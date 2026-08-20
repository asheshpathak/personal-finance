import { addDays, isValidDayKey, startOfDay, toDayKey } from './dates';
import { formatRangeLabel, type DateRange } from './dates';

/**
 * The period window over an expense list.
 *
 * Shared by the dashboard and the expenses page so the two can't drift into
 * having different ideas of what "1W" means. Kept out of the component that
 * renders it because both pages need the filtering and the caption without
 * rendering the control.
 */

export type RangeKey = '1D' | '3D' | '5D' | '1W' | '1M' | '3M' | 'ALL' | 'CUSTOM';

export interface RangeFilter {
  key: RangeKey;
  /** `YYYY-MM-DD`; read only when key is CUSTOM. */
  custom: DateRange;
}

export const defaultRangeFilter = (key: RangeKey = '1W'): RangeFilter => ({
  key,
  custom: { from: '', to: '' },
});

const PRESETS: { key: Exclude<RangeKey, 'CUSTOM'>; label: string; days: number | null }[] = [
  { key: '1D', label: '1D', days: 1 },
  { key: '3D', label: '3D', days: 3 },
  { key: '5D', label: '5D', days: 5 },
  { key: '1W', label: '1W', days: 7 },
  { key: '1M', label: '1M', days: 30 },
  { key: '3M', label: '3M', days: 90 },
  { key: 'ALL', label: 'All', days: null },
];

/** Which presets to offer. The dashboard is a recent view; the list is a history. */
export function presetsFor(scope: 'recent' | 'all') {
  return scope === 'all' ? PRESETS : PRESETS.filter(p => p.key !== 'ALL');
}

/**
 * Filters by calendar day rather than by instant.
 *
 * Expenses are stored at local noon, so comparing raw timestamps against "seven
 * days ago, right now" clips the earliest day for anyone whose local time is
 * past noon. Comparing day keys makes the window mean whole days, which is what
 * "last 7 days" is understood to mean.
 */
export function filterByRange<T extends { date: string }>(items: T[], filter: RangeFilter): T[] {
  if (filter.key === 'CUSTOM') {
    const { from, to } = filter.custom;
    if (!isValidDayKey(from) || !isValidDayKey(to)) return items;
    // Tolerate a backwards range rather than showing an empty list.
    const [start, end] = from <= to ? [from, to] : [to, from];
    return items.filter(item => {
      const day = toDayKey(new Date(item.date));
      return day >= start && day <= end;
    });
  }

  // Looked up in the full table, not the scoped one. A scope that doesn't offer
  // a key (the dashboard hides "All") must still honour it if it is somehow
  // set, rather than silently falling through to the 7-day default while
  // `describeRange` captions it "All time".
  const preset = PRESETS.find(p => p.key === filter.key);
  if (!preset || preset.days === null) return items;

  // Inclusive of today: "1D" means today, not "the last 24 hours".
  const cutoff = toDayKey(addDays(startOfDay(new Date()), -(preset.days - 1)));
  return items.filter(item => toDayKey(new Date(item.date)) >= cutoff);
}

/** What the current selection covers, for a caption under a total. */
export function describeRange(filter: RangeFilter): string {
  if (filter.key === 'CUSTOM') {
    const { from, to } = filter.custom;
    if (isValidDayKey(from) && isValidDayKey(to)) return formatRangeLabel(filter.custom);
    return 'Custom range';
  }
  const preset = PRESETS.find(p => p.key === filter.key);
  if (!preset || preset.days === null) return 'All time';
  if (preset.days === 1) return 'Today';
  return `Last ${preset.days} days`;
}
