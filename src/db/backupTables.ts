// Registry of every user-owned local table that participates in Backup & Restore.
//
// Why a registry instead of hand-written SQL per feature: adding a new
// user-data table (or a new column) to the app must mean adding ONE entry here,
// not rewriting the backup builder, the validator and the restore writer. The
// generic read/restore code below is driven entirely by this table, so the
// three stay in sync by construction.
//
// Every table entry must declare:
//   key        – stable JSON key inside a backup's `data` object. Never reuse
//                or rename a key: old backups must keep parsing.
//   table      – real SQLite table name (interpolated into SQL; never user data).
//   columns    – exact column list to read and to write. Order defines bind order.
//   userScoped – true when the table has a `user_id` column that owns the rows.
//   order      – restore order. Dependencies must come before dependents, and
//                the writer deletes in reverse order (children first).
//   countsAs   – payload record-count key(s) this table contributes to, so the
//                UI can report "N timelines / M events / K expenses". Derived
//                sub-counts (events/expenses inside `timelines`) are computed by
//                the backup service, not here.
//
// Deliberately EXCLUDED:
//   app_meta          – device + schema bookkeeping, not user data.
//   backup_snapshots  – local safety net created by the restore writer itself.

export type ColumnType = 'text' | 'number' | 'boolean' | 'any';

export interface TableSpec {
  key: string;
  table: string;
  columns: readonly string[];
  userScoped: boolean;
  order: number;
  countsAs?: readonly string[];
  /** Column holding the parent key for join tables (restores a scoped DELETE). */
  parentKey?: string;
  columnTypes?: Readonly<Record<string, ColumnType>>;
}

export const BACKUP_TABLES: readonly TableSpec[] = [
  {
    key: 'entities',
    table: 'entities',
    order: 1,
    userScoped: true,
    countsAs: ['entities', 'contacts'],
    columns: ['id', 'user_id', 'name', 'type', 'description', 'avatar', 'created_at', 'updated_at'],
    columnTypes: { name: 'text', type: 'text' },
  },
  {
    key: 'timelines',
    table: 'timelines',
    order: 2,
    userScoped: true,
    countsAs: ['timelines'],
    columns: [
      'id',
      'user_id',
      'title',
      'description',
      'event_date',
      'show_on_calendar',
      'created_at',
      'updated_at',
      'expense_amount_paise',
      'expense_category',
      'receivable_status',
      'money_type',
    ],
    columnTypes: { title: 'text', event_date: 'text', show_on_calendar: 'boolean' },
  },
  {
    key: 'timeline_entities',
    table: 'timeline_entities',
    order: 3,
    userScoped: false,
    parentKey: 'timeline_id',
    countsAs: ['timelineEntityLinks'],
    columns: ['timeline_id', 'entity_id'],
  },
  {
    key: 'notes',
    table: 'notes',
    order: 4,
    userScoped: true,
    countsAs: ['notes'],
    columns: ['id', 'user_id', 'title', 'content', 'pinned', 'created_at', 'updated_at'],
    columnTypes: { title: 'text', content: 'text', pinned: 'boolean' },
  },
  {
    key: 'diary_entries',
    table: 'diary_entries',
    order: 5,
    userScoped: true,
    countsAs: ['diaryEntries'],
    columns: ['id', 'user_id', 'title', 'content', 'mood', 'entry_date', 'created_at', 'updated_at'],
    columnTypes: { title: 'text', content: 'text', mood: 'text', entry_date: 'text' },
  },
  {
    key: 'notifications',
    table: 'notifications',
    order: 6,
    userScoped: true,
    countsAs: ['notifications'],
    columns: [
      'id',
      'user_id',
      'type',
      'title',
      'message',
      'icon',
      'read',
      'entity_id',
      'timeline_id',
      'created_at',
    ],
    columnTypes: { title: 'text', read: 'boolean' },
  },
] as const;

export const TABLES_BY_KEY: Readonly<Record<string, TableSpec>> = Object.fromEntries(
  BACKUP_TABLES.map((spec) => [spec.key, spec]),
);

/** Restore order: parents first. The delete pass walks this list backwards. */
export const RESTORE_ORDER: readonly TableSpec[] = [...BACKUP_TABLES].sort(
  (a, b) => a.order - b.order,
);

export const DELETE_ORDER: readonly TableSpec[] = [...RESTORE_ORDER].reverse();

/**
 * Restore is future-proof by construction: a table added to the app after a
 * backup was taken simply has no rows in that backup, which is the correct
 * "nothing to restore" behaviour rather than a failure.
 */
export function isKnownTableKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABLES_BY_KEY, key);
}
