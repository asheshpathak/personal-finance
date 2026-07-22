import type { Frequency } from './subscriptionTotals';

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

export function formatDueDate({ frequency, dueDayOfWeek, dueDayOfMonth, dueMonth }: DueDateFields): string {
  switch (frequency) {
    case 'daily':
      return '—';
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

function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

export const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);
