import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { PERSONAS, buildPersona, type Persona } from './personas';
import { ask, contextFor, type Answer } from './evalHarness';
import { runChecks, worst, type CheckResult, type Severity } from './checks';
import { judge, type Judgement } from './judge';

dotenv.config();

/**
 * The scenario runner.
 *
 * Usage:
 *   npm run eval                          — every persona, every question
 *   npm run eval -- --personas=credit-card-trap,laid-off
 *   npm run eval -- --today=2026-08-20 --model=claude-haiku-4-5
 *   npm run eval -- --no-judge            — mechanical checks only, no model grading
 *   npm run eval -- --context-only        — print the rendered context, spend nothing
 *
 * Output lands in `evals/<timestamp>/`: a readable report, the raw JSON, and
 * every rendered context. The raw JSON is the point — a prompt change is
 * evaluated by diffing two runs, and that only works if the answers are kept.
 */

// ── Arguments ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const match = argv.find(a => a.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

/**
 * Haiku 4.5, as asked for.
 *
 * Two things about this model differ from the app's default and both are
 * handled rather than worked around:
 *
 *  · It rejects `output_config.effort`. The harness drops the parameter through
 *    the same capability check the server uses (`supportsEffort`), so pointing
 *    the app at Haiku works too rather than 400ing on every route.
 *
 *  · Its minimum cacheable prefix is 4,096 tokens against Sonnet's 1,024. Most
 *    of these personas render a context well past that — a debt book and a year
 *    of category history are not small — but the thinnest ones do not, and for
 *    those the cache silently never forms. The run prints the cache hit rate so
 *    that shows up as a number rather than as a surprise on the bill.
 */
const MODEL = flag('model') ?? 'claude-haiku-4-5';

/**
 * Fixed by default rather than `new Date()`.
 *
 * Every persona's history is generated relative to this day, so a floating
 * "today" would silently change the inputs between runs and make two reports
 * incomparable — which is the one thing an evaluation harness must not do.
 */
const TODAY = flag('today') ?? '2026-08-20';

/** Requests in flight. Four keeps well inside a standard rate limit. */
const CONCURRENCY = Number(flag('concurrency')) || 4;

const wanted = flag('personas')?.split(',').map(s => s.trim()).filter(Boolean);
const questionLimit = Number(flag('questions')) || Infinity;
const useJudge = !has('no-judge');

// ── Setup ───────────────────────────────────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY && !has('context-only')) {
  console.error('ANTHROPIC_API_KEY is not set. Add it to backend/.env, or run with --context-only.');
  process.exit(1);
}

const outDir = path.join(
  __dirname,
  '..',
  'evals',
  flag('out') ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
);

const personas: Persona[] = PERSONAS
  .filter(p => !wanted || wanted.includes(p.id))
  .map(p => buildPersona(p, TODAY));

if (personas.length === 0) {
  console.error(`No personas matched. Available: ${PERSONAS.map(p => p.id).join(', ')}`);
  process.exit(1);
}

// ── Concurrency ─────────────────────────────────────────────────────────────

/**
 * A worker pool over a list of jobs.
 *
 * `Promise.all` over eighty questions would open eighty connections and earn a
 * 429 within seconds; running them one at a time would take half an hour. Four
 * workers pulling from a shared cursor is the whole of what is needed.
 */
async function pool<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await work(item, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Run ─────────────────────────────────────────────────────────────────────

interface Row {
  persona: Persona;
  answer: Answer;
  checks: CheckResult[];
  judgement?: Judgement | undefined;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  // The rendered context per persona, always written. Reading these is the
  // fastest way to find out why an answer was wrong: nine times in ten the
  // model was not told the thing it failed to say.
  const contextDir = path.join(outDir, 'contexts');
  fs.mkdirSync(contextDir, { recursive: true });
  for (const persona of personas) {
    fs.writeFileSync(path.join(contextDir, `${persona.id}.md`), contextFor(persona));
  }

  if (has('context-only')) {
    console.log(`Wrote ${personas.length} contexts to ${contextDir}`);
    for (const persona of personas) {
      const text = contextFor(persona);
      console.log(`\n${'='.repeat(72)}\n${persona.title} (${persona.id}) — ~${Math.ceil(text.length / 4)} tokens\n${'='.repeat(72)}\n`);
      console.log(text);
    }
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4, timeout: 180_000 });

  const jobs = personas.flatMap(persona =>
    persona.questions.slice(0, questionLimit).map(question => ({ persona, question }))
  );

  console.log(`Running ${jobs.length} questions across ${personas.length} personas on ${MODEL}.`);
  console.log(`Today is pinned to ${TODAY}. Output: ${outDir}\n`);

  let done = 0;
  const rows = await pool(jobs, CONCURRENCY, async ({ persona, question }) => {
    const answer = await ask(persona, question, { model: MODEL, client });
    const checks = runChecks(persona, answer);
    const judgement = useJudge && !answer.error
      ? await judge(persona, answer, client, MODEL).catch(() => undefined)
      : undefined;

    done += 1;
    const verdict = worst(checks);
    const mark = verdict === 'fail' ? 'FAIL' : verdict === 'warn' ? 'warn' : ' ok ';
    console.log(`[${String(done).padStart(3)}/${jobs.length}] ${mark}  ${persona.id} — ${question.slice(0, 60)}`);

    return { persona, answer, checks, judgement } as Row;
  });

  writeReport(rows);
}

// ── Reporting ───────────────────────────────────────────────────────────────

function writeReport(rows: Row[]) {
  const totals = { pass: 0, warn: 0, fail: 0 };
  const byCheck = new Map<string, { pass: number; warn: number; fail: number }>();

  for (const row of rows) {
    totals[worst(row.checks)] += 1;
    for (const check of row.checks) {
      const entry = byCheck.get(check.id) ?? { pass: 0, warn: 0, fail: 0 };
      entry[check.severity] += 1;
      byCheck.set(check.id, entry);
    }
  }

  const usage = rows.reduce(
    (sum, r) => ({
      input: sum.input + r.answer.usage.input,
      output: sum.output + r.answer.usage.output,
      cacheRead: sum.cacheRead + r.answer.usage.cacheRead,
      cacheWrite: sum.cacheWrite + r.answer.usage.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  );

  const judged = rows.filter(r => r.judgement);
  const avg = (pick: (j: Judgement) => number) =>
    judged.length === 0 ? 0 : judged.reduce((sum, r) => sum + pick(r.judgement!), 0) / judged.length;

  const lines: string[] = [];
  lines.push(`# Scenario report`);
  lines.push('');
  lines.push(`Model: \`${MODEL}\` · Today: ${TODAY} · ${rows.length} answers across ${new Set(rows.map(r => r.persona.id)).size} personas`);
  lines.push('');
  lines.push(`**${totals.pass} clean · ${totals.warn} with warnings · ${totals.fail} failing.**`);
  lines.push('');

  if (judged.length > 0) {
    lines.push(
      `Judge averages (1–5): accuracy ${avg(j => j.accuracy).toFixed(2)} · `
      + `usefulness ${avg(j => j.usefulness).toFixed(2)} · `
      + `voice ${avg(j => j.voice).toFixed(2)} · `
      + `${judged.filter(r => r.judgement!.fabricated).length} answers flagged as containing something invented.`
    );
    lines.push('');
  }

  lines.push(
    `Tokens: ${usage.input.toLocaleString()} in, ${usage.output.toLocaleString()} out, `
    + `${usage.cacheRead.toLocaleString()} read from cache, ${usage.cacheWrite.toLocaleString()} written. `
    + `Cache hit rate ${((usage.cacheRead / Math.max(1, usage.cacheRead + usage.input)) * 100).toFixed(0)}%.`
  );
  lines.push('');

  // ── Check summary ─────────────────────────────────────────────────────────
  lines.push(`## Checks`);
  lines.push('');
  lines.push('| Check | pass | warn | fail |');
  lines.push('|---|---:|---:|---:|');
  for (const [id, counts] of [...byCheck.entries()].sort((a, b) => b[1].fail - a[1].fail || b[1].warn - a[1].warn)) {
    lines.push(`| \`${id}\` | ${counts.pass} | ${counts.warn} | ${counts.fail} |`);
  }
  lines.push('');

  // ── Failures first ────────────────────────────────────────────────────────
  const failing = rows.filter(r => worst(r.checks) === 'fail');
  if (failing.length > 0) {
    lines.push(`## Failures`);
    lines.push('');
    for (const row of failing) {
      lines.push(`### ${row.persona.title} — "${row.answer.question}"`);
      lines.push('');
      for (const check of row.checks.filter(c => c.severity === 'fail')) {
        lines.push(`- **${check.id}** — ${check.detail}`);
      }
      lines.push('');
      lines.push('> ' + row.answer.text.split('\n').join('\n> '));
      lines.push('');
    }
  }

  // ── Everything, by persona ────────────────────────────────────────────────
  lines.push(`## Every answer`);
  lines.push('');
  for (const persona of new Set(rows.map(r => r.persona))) {
    const personaRows = rows.filter(r => r.persona.id === persona.id);
    lines.push(`### ${persona.title}`);
    lines.push('');
    lines.push(`\`${persona.id}\` — ${persona.probes}`);
    lines.push('');
    for (const row of personaRows) {
      const verdict = worst(row.checks);
      lines.push(`**Q: ${row.answer.question}**  `);
      lines.push(
        `*${verdict.toUpperCase()} · tools: ${row.answer.toolCalls.map(c => c.name).join(', ') || 'none'} · ${(row.answer.latencyMs / 1000).toFixed(1)}s*`
      );
      lines.push('');
      lines.push(row.answer.error ? `\`ERROR: ${row.answer.error}\`` : '> ' + row.answer.text.split('\n').join('\n> '));
      lines.push('');
      const notable = row.checks.filter(c => c.severity !== 'pass');
      if (notable.length > 0) {
        for (const check of notable) lines.push(`- ${check.severity === 'fail' ? '**FAIL**' : 'warn'} \`${check.id}\` — ${check.detail}`);
        lines.push('');
      }
      if (row.judgement) {
        lines.push(
          `- judge: accuracy ${row.judgement.accuracy}/5, usefulness ${row.judgement.usefulness}/5, voice ${row.judgement.voice}/5`
          + (row.judgement.fabricated ? ' — **flagged as containing something invented**' : '')
        );
        lines.push(`  - ${row.judgement.comment}`);
        lines.push('');
      }
    }
  }

  fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(
      rows.map(r => ({
        personaId: r.persona.id,
        personaTitle: r.persona.title,
        probes: r.persona.probes,
        question: r.answer.question,
        text: r.answer.text,
        toolCalls: r.answer.toolCalls,
        usage: r.answer.usage,
        latencyMs: r.answer.latencyMs,
        error: r.answer.error,
        checks: r.checks,
        judgement: r.judgement,
      })),
      null,
      2
    )
  );

  console.log(`\n${totals.pass} clean · ${totals.warn} warnings · ${totals.fail} failing`);
  console.log(`Report: ${path.join(outDir, 'report.md')}`);

  // A non-zero exit so this can gate a change without anyone reading the file.
  if (totals.fail > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
