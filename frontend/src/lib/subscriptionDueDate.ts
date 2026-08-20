import type { Frequency } from './subscriptionTotals';
import { formatDay, fromDayKey, isValidDayKey, ordinal, relativeDay } from './dates';

export const DAYS_OF_WEEK = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]['value'];

export const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
] as const;

export interface DueDateFields {
  frequency: Frequency;
  dueDayOfWeek?: DayOfWeek | null;
  dueDayOfMonth?: number | null;
  dueMonth?: number | null;
}

/** A due-date change waiting for the current cycle to end. */
export interface PendingSchedule extends DueDateFields {
  frequency: Frequency;
}

export function formatDueDate({ frequency, dueDayOfWeek, dueDayOfMonth, dueMonth }: DueDateFields): string {
  switch (frequency) {
    case 'daily':
      return 'Every day';
    case 'weekly': {
      if (!dueDayOfWeek) return '—';
      return DAYS_OF_WEEK.find(d => d.value === dueDayOfWeek)?.label ?? dueDayOfWeek;
    }
    case 'monthly': {
      if (!dueDayOfMonth) return '—';
      return ordinal(dueDayOfMonth);
    }
    case 'yearly': {
      if (!dueMonth || !dueDayOfMonth) return '—';
      const month = MONTHS.find(m => m.value === dueMonth)?.label ?? String(dueMonth);
      return `${month} ${ordinal(dueDayOfMonth)}`;
    }
  }
}

export const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

/** "Sep 12, 2026 · in 23 days" — a date plus how far off it is. */
export function formatNextCharge(nextDueDay: string | null | undefined): string {
  if (!nextDueDay || !isValidDayKey(nextDueDay)) return '—';
  const date = fromDayKey(nextDueDay);
  return `${formatDay(date)} · ${relativeDay(date)}`;
}

/**
 * Explains a staged due-date change in the user's own terms.
 *
 * The rule this describes: editing when a subscription bills does not move a
 * charge that has already gone out this cycle, so the new date starts applying
 * at the next one — the same way changing a renewal date works with an app
 * store. Saying so plainly is what stops it reading as "my edit didn't save".
 */
export function describePendingChange(
  pending: PendingSchedule | null | undefined,
  effectiveFrom: string | null | undefined
): string | null {
  if (!pending || !effectiveFrom || !isValidDayKey(effectiveFrom)) return null;
  return `Due date moves to ${formatDueDate(pending)} from ${formatDay(fromDayKey(effectiveFrom))}. This cycle keeps the current date.`;
}
