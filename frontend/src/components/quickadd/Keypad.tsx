import * as React from 'react';
import { Delete } from 'lucide-react';
import { cn } from '@/lib/utils';
import { appendDigit, formatMinor, removeDigit } from '@/lib/money';
import type { Currency } from '@/lib/currencyCache';

/**
 * A number pad, rather than a text field.
 *
 * This is the least obvious decision in the app and the one that matters most
 * to whether anybody keeps using it. A `<input inputmode="decimal">` looks like
 * the simple answer and costs three things:
 *
 *  1. The OS keyboard takes roughly 45% of the viewport and *animates in*, so
 *     the layout jumps and the amount you are typing can scroll out of view.
 *  2. `inputmode="decimal"` gives a locale-dependent separator and no
 *     guaranteed Done key, so the last step of entry varies by device.
 *  3. It occupies the whole bottom of the screen, which means the category
 *     chips and the save button cannot share a surface with it — and the entry
 *     becomes keypad → dismiss keyboard → scroll → tap, instead of one thumb
 *     never leaving one panel.
 *
 * With a custom pad the whole entry is amount → category → done, on one
 * surface, in about three seconds. Capture latency *is* churn in this
 * category: manual-entry trackers are abandoned at several times the rate of
 * connected ones, and the reason is friction per payment, not features.
 *
 * Accessibility is not sacrificed for it. Every key is a real `<button>` with a
 * label, the running value is announced politely, and a hidden numeric input
 * mirrors the value so a hardware keyboard and a screen reader can type into it
 * normally.
 */

export interface KeypadProps {
  /** The amount in minor units — paise or cents. Never a float. */
  value: number;
  onChange: (minor: number) => void;
  currency: Currency;
  symbol: string;
  /** Rendered under the amount: a hint, a warning, a suggestion. */
  caption?: React.ReactNode;
  className?: string;
}

/**
 * `00` rather than a decimal point.
 *
 * Digits fill from the right, so the decimal separator has nothing to do — and
 * a key that does nothing reads as a broken pad. `00` is the key people
 * actually want on a currency pad: most amounts are whole, and ₹1,200 becomes
 * three presses instead of five.
 */
const KEYS: (number | 'back' | '00')[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, '00', 0, 'back'];

export function Keypad({ value, onChange, currency, symbol, caption, className }: KeypadProps) {
  const display = formatMinor(value, currency);
  const inputId = React.useId();

  const press = (key: (typeof KEYS)[number]) => {
    if (key === 'back') {
      onChange(removeDigit(value));
      return;
    }
    if (key === '00') {
      // Two zeros, appended one at a time so the overflow guard applies to
      // each. Pressing it at zero would be a no-op either way.
      onChange(appendDigit(appendDigit(value, 0), 0));
      return;
    }
    onChange(appendDigit(value, key));
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {/* ── The amount ──────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center py-4 sm:py-6">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'text-title-2 font-semibold transition-colors',
              value > 0 ? 'text-muted-foreground' : 'text-faint'
            )}
          >
            {symbol}
          </span>
          <span
            className={cn(
              'text-display tnum transition-colors',
              value > 0 ? 'text-foreground' : 'text-faint'
            )}
            // The value changes on every keystroke; announcing each one is
            // chatter. `polite` lets the reader finish what it is saying, and
            // the atomic flag makes it read the whole figure rather than the
            // digit that changed.
            aria-live="polite"
            aria-atomic="true"
          >
            {display}
          </span>
        </div>

        {caption && <div className="mt-2 text-center text-footnote">{caption}</div>}
      </div>

      {/* Mirrors the value for anyone typing rather than tapping. Visually
          hidden, not `display:none` — the latter removes it from the
          accessibility tree, which defeats the point. */}
      <label htmlFor={inputId} className="sr-only">
        Amount
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        className="sr-only"
        value={value === 0 ? '' : String(value / 100)}
        onChange={event => {
          const parsed = Number(event.target.value.replace(/[^\d.]/g, ''));
          onChange(Number.isFinite(parsed) ? Math.round(parsed * 100) : 0);
        }}
      />

      {/* ── The keys ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
        {KEYS.map(key => (
          <button
            key={String(key)}
            type="button"
            onClick={() => press(key)}
            aria-label={key === 'back' ? 'Delete' : key === '00' ? 'Double zero' : String(key)}
            className={cn(
              'tactile flex h-[3.5rem] items-center justify-center rounded-xl',
              'text-title-2 font-medium tnum',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/28',
              key === 'back'
                ? 'bg-muted text-muted-foreground active:bg-hover'
                : 'bg-subtle text-foreground active:bg-hover'
            )}
          >
            {key === 'back' ? <Delete className="h-5 w-5" /> : key}
          </button>
        ))}
      </div>
    </div>
  );
}
