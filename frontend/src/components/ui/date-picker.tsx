import * as React from 'react';
import { CalendarDays, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  addDays,
  endOfMonth,
  formatDay,
  formatRangeLabel,
  fromDayKey,
  isValidDayKey,
  startOfMonth,
  toDayKey,
  type DateRange,
} from '@/lib/dates';

export type { DateRange };

/**
 * App-styled date controls, replacing `<input type="date">`.
 *
 * The native input hands the whole interaction to the OS: an iOS wheel here, a
 * Windows flyout there, a Chrome grid elsewhere — three visual languages, none
 * of them this app's. These render the same calendar everywhere.
 *
 * The value contract is unchanged — `YYYY-MM-DD` in, `YYYY-MM-DD` out — so this
 * drops straight into every place the native input was used.
 */

const triggerClasses = cn(
  'tactile flex h-11 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-subtle',
  'px-3.5 text-left text-callout md:h-10 md:text-subhead',
  'hover:border-border-strong hover:bg-muted',
  'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/28',
  'disabled:cursor-not-allowed disabled:opacity-50'
);

export interface DatePickerProps {
  /** `YYYY-MM-DD`, or empty for no selection. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  /** Quick options above the grid — "Today", "Yesterday" by default. */
  presets?: { label: string; value: () => string }[];
}

const DEFAULT_PRESETS: NonNullable<DatePickerProps['presets']> = [
  { label: 'Today', value: () => toDayKey() },
  { label: 'Yesterday', value: () => toDayKey(addDays(new Date(), -1)) },
];

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Pick a date',
  id,
  className,
  disabled,
  presets = DEFAULT_PRESETS,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const valid = isValidDayKey(value);

  const allowed = (day: string) => {
    if (min && isValidDayKey(min) && day < min) return false;
    if (max && isValidDayKey(max) && day > max) return false;
    return true;
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      label="Choose a date"
      trigger={
        <button id={id} type="button" disabled={disabled} className={cn(triggerClasses, className)}>
          <CalendarDays className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <span className={cn('min-w-0 flex-1 truncate', !valid && 'text-faint')}>
            {valid ? formatDay(fromDayKey(value)) : placeholder}
          </span>
        </button>
      }
    >
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border p-3 pb-2.5">
          {presets.map(preset => {
            const day = preset.value();
            return (
              <button
                key={preset.label}
                type="button"
                disabled={!allowed(day)}
                onClick={() => { onChange(day); setOpen(false); }}
                className={cn(
                  'tactile rounded-full px-3.5 h-9 text-caption font-semibold',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                  day === value
                    ? 'border-primary/60 bg-primary/15 text-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}

      <Calendar
        selected={value}
        onSelect={day => { onChange(day); setOpen(false); }}
        min={min}
        max={max}
      />
    </Popover>
  );
}

// ── Range ───────────────────────────────────────────────────────────────────

/** State a bespoke trigger needs to label itself. */
export interface RangeTriggerState {
  label: string;
  hasValue: boolean;
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  /**
   * Renders a bespoke trigger — a filter chip, say — instead of the default
   * field. Must return a single element that forwards refs and spreads props,
   * because Radix wires the anchor onto it.
   */
  renderTrigger?: (state: RangeTriggerState) => React.ReactElement;
  presets?: { label: string; range: () => DateRange }[];
}

const rangeOf = (from: Date, to: Date): DateRange => ({ from: toDayKey(from), to: toDayKey(to) });

const DEFAULT_RANGE_PRESETS: NonNullable<DateRangePickerProps['presets']> = [
  { label: 'Last 7 days', range: () => rangeOf(addDays(new Date(), -6), new Date()) },
  { label: 'Last 30 days', range: () => rangeOf(addDays(new Date(), -29), new Date()) },
  { label: 'This month', range: () => rangeOf(startOfMonth(new Date()), new Date()) },
  {
    label: 'Last month',
    range: () => {
      const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
      return rangeOf(startOfMonth(lastMonth), endOfMonth(lastMonth));
    },
  },
  { label: 'Last 90 days', range: () => rangeOf(addDays(new Date(), -89), new Date()) },
  { label: 'This year', range: () => rangeOf(new Date(new Date().getFullYear(), 0, 1), new Date()) },
];

export function DateRangePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Custom range',
  className,
  id,
  renderTrigger,
  presets = DEFAULT_RANGE_PRESETS,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState<string | null>(null);
  /** The half-drawn range: set on the first press, cleared on the second. */
  const [pendingFrom, setPendingFrom] = React.useState<string | null>(null);

  const hasValue = isValidDayKey(value.from) && isValidDayKey(value.to);
  const label = pendingFrom
    ? `${formatDay(fromDayKey(pendingFrom))} – …`
    : formatRangeLabel(value, placeholder);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) { setPendingFrom(null); setHovered(null); }
  };

  const handleSelect = (day: string) => {
    if (!pendingFrom) {
      setPendingFrom(day);
      return;
    }
    // Second press closes the range. Picking backwards is normal behaviour, not
    // an error — swap the ends rather than rejecting it.
    const [from, to] = day < pendingFrom ? [day, pendingFrom] : [pendingFrom, day];
    setPendingFrom(null);
    setHovered(null);
    onChange({ from, to });
    handleOpenChange(false);
  };

  const defaultTrigger = (
    <button id={id} type="button" className={cn(triggerClasses, className)}>
      <CalendarDays className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <span className={cn('min-w-0 flex-1 truncate', !hasValue && 'text-faint')}>
        {label}
      </span>
      {hasValue && (
        // A span, not a nested button — a button inside a button is invalid
        // markup and browsers resolve it by dropping one of them.
        <span
          role="button"
          tabIndex={-1}
          aria-label="Clear range"
          onClick={event => { event.stopPropagation(); onChange({ from: '', to: '' }); }}
          className="tactile -mr-1.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      align="end"
      label="Choose a date range"
      trigger={renderTrigger ? renderTrigger({ label, hasValue }) : defaultTrigger}
    >
      <div className="flex flex-col sm:flex-row">
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border p-3 sm:w-40 sm:flex-col sm:flex-nowrap sm:gap-1 sm:border-b-0 sm:border-r">
            {presets.map(preset => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setPendingFrom(null);
                  onChange(preset.range());
                  handleOpenChange(false);
                }}
                className="tactile rounded-lg bg-muted px-3 h-9 text-caption font-semibold text-muted-foreground hover:text-foreground sm:w-full sm:bg-transparent sm:text-left sm:hover:bg-muted"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}

        <div>
          <Calendar
            rangeStart={pendingFrom ?? value.from}
            rangeEnd={pendingFrom ? null : value.to}
            hovered={pendingFrom ? hovered : null}
            onHover={setHovered}
            onSelect={handleSelect}
            min={min}
            max={max}
          />
          <p className="px-3 pb-3 text-micro text-muted-foreground">
            {pendingFrom ? 'Now pick the end of the range.' : 'Pick a start date, then an end date.'}
          </p>
        </div>
      </div>
    </Popover>
  );
}
