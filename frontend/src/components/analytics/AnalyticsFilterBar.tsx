import { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { PERIOD_PRESETS, type AnalyticsFilters } from '@/lib/analytics';
import { CATEGORY_GROUP_LABELS, type CategoryGroup } from '@/lib/expenseCategories';

/** Toggles a value in a "selected" list, where empty means "everything". */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'rounded-full border px-3 h-11 md:h-8 text-xs font-semibold transition-colors',
        selected
          ? 'border-primary/60 bg-primary/15 text-foreground'
          : 'border-white/10 bg-white/[0.04] text-muted-foreground hover:text-foreground hover:border-white/20'
      )}
    >
      {label}
    </button>
  );
}

/**
 * One filter row above everything it scopes — every chart, stat and table on the
 * page reads the same slice, so the numbers can never disagree.
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

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 sm:p-4 min-w-0">
      {/* Date range first — it's the control every reader reaches for. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PERIOD_PRESETS.map(preset => (
          <Chip
            key={preset.key}
            label={preset.label}
            selected={filters.period === preset.key}
            onClick={() => patch({ period: preset.key })}
          />
        ))}

        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 h-11 md:h-8 text-xs font-semibold transition-colors',
            activeCount > 0
              ? 'border-primary/60 bg-primary/15 text-foreground'
              : 'border-white/10 bg-white/[0.04] text-muted-foreground hover:text-foreground'
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/30 px-1.5 tabular-nums">{activeCount}</span>
          )}
        </button>
      </div>

      {filters.period === 'CUSTOM' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-white/[0.06]">
          <div className="space-y-1.5">
            <Label htmlFor="analytics-from" className="text-xs text-muted-foreground">From</Label>
            <Input
              id="analytics-from"
              type="date"
              value={filters.customStart}
              onChange={e => patch({ customStart: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="analytics-to" className="text-xs text-muted-foreground">To</Label>
            <Input
              id="analytics-to"
              type="date"
              value={filters.customEnd}
              onChange={e => patch({ customEnd: e.target.value })}
            />
          </div>
        </div>
      )}

      {open && (
        <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-4">
          <FilterGroup label="Type">
            {(Object.keys(CATEGORY_GROUP_LABELS) as CategoryGroup[]).map(group => (
              <Chip
                key={group}
                label={CATEGORY_GROUP_LABELS[group]}
                selected={filters.groups.includes(group)}
                onClick={() => patch({ groups: toggle(filters.groups, group) })}
              />
            ))}
          </FilterGroup>

          {paymentModes.length > 0 && (
            <FilterGroup label="Payment mode">
              {paymentModes.map(mode => (
                <Chip
                  key={mode}
                  label={mode}
                  selected={filters.paymentModes.includes(mode)}
                  onClick={() => patch({ paymentModes: toggle(filters.paymentModes, mode) })}
                />
              ))}
            </FilterGroup>
          )}

          {categories.length > 0 && (
            <FilterGroup label="Category">
              {categories.map(category => (
                <Chip
                  key={category}
                  label={category}
                  selected={filters.categories.includes(category)}
                  onClick={() => patch({ categories: toggle(filters.categories, category) })}
                />
              ))}
            </FilterGroup>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3 pt-3 border-t border-white/[0.06] text-xs text-muted-foreground">
        <span className="tabular-nums">
          {resultCount} {resultCount === 1 ? 'payment' : 'payments'} in view
        </span>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => patch({ categories: [], paymentModes: [], groups: [] })}
            className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors"
          >
            <X className="w-3 h-3" />
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
