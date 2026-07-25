/**
 * Chart colour tokens for the dark canvas.
 *
 * The categorical slots were snapped into the OKLCH lightness band for dark
 * surfaces (0.48–0.67) and validated against surface #14121c: lightness band,
 * chroma floor, adjacent-pair CVD separation (worst ΔE 19.3, target ≥ 8),
 * normal-vision floor (23.7) and 3:1 contrast all pass. The order is what was
 * validated — assign by slot, never re-sort, never generate a 9th.
 */
export const CATEGORICAL = [
  'hsl(255, 100%, 69%)', // violet — brand, always slot 1
  'hsl(322, 90%, 41%)',  // fuchsia
  'hsl(220, 92%, 59%)',  // blue
  'hsl(38, 95%, 37%)',   // amber
  'hsl(190, 90%, 40%)',  // cyan
  'hsl(2, 85%, 45%)',    // coral
  'hsl(280, 72%, 64%)',  // purple
  'hsl(152, 65%, 34%)',  // green
] as const;

/** Everything measured on one scale wears this. More is not darker. */
export const PRIMARY = CATEGORICAL[0];

/** The comparison series: present, clearly secondary, never competing for the eye. */
export const COMPARISON = 'hsl(250, 10%, 45%)';

export const GRID = 'hsl(250, 16%, 20%)';
export const AXIS_TEXT = 'hsl(252, 13%, 66%)';

/** Recharts tooltip chrome, matching the app's popover surface. */
export const TOOLTIP_STYLE = {
  borderRadius: '12px',
  border: '1px solid hsl(250 16% 22%)',
  background: 'hsl(250 22% 11%)',
  color: 'hsl(0 0% 98%)',
  fontSize: '13px',
  padding: '8px 10px',
} as const;

export const TOOLTIP_ITEM_STYLE = { color: 'hsl(0 0% 98%)' } as const;
export const TOOLTIP_LABEL_STYLE = { color: 'hsl(252 13% 66%)', marginBottom: '2px' } as const;

/** Categorical hue for slot `i`. Callers must fold anything past 8 into "Other". */
export function categoricalColor(index: number): string {
  return CATEGORICAL[Math.min(index, CATEGORICAL.length - 1)];
}
