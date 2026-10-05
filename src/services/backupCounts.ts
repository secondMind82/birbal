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
    (t) =>
      t.expense_amount_paise !== null &&
      t.expense_amount_paise !== undefined &&
      (t.money_type === null || t.money_type === undefined || t.money_type === 'expense'),
  ).length;
  counts.credits = timelines.filter(
    (t) => t.expense_amount_paise !== null && t.expense_amount_paise !== undefined && t.money_type === 'receive',
  ).length;
  counts.debits = timelines.filter(
    (t) =>
      t.expense_amount_paise !== null &&
      t.expense_amount_paise !== undefined &&
      (t.money_type === 'expense' || t.money_type === null || t.money_type === undefined),
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
  'smsMessages',
] as const;

export function isInternalCountKey(key: string): boolean {
  return (INTERNAL_COUNT_KEYS as readonly string[]).includes(key);
}

export function describeCounts(counts: Record<string, number>): string {
  const parts: string[] = [];
  const add = (key: string, singular: string, plural?: string) => {
    const c = counts[key] ?? 0;
    if (c === 0) return;
    parts.push(`${c} ${c === 1 ? singular : plural ?? singular + 's'}`);
  };
  add('timelines', 'timeline');
  add('events', 'event');
  add('expenses', 'expense');
  add('notes', 'note');
  add('diary_entries', 'diary', 'diaries');
  add('diary', 'diary', 'diaries');
  add('entities', 'entity');
  add('contacts', 'contact');
  add('timelineEntityLinks', 'timeline-entity link');
  add('notifications', 'notification');
  add('sms_messages', 'SMS message');
  add('sms', 'SMS message');
  return parts.length > 0 ? parts.join(' · ') : '0 records';
}
