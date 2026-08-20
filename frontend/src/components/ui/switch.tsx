import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * An on/off switch with a real tap target.
 *
 * Built on a native checkbox rather than a div: it stays keyboard-operable,
 * announces its state to screen readers, and participates in forms — all of
 * which a styled div would have to reimplement badly. The input is visually
 * hidden but still the thing being pressed, so the whole control is the target.
 *
 * Sized to iOS: 51×31pt track, 27pt knob. Those proportions are not arbitrary —
 * a thinner track reads as a toggle switch from a settings page in 2012, and a
 * knob that doesn't overhang the track reads as a slider.
 */
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  label?: string;
  description?: string;
  className?: string;
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ checked, onCheckedChange, id, disabled, label, description, className }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    const control = (
      <span
        className={cn(
          'relative inline-flex h-[31px] w-[51px] flex-shrink-0 items-center rounded-full transition-colors duration-200 ease-out',
          checked ? 'bg-positive' : 'bg-border-strong',
          'peer-focus-visible:ring-[3px] peer-focus-visible:ring-primary/28',
          disabled && 'opacity-50'
        )}
        aria-hidden="true"
      >
        <span
          className={cn(
            'pointer-events-none absolute h-[27px] w-[27px] rounded-full bg-white shadow-xs',
            'transition-transform duration-300 ease-snappy',
            checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
          )}
        />
      </span>
    );

    const input = (
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={e => onCheckedChange(e.target.checked)}
        className="peer sr-only"
      />
    );

    if (!label) {
      return (
        <label
          htmlFor={inputId}
          className={cn(
            'inline-flex cursor-pointer items-center',
            disabled && 'cursor-not-allowed',
            className
          )}
        >
          {input}
          {control}
        </label>
      );
    }

    return (
      <label
        htmlFor={inputId}
        className={cn(
          'flex min-h-[44px] cursor-pointer items-center gap-3 py-1',
          disabled && 'cursor-not-allowed',
          className
        )}
      >
        {input}
        <span className="min-w-0 flex-1">
          <span className="block text-subhead font-medium leading-tight">{label}</span>
          {description && (
            <span className="mt-1 block text-caption text-muted-foreground">{description}</span>
          )}
        </span>
        {/* Trailing, matching every settings row on the platform: the label is
            what you read, the control is what you reach for. */}
        {control}
      </label>
    );
  }
);
Switch.displayName = 'Switch';
