import { API_URL, ApiError, api, getToken } from './api';
import { toDayKey } from './dates';

/**
 * The client half of the AI features.
 *
 * Every call goes through this app's own server. The Anthropic key never leaves
 * it — Vite inlines anything prefixed `VITE_` straight into the bundle, so a
 * key handed to the browser is a key published on the internet.
 */

export interface AiStatus {
  configured: boolean;
  model: string | null;
}

/**
 * Whether this deployment has AI at all.
 *
 * Every AI surface hides itself when the answer is no, which is much better
 * than showing controls that fail — an app with a broken button in it reads as
 * broken everywhere.
 *
 * **Only a "yes" is cached.** Caching the "no" is the obvious optimisation and
 * it is wrong: a server that gains a key mid-session would never be noticed,
 * because the module-level promise outlives every mount and there is nothing to
 * invalidate it. The reader adds the key, restarts the server, and the app goes
 * on insisting the feature does not exist until they think to hard-reload.
 *
 * Re-asking costs one request against an endpoint that does no work and touches
 * no database — and it only happens while the answer is still no.
 */
let configured: Promise<AiStatus> | null = null;

export function aiStatus(): Promise<AiStatus> {
  if (configured) return configured;

  const pending = api
    .get<AiStatus>('/api/ai/status')
    .catch(() => ({ configured: false, model: null }));

  // Latch it only once the answer is one that can't go stale in a useful
  // direction. A key being *removed* mid-session is not a case worth polling for.
  void pending.then(status => {
    if (status.configured) configured = pending;
  });

  return pending;
}

/** Called on sign-out, so the next account re-asks. */
export function resetAiStatus(): void {
  configured = null;
}

// ── Capture ─────────────────────────────────────────────────────────────────

export interface CaptureDraft {
  amount: number;
  category: string;
  paymentMode: string;
  description: string;
  date: string;
  confidence: 'high' | 'medium' | 'low';
  note?: string;
}

/**
 * One line of text into a filled-in expense.
 *
 * The allowed categories are sent from the client rather than hard-coded on the
 * server, so the list can only ever be the one the form itself offers. A model
 * that invents a plausible category the picker has never heard of produces a
 * silently empty select and no explanation.
 */
export const captureExpense = (text: string, categories: readonly string[]) =>
  api.post<CaptureDraft>('/api/ai/capture', { text, categories: [...categories] });

// ── Briefing ────────────────────────────────────────────────────────────────

export interface BriefInsight {
  title: string;
  detail: string;
  metric: string;
  tone: 'good' | 'watch' | 'risk' | 'neutral';
  action?: string;
}

export interface BriefStanding {
  summary: string;
  tone: 'strong' | 'steady' | 'tight' | 'strained';
}

export interface BriefPace {
  status: 'ahead' | 'on-track' | 'behind' | 'too-early';
  detail: string;
  metric: string;
}

export interface Brief {
  headline: string;
  /** Where they stand overall. Null on a sparse account. */
  standing: BriefStanding | null;
  /** This month against how their months usually go, at the same point in it. */
  pace: BriefPace | null;
  insights: BriefInsight[];
  /** True when there simply isn't enough recorded to say anything. */
  sparse: boolean;
  /** The day this was written for, `YYYY-MM-DD`. */
  day: string;
  /** True when it came from storage rather than being written just now. */
  cached: boolean;
  fingerprint?: string;
  /** Set when the model could not be reached and yesterday's answer was served. */
  stale?: boolean;
  /** Set when today's allowance of fresh reads is used up. */
  regenerationsExhausted?: boolean;
}

/**
 * Today's briefing.
 *
 * Written once per calendar day on the server and served from storage for the
 * rest of it, so calling this on every dashboard mount costs nothing and — much
 * more importantly — returns the same words every time. An insight that
 * reworded itself on every page load taught people to stop reading it.
 */
export const fetchBrief = (refresh = false) => api.post<Brief>('/api/ai/brief', { refresh });

export interface BriefFreshness {
  hasBrief: boolean;
  current: string;
  written: string | null;
  /** True when the data has moved since the briefing was written. */
  changed: boolean;
  regenerationsLeft: number;
}

/** Whether the ground has moved under today's briefing. Spends no tokens. */
export const fetchBriefFreshness = () => api.get<BriefFreshness>('/api/ai/brief/freshness');

// ── Plan review ─────────────────────────────────────────────────────────────

export interface PlanNote {
  category: string;
  kind: 'too-low' | 'too-high' | 'missing' | 'good';
  issue: string;
  suggested?: number;
}

export interface PlanReview {
  verdict: 'solid' | 'workable' | 'unrealistic';
  summary: string;
  notes: PlanNote[];
}

export const reviewPlan = (plan: unknown) => api.post<PlanReview>('/api/ai/review-plan', { plan });

// ── Chat ────────────────────────────────────────────────────────────────────

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamHandlers {
  onDelta: (text: string) => void;
  /** Fired when the assistant reaches for the data behind its answer. */
  onTool?: (count: number) => void;
  /**
   * A budget the assistant is putting on screen.
   *
   * Only the drafting endpoint emits these. It arrives as its own event rather
   * than inside the text because it is a *thing*, not a sentence — it renders
   * as an editable plan the person can save, and parsing it back out of prose
   * would be both fragile and a downgrade.
   */
  onProposal?: (proposal: BudgetProposal) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

// ── Budget drafting ─────────────────────────────────────────────────────────

export interface ProposedLine {
  name: string;
  allocatedAmount: number;
  note?: string;
}

export interface BudgetProposal {
  label: string;
  summary: string;
  startDate: string;
  endDate: string;
  income: number;
  categories: ProposedLine[];
  savings: ProposedLine[];
  investments: ProposedLine[];
  debts: { name: string; amount: number; instalments: number }[];
  subscriptions: { name: string; amount: number; frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' }[];
  totals: { allocated: number; unallocated: number };
}

/**
 * Streams an answer over Server-Sent Events.
 *
 * `EventSource` is unusable here, and the reason is structural rather than
 * stylistic: it is GET-only and cannot carry an `Authorization` header, so
 * every authenticated stream on the web ends up as `fetch` plus a hand-written
 * frame parser. This is that parser.
 */
export async function streamChat(
  message: string,
  history: ChatTurn[],
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  return streamFrom('/api/ai/chat', message, history, handlers, signal);
}

/**
 * The same transport, pointed at the budget-drafting conversation.
 *
 * A separate endpoint rather than a mode flag on the chat one, because the two
 * carry different task prompts, different tools and a different token ceiling —
 * and because the cached prefix is shared between them either way, so splitting
 * costs nothing.
 */
export async function streamBudgetChat(
  message: string,
  history: ChatTurn[],
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  return streamFrom('/api/ai/budget-chat', message, history, handlers, signal);
}

async function streamFrom(
  path: string,
  message: string,
  history: ChatTurn[],
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const token = getToken();

  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Day': toDayKey(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, history }),
    signal,
  });

  // The gate runs before the stream commits, so a refusal, a rate limit or a
  // missing key still arrives as an ordinary JSON error with a status code.
  if (!response.ok) {
    const text = await response.text();
    let error = `Request failed with status ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) error = parsed.error;
    } catch {
      /* not JSON — keep the status message */
    }
    throw new ApiError(response.status, error, text);
  }

  if (!response.body) throw new Error('This browser cannot read a streamed response.');

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // Frames are separated by a blank line. A chunk can split one anywhere, so
    // the buffer is only consumed up to the last complete separator.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      // A comment frame — the server's heartbeat, which exists so a proxy
      // doesn't time out a socket that goes quiet during a tool call.
      if (frame.startsWith(':')) continue;

      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (event === 'delta' && typeof payload.text === 'string') handlers.onDelta(payload.text);
      else if (event === 'tool') handlers.onTool?.(Number(payload.count) || 1);
      else if (event === 'proposal') handlers.onProposal?.(payload as unknown as BudgetProposal);
      else if (event === 'error') handlers.onError(String(payload.message ?? 'Something went wrong.'));
      else if (event === 'done') {
        handlers.onDone();
        return;
      }
    }
  }

  // The stream ended without a `done` frame — the connection dropped mid-answer.
  handlers.onDone();
}
