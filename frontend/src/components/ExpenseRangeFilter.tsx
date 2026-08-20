import { useMemo } from 'react';
import { CalendarRange, ChevronDown } from 'lucide-react';
import { SegmentedButton } from '@/components/ui/segmented';
import { DateRangePicker } from '@/components/ui/date-picker';
import { isValidDayKey, toDayKey } from '@/lib/dates';
import { presetsFor, type RangeFilter } from '@/lib/expenseRange';

/**
 * The period control over an expense list.
 *
 * The custom range lives in the same row as the presets rather than behind a
 * separate mode switch — it is one more way of answering the same question, not
 * a different question. The filtering itself lives in `lib/expenseRange`, since
 * both pages need it without rendering this.
 */
export function ExpenseRangeFilter({
  value,
  onChange,
  scope = 'all',
}: {
  value: RangeFilter;
  onChange: (next: RangeFilter) => void;
  scope?: 'recent' | 'all';
}) {
  const presets = useMemo(() => presetsFor(scope), [scope]);
  const hasCustom = isValidDayKey(value.custom.from) && isValidDayKey(value.custom.to);

  return (
    <div
      role="group"
      aria-label="Period"
      className="scroll-x no-scrollbar -mx-1 flex items-center gap-1.5 px-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      {presets.map(preset => (
        <SegmentedButton
          key={preset.key}
          size="sm"
          selected={value.key === preset.key}
          onClick={() => onChange({ ...value, key: preset.key })}
        >
          {preset.label}
        </SegmentedButton>
      ))}

      <DateRangePicker
        value={value.custom}
        onChange={custom => onChange({ key: 'CUSTOM', custom })}
        // No future dates: an expense can't be recorded ahead of time.
        max={toDayKey()}
        // Five years back is further than any history here goes; it gives the
        // calendar a floor to page against rather than a real constraint.
        min={toDayKey(new Date(new Date().getFullYear() - 5, 0, 1))}
        renderTrigger={({ label }) => (
          <SegmentedButton
            size="sm"
            selected={value.key === 'CUSTOM'}
            className="max-w-[15rem]"
            title="Pick an exact date range"
          >
            <CalendarRange className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">
              {value.key === 'CUSTOM' && hasCustom ? label : 'Custom'}
            </span>
            <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
          </SegmentedButton>
        )}
      />
    </div>
  );
}
