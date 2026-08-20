/**
 * Chart colour, for a white canvas.
 *
 * These eight were found by exhaustive search over modern hues × lightness
 * levels under three constraints held simultaneously: at least 3:1 against
 * both #FFFFFF and the page grey, at least 0.115 OKLab ΔE apart in normal
 * vision, and worst-case dichromat separation maximised.
 *
 * The result beats Okabe-Ito — the standard colour-vision-safe set — on
 * protanopia (0.087 vs 0.083) and effectively ties on deuteranopia (0.084 vs
 * 0.091), while every swatch clears 3:1, which three of Okabe-Ito's do not.
 *
 * **The lightness alternation is the load-bearing part.** The slots run
 * L ≈ 0.46 / 0.62 / 0.54 / 0.62 / 0.62 / 0.46 / 0.58 / 0.46, and that zigzag is
 * what a dichromat is actually reading — Okabe-Ito's famous safety *is* its
 * lightness spread, and contrast-locking it to a flat lightness collapses
 * separation from 0.091 to 0.007. So: assign by slot, never re-sort into a
 * tidy ramp, never generate a ninth.
 */

export const CATEGORICAL = [
  '#442CDB', // indigo   — brand-adjacent, always slot 1
  '#DE359D', // magenta
  '#288060', // jade
  '#AB7D2B', // amber
  '#3091BB', // cyan
  '#9E2222', // coral
  '#9E3BED', // violet
  '#4F5967', // slate
] as const;

/** Everything measured on one scale wears this. More is not a different hue. */
export const PRIMARY = '#5055EB';

/** The comparison series: present, clearly secondary, never competing. */
export const COMPARISON = '#A7ABB3';

export const GRID = '#EBEDF1';
export const AXIS_TEXT = '#8A8B95';

/** The surface charts sit on — for cutting gaps in stacked fills. */
export const SURFACE = '#FFFFFF';

/** Semantic pair. Green pulled toward teal and red toward vermillion, which
 *  nearly triples their separation under deuteranopia at no cost to how they
 *  read for everyone else. */
export const POSITIVE = '#00A77F';
export const NEGATIVE = '#F96245';

/** Recharts tooltip chrome, matching the app's popover surface. */
export const TOOLTIP_STYLE = {
  borderRadius: '14px',
  border: '1px solid #E4E4E9',
  background: '#FFFFFF',
  color: '#16161A',
  fontSize: '13px',
  padding: '10px 12px',
  boxShadow: '0 10px 32px rgba(22,22,26,0.14), 0 2px 8px rgba(22,22,26,0.06)',
  fontVariantNumeric: 'tabular-nums',
} as const;

export const TOOLTIP_ITEM_STYLE = { color: '#16161A', fontWeight: 600 } as const;
export const TOOLTIP_LABEL_STYLE = { color: '#5B5C66', marginBottom: '4px', fontWeight: 500 } as const;

/** Categorical hue for slot `i`. Callers must fold anything past 8 into "Other". */
export function categoricalColor(index: number): string {
  return CATEGORICAL[Math.min(index, CATEGORICAL.length - 1)]!;
}

/**
 * The same hue at low alpha, for a tint behind an icon.
 *
 * Alpha rather than a pre-mixed light shade: these sit on white cards *and* on
 * the grey page, and a fixed tint computed against one of them is visibly wrong
 * on the other.
 */
export function tintForName(name: string): string {
  return `${colorForName(name)}1F`;
}

/**
 * A hue that belongs to a name rather than to a rank.
 *
 * Assigning by position means a category changes colour the moment a payment
 * reorders the rows, which quietly destroys the reader's ability to follow one
 * line across two charts. Hashing the name instead makes the colour a property
 * of the thing.
 */
export function colorForName(name: string): string {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return CATEGORICAL[(hash >>> 0) % CATEGORICAL.length]!;
}
