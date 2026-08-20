import Anthropic from '@anthropic-ai/sdk';
import { renderSnapshot } from '../src/lib/financeSnapshot';
import { buildPosition, expenseDay, type PositionInput } from '../src/lib/financialPosition';
import { FINANCE_TOOLS, makeToolRunner } from '../src/lib/financeTools';
import { VOICE, supportsEffort } from '../src/lib/claude';
import type { Persona } from './personas';

/**
 * Running the real assistant against a synthetic person.
 *
 * The important word is *real*. This does not approximate the chat endpoint —
 * it imports the same voice prompt, the same task prompt, the same tool
 * definitions and the same tool implementations the server uses, and the only
 * substitution is where `query_expenses` reads from. So a prompt change is
 * evaluated by the harness the moment it is made, and a passing suite means the
 * shipping code passes rather than a copy of it that has drifted.
 */

// ── The task prompt ─────────────────────────────────────────────────────────
//
// Kept in step with routes/ai.ts by hand. It cannot be imported: that module
// constructs an Express router at import time and reaches for a database.
// The duplication is real and is the price of not booting the server to run an
// evaluation; the two are compared whenever either changes.
export const CHAT_TASK = `The person is asking about their own money.

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

const MAX_TOOL_ROUNDS = 8;

export interface ToolCallRecord {
  name: string;
  input: unknown;
  /** Truncated — a full projection is 24 months of rows nobody reads in a report. */
  result: string;
}

export interface Answer {
  personaId: string;
  question: string;
  text: string;
  toolCalls: ToolCallRecord[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  latencyMs: number;
  error?: string;
}

/**
 * `query_expenses`, served from an array instead of Mongo.
 *
 * Mirrors the database implementation's contract exactly — same argument names,
 * same grouping keys, same truncation flag — because a harness whose tool
 * behaves differently from the real one tests the harness.
 */
function inMemoryExpenseQuery(data: PositionInput) {
  const round2 = (v: number) => Math.round(v * 100) / 100;

  return async (args: Record<string, unknown>): Promise<string> => {
    const from = typeof args.from === 'string' ? args.from : null;
    const to = typeof args.to === 'string' ? args.to : null;
    if (!from || !to) return JSON.stringify({ error: 'from and to must both be YYYY-MM-DD dates.' });

    const categories = Array.isArray(args.categories)
      ? new Set((args.categories as unknown[]).filter((c): c is string => typeof c === 'string'))
      : null;
    const search = typeof args.search === 'string' ? args.search.trim().toLowerCase() : '';
    const minAmount = typeof args.minAmount === 'number' ? args.minAmount : null;

    const rows = data.expenses.filter(e => {
      const day = expenseDay(e.date);
      if (day < from || day > to) return false;
      if (categories && !categories.has(e.category)) return false;
      if (search && !(e.description ?? '').toLowerCase().includes(search)) return false;
      if (minAmount !== null && e.amount < minAmount) return false;
      return true;
    });

    const groupBy = typeof args.groupBy === 'string' ? args.groupBy : 'none';

    if (groupBy === 'none') {
      const capped = rows.slice(0, 150);
      return JSON.stringify({
        from,
        to,
        count: capped.length,
        truncated: rows.length > 150,
        total: round2(capped.reduce((sum, r) => sum + r.amount, 0)),
        rows: capped.map(r => ({
          date: expenseDay(r.date),
          amount: round2(r.amount),
          category: r.category,
          paymentMode: r.paymentMode,
          description: (r.description ?? '').slice(0, 60),
          auto: r.source === 'subscription' ? 'subscription' : r.source === 'debt' ? 'instalment' : undefined,
        })),
      });
    }

    const keyOf = (e: (typeof rows)[number]): string => {
      switch (groupBy) {
        case 'category': return e.category;
        case 'month': return expenseDay(e.date).slice(0, 7);
        case 'paymentMode': return e.paymentMode ?? '(none)';
        case 'description': return e.description ?? '(none)';
        default: return '(none)';
      }
    };

    if (!['category', 'month', 'paymentMode', 'description'].includes(groupBy)) {
      return JSON.stringify({ error: `Unsupported groupBy "${groupBy}".` });
    }

    const groups = new Map<string, { total: number; payments: number }>();
    for (const row of rows) {
      const key = keyOf(row);
      const entry = groups.get(key) ?? { total: 0, payments: 0 };
      entry.total += row.amount;
      entry.payments += 1;
      groups.set(key, entry);
    }

    const sorted = [...groups.entries()]
      .map(([key, v]) => ({ key, total: round2(v.total), payments: v.payments }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 60);

    return JSON.stringify({
      from,
      to,
      groupBy,
      total: round2(sorted.reduce((sum, g) => sum + g.total, 0)),
      groups: sorted,
    });
  };
}

export interface AskOptions {
  model: string;
  client: Anthropic;
  /** Extra instructions appended after the task — for testing a prompt change. */
  taskOverride?: string;
}

/**
 * One question, answered exactly the way the chat endpoint would answer it.
 */
export async function ask(
  persona: Persona,
  question: string,
  { model, client, taskOverride }: AskOptions
): Promise<Answer> {
  const started = Date.now();
  const snapshot = renderSnapshot(persona.data, { today: persona.data.today });
  const position = buildPosition(persona.data);

  const runTool = makeToolRunner({
    userId: 'eval',
    today: persona.data.today,
    position,
    queryExpenses: inMemoryExpenseQuery(persona.data),
  });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  const toolCalls: ToolCallRecord[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let text = '';

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const message = await client.messages.create({
        model,
        max_tokens: 2000,
        system: [
          { type: 'text', text: VOICE },
          { type: 'text', text: snapshot.text, cache_control: { type: 'ephemeral', ttl: '1h' } },
          { type: 'text', text: taskOverride ?? CHAT_TASK },
        ],
        // Dropped on models that reject it. Haiku 4.5 answers a request
        // carrying `effort` with a 400, which would make every row in the
        // report an error rather than an answer.
        ...(supportsEffort(model) ? { output_config: { effort: 'low' as const } } : {}),
        tools: FINANCE_TOOLS,
        messages,
      });

      usage.input += message.usage.input_tokens;
      usage.output += message.usage.output_tokens;
      usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;

      const said = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
      if (said) text = text ? `${text}\n${said}` : said;

      if (message.stop_reason === 'refusal') {
        return { personaId: persona.id, question, text, toolCalls, usage, latencyMs: Date.now() - started, error: 'refusal' };
      }
      if (message.stop_reason !== 'tool_use') break;

      const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

      const results = await Promise.all(
        calls.map(async call => {
          const result = await runTool(call.name, call.input);
          toolCalls.push({ name: call.name, input: call.input, result: result.slice(0, 4000) });
          return { type: 'tool_result' as const, tool_use_id: call.id, content: result };
        })
      );

      messages.push({ role: 'assistant', content: message.content });
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    return {
      personaId: persona.id,
      question,
      text,
      toolCalls,
      usage,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }

  return { personaId: persona.id, question, text, toolCalls, usage, latencyMs: Date.now() - started };
}

/** The rendered context a persona produces — useful on its own for eyeballing. */
export function contextFor(persona: Persona): string {
  return renderSnapshot(persona.data, { today: persona.data.today }).text;
}
