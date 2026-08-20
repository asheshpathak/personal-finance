import Anthropic from '@anthropic-ai/sdk';
import { contextFor } from './evalHarness';
import type { Persona } from './personas';
import type { Answer } from './evalHarness';
import { supportsEffort } from '../src/lib/claude';

/**
 * A second model reading the answer against the data it came from.
 *
 * This covers what the mechanical checks cannot: whether the answer is
 * *responsive*, whether it buried the important thing under two paragraphs of
 * throat-clearing, whether a claim is technically true and misleading. It does
 * not cover arithmetic — the deterministic checks do that better, and a judge
 * asked to verify sums will confidently agree with a wrong one.
 *
 * The judge sees the same context the answer was written from, which is what
 * makes the fabrication question answerable at all.
 */

export interface Judgement {
  accuracy: number;
  usefulness: number;
  voice: number;
  /** Something stated that the context does not support. */
  fabricated: boolean;
  /** The single most useful sentence about this answer. */
  comment: string;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['accuracy', 'usefulness', 'voice', 'fabricated', 'comment'],
  properties: {
    accuracy: {
      type: 'integer',
      description:
        '1–5. Is every claim supported by the context and the tool results? 5 = everything checks out. 3 = one claim is unsupported or overstated. 1 = a central figure or fact is wrong.',
    },
    usefulness: {
      type: 'integer',
      description:
        '1–5. Did it answer the question actually asked, lead with the answer, and give the person something they can act on? 5 = yes. 1 = evasive, generic, or answered a different question.',
    },
    voice: {
      type: 'integer',
      description:
        '1–5 against the house style: leads with the number, short, plain, no moralising, no congratulating, no padding. 5 = indistinguishable from a good analyst. 1 = chatty, preachy or padded.',
    },
    fabricated: {
      type: 'boolean',
      description:
        'True if the answer states anything the context does not support — an invented merchant or place, a figure that appears nowhere, a claim about a debt or account that does not exist. Rounding a real figure is not fabrication.',
    },
    comment: {
      type: 'string',
      description: 'One sentence, at most 200 characters: the single most useful thing to say about this answer.',
    },
  },
} as const;

const RUBRIC = `You are grading an answer written by a personal finance assistant, against the exact data it was given.

The house style it was asked to follow:
- Lead with the number and the answer. No preamble.
- Short. Specific. Plain language, no jargon, no emoji, no motivational tone.
- Never moralise about what someone spends money on, and never congratulate them.
- Invent nothing — not a figure and not a merchant, shop or place.
- Say plainly when the data does not answer the question.

Grade what is in front of you. Do not reward length, hedging, or a disclaimer about seeking professional advice — in this app those are faults. Do not penalise an answer for being blunt about bad news; that is the job.

Check the arithmetic only where it is obviously wrong. The suite has a separate mechanical check for figures, and a confident wrong opinion from you about a sum is worse than no opinion.`;

export async function judge(
  persona: Persona,
  answer: Answer,
  client: Anthropic,
  model: string
): Promise<Judgement> {
  const toolSummary = answer.toolCalls.length === 0
    ? 'No tools were called.'
    : answer.toolCalls
        .map(c => `Tool ${c.name}(${JSON.stringify(c.input)}) returned:\n${c.result.slice(0, 2500)}`)
        .join('\n\n');

  const message = await client.messages.create({
    model,
    max_tokens: 700,
    system: [{ type: 'text', text: RUBRIC }],
    output_config: {
      ...(supportsEffort(model) ? { effort: 'low' as const } : {}),
      format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [
      {
        role: 'user',
        content:
          `THE DATA THE ASSISTANT WAS GIVEN\n${'='.repeat(40)}\n${contextFor(persona)}\n\n`
          + `TOOL RESULTS\n${'='.repeat(40)}\n${toolSummary}\n\n`
          + `THE QUESTION\n${'='.repeat(40)}\n${answer.question}\n\n`
          + `THE ANSWER\n${'='.repeat(40)}\n${answer.text}`,
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  return JSON.parse(text) as Judgement;
}
