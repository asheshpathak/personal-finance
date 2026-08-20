import express, { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { authenticateToken, clientDay, AuthRequest } from '../middleware/auth';
import { toDayKey } from '../lib/schedule';
import { buildFinanceSnapshot } from '../lib/financeSnapshot';
import { FINANCE_TOOLS, makeToolRunner } from '../lib/financeTools';
import { runSubscriptionCharges } from '../lib/subscriptionCharges';
import { runDebtCharges } from '../lib/debtCharges';
import { loadPosition } from '../lib/loadPosition';
import DailyBrief from '../models/DailyBrief';
import Expense from '../models/Expense';
import {
  MODEL,
  VOICE,
  cacheFloor,
  getClaude,
  isClaudeConfigured,
  outputConfig,
  takeRateToken,
} from '../lib/claude';

/**
 * The AI surface.
 *
 * Everything here is *read-only over the user's own data*. Claude never writes
 * an expense, edits a budget or deletes anything: the capture endpoint returns
 * a draft that lands in the form, and the person taps save. That boundary is
 * the whole safety story — the worst a bad completion can do is propose a wrong
 * number that a human then declines.
 *
 * Every route shares one shape: cheap gate (configured? rate limited?), build
 * the financial context, put it in a *cached* system block, put the volatile
 * part after it.
 */

const router = express.Router();

router.use(authenticateToken);

/**
 * Past this the model has more context than it can use well and the bill starts
 * mattering. Nowhere near the model's window — a quality and cost guard, not a
 * technical limit.
 */
const MAX_CONTEXT_TOKENS = 60_000;

/** Answers are short by design; a long one is a symptom, not a feature. */
const CHAT_MAX_TOKENS = 2000;

/**
 * Hard ceiling on the tool loop, so a confused model can't bill forever.
 *
 * Raised from five when the tool surface grew from one lookup to six. A real
 * planning conversation legitimately chains — draft a budget, project the
 * cash flow it implies, check one purchase against it — and cutting that off
 * at five reads to the user as the assistant giving up mid-thought.
 */
const MAX_TOOL_ROUNDS = 8;

type Gate =
  | { ok: true; userId: string; today: string }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * The checks every route runs before spending anything.
 *
 * Returned rather than thrown so a streaming route can answer with an ordinary
 * JSON error *before* it commits to SSE — once the headers say
 * text/event-stream there is no way back to a status code the client can read.
 */
function gate(req: AuthRequest): Gate {
  if (!isClaudeConfigured()) {
    return {
      ok: false,
      status: 503,
      body: { error: 'AI is not configured on this server.', code: 'ai_not_configured' },
    };
  }

  const userId = req.user!.id;
  const verdict = takeRateToken(userId);
  if (!verdict.allowed) {
    return {
      ok: false,
      status: 429,
      body: {
        error: `You've used this a lot in the last hour. Try again in ${Math.max(1, Math.ceil(verdict.retryAfter / 60))} minutes.`,
        code: 'rate_limited',
        retryAfter: verdict.retryAfter,
      },
    };
  }

  return { ok: true, userId, today: clientDay(req) ?? toDayKey(new Date()) };
}

/**
 * Maps an SDK error onto something worth showing a person.
 *
 * `APIConnectionError` is checked before `APIError` deliberately: in the
 * TypeScript SDK it is a *subclass*, so the general branch would swallow it and
 * report "the service returned an error" for what is actually a dead network.
 */
function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error('[ai] credentials rejected', err.requestID);
    return { status: 502, message: 'The AI service rejected this server\'s credentials.' };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'The AI service is busy. Try again in a moment.' };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 504, message: 'Could not reach the AI service. Check your connection.' };
  }
  if (err instanceof Anthropic.APIError) {
    console.error('[ai] api error', err.status, err.name, err.requestID);
    return { status: 502, message: 'The AI service returned an error. Try again in a moment.' };
  }
  return { status: 500, message: 'Something went wrong generating that.' };
}

/** Every text block of a response, joined. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
}

/**
 * The system prompt, split for caching.
 *
 * The order is the entire point. The voice never changes; the financial context
 * changes at most once a day; the task changes per route. Caching is a strict
 * *prefix* match, so the breakpoint goes after the context and every later call
 * in a session re-reads the expensive part at a tenth of the price. Putting the
 * task first — the intuitive order — would give every route a different prefix
 * and a cache that never hits.
 *
 * `ttl` is a real trade: a 1h write costs 2× and only pays back on the third
 * read, so it belongs on the endpoints someone uses repeatedly in a sitting.
 */
function systemFor(
  context: string,
  task: string,
  ttl: '5m' | '1h' = '5m'
): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: VOICE },
    { type: 'text', text: context, cache_control: { type: 'ephemeral', ttl } },
    { type: 'text', text: task },
  ];
}

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * Whether the AI features exist on this deployment.
 *
 * The client asks once and hides every AI surface if the answer is no, which is
 * better than showing controls that fail. Outside the rate limit — it spends
 * nothing.
 */
router.get('/status', (_req: AuthRequest, res: Response) => {
  res.json({ configured: isClaudeConfigured(), model: isClaudeConfigured() ? MODEL : null });
});

// ── Chat ────────────────────────────────────────────────────────────────────

const CHAT_TASK = `The person is asking about their own money.

Answer from the summary above where it covers the question. When it does not, use a tool. Which one:

- An older period, a specific merchant, an exact total → **query_expenses**. Group by category or month when the question is about a total; that comes back exact.
- Any form of "can I afford", "should I buy", "is this a good idea financially" → **check_affordability**. Always. Do not weigh it up yourself: that tool is the same code the app's own answer comes from, and a figure you derive independently will eventually disagree with the one on their screen.
- "Which debt first", "how fast can I be debt free", spare money and several debts → **compare_debt_strategies**.
- A lump sum or a bigger instalment against one loan → **simulate_debt_payment**.
- Anything about a point in the future — "by June", "when could I", "will I be short", "how long can I last", "what if I took time off" → **project_cashflow**. It models income stopping for a stretch, a permanent raise or cut, and an extra monthly commitment.
- Planning a month, or "what should my budget be" → **draft_budget**.

Rules for using them:
- **Write nothing in a turn where you call a tool.** No "let me check", no "I'll look at that", no preamble at all — call the tool, then write the answer once you have the result. Anything you type alongside a tool call is shown to the person before the answer arrives, and it reads as the app talking to itself.
- One call is usually enough. Chain only when the second genuinely needs the first's answer.
- If a tool comes back with an error, fix the call and try again silently. Never write about having got one wrong — the person did not see the first attempt and does not need to.
- **Assume the obvious thing rather than asking.** "Can I afford three months off" means no income for three months starting soon: run it and say what you assumed. "Should I increase my EMI" means by roughly what they have spare: run it at that and say so. A question back is only right when the answer genuinely turns on something the data cannot contain, and even then, answer the likeliest reading first and offer to redo it.
- Report what the tool returned. Do not recompute its figures, round them differently, or argue with them.
- When a tool reports something is missing — no income recorded, no balances, one month of history — say so in one clause and answer anyway with what there is. Never refuse for want of data you were not asked to have.

Do the arithmetic yourself only where no tool covers it, and state the result. Never describe how they could work it out.

If a category they name does not exist in their data, say so and name the closest one that does.

The currency is stated at the top of the summary and it is fixed by the account. Every amount you write carries that symbol. Never write a figure with the other currency's symbol, in any part of any sentence — an account is in one currency, and mixing them makes every number on the page suspect.`;

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Keeps the transcript bounded and free of anything that isn't a plain turn. */
function sanitizeHistory(raw: unknown): Anthropic.MessageParam[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((turn): turn is ChatTurn => {
      if (!turn || typeof turn !== 'object') return false;
      const t = turn as Partial<ChatTurn>;
      return (
        (t.role === 'user' || t.role === 'assistant') &&
        typeof t.content === 'string' &&
        t.content.trim().length > 0
      );
    })
    // Twelve turns is six exchanges. Past that a conversation about money has
    // almost always moved on, and every extra turn is paid for on every request.
    .slice(-12)
    .map(turn => ({ role: turn.role, content: turn.content.slice(0, 4000) }));
}

/**
 * Streamed answer over Server-Sent Events, with a tool loop behind it.
 *
 * SSE rather than a plain JSON response because a first token in half a second
 * reads as fast, and a complete answer in eight seconds reads as broken — even
 * though the second one delivers more information sooner by every measure that
 * isn't a human waiting.
 */
router.post('/chat', async (req: AuthRequest, res: Response) => {
  const check = gate(req);
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }

  const question = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!question) {
    res.status(400).json({ error: 'Ask a question.' });
    return;
  }
  if (question.length > 2000) {
    res.status(400).json({ error: 'That question is too long.' });
    return;
  }

  let snapshot;
  try {
    snapshot = await buildFinanceSnapshot(check.userId, { today: check.today });
  } catch (err) {
    console.error('[ai] snapshot failed:', err);
    res.status(500).json({ error: 'Could not read your financial data.' });
    return;
  }

  if (snapshot.approxTokens > MAX_CONTEXT_TOKENS) {
    console.warn(`[ai] large context (~${snapshot.approxTokens} tokens) for user ${check.userId}`);
  }
  // Under the model's floor the prefix silently does not cache — no error, and
  // `cache_creation_input_tokens` simply stays 0 while every request pays full
  // price for the whole block. Worth a line in the log, since nothing else
  // would ever surface it.
  if (snapshot.approxTokens < cacheFloor()) {
    console.warn(
      `[ai] context (~${snapshot.approxTokens} tokens) is under ${MODEL}'s ${cacheFloor()}-token cache floor — this request will not cache.`
    );
  }

  // Past this point the status line is spent, so every failure has to be
  // reported inside the stream.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx and most proxies buffer a response body by default, which turns a
    // stream into one delayed blob. This is the header that stops them.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // An SSE comment every 15s. Load balancers idle out a quiet socket, and a
  // tool round is easily long enough to be quiet.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  // A reader who navigates away should stop the generation, not keep paying for
  // tokens nobody will see.
  const controller = new AbortController();
  const onClose = () => controller.abort();
  req.on('close', onClose);

  const messages: Anthropic.MessageParam[] = [
    ...sanitizeHistory(req.body?.history),
    { role: 'user', content: question },
  ];

  const usage = { input: 0, output: 0, cacheRead: 0 };

  // One runner per request: four of the six tools need the full financial
  // position, and building it reads seven collections. Memoizing it here means
  // a conversation that chains three tools pays for it once.
  const runTool = makeToolRunner({
    userId: check.userId,
    today: check.today,
    position: snapshot.position,
  });

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = getClaude().messages.stream(
        {
          model: MODEL,
          max_tokens: CHAT_MAX_TOKENS,
          system: systemFor(snapshot.text, CHAT_TASK, '1h'),
          // Low effort on purpose: these are lookups and small sums over data
          // already in front of the model, with the heavy arithmetic done by
          // tools. Dropped entirely when the configured model rejects the
          // parameter — Haiku 4.5 answers a request carrying it with a 400.
          output_config: outputConfig('low'),
          tools: FINANCE_TOOLS,
          messages,
        },
        { signal: controller.signal }
      );

      stream.on('text', text => send('delta', { text }));

      const final = await stream.finalMessage();

      usage.input += final.usage.input_tokens;
      usage.output += final.usage.output_tokens;
      usage.cacheRead += final.usage.cache_read_input_tokens ?? 0;

      if (final.stop_reason === 'refusal') {
        send('error', { message: 'I can\'t answer that one.' });
        break;
      }

      if (final.stop_reason !== 'tool_use') break;

      const calls = final.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      send('tool', { count: calls.length });

      // Parallel calls have to come back as tool_result blocks in ONE user
      // message. Splitting them across messages is accepted by the API and
      // quietly teaches the model to stop calling tools in parallel.
      const results = await Promise.all(
        calls.map(async call => ({
          type: 'tool_result' as const,
          tool_use_id: call.id,
          content: await runTool(call.name, call.input),
        }))
      );

      messages.push({ role: 'assistant', content: final.content });
      messages.push({ role: 'user', content: results });

      if (round === MAX_TOOL_ROUNDS - 1) {
        send('error', { message: 'That took more lookups than I\'m allowed. Try narrowing the question.' });
      }
    }

    send('done', { usage });
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError || controller.signal.aborted) {
      // The reader left. There is nobody to report to.
    } else {
      console.error('[ai] chat failed:', err);
      send('error', { message: describeError(err).message });
    }
  } finally {
    clearInterval(heartbeat);
    req.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
});

// ── Briefing ────────────────────────────────────────────────────────────────

/**
 * The shape of a briefing.
 *
 * Forced through a schema rather than parsed out of prose because these render
 * as cards, and a card needs a known field in a known slot. The fields are also
 * the guardrails: `metric` obliges every insight to carry a figure, and `tone`
 * obliges it to commit to whether this is good news.
 *
 * Structured output does not support numeric or length bounds, and array
 * `minItems` only accepts 0 or 1 — so counts and lengths are stated in the
 * descriptions, which the model follows, and never relied on for correctness.
 */
const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'standing', 'pace', 'insights'],
  properties: {
    headline: {
      type: 'string',
      description:
        'One sentence, at most 110 characters, naming the single most important thing about their money right now. Must contain a figure.',
    },
    standing: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'tone'],
      description: 'Where they stand overall today. The one-line answer to "how am I doing".',
      properties: {
        summary: {
          type: 'string',
          description:
            'One or two sentences on the whole position: what comes in, what is committed, what is genuinely left, and whether that is working. Must carry at least two real figures.',
        },
        tone: {
          type: 'string',
          enum: ['strong', 'steady', 'tight', 'strained'],
          description:
            'strong = comfortable margin and no debt problem; steady = it works, nothing alarming; tight = it works but with almost nothing spare; strained = the numbers do not currently work.',
        },
      },
    },
    pace: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'detail', 'metric'],
      description:
        'How this month is going against how their months usually go — compared at the SAME POINT in the month, never a partial month against a whole one.',
      properties: {
        status: {
          type: 'string',
          enum: ['ahead', 'on-track', 'behind', 'too-early'],
          description:
            'ahead = spending less than usual by this day; on-track = about normal; behind = spending more than usual by this day; too-early = fewer than four days in, or not enough history to say.',
        },
        detail: {
          type: 'string',
          description:
            'One sentence with the comparison in it, and the day of the month it is measured at. E.g. "By the 20th you have usually spent about X; you are at Y."',
        },
        metric: {
          type: 'string',
          description: 'The single figure, formatted for display — a percentage or an amount with its symbol.',
        },
      },
    },
    insights: {
      type: 'array',
      description: 'Between two and five insights, most consequential first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'metric', 'tone'],
        properties: {
          title: {
            type: 'string',
            description:
              'At most 48 characters. The finding itself, not a category name. ' +
              'Must be consistent with the figures in `detail` — never claim a direction the numbers contradict.',
          },
          detail: {
            type: 'string',
            description: 'One or two sentences of evidence, with real figures and dates from the data.',
          },
          metric: {
            type: 'string',
            description:
              'The single number this is about, formatted for display, e.g. "₹4,820" or "38%". ' +
              'Rounded — no decimal places unless they carry information.',
          },
          tone: {
            type: 'string',
            enum: ['good', 'watch', 'risk', 'neutral'],
            description:
              'good = genuinely in their favour; watch = worth an eye; risk = will cost them if nothing changes; neutral = a fact.',
          },
          action: {
            type: 'string',
            description:
              'Optional. One concrete thing to do, at most 90 characters. Omit rather than invent one.',
          },
        },
      },
    },
  },
} as const;

const BRIEF_TASK = `Write this person's briefing on their money, as of today. It is written once each morning and read all day, so it has to be worth reading once rather than glanceable forever.

Three parts, in this order.

**standing** — where they are overall. Income, what is committed before any choice, what is genuinely left in a normal month, and whether that arrangement works. This is the answer to "how am I doing" and it is the part most people read and nothing else, so it carries the whole position in two sentences with real figures in them. If a debt is growing rather than shrinking, that is the standing and nothing else competes with it.

**pace** — how this month is going against how their months usually go. The context carries a line beginning "PACE:" with this already worked out, measured at the same day of the month across their history. **Quote those figures and that status.** Do not compute your own version by prorating a monthly median across the days elapsed: that assumes spending is spread evenly through a month, and nobody's is — rent and subscriptions land in the first week — so it reports every month as running hot until the 10th and cold afterwards. Where the PACE line says it is too early, the status is "too-early" and the detail says why.

**insights** — what is true and non-obvious. A good insight is one they could not have got from looking at a total: a category quietly climbing for three months, a subscription costing more than they think, a debt whose interest is larger than they realise, a month where one payment accounts for most of the movement, a plan line that is wrong in the same direction every time.

Rules:
- Every insight must be checkable against the data above. Quote the real figures.
- **The title and the detail must agree.** Before writing a title, check it against the figures you are about to put in the detail: a title saying a line is under budget, above a detail showing it over, is worse than no insight at all — it makes every other claim on the card suspect.
- The tone must match the same arithmetic. "good" means the figures are genuinely in their favour, not that the sentence sounds encouraging.
- Rank by money at stake, not by how interesting it sounds. A debt costing 42% a year outranks a category that moved 8%.
- The current month is partial. Say "so far" when you mean so far.
- Do not tell them to make a budget if they have one, and do not tell them to spend less as a general principle.
- If there genuinely isn't much to say, return two honest insights rather than five padded ones.
- The context already carries free cash flow, debt-to-income, runway, the interest each debt costs per month, and the split between essential and discretionary spending. Use those figures; do not re-derive them, and do not contradict them.
- Nothing here congratulates. "Steady" is a description, not praise.`;

/**
 * How many fresh reads a person may ask for in one day.
 *
 * The briefing is a fact about a day, so asking for another one is asking for a
 * different opinion about the same facts — occasionally reasonable after
 * recording a big payment, and not something to do six times. The hourly rate
 * limit already bounds the bill; this bounds the *incoherence*.
 */
const MAX_REGENERATIONS_PER_DAY = 3;

/**
 * A cheap summary of the data a briefing was written from.
 *
 * Compared against today's to tell the reader their ground has moved. It is
 * deliberately coarse — payment count, spend so far, debt — because a
 * fingerprint that changed on every rupee would flag every visit, and one that
 * changed on nothing would flag none.
 */
function fingerprintOf(position: {
  spending: { thisMonthSoFar: number };
  debtTotals: { balance: number };
  income: { monthly: number };
}, expenses: number): string {
  return [
    expenses,
    Math.round(position.spending.thisMonthSoFar / 100),
    Math.round(position.debtTotals.balance / 100),
    Math.round(position.income.monthly / 100),
  ].join(':');
}

/**
 * The daily briefing.
 *
 * Written once per calendar day and served from storage for the rest of it. The
 * caching is not primarily about cost — it is about the briefing being the same
 * briefing. A dashboard insight that reworded itself on every page load taught
 * people to stop reading it, which is the failure this endpoint is shaped to
 * avoid.
 *
 * The cache is checked *before* the rate-limit token is taken, so opening the
 * app twenty times in a morning spends nothing and consumes no allowance.
 */
router.post('/brief', async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const today = clientDay(req) ?? toDayKey(new Date());
  const wantsFresh = req.body?.refresh === true;

  let existing: any = null;
  try {
    existing = await DailyBrief.findOne({ userId, day: today }).lean();
  } catch (err) {
    // A cache read failing must not cost anyone their briefing.
    console.error('[ai] brief cache read failed:', err);
  }

  if (existing && !wantsFresh) {
    res.json({ ...existing.payload, day: today, cached: true, fingerprint: existing.fingerprint });
    return;
  }

  if (existing && wantsFresh && (existing.regenerations ?? 0) >= MAX_REGENERATIONS_PER_DAY) {
    res.json({
      ...existing.payload,
      day: today,
      cached: true,
      fingerprint: existing.fingerprint,
      regenerationsExhausted: true,
    });
    return;
  }

  const check = gate(req);
  if (!check.ok) {
    // A rate limit should not blank a briefing that already exists.
    if (existing) {
      res.json({ ...existing.payload, day: today, cached: true, fingerprint: existing.fingerprint });
      return;
    }
    res.status(check.status).json(check.body);
    return;
  }

  try {
    // Instalments and subscriptions post themselves before anything is
    // measured, or the first briefing of the month describes a month that has
    // not had its rent charged to it yet.
    await Promise.all([
      runSubscriptionCharges(check.userId, clientDay(req)).catch(() => undefined),
      runDebtCharges(check.userId, clientDay(req)).catch(() => undefined),
    ]);

    const snapshot = await buildFinanceSnapshot(check.userId, { today: check.today });

    if (snapshot.counts.expenses < 5) {
      res.json({
        headline: 'Not enough recorded yet to say anything useful.',
        standing: null,
        pace: null,
        insights: [],
        sparse: true,
        day: today,
        cached: false,
      });
      return;
    }

    const message = await getClaude().messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: systemFor(snapshot.text, BRIEF_TASK, '1h'),
      // A step above chat, not the top of the scale: this has to *find* the
      // story rather than look up an answer, but the search space is a table of
      // twenty categories over six months plus a handful of debts. Effort past
      // `medium` was buying thinking tokens, not better findings.
      output_config: outputConfig('medium', {
        type: 'json_schema',
        schema: BRIEF_SCHEMA as unknown as Record<string, unknown>,
      }),
      messages: [{ role: 'user', content: 'Give me the briefing.' }],
    });

    if (message.stop_reason === 'refusal') {
      res.status(502).json({ error: 'Could not produce a briefing.' });
      return;
    }

    const payload = { ...JSON.parse(textOf(message.content)), sparse: false };
    const fingerprint = fingerprintOf(snapshot.position, snapshot.counts.expenses);

    // Upsert rather than insert: two tabs opening at once would otherwise race
    // on the unique index and one of them would 500 for no reason.
    await DailyBrief.findOneAndUpdate(
      { userId, day: today },
      {
        payload,
        model: MODEL,
        fingerprint,
        $inc: { regenerations: existing ? 1 : 0 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).catch(err => console.error('[ai] brief cache write failed:', err));

    res.json({ ...payload, day: today, cached: false, fingerprint });
  } catch (err) {
    console.error('[ai] brief failed:', err);
    if (existing) {
      // Yesterday's answer beats an error message on a dashboard.
      res.json({ ...existing.payload, day: today, cached: true, fingerprint: existing.fingerprint, stale: true });
      return;
    }
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

/**
 * The fingerprint of the data as it stands right now.
 *
 * Lets the card say "three payments have gone in since this was written" without
 * spending a token. Outside the rate limit — it reads the database and nothing
 * else.
 */
router.get('/brief/freshness', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const today = clientDay(req) ?? toDayKey(new Date());
    const [existing, position] = await Promise.all([
      DailyBrief.findOne({ userId, day: today }).lean(),
      loadPosition(userId, today),
    ]);

    const expenses = await Expense.countDocuments({ userId });
    const current = fingerprintOf(position, expenses);

    res.json({
      hasBrief: Boolean(existing),
      current,
      written: existing?.fingerprint ?? null,
      changed: Boolean(existing) && existing?.fingerprint !== current,
      regenerationsLeft: Math.max(0, MAX_REGENERATIONS_PER_DAY - (existing?.regenerations ?? 0)),
    });
  } catch (err) {
    console.error('[ai] freshness failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Capture ─────────────────────────────────────────────────────────────────

const CAPTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'category', 'paymentMode', 'description', 'date', 'confidence'],
  properties: {
    amount: { type: 'number', description: 'The amount as a number. 0 if none was given.' },
    category: {
      type: 'string',
      description: 'Exactly one of the allowed categories listed in the task. Never invent one.',
    },
    paymentMode: {
      type: 'string',
      enum: ['Credit Card', 'Debit Card', 'Cash', 'Bank Transfer'],
    },
    description: {
      type: 'string',
      description:
        'A short human label for this payment — the merchant or the thing bought, in their own words, tidied. ' +
        'Copy it out of the text; never invent one, and never emit filler like "placeholder", "unknown" or "N/A". ' +
        'If the text genuinely says nothing beyond a category, use an empty string.',
    },
    date: { type: 'string', description: 'YYYY-MM-DD. Today unless the text says otherwise.' },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description:
        'About the amount and the category only — never about the description or the payment mode. ' +
        'low when the amount is ambiguous or the category had to be guessed; otherwise high.',
    },
    note: {
      type: 'string',
      description: 'Optional. What you were unsure about, under 70 characters.',
    },
  },
} as const;

/**
 * Words a model writes when it has nothing to write.
 *
 * These are artefacts of a required field under constrained decoding, not
 * anything the person said, and every one of them would be saved as the
 * description of a real payment.
 */
const FILLER = new Set([
  'placeholder',
  'n/a',
  'na',
  'none',
  'unknown',
  'unspecified',
  'no description',
  'not specified',
  '-',
  '--',
]);

/**
 * One line of text into a filled-in expense form.
 *
 * The highest-leverage AI feature in the app, and the reason is friction rather
 * than intelligence: an expense that takes four taps and two dropdowns often
 * doesn't get recorded at all, and a tracker with holes in it is worse than
 * useless because every total it shows is quietly wrong. "chai 30 cash" typed
 * one-handed at a stall is the whole point.
 *
 * The result is a draft. It lands in the form with every field editable, and
 * nothing is written until the person presses save.
 */
router.post('/capture', async (req: AuthRequest, res: Response) => {
  const check = gate(req);
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: 'Nothing to read.' });
    return;
  }
  if (text.length > 400) {
    res.status(400).json({ error: 'That is too long for a quick entry.' });
    return;
  }

  const categories = Array.isArray(req.body?.categories)
    ? (req.body.categories as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  if (categories.length === 0) {
    res.status(400).json({ error: 'No categories supplied.' });
    return;
  }

  const task = `Turn one line of text into an expense.

Today is ${check.today}. Resolve relative dates ("yesterday", "last Friday") against it, and never return a future date — if the text implies one, use today.

The category must be exactly one of these, copied character for character:
${categories.map(c => `- ${c}`).join('\n')}

Reading the text:
- The number is the amount. Handle "1.2k", "1,200", "₹1200", "$12.50", "12 dollars". Indian shorthand: "k" is a thousand, "L"/"lakh" is 100,000, "cr"/"crore" is 10,000,000.
- Payment words map to modes. upi, gpay, phonepe, paytm, netbanking, bank, transfer, neft → Bank Transfer. card, credit, cc, visa, amex → Credit Card. debit, dc → Debit Card. cash, note, change → Cash. Nothing said → whichever mode dominates the recent payments above, or Cash if there is no history.
- Use the recent payments above to resolve merchants: if "swiggy" is filed under Dining Out in their history, file it there again. Their own habits beat your assumptions.
- The description is what the payment was — the merchant, or the thing bought — not a restatement of the whole sentence. Take the words from the text. "uber to airport 850 gpay" is "Uber to airport". If the text carries nothing beyond a category, leave it empty rather than writing anything to fill the field.
- Confidence is about the amount and the category, and nothing else. A payment whose amount and category are both plain is high confidence even if the note or the payment mode had to be inferred.
- Set confidence to low, and say why in the note, when the amount is ambiguous or the category is a guess. A wrong number recorded confidently is worse than one that is flagged.`;

  try {
    const snapshot = await buildFinanceSnapshot(check.userId, {
      today: check.today,
      // Enough recent history to learn merchant→category and a habitual payment
      // mode, without paying for a year of it on every quick entry.
      recentLimit: 30,
      months: 2,
      // Reading "chai 30 cash" into a form does not need the loan book. Sending
      // it anyway would be several hundred tokens on the latency-sensitive path
      // in the app, on every entry.
      include: { debts: false, assets: false, income: false, budgets: false },
    });

    const message = await getClaude().messages.create({
      model: MODEL,
      max_tokens: 700,
      system: systemFor(snapshot.text, task, '1h'),
      // A parse, not a deliberation — and it sits directly in front of someone
      // waiting to record a coffee.
      output_config: outputConfig('low', {
        type: 'json_schema',
        schema: CAPTURE_SCHEMA as unknown as Record<string, unknown>,
      }),
      messages: [{ role: 'user', content: text }],
    });

    if (message.stop_reason === 'refusal') {
      res.status(502).json({ error: 'Could not read that.' });
      return;
    }

    const draft = JSON.parse(textOf(message.content)) as Record<string, unknown>;

    // The schema constrains the shape, not the truth. A category outside the
    // list would fail silently in the form's select — an empty picker with no
    // explanation — so it is checked here instead.
    if (typeof draft.category !== 'string' || !categories.includes(draft.category)) {
      draft.category = '';
      draft.confidence = 'low';
      draft.note = 'Pick a category — I couldn\'t match one.';
    }

    // Constrained decoding will fill a required string field rather than leave
    // it out, and when the model has nothing to say the filler it reaches for is
    // a word like "placeholder". That lands in the note field of a real expense
    // and is worse than blank, so known filler is treated as blank.
    if (typeof draft.description === 'string' && FILLER.has(draft.description.trim().toLowerCase())) {
      draft.description = '';
    }

    res.json(draft);
  } catch (err) {
    console.error('[ai] capture failed:', err);
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// ── Plan review ─────────────────────────────────────────────────────────────

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'notes'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['solid', 'workable', 'unrealistic'],
      description:
        'unrealistic = history says they will break this plan; workable = it needs a couple of changes; solid = it matches how they actually spend.',
    },
    summary: {
      type: 'string',
      description: 'One or two sentences on whether this plan survives contact with their history.',
    },
    notes: {
      type: 'array',
      description: 'At most six points, most consequential first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'issue', 'kind'],
        properties: {
          category: {
            type: 'string',
            description: 'A category name from the plan, or "" for a point about the whole plan.',
          },
          kind: { type: 'string', enum: ['too-low', 'too-high', 'missing', 'good'] },
          issue: {
            type: 'string',
            description:
              'One sentence, with the figures that show it. Format every amount with the ' +
              'currency symbol and thousands separators the context uses — never a bare integer.',
          },
          suggested: { type: 'number', description: 'Optional. A better number for this line.' },
        },
      },
    },
  },
} as const;

/**
 * Reads a budget draft against the history that will be spent against it.
 *
 * The app's own statistics already suggest a number per line. What they cannot
 * do is look at the plan *as a whole* and notice that it is internally
 * implausible — that groceries were cut 40% in the same month a gym membership
 * was added, or that the total assumes a month with no birthdays in a year that
 * has had one every month. That judgement is why this call exists.
 */
router.post('/review-plan', async (req: AuthRequest, res: Response) => {
  const check = gate(req);
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }

  const plan = req.body?.plan;
  if (!plan || typeof plan !== 'object') {
    res.status(400).json({ error: 'No plan to review.' });
    return;
  }

  const task = `Review this draft budget against the spending history above.

The draft, as JSON:
${JSON.stringify(plan).slice(0, 6000)}

What to look for, in order of value:
1. **Whether the plan accounts for what is already committed.** Instalments and subscriptions leave before any of this is allocated. A plan whose total ignores them is not optimistic, it is arithmetically impossible, and this outranks every other note.
2. Lines set below what this person has actually spent, month after month. These are what break a plan.
3. Real, regular spending the plan has no line for at all — the usual reason a budget "fails" is money with nowhere to charge it to.
4. Lines set well above history, where money would sit unused and could be doing something else.
5. Whether the total is consistent with the income above — which is the account's recorded income, not a number typed into this plan.
6. Whether anything is set aside at all. A plan that allocates every rupee to spending has no answer to the first unexpected bill.

Say nothing about lines that are fine, except at most one where the number is well judged. Do not comment on subscription prices — those are set by the provider, not chosen.

Write every amount the way the data above writes it: with the currency symbol and thousands separators, rounded. "44400/month" is a figure nobody reads; "₹44,400 a month" is.`;

  try {
    const snapshot = await buildFinanceSnapshot(check.userId, { today: check.today });

    const message = await getClaude().messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemFor(snapshot.text, task, '1h'),
      output_config: outputConfig('medium', {
        type: 'json_schema',
        schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
      }),
      messages: [{ role: 'user', content: 'Review it.' }],
    });

    if (message.stop_reason === 'refusal') {
      res.status(502).json({ error: 'Could not review that plan.' });
      return;
    }

    res.json(JSON.parse(textOf(message.content)));
  } catch (err) {
    console.error('[ai] review-plan failed:', err);
    const { status, message } = describeError(err);
    res.status(status).json({ error: message });
  }
});

// ── Budget drafting ─────────────────────────────────────────────────────────

/**
 * The shape of a proposed budget.
 *
 * Declared as a *tool* rather than a structured output, and that is the whole
 * design of this endpoint. A structured output would force the model to choose
 * between talking and proposing on every turn; as a tool it can do both — say
 * "your dining out has been ₹14,000 a month, not the ₹8,000 you suggested", and
 * hand over a revised plan in the same turn. The server intercepts the call,
 * streams the proposal to the client as its own event, and tells the model it
 * landed. Nothing is written: the plan appears in the app as a draft the person
 * edits and saves.
 */
const PROPOSE_BUDGET_TOOL: Anthropic.Tool = {
  name: 'propose_budget',
  description:
    'Hand the person a budget to look at. Call this once you have something worth showing — '
    + 'after drafting, or after they have asked for a change. It puts an editable plan on their screen; '
    + 'it does not save anything. Call it again with the whole revised plan whenever they ask for a change; '
    + 'never describe an edit in prose and leave the plan on screen stale.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['label', 'startDate', 'endDate', 'income', 'categories', 'summary'],
    properties: {
      label: { type: 'string', description: 'A short name for the plan, e.g. "March" or "Post-bonus".' },
      startDate: { type: 'string', description: 'First day, YYYY-MM-DD.' },
      endDate: { type: 'string', description: 'Last day, YYYY-MM-DD.' },
      income: { type: 'number', description: 'Expected take-home for the period. Use the recorded income unless they say otherwise.' },
      summary: {
        type: 'string',
        description: 'One or two sentences on what this plan does and what it assumes. No headers, no lists.',
      },
      categories: {
        type: 'array',
        description: 'Day-to-day spending lines. Never include Subscriptions or Debt Payments here — they have their own sections.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'allocatedAmount'],
          properties: {
            name: { type: 'string' },
            allocatedAmount: { type: 'number' },
            note: { type: 'string', description: 'Optional. Why this number, in under 80 characters.' },
          },
        },
      },
      savings: {
        type: 'array',
        description: 'Money set aside. Use the savings category names from their history where they exist.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'allocatedAmount'],
          properties: {
            name: { type: 'string' },
            allocatedAmount: { type: 'number' },
            note: { type: 'string' },
          },
        },
      },
      investments: {
        type: 'array',
        description: 'Money put to work — funds, stocks, gold.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'allocatedAmount'],
          properties: {
            name: { type: 'string' },
            allocatedAmount: { type: 'number' },
            note: { type: 'string' },
          },
        },
      },
      debts: {
        type: 'array',
        description: 'Instalments falling inside the period. Take these from draft_budget rather than inventing them.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'amount'],
          properties: {
            name: { type: 'string' },
            amount: { type: 'number' },
            instalments: { type: 'number' },
          },
        },
      },
      subscriptions: {
        type: 'array',
        description: 'Subscriptions carried into the plan, at their recorded price and frequency.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'amount', 'frequency'],
          properties: {
            name: { type: 'string' },
            amount: { type: 'number' },
            frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] },
          },
        },
      },
    },
  },
};

const BUDGET_CHAT_TASK = `You are helping this person build a budget, by talking it through.

Start by calling draft_budget. It builds a complete first plan from what is on record — income, instalments, subscriptions, and what each category has actually cost them — and it returns the reasoning behind every line. Never open by asking what they want to spend on groceries; they have six months of data saying what they spend on groceries, and asking makes the app look like it has not read its own database.

Then: say what the draft does in two or three sentences, name the one or two lines most likely to be wrong or uncomfortable, and call propose_budget so it lands on their screen.

From there they will push back. When they do:
- Take the change, and say what it costs. "Cutting dining out to 6,000 works, but you have been over 12,000 in five of the last six months, so this is the line that will break first."
- Rebalance the rest so the total still holds, and say what you moved.
- Call propose_budget again with the **whole** revised plan. Never describe an edit and leave the old plan on screen.

Hard rules:
- Instalments and subscriptions come off the top. They are not choices inside the month, and a plan whose spending lines assume that money is available is arithmetically impossible rather than merely ambitious.
- Never allocate more than the income. If they ask for something that does not fit, say what does not fit and by how much, and propose the version that does.
- Never plan a category below what it has cost every month for six months without saying so plainly.
- Something must be set aside unless there is genuinely nothing left. A plan with no savings line has no answer to the first unexpected bill.
- If a purchase or a trip comes up, use check_affordability rather than reasoning about it.
- Nothing here is saved. The plan appears in their app as a draft they can edit; say so once, at the end, not every turn.`;

/**
 * Budget drafting, as a conversation.
 *
 * The same SSE machinery as chat, with one addition: a tool call the server
 * intercepts rather than answers. `propose_budget` is not a lookup — it is the
 * model putting something on the screen, and treating it as a tool is what lets
 * a single turn both explain a trade-off and revise the plan.
 */
router.post('/budget-chat', async (req: AuthRequest, res: Response) => {
  const check = gate(req);
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }

  const question = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!question) {
    res.status(400).json({ error: 'Say what you want to plan.' });
    return;
  }
  if (question.length > 2000) {
    res.status(400).json({ error: 'That is too long.' });
    return;
  }

  let snapshot;
  try {
    // Catch up first: an instalment that has not posted yet would leave the
    // draft planning against income that is already spoken for.
    await Promise.all([
      runSubscriptionCharges(check.userId, clientDay(req)).catch(() => undefined),
      runDebtCharges(check.userId, clientDay(req)).catch(() => undefined),
    ]);
    snapshot = await buildFinanceSnapshot(check.userId, { today: check.today });
  } catch (err) {
    console.error('[ai] budget-chat snapshot failed:', err);
    res.status(500).json({ error: 'Could not read your financial data.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  const controller = new AbortController();
  const onClose = () => controller.abort();
  req.on('close', onClose);

  const messages: Anthropic.MessageParam[] = [
    ...sanitizeHistory(req.body?.history),
    { role: 'user', content: question },
  ];

  const runTool = makeToolRunner({
    userId: check.userId,
    today: check.today,
    position: snapshot.position,
  });

  const usage = { input: 0, output: 0, cacheRead: 0 };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = getClaude().messages.stream(
        {
          model: MODEL,
          max_tokens: 4000,
          system: systemFor(snapshot.text, BUDGET_CHAT_TASK, '1h'),
          // A step above chat: this has to hold a whole plan in view, notice
          // that a change to one line breaks the total, and rebalance the rest.
          // That is a different job from looking up a figure.
          output_config: outputConfig('medium'),
          tools: [...FINANCE_TOOLS, PROPOSE_BUDGET_TOOL],
          messages,
        },
        { signal: controller.signal }
      );

      stream.on('text', text => send('delta', { text }));

      const final = await stream.finalMessage();

      usage.input += final.usage.input_tokens;
      usage.output += final.usage.output_tokens;
      usage.cacheRead += final.usage.cache_read_input_tokens ?? 0;

      if (final.stop_reason === 'refusal') {
        send('error', { message: 'I can\'t help with that one.' });
        break;
      }

      if (final.stop_reason !== 'tool_use') break;

      const calls = final.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      const lookups = calls.filter(call => call.name !== 'propose_budget');
      if (lookups.length > 0) send('tool', { count: lookups.length });

      const results = await Promise.all(
        calls.map(async call => {
          if (call.name === 'propose_budget') {
            const proposal = normalizeProposal(call.input, check.today);
            send('proposal', proposal);
            // The model is told it landed, and told the total, so a plan that
            // does not add up gets corrected in the same turn rather than
            // sitting on the person's screen being wrong.
            return {
              type: 'tool_result' as const,
              tool_use_id: call.id,
              // The sign is spelled out in words as well as given as a number.
              // A model handed `unallocated: 4009.81` described the plan as
              // "₹3,959 short of balancing the month" — it read a surplus as a
              // shortfall, which is the one arithmetic mistake here that would
              // send someone away thinking the opposite of the truth.
              content: JSON.stringify({
                shown: true,
                income: proposal.income,
                allocated: proposal.totals.allocated,
                unallocated: proposal.totals.unallocated,
                reading:
                  proposal.totals.unallocated < 0
                    ? `OVER-COMMITTED by ${Math.abs(proposal.totals.unallocated)}: this plan spends more than comes in. Fix it and call propose_budget again with the whole corrected plan.`
                    : proposal.totals.unallocated > 0
                      ? `UNDER-ALLOCATED by ${proposal.totals.unallocated}: that much income has no line against it yet. It is spare, not a shortfall. Say where it should go — savings, a debt, or a category that is set too low.`
                      : 'The plan balances exactly.',
                note: 'The plan is on their screen. Do not repeat it back line by line.',
              }),
            };
          }
          return {
            type: 'tool_result' as const,
            tool_use_id: call.id,
            content: await runTool(call.name, call.input),
          };
        })
      );

      messages.push({ role: 'assistant', content: final.content });
      messages.push({ role: 'user', content: results });

      if (round === MAX_TOOL_ROUNDS - 1) {
        send('error', { message: 'That took more steps than I\'m allowed. Try asking for one change at a time.' });
      }
    }

    send('done', { usage });
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError || controller.signal.aborted) {
      // The reader left. There is nobody to report to.
    } else {
      console.error('[ai] budget-chat failed:', err);
      send('error', { message: describeError(err).message });
    }
  } finally {
    clearInterval(heartbeat);
    req.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
});

interface ProposedLine {
  name: string;
  allocatedAmount: number;
  note?: string;
}

/**
 * Coerces a proposal into exactly the shape the budget form takes.
 *
 * The schema constrains structure, not sense. A model asked for a number under
 * constrained decoding will produce one even when it has nothing to base it on,
 * and a negative allocation or a line named "" would land in the form as a row
 * nobody can fix. The totals are recomputed here rather than taken on trust for
 * the same reason: they are the one figure the person will check.
 */
function normalizeProposal(input: unknown, today: string) {
  const raw = (input ?? {}) as Record<string, any>;

  const lines = (value: unknown): ProposedLine[] =>
    (Array.isArray(value) ? value : [])
      .map(item => ({
        name: typeof item?.name === 'string' ? item.name.trim() : '',
        allocatedAmount: Math.max(0, Number(item?.allocatedAmount) || 0),
        ...(typeof item?.note === 'string' && item.note.trim() ? { note: item.note.trim().slice(0, 120) } : {}),
      }))
      .filter(line => line.name !== '');

  const categories = lines(raw.categories);
  const savings = lines(raw.savings);
  const investments = lines(raw.investments);

  const debts = (Array.isArray(raw.debts) ? raw.debts : [])
    .map((d: any) => ({
      name: typeof d?.name === 'string' ? d.name.trim() : '',
      amount: Math.max(0, Number(d?.amount) || 0),
      instalments: Math.max(1, Math.round(Number(d?.instalments) || 1)),
    }))
    .filter((d: { name: string }) => d.name !== '');

  const subscriptions = (Array.isArray(raw.subscriptions) ? raw.subscriptions : [])
    .map((s: any) => ({
      name: typeof s?.name === 'string' ? s.name.trim() : '',
      amount: Math.max(0, Number(s?.amount) || 0),
      frequency: ['daily', 'weekly', 'monthly', 'yearly'].includes(s?.frequency) ? s.frequency : 'monthly',
    }))
    .filter((s: { name: string }) => s.name !== '');

  const income = Math.max(0, Number(raw.income) || 0);

  const sum = (rows: { allocatedAmount: number }[]) =>
    rows.reduce((total, row) => total + row.allocatedAmount, 0);

  const allocated =
    sum(categories) + sum(savings) + sum(investments) +
    debts.reduce((total: number, d: { amount: number }) => total + d.amount, 0) +
    subscriptions.reduce((total: number, s: { amount: number }) => total + s.amount, 0);

  return {
    label: typeof raw.label === 'string' ? raw.label.trim().slice(0, 60) : 'Draft',
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 500) : '',
    startDate: typeof raw.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)
      ? raw.startDate
      : `${today.slice(0, 7)}-01`,
    endDate: typeof raw.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.endDate)
      ? raw.endDate
      : today,
    income,
    categories,
    savings,
    investments,
    debts,
    subscriptions,
    totals: {
      allocated: Math.round(allocated * 100) / 100,
      unallocated: Math.round((income - allocated) * 100) / 100,
    },
  };
}

export default router;
