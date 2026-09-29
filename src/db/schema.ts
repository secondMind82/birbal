import type { SQLiteDatabase } from 'expo-sqlite';

// Schema versioning uses SQLite's PRAGMA user_version (the source of truth) plus a
// minimal app_meta key/value table. runMigrations() is idempotent and safe to call on
// every app start; each migration runs atomically inside a transaction.
//
// TO ADD A FUTURE MIGRATION:
//   1. Append a new entry to MIGRATIONS with version = last version + 1 (and bump
//      SCHEMA_VERSION to match).
//   2. Keep `up` additive and/or reversible-by-reinstall; never edit an already
//      released migration, since only new versions are applied to existing databases.
//   3. New DDL can slot into its own `up` (e.g. CREATE TABLE notes (..., user_id TEXT
//      REFERENCES users(id) ...)).

export const SCHEMA_VERSION = 8;

export interface Migration {
  version: number;
  up: (db: SQLiteDatabase) => Promise<void> | void;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key   TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
      await db.runAsync(
        'INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)',
        'schema_created_at',
        new Date().toISOString(),
      );
    },
  },
  {
    // Business schema: user-scoped local persistence tables. Named after the mobile
    // models in src/models/types.ts (snake_case columns; TS model names stay separate).
    // user_id is NOT NULL on every business table to enforce local user isolation
    // (repositories will later filter WHERE user_id = <current user>); the API model
    // marks userId optional because the server derives it from the auth token.
    // Booleans are INTEGER 0/1. Timestamps are ISO TEXT. Optional model fields map to
    // NULLable columns. Timeline <-> Entity is a many-to-many join (timeline_entities);
    // the Timeline.entities relation is reconstructed from that join, never stored as JSON.
    version: 2,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS notes (
          id         TEXT PRIMARY KEY NOT NULL,
          user_id    TEXT NOT NULL,
          title      TEXT NOT NULL,
          content    TEXT NOT NULL,
          pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
          created_at TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS diary_entries (
          id         TEXT PRIMARY KEY NOT NULL,
          user_id    TEXT NOT NULL,
          title      TEXT NOT NULL,
          content    TEXT NOT NULL,
          mood       TEXT NOT NULL,
          entry_date TEXT NOT NULL,
          created_at TEXT,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS entities (
          id          TEXT PRIMARY KEY NOT NULL,
          user_id     TEXT NOT NULL,
          name        TEXT NOT NULL,
          type        TEXT NOT NULL,
          description TEXT,
          avatar      TEXT,
          created_at  TEXT,
          updated_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS timelines (
          id               TEXT PRIMARY KEY NOT NULL,
          user_id          TEXT NOT NULL,
          title            TEXT NOT NULL,
          description      TEXT,
          event_date       TEXT NOT NULL,
          show_on_calendar INTEGER NOT NULL DEFAULT 0 CHECK (show_on_calendar IN (0, 1)),
          created_at       TEXT,
          updated_at       TEXT
        );

        CREATE TABLE IF NOT EXISTS timeline_entities (
          timeline_id TEXT NOT NULL,
          entity_id   TEXT NOT NULL,
          PRIMARY KEY (timeline_id, entity_id),
          FOREIGN KEY (timeline_id) REFERENCES timelines(id) ON DELETE CASCADE,
          FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
        CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at);
        CREATE INDEX IF NOT EXISTS idx_diary_user_entry_date ON diary_entries(user_id, entry_date);
        CREATE INDEX IF NOT EXISTS idx_entities_user ON entities(user_id);
        CREATE INDEX IF NOT EXISTS idx_timelines_user_event_date ON timelines(user_id, event_date);
        CREATE INDEX IF NOT EXISTS idx_timeline_entities_entity ON timeline_entities(entity_id);
      `);
    },
  },
  {
    // Local notification center: derived rows from genuine app activity (upcoming
    // events, reminders, birthdays, recent timeline entries, backup completions).
    // Stable ids + INSERT OR IGNORE keep the set idempotent across refreshes and
    // app restarts; `read` is persisted so unread state survives relaunch.
    version: 3,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS notifications (
          id          TEXT PRIMARY KEY NOT NULL,
          user_id     TEXT NOT NULL,
          type        TEXT NOT NULL,
          title       TEXT NOT NULL,
          message     TEXT,
          icon        TEXT,
          read        INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
          entity_id   TEXT,
          timeline_id TEXT,
          created_at  TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
        CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);
      `);
    },
  },
{
    // Expenses: an expense is the SAME underlying record as a timeline entry.
    // Two additive, NULLable columns on `timelines` make an expense machine-readable
    // (amount in paise + category) without duplicating storage or a join table.
    // `expense_amount_paise IS NOT NULL` marks the row as an expense; NULL keeps
    // existing rows exactly as they are. These columns are LOCAL ONLY — they are
    // never sent to the backend, and sync/replaceAll explicitly preserves them.
    version: 4,
    up: async (db) => {
      await db.execAsync(`
        ALTER TABLE timelines ADD COLUMN expense_amount_paise INTEGER;
        ALTER TABLE timelines ADD COLUMN expense_category TEXT;
      `);
    },
  },
  {
    // Receivable lifecycle: NULL = pending (classified at render), 'received' /
    // 'ignored' = user acted on a money-to-receive entry. Additive and NULLable;
    // LOCAL ONLY — never sent to the backend, preserved by sync/replaceAll.
    version: 5,
    up: async (db) => {
      await db.execAsync(`
        ALTER TABLE timelines ADD COLUMN receivable_status TEXT;
      `);
    },
  },
  {
    // Money direction: explicitly tags a timeline row that carries local money
    // attribution as CREDIT / receivable ('receive') or DEBIT / expense
    // ('expense'). An amount alone must never imply a direction (a refund, a
    // loan or money given are not the same intent), so this marker is what makes
    // the classification unambiguous. Additive and NULLable (NULL = existing
    // non-money rows); LOCAL ONLY — never sent to the backend, preserved by
    // sync/replaceAll like the expense columns.
    version: 6,
    up: async (db) => {
      await db.execAsync(`
        ALTER TABLE timelines ADD COLUMN money_type TEXT;
      `);
    },
  },
  {
    // Local safety net for Backup & Restore. Before a restore overwrites the
    // user's local rows, the current state is captured here as a v2 snapshot so
    // a bad restore can be rolled back even if it committed successfully.
    // The snapshot uses the SAME table-driven shape as a cloud backup
    // (see src/db/backupTables.ts), which makes rollback a normal restore.
    //
    // `data` holds the canonical snapshot JSON. `reason` records what produced
    // it. This table is intentionally NOT part of a backup (it is local
    // bookkeeping, not user data) and only the newest snapshot per user is
    // kept, so it can never grow without bound.
    version: 7,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS backup_snapshots (
          id            TEXT PRIMARY KEY NOT NULL,
          user_id       TEXT NOT NULL,
          reason        TEXT NOT NULL,
          app_version   TEXT,
          schema_version INTEGER NOT NULL,
          data          TEXT NOT NULL,
          created_at    TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_backup_snapshots_user ON backup_snapshots(user_id, created_at);
      `);
    },
  },
  {
    // SIM SMS capture: the inbox the native BroadcastReceiver feeds, plus the
    // provenance columns that let a user see (and later undo) which records came
    // from a message.
    //
    // `sms_messages` is the review queue. `status` is the review lifecycle:
    // PENDING (waiting for the user), IGNORED (dismissed on purpose) or
    // PROCESSED (saved into the app). The two linkage columns are nullable and
    // NULL while the message is still PENDING; they are what makes saving
    // idempotent — a second save finds the timeline it already created instead of
    // duplicating it. `is_otp` is a local privacy hint so OTP-style messages can
    // be masked in the notification and aged out of the queue.
    //
    // This table is deliberately EXCLUDED from cloud backups (see
    // src/db/backupTables.ts): message bodies are private, per-device data that
    // the user never asked to leave the phone.
    //
    // `source` / `source_notification_id` on `timelines` and
    // `source_notification_id` on `entities` are LOCAL ONLY, exactly like the
    // money columns: the backend has no such field, so sync/replaceAll snapshots
    // them back onto the same row on every refresh. The SMS origin marker is
    // also what protects on-device records from being dropped by a refresh that
    // happened before they could sync (offline saves).
    version: 8,
    up: async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sms_messages (
          id                   TEXT PRIMARY KEY NOT NULL,
          user_id              TEXT NOT NULL,
          sender               TEXT NOT NULL,
          body                 TEXT NOT NULL,
          received_at          TEXT NOT NULL,
          status               TEXT NOT NULL DEFAULT 'PENDING'
                                 CHECK (status IN ('PENDING', 'IGNORED', 'PROCESSED')),
          is_otp               INTEGER NOT NULL DEFAULT 0 CHECK (is_otp IN (0, 1)),
          notification_id      TEXT,
          timeline_id          TEXT,
          processed_at         TEXT,
          created_at           TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sms_messages_user_status
          ON sms_messages(user_id, status, received_at);

        ALTER TABLE timelines ADD COLUMN source TEXT;
        ALTER TABLE timelines ADD COLUMN source_notification_id TEXT;
        ALTER TABLE entities ADD COLUMN source_notification_id TEXT;
      `);
    },
  },
];

async function initializePragmas(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
}

async function getSchemaVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return typeof row?.user_version === 'number' ? row.user_version : 0;
}

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  await initializePragmas(db);
  const currentVersion = await getSchemaVersion(db);

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue;
    }
    await db.withExclusiveTransactionAsync(async (txn) => {
      await migration.up(txn);
      await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
}