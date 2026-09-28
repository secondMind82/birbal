import type { BackupRows } from '../db/models/backupRows';

// Record counting for Backup & Restore.
//
// Events and expenses are NOT separate collections: an event is a timeline row
// with show_on_calendar = 1 and an expense is a timeline row with
// expense_amount_paise set. They are the same underlying record, so the counts
// below are derived from the single `timelines` table. Duplicating those rows
// into their own arrays would risk the copies drifting apart and would inflate
// the payload, which is why the wire format stores them once.

export function computeRecordCounts(rows: BackupRows): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, list] of Object.entries(rows)) {
    counts[key] = Array.isArray(list) ? list.length : 0;
  }

  const timelines = Array.isArray(rows.timelines) ? rows.timelines : [];
  counts.timelines = timelines.length;
  counts.events = timelines.filter((t) => Number(t.show_on_calendar) === 1).length;
  counts.expenses = timelines.filter(
    (t) => t.expense_amount_paise !== null && t.expense_amount_paise !== undefined,
  ).length;

  // `total` is the number of physical rows written to SQLite, so it is summed
  // from the collections only. events/expenses are derived views of the same
  // timeline rows and must not be added in, or every calendar event and expense
  // would be counted twice in the "N records" the UI shows.
  counts.total = Object.entries(counts)
    .filter(([key]) => key !== 'total')
    .reduce((sum, [key, value]) => sum + (Array.isArray(rows[key as keyof BackupRows]) ? value : 0), 0);

  return counts;
}

/** Keys that are noise in a user-facing summary. */
export const INTERNAL_COUNT_KEYS = [
  'total',
  'contacts',
  'timelineEntityLinks',
  'notifications',
] as const;

export function isInternalCountKey(key: string): boolean {
  return (INTERNAL_COUNT_KEYS as readonly string[]).includes(key);
}

export function describeCounts(counts: Record<string, number>): string {
  const parts = [
    `${counts.timelines ?? 0} timeline${counts.timelines === 1 ? '' : 's'}`,
    `${counts.events ?? 0} event${counts.events === 1 ? '' : 's'}`,
    `${counts.expenses ?? 0} expense${counts.expenses === 1 ? '' : 's'}`,
    `${counts.notes ?? 0} note${counts.notes === 1 ? '' : 's'}`,
    `${counts.diary_entries ?? 0} ${counts.diary_entries === 1 ? 'diary' : 'diaries'}`,
  ];
  return parts.join(' · ');
}
