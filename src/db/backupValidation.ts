import { isKnownTableKey, TABLES_BY_KEY, type TableSpec } from './backupTables';
import type { BackupRows } from './models/backupRows';

// Structural validation of a backup's `data` section.
//
// Deliberately free of any database dependency so it can run — and be verified
// — outside the app: it is the gate that runs BEFORE the first write during a
// restore, which is what guarantees a malformed payload can never reach SQLite.
//
// Unknown top-level keys are tolerated (forward compatibility: a newer client
// may add a table this build does not know, and there is simply nothing to
// restore for it), but every recognised table is checked strictly.

export interface SnapshotValidation {
  ok: boolean;
  error?: string;
  /** Total rows across all recognised tables. */
  totalRows: number;
  rowsByTable: Record<string, number>;
}

export const MAX_ROWS_PER_TABLE = 200_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requiredColumnsOf(spec: TableSpec): readonly string[] {
  return spec.columnTypes ? Object.keys(spec.columnTypes) : [];
}

function fail(error: string, rowsByTable: Record<string, number> = {}): SnapshotValidation {
  return { ok: false, error, totalRows: 0, rowsByTable };
}

export function validateBackupRows(data: unknown, options: { allowEmpty?: boolean } = {}): SnapshotValidation {
  if (!isPlainObject(data)) return fail('Backup data is not an object');

  const rowsByTable: Record<string, number> = {};
  let totalRows = 0;

  for (const [key, rows] of Object.entries(data)) {
    if (!isKnownTableKey(key)) continue;

    if (!Array.isArray(rows)) return fail(`Table "${key}" is not a list`);
    if (rows.length > MAX_ROWS_PER_TABLE) return fail(`Table "${key}" has too many rows`);

    const spec = TABLES_BY_KEY[key];
    const allowed = new Set(spec.columns);
    const required = requiredColumnsOf(spec);

    for (const row of rows) {
      if (!isPlainObject(row)) return fail(`Table "${key}" has a malformed row`);

      for (const col of Object.keys(row)) {
        if (!allowed.has(col)) {
          return fail(`Table "${key}" contains unsupported column "${col}"`);
        }
      }
      for (const col of spec.columns) {
        if (!(col in row)) return fail(`Table "${key}" row is missing column "${col}"`);
      }
      for (const col of required) {
        const value = row[col];
        if (value === null || value === undefined || value === '') {
          return fail(`Table "${key}" row is missing required value "${col}"`);
        }
      }
    }

    rowsByTable[key] = rows.length;
    totalRows += rows.length;
  }

  // An empty payload is almost always a sign that the client backed up the
  // wrong thing, so restoring one over real data is refused. The exception is
  // a local safety snapshot: undoing a restore on a device that had no records
  // yet is a legitimate way to get back to an empty device, and blocking it
  // would leave the user with no way back.
  if (totalRows === 0 && !options.allowEmpty) return fail('Backup contains no records');

  return { ok: true, totalRows, rowsByTable };
}
