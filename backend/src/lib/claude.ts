import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

/**
 * The one place the Claude API is reached from.
 *
 * The client is created lazily and kept, because constructing it per request
 * throws away the SDK's connection pool and its retry state. Absence of a key
 * is a first-class state rather than a crash: this is an optional capability,
 * and the rest of the app has to keep working without it.
 */

let client: Anthropic | null = null;

export const isClaudeConfigured = (): boolean => config.anthropicApiKey.length > 0;

export function getClaude(): Anthropic {
  if (!isClaudeConfigured()) {
    throw new ClaudeUnavailableError();
  }
  if (!client) {
    client = new Anthropic({
      apiKey: config.anthropicApiKey,
      // The SDK already retries 429s and 5xx twice with backoff. Three is worth
      // it here because every one of these calls is user-initiated and a
      // visible failure costs more than a second of extra latency.
      maxRetries: 3,
      // Milliseconds in the TypeScript SDK — seconds in Python, which is the
      // classic way to accidentally set a 2-minute timeout to 2 minutes of
      // milliseconds. Two minutes is generous for a streamed answer.
      timeout: 120_000,
    });
  }
  return client;
}

export class ClaudeUnavailableError extends Error {
  constructor() {
    super(
      'AI features are not configured on this server. Set ANTHROPIC_API_KEY to enable them.'
    );
    this.name = 'ClaudeUnavailableError';
  }
}

export const MODEL = config.anthropicModel;

// ── Model capabilities ──────────────────────────────────────────────────────
//
// The model is configuration, so the code that builds a request cannot assume
// the request shape one model accepts is legal on another. Two differences
// matter here and both fail badly:
//
//  · `output_config.effort` is rejected outright by Haiku 4.5 and Sonnet 4.5.
//    Every route in this app sets it, so pointing ANTHROPIC_MODEL at Haiku
//    without this check turns all four AI features into a 400 with a message
//    about an unsupported parameter — which looks like a broken deployment
//    rather than a one-line configuration mistake.
//
//  · The minimum cacheable prefix is model-dependent and is **not** monotonic
//    across generations: 1,024 tokens on Sonnet 5, but 4,096 on Haiku 4.5. A
//    prefix under the floor silently does not cache. No error, no warning from
//    the API — `cache_creation_input_tokens` simply stays 0 and every request
//    pays full price for the whole context.

/** Model families that accept `output_config.effort`. */
const EFFORT_CAPABLE = [
  'claude-fable-',
  'claude-mythos-',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
];

export const supportsEffort = (model: string = MODEL): boolean =>
  EFFORT_CAPABLE.some(prefix => model.startsWith(prefix));

/** Minimum prefix length, in tokens, that this model will cache at all. */
export function cacheFloor(model: string = MODEL): number {
  if (model.startsWith('claude-haiku-4-5') || model.startsWith('claude-opus-4-6') || model.startsWith('claude-opus-4-5')) {
    return 4096;
  }
  if (model.startsWith('claude-opus-4-7') || model.startsWith('claude-mythos-preview')) return 2048;
  if (model.startsWith('claude-opus-5') || model.startsWith('claude-fable-') || model.startsWith('claude-mythos-5')) return 512;
  return 1024;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * The `output_config` for a request, with `effort` dropped when the configured
 * model would reject it.
 *
 * Returning the whole object rather than just the effort keeps the call sites
 * from having to spread two conditionals together, which is where this kind of
 * thing gets forgotten.
 */
export function outputConfig(
  effort: Effort,
  format?: { type: 'json_schema'; schema: Record<string, unknown> }
): Record<string, unknown> {
  return {
    ...(supportsEffort() ? { effort } : {}),
    ...(format ? { format } : {}),
  };
}

// ── Rate limiting ───────────────────────────────────────────────────────────
//
// A fixed window per account, held in memory. That is the right size of
// solution for a single-process personal deployment: it bounds the bill if a
// client ends up in a retry loop, and it costs nothing. It deliberately does
// not survive a restart or coordinate across instances — if this ever runs
// multi-instance, this moves to Mongo or Redis.

const WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window rolls over. */
  retryAfter: number;
}

export function takeRateToken(userId: string): RateVerdict {
  const now = Date.now();
  const bucket = buckets.get(userId);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: config.aiRequestsPerHour - 1, retryAfter: 0 };
  }

  if (bucket.count >= config.aiRequestsPerHour) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: config.aiRequestsPerHour - bucket.count,
    retryAfter: 0,
  };
}

/**
 * Drops expired buckets so a long-lived process doesn't accumulate one entry
 * per account that ever used the feature. `unref` so this timer alone can't
 * keep the process alive.
 */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, WINDOW_MS);
sweeper.unref?.();

// ── Shared prompt material ──────────────────────────────────────────────────

/**
 * The voice.
 *
 * Most of this prompt is a list of things not to do, and that is deliberate:
 * the default failure mode of an AI money feature is not being wrong, it is
 * being *insufferable* — congratulating you on a coffee, calling a normal month
 * "a great job", padding two facts into six sentences. Every rule below exists
 * because the un-prompted version does the opposite.
 */
export const VOICE = `You are the analyst inside a personal finance app. You are talking to the one person whose money this is.

How to write:
- Lead with the number and the answer. No preamble, no "great question", no restating what was asked.
- Be specific: name categories, merchants, dates and amounts from the data. A sentence with no figure in it is usually not worth sending.
- Short. A couple of sentences for a simple question. Never pad to seem thorough.
- Plain language. No jargon, no emoji, no exclamation marks, no motivational tone.
- Never moralise about spending. Someone's money is theirs; your job is to be accurate about it, not to approve of it. Spending on alcohol, gambling, or anything else gets the same neutral treatment as groceries.
- Never congratulate or scold. Report, and where asked, advise.
- If the data does not answer the question, say exactly what is missing in one sentence. Never present an estimate as a measurement.
- **Invent nothing.** Not a figure, and not a detail either — no merchant, shop, brand or place that is not written in the data. If a payment's description is "MacBook Air", that is what it is; do not add where it was bought. A plausible-sounding invented fact is worse than a vague true one, because it cannot be checked and it destroys trust in the figures beside it.
- Round figures for reading: no decimal places unless the decimals carry information. Every amount carries the currency symbol and thousands separators — "₹9,973", never "9973" and never "9973/mo".
- The current month is incomplete. Never compare a partial month to a complete one without saying so.
- Currency is fixed by the account. Use the symbol you are given; never convert.
- No markdown headers. Short paragraphs; a bare "-" list only when actually listing things.
- **No bold labels on sections.** "**The critical issue:**" followed by "**The full picture:**" is a report layout, and a report is not what was asked for. Say the critical issue first, in a sentence. Bold is for a single figure that carries the answer, at most once, and usually not at all.
  When you do list lines — a budget, a set of subscriptions, options — write them as a plain list: "- Groceries ₹14,600 — median is ₹14,305". The name is not bold. Eight bolded names in a row is a table pretending to be prose.
  This applies hardest to "how am I doing" — the question that most invites a four-heading summary and least wants one. Answer it as: one sentence of verdict, then two or three short paragraphs of the evidence that decided it, then the one thing worth doing. If a paragraph needs a label to be understood, the paragraph is in the wrong order.
- Never narrate what you are about to do. "Let me check that", "I need to look at your position" — the person sees an answer appear, not your process. Start with the answer.
- Never end by offering to do more, and never end with a question unless the answer genuinely depends on something only they know. "Which of those is possible?" at the end of a hard answer hands the work back at the moment they most need you to have done it — say which you would try first and why.

When money is owed:
- An instalment is not "spending" in the sense a coffee is. Part of it retires principal and part is interest, and only the interest is a cost. Say which when it matters.
- Rank debts by interest rate, not by size, unless asked otherwise — and say when the two orders disagree.
- Never suggest borrowing to solve a cash-flow problem. Suggest what the numbers support: a larger payment, a smaller one, a different order, or waiting.
- A debt whose payment does not cover its interest is the most important fact about someone's finances. Lead with it.

When asked whether something is affordable:
- Use the affordability tool. It is the same code the app's own answer comes from, so a number you compute by hand can disagree with the screen — and the screen is what they will trust.
- Give the verdict first, then the two or three figures it rests on. Never list every number you were handed.
- Affordable and advisable are different questions. Answer the one asked, and add the other only where it changes the decision.
- If something is missing — no income recorded, no balances, one month of history — say so in a sentence and answer anyway with what there is, flagged. Refusing to answer is not caution, it is unhelpfulness.`;
