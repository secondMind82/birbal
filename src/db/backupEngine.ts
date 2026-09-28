import { validateBackupRows } from './backupValidation';
import { DELETE_ORDER, RESTORE_ORDER, TABLES_BY_KEY, type TableSpec } from './backupTables';
import type { BackupRows } from './models/backupRows';

// Table-driven snapshot + restore ENGINE for Backup & Restore.
//
// This module is deliberately free of any expo-sqlite import: everything takes
// its database as an argument, so the whole restore algorithm can be exercised
// (and proven correct) outside a device. The device-bound wrappers that bind it
// to the app's single serialized connection live in ./repositories/backup.ts.
//
// The generic code is driven exclusively by the BACKUP_TABLES registry, so a new
// user-data table only needs a registry entry. It works on RAW SQLite rows
// (column name -> value) rather than app model objects, which is what makes a
// backup lossless: exact timestamps, original ids and columns the current build
// does not model all survive a round trip.
//
// Safety properties, in order of execution:
//   1. validateBackupRows()  – full structural check, runs before ANY write.
//   2. saveSnapshotWith()    – current local state captured in its own committed
//      transaction, so it survives even if the restore itself commits.
//   3. one transaction       – delete-then-insert inside
//      withExclusiveTransactionAsync; any failure rolls back completely.
//   4. PRAGMA foreign_key_check inside the transaction, so a broken graph aborts.
//   5. row counts verified against the database before the commit is allowed.
// Restoring the same backup twice is a no-op: rows keep their original primary
// keys and the delete pass clears the previous restore first.

/** The subset of expo-sqlite's SQLiteDatabase the engine needs. */
export interface BackupExecutor {
  runAsync(source: string, params?: unknown): Promise<unknown>;
  getAllAsync<T = Record<string, unknown>>(source: string, params?: unknown): Promise<T[]>;
  getFirstAsync<T = Record<string, unknown>>(source: string, params?: unknown): Promise<T | null>;
  execAsync(source: string): Promise<void>;
}

/** An executor that can also open a transaction. */
export interface BackupDb extends BackupExecutor {
  withExclusiveTransactionAsync: (
    fn: (txn: BackupExecutor) => Promise<void>,
  ) => Promise<void>;
}

/** SQLiteBindValue, restated so this module needs no native types. */
type BindValue = string | number | null;

export type { BackupRows };

export interface RestoreResult {
  rowsByTable: Record<string, number>;
  totalRows: number;
  restoredFrom: 'backup' | 'snapshot';
}

export interface RestoreOptions {
  /** When false the caller has already taken/validated a snapshot. */
  takeSnapshot?: boolean;
  appVersion?: string | null;
  schemaVersion?: number;
  reason?: string;
}

export interface StoredSnapshot {
  id: string;
  userId: string;
  reason: string;
  appVersion: string | null;
  schemaVersion: number;
  createdAt: string;
}

// ─── Value handling ──────────────────────────────────────────────────────────

/** Normalizes 0/1 booleans read back out of SQLite. */
function coerceValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * Coerces a stored value to something SQLite can bind. Anything that is not a
 * primitive bind value (e.g. a nested object smuggled in by a hostile payload)
 * becomes NULL rather than being passed through.
 */
function toBindValue(value: unknown): BindValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  return null;
}

// ─── SQL generation (registry-driven) ────────────────────────────────────────

function selectSql(spec: TableSpec): string {
  const cols = spec.columns.join(', ');
  if (spec.userScoped) {
    return `SELECT ${cols} FROM ${spec.table} WHERE user_id = ? ORDER BY rowid`;
  }
  // Join tables carry no user_id: scope them through their parent table so a
  // backup can never contain another account's links.
  return `SELECT ${cols} FROM ${spec.table}
          WHERE ${spec.parentKey} IN (SELECT id FROM timelines WHERE user_id = ?)
          ORDER BY rowid`;
}

function countSql(spec: TableSpec): string {
  if (spec.userScoped) return `SELECT COUNT(*) AS n FROM ${spec.table} WHERE user_id = ?`;
  return `SELECT COUNT(*) AS n FROM ${spec.table}
          WHERE ${spec.parentKey} IN (SELECT id FROM timelines WHERE user_id = ?)`;
}

function deleteSql(spec: TableSpec): string {
  if (spec.userScoped) return `DELETE FROM ${spec.table} WHERE user_id = ?`;
  return `DELETE FROM ${spec.table}
          WHERE ${spec.parentKey} IN (SELECT id FROM timelines WHERE user_id = ?)`;
}

function insertSql(spec: TableSpec): string {
  const cols = spec.columns.join(', ');
  const placeholders = spec.columns.map(() => '?').join(', ');
  return `INSERT OR REPLACE INTO ${spec.table} (${cols}) VALUES (${placeholders})`;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Reads every registered user-owned table for one user as raw row maps. */
export async function readSnapshot(db: BackupExecutor, userId: string): Promise<BackupRows> {
  const rows: BackupRows = {};
  for (const spec of RESTORE_ORDER) {
    const result = await db.getAllAsync<Record<string, unknown>>(selectSql(spec), userId);
    rows[spec.key] = result.map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of spec.columns) out[col] = coerceValue(row[col]);
      return out;
    });
  }
  return rows;
}

// ─── Writing ─────────────────────────────────────────────────────────────────

async function clearAndInsert(
  txn: BackupExecutor,
  userId: string,
  data: BackupRows,
): Promise<Record<string, number>> {
  const written: Record<string, number> = {};

  // Children first, so a parent delete can never be blocked by live children.
  for (const spec of DELETE_ORDER) {
    await txn.runAsync(deleteSql(spec), userId);
  }

  for (const spec of RESTORE_ORDER) {
    const rows = Array.isArray(data[spec.key]) ? (data[spec.key] as Record<string, unknown>[]) : [];
    const sql = insertSql(spec);
    for (const row of rows) {
      // Ownership is re-asserted locally: a restored row always belongs to the
      // authenticated user, never to whatever the payload claimed.
      const values: BindValue[] = spec.columns.map((col) =>
        col === 'user_id' ? userId : toBindValue(row[col]),
      );
      await txn.runAsync(sql, values);
    }
    written[spec.key] = rows.length;
  }

  return written;
}

/** Runs PRAGMA foreign_key_check and reports the first violation, if any. */
async function assertForeignKeysIntact(txn: BackupExecutor): Promise<void> {
  const violations = await txn.getAllAsync<{ table: string; rowid: number }>(
    'PRAGMA foreign_key_check',
  );
  if (violations.length > 0) {
    const first = violations[0];
    throw new Error(
      `Restored data failed referential integrity check (table "${first?.table ?? 'unknown'}")`,
    );
  }
}

/**
 * The restore transaction itself: clear the user's rows, re-insert the backup's
 * rows, then prove the result is consistent. Any throw leaves the database
 * exactly as it was, because the caller owns the transaction.
 */
export async function runRestoreTransaction(
  db: BackupDb,
  userId: string,
  data: BackupRows,
  options: { allowEmpty?: boolean } = {},
): Promise<Record<string, number>> {
  const validation = validateBackupRows(data, { allowEmpty: options.allowEmpty });
  if (!validation.ok) {
    throw new Error(validation.error ?? 'Backup failed validation');
  }

  // withExclusiveTransactionAsync resolves to void, so the per-table counts are
  // captured through the closure rather than a return value.
  let written: Record<string, number> = {};
  await db.withExclusiveTransactionAsync(async (txn) => {
    written = await clearAndInsert(txn, userId, data);
    await assertForeignKeysIntact(txn);

    // Verify the database really holds what we intended to write, before the
    // transaction is allowed to commit.
    for (const [key, expected] of Object.entries(written)) {
      if (expected === 0) continue;
      const spec = TABLES_BY_KEY[key];
      if (!spec) continue;
      const actual = await txn.getFirstAsync<{ n: number }>(countSql(spec), userId);
      if ((actual?.n ?? 0) !== expected) {
        throw new Error(`Restore verification failed for "${key}"`);
      }
    }
  });

  return written;
}

/**
 * Captures the user's current local state into backup_snapshots so a restore can
 * be undone. Committed in its OWN transaction, before the restore starts, which
 * is what makes it a real safety net rather than part of the same all-or-nothing
 * unit. Only the newest snapshot per user is retained.
 */
export async function saveSnapshotWith(
  db: BackupDb,
  userId: string,
  reason: string,
  appVersion: string | null,
  schemaVersion: number,
): Promise<string> {
  const rows = await readSnapshot(db, userId);
  const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `INSERT INTO backup_snapshots (id, user_id, reason, app_version, schema_version, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, reason, appVersion, schemaVersion, JSON.stringify(rows), createdAt],
    );
    // Keep exactly one snapshot per user; older ones are dead weight.
    await txn.runAsync(
      `DELETE FROM backup_snapshots
       WHERE user_id = ? AND id NOT IN (
         SELECT id FROM backup_snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
       )`,
      [userId, userId],
    );
  });

  return id;
}

const SNAPSHOT_META_SQL = `SELECT id, user_id, reason, app_version, schema_version, created_at
     FROM backup_snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`;

function toStoredSnapshot(row: Record<string, unknown> | null): StoredSnapshot | null {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    reason: String(row.reason),
    appVersion: (row.app_version as string | null) ?? null,
    schemaVersion: Number(row.schema_version ?? 0),
    createdAt: String(row.created_at),
  };
}

/** Metadata for the newest local safety snapshot, or null when there is none. */
export async function getLatestSnapshotWith(
  db: BackupExecutor,
  userId: string,
): Promise<StoredSnapshot | null> {
  return toStoredSnapshot(await db.getFirstAsync<Record<string, unknown>>(SNAPSHOT_META_SQL, userId));
}

/** Rolls the user's local data back to the pre-restore snapshot. */
export async function restoreFromSnapshotWith(
  db: BackupDb,
  userId: string,
): Promise<RestoreResult> {
  const row = await db.getFirstAsync<{ data: string }>(
    `SELECT data FROM backup_snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    userId,
  );
  if (!row?.data) {
    throw new Error('No local snapshot is available to roll back to');
  }

  // Rolling back must be able to return a device to an empty state: a user who
  // restored onto a brand-new device has a legitimate snapshot of "no records",
  // and refusing it would leave them permanently stuck on the restored data.
  const written = await runRestoreTransaction(db, userId, JSON.parse(row.data) as BackupRows, {
    allowEmpty: true,
  });
  return {
    rowsByTable: written,
    totalRows: Object.values(written).reduce((a, b) => a + b, 0),
    restoredFrom: 'snapshot',
  };
}

/** Validates, snapshots and then restores — the full pipeline. */
export async function restoreRows(
  db: BackupDb,
  userId: string,
  data: BackupRows,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const validation = validateBackupRows(data);
  if (!validation.ok) {
    throw new Error(validation.error ?? 'Backup failed validation');
  }

  if (options.takeSnapshot !== false) {
    await saveSnapshotWith(
      db,
      userId,
      options.reason ?? 'pre-restore',
      options.appVersion ?? null,
      options.schemaVersion ?? 0,
    );
  }

  const written = await runRestoreTransaction(db, userId, data);
  return {
    rowsByTable: written,
    totalRows: Object.values(written).reduce((a, b) => a + b, 0),
    restoredFrom: 'backup',
  };
}

export async function clearSnapshot(db: BackupExecutor, userId: string): Promise<void> {
  await db.runAsync('DELETE FROM backup_snapshots WHERE user_id = ?', userId);
}
