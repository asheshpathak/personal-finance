import { useState } from 'react';
import { SlidersHorizontal, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SegmentedButton } from '@/components/ui/segmented';
import { DateRangePicker } from '@/components/ui/date-picker';
import { PERIOD_PRESETS, type AnalyticsFilters } from '@/lib/analytics';
import { CATEGORY_GROUP_LABELS, type CategoryGroup } from '@/lib/expenseCategories';

/** Toggles a value in a "selected" list, where empty means "everything". */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

/**
 * One filter row above everything it scopes — every chart, stat and table on the
 * page reads the same slice, so the numbers can never disagree.
 *
 * The layout is deliberately two *rows*, not one wrapping flex line. The old
 * version put the presets and the Filters button in a single `flex-wrap` with
 * `ml-auto` on the button: as soon as the presets wrapped, the button dropped
 * onto its own line and `ml-auto` shoved it to the far right, leaving a wide
 * ragged gap where a button group should be. Giving the actions their own row
 * means the group is aligned at every width instead of only the wide ones.
 */
export function AnalyticsFilterBar({
  filters,
  onChange,
  categories,
  paymentModes,
  resultCount,
}: {
  filters: AnalyticsFilters;
  onChange: (next: AnalyticsFilters) => void;
  /** Categories actually present in the data, most-used first. */
  categories: string[];
  paymentModes: string[];
  resultCount: number;
}) {
  const [open, setOpen] = useState(false);

  const patch = (next: Partial<AnalyticsFilters>) => onChange({ ...filters, ...next });

  const activeCount =
    filters.categories.length + filters.paymentModes.length + filters.groups.length;

  const presets = PERIOD_PRESETS.filter(p => p.key !== 'CUSTOM');

  return (
    <div className="rounded-2xl border border-border bg-subtle p-3 sm:p-4 min-w-0">
      {/* Row 1 — period. The control every reader reaches for first. */}
      <div
        role="group"
        aria-label="Period"
        className="scroll-x no-scrollbar -mx-1 flex items-center gap-1.5 px-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {presets.map(preset => (
          <SegmentedButton
            key={preset.key}
            selected={filters.period === preset.key}
            onClick={() => patch({ period: preset.key })}
          >
            {preset.label}
          </SegmentedButton>
        ))}

        {/* Custom sits in the same row and opens the app's own range calendar
            rather than two native date inputs. */}
        <DateRangePicker
          value={{ from: filters.customStart, to: filters.customEnd }}
          onChange={range =>
            patch({ period: 'CUSTOM', customStart: range.from, customEnd: range.to })
          }
          placeholder="Custom"
          renderTrigger={({ label, hasValue }) => (
            <SegmentedButton selected={filters.period === 'CUSTOM'} className="max-w-[16rem]">
              <span className="truncate">
                {filters.period === 'CUSTOM' && hasValue ? label : 'Custom'}
              </span>
              <ChevronDown className="h-3 w-3 flex-shrink-0 opacity-60" />
            </SegmentedButton>
          )}
        />
      </div>

      {/* Row 2 — actions and result count. Its own row, so nothing here can be
          knocked out of alignment by how many presets happened to fit above. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className={cn(
            'tactile inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 h-11 md:h-9 text-caption font-semibold',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
            activeCount > 0 || open
              ? 'border-primary/60 bg-primary/15 text-foreground'
              : 'border-border bg-subtle text-muted-foreground hover:border-border-strong hover:text-foreground'
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/30 px-1.5 tnum">{activeCount}</span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => patch({ categories: [], paymentModes: [], groups: [] })}
            className="tactile inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 h-9 text-caption font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}

        <span className="ml-auto flex-shrink-0 text-caption tnum text-muted-foreground">
          {resultCount} {resultCount === 1 ? 'payment' : 'payments'} in view
        </span>
      </div>

      {open && (
        <div className="mt-3 space-y-4 border-t border-border pt-3">
          <FilterGroup label="Type">
            {(Object.keys(CATEGORY_GROUP_LABELS) as CategoryGroup[]).map(group => (
              <SegmentedButton
                key={group}
                size="sm"
                selected={filters.groups.includes(group)}
                onClick={() => patch({ groups: toggle(filters.groups, group) })}
              >
                {CATEGORY_GROUP_LABELS[group]}
              </SegmentedButton>
            ))}
          </FilterGroup>

          {paymentModes.length > 0 && (
            <FilterGroup label="Payment mode">
              {paymentModes.map(mode => (
                <SegmentedButton
                  key={mode}
                  size="sm"
                  selected={filters.paymentModes.includes(mode)}
                  onClick={() => patch({ paymentModes: toggle(filters.paymentModes, mode) })}
                >
                  {mode}
                </SegmentedButton>
              ))}
            </FilterGroup>
          )}

          {categories.length > 0 && (
            <FilterGroup label="Category">
              {categories.map(category => (
                <SegmentedButton
                  key={category}
                  size="sm"
                  selected={filters.categories.includes(category)}
                  onClick={() => patch({ categories: toggle(filters.categories, category) })}
                >
                  {category}
                </SegmentedButton>
              ))}
            </FilterGroup>
          )}
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-micro font-bold uppercase text-muted-foreground mb-2">{label}</p>
      {/* Wraps rather than scrolls: these lists are long and a hidden scroll
          strip would bury most of the options. */}
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
