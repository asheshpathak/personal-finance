/**
 * Robust statistics.
 *
 * Spending is right-skewed and close to log-normal: more than nine payments in
 * ten are small, and a thin tail is enormous. That single fact decides which
 * estimator is allowed where.
 *
 * The mean has a breakdown point of zero — one annual insurance premium moves
 * it — so it is never the right answer for "what does this normally cost". The
 * median has a breakdown point of a half and is the right answer for *typical*
 * and for *anomaly baseline*.
 *
 * But there is a trap on the other side, and it is why this file exports both:
 * **the sum of medians is not the median of the sum.** Anything that has to
 * total correctly — a forecast, a budget recommendation — must use a trimmed
 * mean, because a plan built from medians systematically under-funds.
 */

/** Ascending copy. Every quantile function here assumes sorted input. */
export const sorted = (values: number[]): number[] => [...values].sort((a, b) => a - b);

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Linear-interpolated quantile of an already-sorted array. */
export function quantileSorted(asc: number[], q: number): number {
  if (asc.length === 0) return 0;
  if (asc.length === 1) return asc[0]!;
  const pos = (asc.length - 1) * Math.min(Math.max(q, 0), 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = asc[base]!;
  const upper = asc[base + 1] ?? lower;
  return lower + rest * (upper - lower);
}

export const quantile = (values: number[], q: number): number => quantileSorted(sorted(values), q);

export const median = (values: number[]): number => quantile(values, 0.5);

/**
 * Median absolute deviation — the robust spread.
 *
 * Returned raw, not scaled. Callers that want something comparable to a
 * standard deviation multiply by 1.4826, which is the constant that makes MAD
 * consistent for σ under a normal distribution.
 */
export function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map(v => Math.abs(v - m)));
}

/** MAD rescaled so it can stand in for a standard deviation. */
export const robustSigma = (values: number[]): number => 1.4826 * mad(values);

/**
 * Mean with the extremes cut from both ends.
 *
 * This is the estimator for anything that must add up. It keeps the mean's
 * property of totalling correctly while dropping the single-outlier
 * sensitivity that makes a raw mean useless on spending data.
 */
export function trimmedMean(values: number[], proportion = 0.1): number {
  if (values.length === 0) return 0;
  const asc = sorted(values);
  const cut = Math.floor(asc.length * proportion);
  // Trimming everything would leave nothing to average — fall back to the
  // median, which is the limit of a trimmed mean as the trim approaches a half.
  if (asc.length - 2 * cut < 1) return quantileSorted(asc, 0.5);
  return mean(asc.slice(cut, asc.length - cut));
}

/** Coefficient of variation. Above ~1 a monthly series is genuinely erratic. */
export function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m <= 0) return 0;
  const variance = mean(values.map(v => (v - m) ** 2));
  return Math.sqrt(variance) / m;
}

/**
 * The Iglewicz–Hoaglin modified z-score.
 *
 * 0.6745 is the reciprocal of 1.4826: it rescales the MAD so the score is
 * directly comparable to a classical z under normality. The published flagging
 * threshold is 3.5, and it is deliberately high — 2.0 is an exploratory
 * threshold that floods a real interface with false alarms.
 *
 * An identical repeated amount makes the MAD exactly zero and the score
 * infinite, so the spread falls back to the IQR (÷1.349 puts it on the same
 * scale) and then to a floor.
 */
export function modifiedZ(value: number, values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  let spread = mad(values);

  if (spread === 0) {
    const asc = sorted(values);
    spread = (quantileSorted(asc, 0.75) - quantileSorted(asc, 0.25)) / 1.349;
  }
  if (spread === 0) return 0; // every observation identical — nothing is an outlier

  return (0.6745 * (value - m)) / spread;
}

/**
 * A seeded PRNG.
 *
 * Every simulation in this app is seeded, and that is a product decision rather
 * than a testing convenience: a "safe to spend" figure that changes on
 * re-render is a figure nobody can trust or act on. The same inputs must always
 * produce the same number.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash, for deriving a seed from something like a budget id. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Shrinks an estimate toward a neutral value when the evidence is thin.
 *
 * `n / (n + strength)` is the standard James–Stein-flavoured weight: with no
 * observations the answer is entirely the prior, and it approaches the sample
 * estimate as evidence accumulates. This is what stops one observed Saturday
 * from declaring that Saturdays cost three times a Tuesday.
 */
export const shrink = (estimate: number, toward: number, n: number, strength: number): number =>
  toward + (estimate - toward) * (n / (n + strength));

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Sum, with non-finite entries treated as zero rather than poisoning the total. */
export const sum = (values: number[]): number =>
  values.reduce((total, v) => total + (Number.isFinite(v) ? v : 0), 0);
