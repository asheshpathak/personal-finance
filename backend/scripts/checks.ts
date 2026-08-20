import { buildPosition } from '../src/lib/financialPosition';
import type { Persona } from './personas';
import type { Answer } from './evalHarness';

/**
 * Automated checks over an answer.
 *
 * Deliberately mechanical. A model grading a model is useful for taste and
 * useless for "did it quote a number that exists", and the failures that matter
 * most in a money app are exactly the mechanical ones: a fabricated figure, a
 * dollar sign in a rupee account, a savings rate quoted for someone whose
 * income was never recorded, a ring-fenced emergency fund offered up to pay for
 * a holiday. Each of those is decidable from the text and the data.
 *
 * A judge model runs separately, over the things this cannot see.
 *
 * Severity means something specific:
 *  · `fail` — the answer is wrong or unsafe to show. A single one blocks.
 *  · `warn` — worth a human's eye, not necessarily wrong.
 *  · `pass` — checked and fine.
 */

export type Severity = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  severity: Severity;
  detail: string;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/** Every number in a string, as plain numbers. Handles 1,23,456.78 and 1.2k. */
function numbersIn(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)) {
    const raw = match[1];
    if (!raw) continue;
    const value = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
}

/**
 * Whether a figure in the answer traces back to something the model was given.
 *
 * Tolerance matters more than it looks. The voice prompt asks for rounded
 * figures, so ₹45,203.44 is legitimately reported as "about 45,200" — and a
 * check that flagged that would flag every well-written answer and be turned
 * off within a week. Two percent is wide enough for honest rounding and narrow
 * enough to catch a number that was invented.
 */
function isGrounded(value: number, known: number[], derived: Set<number>): boolean {
  if (value < 1000) return true; // months, percentages, counts, small change
  const near = (k: number) => k !== 0 && Math.abs(value - k) / Math.abs(k) <= 0.02;
  if (known.some(near)) return true;
  // A sum or a difference of two real figures is a real figure. "Instalments
  // ₹160,000 plus discretionary ₹141,859 is ₹301,859" was being flagged as
  // invented, which is the check punishing exactly the arithmetic the voice
  // prompt asks for.
  for (const d of derived) if (near(d)) return true;
  return false;
}

/**
 * Every sum and difference of the most significant known figures.
 *
 * Capped at the largest 120 — the combinations grow quadratically, and a
 * two-rupee transaction from March is not what anyone is adding up.
 */
function derivedFrom(known: number[]): Set<number> {
  const top = [...new Set(known.filter(v => v >= 100))].sort((a, b) => b - a).slice(0, 120);
  const out = new Set<number>();
  for (let i = 0; i < top.length; i++) {
    for (let j = i; j < top.length; j++) {
      const a = top[i]!;
      const b = top[j]!;
      out.add(a + b);
      out.add(a - b);
    }
  }
  return out;
}

export function runChecks(persona: Persona, answer: Answer): CheckResult[] {
  const results: CheckResult[] = [];
  const text = answer.text;
  const lower = text.toLowerCase();
  const position = buildPosition(persona.data);
  const toolNames = new Set(answer.toolCalls.map(c => c.name));
  const question = answer.question.toLowerCase();

  const add = (id: string, severity: Severity, detail: string) => results.push({ id, severity, detail });

  if (answer.error) {
    add('completed', 'fail', `The request failed: ${answer.error}`);
    return results;
  }
  if (!text.trim()) {
    add('completed', 'fail', 'Empty answer.');
    return results;
  }

  // ── Voice ─────────────────────────────────────────────────────────────────
  add('no-emoji', EMOJI.test(text) ? 'fail' : 'pass', EMOJI.test(text) ? 'Contains emoji.' : 'No emoji.');

  const headers = /^#{1,6}\s/m.test(text);
  add('no-markdown-headers', headers ? 'fail' : 'pass', headers ? 'Uses markdown headers.' : 'No headers.');

  // A "**Label:**" opening a paragraph is a report layout, not an answer. One
  // bolded figure is fine; three bolded section headings is the model reaching
  // for structure because it has nothing to lead with.
  const boldLabels = (text.match(/(^|\n)\s*\*\*[^*\n]{2,40}:?\*\*/g) ?? []).length;
  add(
    'no-bold-section-labels',
    boldLabels >= 2 ? 'fail' : boldLabels === 1 ? 'warn' : 'pass',
    boldLabels === 0 ? 'No bolded section labels.' : `${boldLabels} bolded section label(s) — reads as a report, not an answer.`
  );

  // Narrating the tool call. The person sees an answer appear, not the process,
  // and a first line that says "let me check" is a first line with no answer in it.
  // Anywhere, not just the opening: "Let me show you how the strategies
  // compare:" mid-answer is the same failure one paragraph later.
  // Narrowed to narration of a *lookup*. "I need to understand what you're
  // considering" on a genuinely ambiguous question is a different thing from
  // "I need to check your affordability" in front of a tool call, and the suite
  // was failing the first for being the second.
  const narration = text.match(
    /(^|\n)\s*(let me (check|look|run|get|show|see|try|calculate|pull)|i'?ll (check|look|run|get|calculate|pull)|i will (check|look|run|get)|i need to (check|look|run|get|calculate|pull)|let's (look at|check|run|see) (your|the)|checking your|looking at your|first,? let me)/i
  );
  add(
    'no-tool-narration',
    narration ? 'fail' : 'pass',
    narration ? `Narrates the lookup: "${narration[0].trim().slice(0, 60)}"` : 'No process narration.'
  );

  // An amount with no symbol reads as a quantity, not money — and in an app
  // that supports two currencies it is genuinely ambiguous.
  const hasAmounts = numbersIn(text).some(v => v >= 1000);
  const symbol = position.currency === 'INR' ? '₹' : '$';
  add(
    'currency-symbol-present',
    !hasAmounts || text.includes(symbol) ? 'pass' : 'warn',
    !hasAmounts ? 'No amounts to mark.'
      : text.includes(symbol) ? 'Amounts carry the symbol.'
      : `Quotes amounts with no ${symbol}.`
  );

  // A closing question is the model handing the work back. Legitimate only when
  // the answer genuinely turns on something it cannot know.
  const trailingQuestion = /\?\s*$/.test(text.trim());
  add(
    'no-trailing-question',
    trailingQuestion ? 'warn' : 'pass',
    trailingQuestion ? 'Ends by asking the person a question.' : 'Ends on a statement.'
  );

  const bangs = (text.match(/!/g) ?? []).length;
  add('no-exclamations', bangs > 0 ? 'warn' : 'pass', bangs > 0 ? `${bangs} exclamation mark(s).` : 'None.');

  add(
    'length',
    text.length > 1400 ? 'warn' : 'pass',
    `${text.length} characters.`
  );

  // ── Currency ──────────────────────────────────────────────────────────────
  //
  // A dollar sign in a rupee account is not a formatting nit. It is the app
  // telling someone their money is a different currency than it is.
  const wrongSymbol = position.currency === 'INR' ? /\$\s?\d/.test(text) : /₹\s?\d/.test(text);
  add(
    'currency-symbol',
    wrongSymbol ? 'fail' : 'pass',
    wrongSymbol
      ? `Used the wrong currency symbol for a ${position.currency} account.`
      : `Correct symbol for ${position.currency}.`
  );

  // ── Tool routing ──────────────────────────────────────────────────────────
  const asksAffordability =
    /can i afford|should i buy|afford a|afford to|worth buying|can we afford/.test(question)
    // A concrete thing, not a general state-of-play question. "Can I afford
    // anything at all right now" has no amount to check and is answered from
    // the position — requiring the tool there was the check being wrong.
    && (/\d/.test(question) || /afford to (take|hire|buy|move|give|keep)/.test(question));
  if (asksAffordability) {
    // `project_cashflow` counts too. "When can I afford a deposit" and "can I
    // afford three months off" are timing questions, and the projection is the
    // better instrument for both — insisting on the affordability tool there
    // was the check being narrower than the app.
    const usedAnAnalysisTool =
      toolNames.has('check_affordability') || toolNames.has('project_cashflow');
    add(
      'used-affordability-tool',
      usedAnAnalysisTool ? 'pass' : 'fail',
      usedAnAnalysisTool
        ? `Called ${toolNames.has('check_affordability') ? 'check_affordability' : 'project_cashflow'}.`
        : `Answered an affordability question without a tool. Called: ${[...toolNames].join(', ') || 'nothing'}.`
    );
  }

  const asksDebtOrder = /which (debt|loan|card).*(first|priority)|clear first|pay off first|debt free/.test(question);
  if (asksDebtOrder && position.debtTotals.count > 1) {
    add(
      'used-strategy-tool',
      toolNames.has('compare_debt_strategies') ? 'pass' : 'warn',
      toolNames.has('compare_debt_strategies')
        ? 'Called compare_debt_strategies.'
        : 'Ranked debts without the comparison tool.'
    );
  }

  const asksBudget = /budget should|my budget be|what should my budget/.test(question);
  if (asksBudget) {
    add(
      'used-budget-tool',
      toolNames.has('draft_budget') ? 'pass' : 'fail',
      toolNames.has('draft_budget') ? 'Called draft_budget.' : 'Wrote a budget without the planner.'
    );
  }

  // ── The findings that must not be missed ──────────────────────────────────
  const negative = position.debts.filter(d => d.negativelyAmortizing);
  if (negative.length > 0) {
    // Identified by name OR by category. "Your credit card balance is growing"
    // is a perfectly clear reference when there is one card, and requiring the
    // stored name failed an answer that led with the finding — the check being
    // stricter than the thing it was checking for.
    const identifies = negative.some(d => {
      const head = d.name.toLowerCase().split(' ')[0] ?? '';
      return (head.length > 2 && lower.includes(head))
        || lower.includes(d.category.toLowerCase())
        || (d.lender.length > 2 && lower.includes(d.lender.toLowerCase()));
    });
    // The description is the part that cannot be waived: "your card is large"
    // and "your card is growing every month" are different findings.
    const described = /(does not|doesn'?t|not) cover|grow(s|ing)?|never (be )?(paid|cleared)|going backwards|compound|rising|climbing/.test(lower);
    add(
      'surfaces-negative-amortization',
      identifies && described ? 'pass' : 'fail',
      identifies && described
        ? 'Identified the debt that is growing and said why.'
        : `A debt (${negative.map(d => d.name).join(', ')}) is growing rather than shrinking and the answer does not say so.`
    );
  }

  if (position.income.empty) {
    // The failure to catch here is confident zero. "Your savings rate is 0%"
    // for someone who simply never entered their salary is worse than silence:
    // it is a measurement presented where there is no measurement.
    const claimsRate = /savings rate (?:is|of|:)?\s*-?\d/.test(lower) || /you (?:save|earn)\s*(?:about\s*)?[₹$]?\s*0\b/.test(lower);
    const flags = /(no|not|haven't|have not|isn't|is not|never) (recorded|entered|set|added|got)|income (isn't|is not|has not been|hasn't been) (recorded|entered|set)|don't have (?:your )?income|no income/.test(lower);
    add(
      'income-unknown-not-zero',
      claimsRate ? 'fail' : flags ? 'pass' : 'warn',
      claimsRate
        ? 'Quoted an income-derived rate for an account with no income recorded.'
        : flags
          ? 'Said income is not recorded.'
          : 'Did not mention that income is missing, though nothing false was claimed.'
    );
  }

  const ringFenced = persona.data.assets.filter(a => a.ringFenced);
  if (ringFenced.length > 0 && asksAffordability) {
    // The tool already excludes ring-fenced money. The failure is the answer
    // quoting the larger total anyway, which reads as the app forgetting an
    // instruction the person gave it explicitly.
    // The failure is *silence*, not inclusion. A fund earmarked for the thing
    // being bought should be counted — that is what it is for — and the check
    // was flagging exactly the answer the feature was built to produce. What
    // must never happen is the larger total appearing with no mention of where
    // the extra money came from.
    const quotesTotal = numbersIn(text).some(
      v => Math.abs(v - position.assets.liquid) / Math.max(1, position.assets.liquid) <= 0.01
        && Math.abs(position.assets.liquid - position.assets.available) > 1
    );
    const namesTheFund = ringFenced.some(a => {
      const head = a.name.toLowerCase().split(/\s+/)[0] ?? '';
      return head.length > 2 && lower.includes(head);
    });
    add(
      'respects-ring-fence',
      !quotesTotal ? 'pass' : namesTheFund ? 'pass' : 'fail',
      !quotesTotal
        ? 'Did not offer up ring-fenced money.'
        : namesTheFund
          ? `Counted ${ringFenced.map(a => a.name).join(', ')} and said so.`
          : `Quoted ${position.assets.liquid} as available without mentioning that ${ringFenced.map(a => a.name).join(', ')} is ring-fenced.`
    );
  }

  const oldest = position.assets.oldestAsOf;
  const staleCutoff = staleBefore(persona.data.today, 3);
  const asksHowMuch = asksAffordability || /how much do i have|how much have i saved|savings/.test(question);
  if (oldest && oldest < staleCutoff && asksHowMuch) {
    const mentions = lower.includes(oldest) || /(last|only) (confirmed|updated|checked)|out of date|stale|months old|since [a-z]+ \d{4}/.test(lower);
    add(
      'flags-stale-balances',
      mentions ? 'pass' : 'warn',
      mentions
        ? 'Flagged that the balances are old.'
        : `Balances were last confirmed ${oldest}, and the answer treats them as current.`
    );
  }

  // ── Numeric grounding ─────────────────────────────────────────────────────
  //
  // The strongest signal in the suite. A number in a money app that traces back
  // to nothing is the failure mode that destroys trust in every other number
  // beside it.
  const known = [
    ...numbersIn(contextNumbersSource(persona)),
    ...answer.toolCalls.flatMap(c => numbersIn(c.result)),
    // The question itself. "I have 60000 spare, where should it go" makes
    // 60,000 a given, and flagging it as invented was the check being wrong,
    // not the answer.
    ...numbersIn(answer.question),
    ...answer.toolCalls.flatMap(c => numbersIn(JSON.stringify(c.input))),
  ];
  const derived = derivedFrom(known);
  const ungrounded = [...new Set(numbersIn(text))].filter(v => !isGrounded(v, known, derived));
  add(
    'numbers-traceable',
    ungrounded.length === 0 ? 'pass' : ungrounded.length > 2 ? 'fail' : 'warn',
    ungrounded.length === 0
      ? 'Every figure traces back to the data or a tool result.'
      : `Untraceable figures: ${ungrounded.slice(0, 6).join(', ')}.`
  );

  return results;
}

/**
 * Everything the model could legitimately have taken a number from.
 *
 * Rebuilt rather than passed in, so a check can never be satisfied by a number
 * the harness introduced.
 */
function contextNumbersSource(persona: Persona): string {
  // Imported lazily to keep this module free of the renderer's cost when a
  // caller only wants the voice checks.
  const { renderSnapshot } = require('../src/lib/financeSnapshot') as typeof import('../src/lib/financeSnapshot');
  return renderSnapshot(persona.data, { today: persona.data.today }).text;
}

function staleBefore(today: string, months: number): string {
  const [y = 0, m = 1, d = 1] = today.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
  at.setUTCDate(Math.min(d, last));
  return at.toISOString().slice(0, 10);
}

export const worst = (results: CheckResult[]): Severity =>
  results.some(r => r.severity === 'fail') ? 'fail'
  : results.some(r => r.severity === 'warn') ? 'warn'
  : 'pass';
