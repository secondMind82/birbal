// In-memory stand-in for the slice of expo-sqlite that the backup engine uses.
//
// It is NOT a SQL engine. It recognises the exact statement shapes the registry
// generates and implements just enough of the semantics that matter for a
// restore: primary-key replacement, user scoping, and transactional rollback.
// The verification suite asserts the generated SQL through this file, so a
// change to the SQL builder fails the tests instead of silently exercising a
// path the real driver would never take.
//
// Why it exists: the restore safety properties — atomicity, idempotency,
// ownership re-assertion, referential integrity — are the part that can actually
// break, and they can be proven on a laptop without an emulator.

import { BACKUP_TABLES, RESTORE_ORDER, type TableSpec } from '../src/db/backupTables';
import type { BackupDb, BackupExecutor } from '../src/db/backupEngine';
import type { BackupRows } from '../src/db/models/backupRows';

type Row = Record<string, unknown>;

const PRIMARY_KEY: Record<string, string[]> = {
  entities: ['id'],
  timelines: ['id'],
  timeline_entities: ['timeline_id', 'entity_id'],
  notes: ['id'],
  diary_entries: ['id'],
  notifications: ['id'],
  backup_snapshots: ['id'],
};

/** Join tables are scoped through their parent table instead of a user_id. */
const PARENT_OF: Record<string, string> = {
  timeline_entities: 'timelines',
};

const PARENT_PK: Record<string, string> = {
  timeline_entities: 'timeline_id',
};

function tableOf(sql: string): string {
  const m = /(?:FROM|INTO|UPDATE)\s+([a-z_]+)/i.exec(sql);
  if (!m) throw new Error(`fake-sqlite: cannot parse a table name out of: ${sql}`);
  return m[1];
}

function keyOf(row: Row, table: string): string {
  return (PRIMARY_KEY[table] ?? ['id']).map((c) => String(row[c])).join(' ');
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

// ─── State ───────────────────────────────────────────────────────────────────

export class FakeState {
  tables: Map<string, Row[]> = new Map();
  statements: string[] = [];

  constructor() {
    for (const spec of RESTORE_ORDER) this.tables.set(spec.table, []);
    this.tables.set('backup_snapshots', []);
  }

  table(name: string): Row[] {
    const existing = this.tables.get(name);
    if (existing) return existing;
    const created: Row[] = [];
    this.tables.set(name, created);
    return created;
  }

  replace(name: string, rows: Row[]): void {
    this.tables.set(name, rows);
  }

  clone(): FakeState {
    const next = new FakeState();
    next.tables = new Map([...this.tables].map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
    return next;
  }
}

export const state = new FakeState();

/** Rows currently visible to `userId`, as the app would read them back. */
export function visibleTo(userId: string): BackupRows {
  const rows: BackupRows = {};
  for (const spec of RESTORE_ORDER) {
    rows[spec.key] = scopedRows(spec.table, userId).map((r) => ({ ...r }));
  }
  return rows;
}

function scopedRows(table: string, userId: string): Row[] {
  const parent = PARENT_OF[table];
  if (parent) {
    const parentIds = new Set(scopedRows(parent, userId).map((r) => String(r.id)));
    return state.table(table).filter((r) => parentIds.has(String(r[PARENT_PK[table]])));
  }
  return state.table(table).filter((r) => r.user_id === userId);
}

/** Inserts rows directly, bypassing the engine, to set up a test scenario. */
export function seed(rows: BackupRows, userId: string): void {
  for (const spec of RESTORE_ORDER) {
    for (const row of rows[spec.key] ?? []) {
      state.table(spec.table).push({ ...row, user_id: spec.userScoped ? userId : row.user_id });
    }
  }
}

/** Every SQL statement the engine has issued so far. */
export function statementsIssued(): string[] {
  return state.statements;
}

/** Resets global state between test cases. */
export function resetState(): void {
  state.tables = new FakeState().tables;
  state.statements = [];
}

// ─── Statement handling ──────────────────────────────────────────────────────

function execSql(sql: string, params: unknown[]): void {
  state.statements.push(sql);
  const stmt = normalize(sql);
  const table = tableOf(sql);

  if (/^DELETE FROM (\w+) WHERE user_id = \?$/.test(stmt)) {
    state.replace(table, state.table(table).filter((r) => r.user_id !== params[0]));
    return;
  }

  const scopedDelete = /^DELETE FROM (\w+) WHERE (\w+) IN \(SELECT id FROM (\w+) WHERE user_id = \?\)$/.exec(
    stmt,
  );
  if (scopedDelete) {
    const parentIds = new Set(scopedRows(scopedDelete[3], String(params[0])).map((r) => String(r.id)));
    state.replace(
      table,
      state.table(table).filter((r) => !parentIds.has(String(r[scopedDelete[2]]))),
    );
    return;
  }

  if (/^DELETE FROM backup_snapshots WHERE user_id = \? AND id NOT IN/.test(stmt)) {
    const keep = new Set([newestSnapshot(String(params[0]))].filter(Boolean).map((r) => String(r!.id)));
    state.replace(
      'backup_snapshots',
      state.table('backup_snapshots').filter((r) => r.user_id !== params[0] || keep.has(String(r.id))),
    );
    return;
  }

  const insert = /^INSERT (?:OR REPLACE )?INTO (\w+) \((.+)\) VALUES \((.+)\)$/.exec(stmt);
  if (insert) {
    const cols = insert[2].split(',').map((c) => c.trim());
    const values = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
    const rows = state.table(table);
    const k = keyOf(values, table);
    const index = rows.findIndex((r) => keyOf(r, table) === k);
    if (index >= 0) rows[index] = { ...rows[index], ...values };
    else rows.push(values);
    return;
  }

  if (/^SELECT/.test(stmt)) return; // handled by the read methods
  if (/^PRAGMA/.test(stmt)) return;

  throw new Error(`fake-sqlite: unrecognised statement: ${stmt}`);
}

/**
 * Newest snapshot for a user. Ties on a millisecond timestamp fall back to
 * insertion order, which is what SQLite's rowid ordering gives us.
 */
function newestSnapshot(userId: string): Row | undefined {
  return [...state.table('backup_snapshots')]
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.user_id === userId)
    .sort((a, b) => {
      const byTime = String(b.row.created_at).localeCompare(String(a.row.created_at));
      return byTime !== 0 ? byTime : b.index - a.index;
    })[0]?.row;
}

function selectRows(sql: string, params: unknown): Row[] {
  state.statements.push(sql);
  const stmt = normalize(sql);

  if (stmt === 'PRAGMA foreign_key_check') {
    const timelines = new Set(state.table('timelines').map((r) => String(r.id)));
    const entities = new Set(state.table('entities').map((r) => String(r.id)));
    const violations: Row[] = [];
    for (const r of state.table('timeline_entities')) {
      if (!timelines.has(String(r.timeline_id)) || !entities.has(String(r.entity_id))) {
        violations.push({ table: 'timeline_entities', rowid: state.table('timeline_entities').indexOf(r) });
      }
    }
    return violations;
  }

  const scopedCount = /^SELECT COUNT\(\*\) AS n FROM (\w+) WHERE (\w+) IN \(SELECT id FROM (\w+) WHERE user_id = \?\)$/.exec(
    stmt,
  );
  if (scopedCount) {
    const parentIds = new Set(scopedRows(scopedCount[3], String(params)).map((r) => String(r.id)));
    return [{ n: state.table(scopedCount[1]).filter((r) => parentIds.has(String(r[scopedCount[2]]))).length }];
  }

  const simpleCount = /^SELECT COUNT\(\*\) AS n FROM (\w+) WHERE user_id = \?$/.exec(stmt);
  if (simpleCount) {
    return [{ n: state.table(simpleCount[1]).filter((r) => r.user_id === params).length }];
  }

  const scopedSelect = /^SELECT (.+) FROM (\w+) WHERE (\w+) IN \(SELECT id FROM (\w+) WHERE user_id = \?\) ORDER BY rowid$/.exec(
    stmt,
  );
  if (scopedSelect) {
    const parentIds = new Set(scopedRows(scopedSelect[4], String(params)).map((r) => String(r.id)));
    return state
      .table(scopedSelect[2])
      .filter((r) => parentIds.has(String(r[scopedSelect[3]])))
      .map((r) => ({ ...r }));
  }

  const simpleSelect = /^SELECT (.+) FROM (\w+) WHERE user_id = \? ORDER BY rowid$/.exec(stmt);
  if (simpleSelect) {
    return state.table(simpleSelect[2]).filter((r) => r.user_id === params).map((r) => ({ ...r }));
  }

  if (/^SELECT .+ FROM backup_snapshots WHERE user_id = \? ORDER BY created_at DESC LIMIT 1$/.test(stmt)) {
    const row = newestSnapshot(String(params));
    if (!row) return [];
    return stmt.startsWith('SELECT data') ? [{ data: row.data }] : [{ ...row }];
  }

  throw new Error(`fake-sqlite: unrecognised query: ${stmt}`);
}

// ─── The fake driver ─────────────────────────────────────────────────────────

/** A `BackupDb` whose transactions roll back for real. */
export function fakeDb(): BackupDb {
  const txn: BackupExecutor = {
    runAsync: async (source: string, params?: unknown) => {
      const list = Array.isArray(params) ? params : params === undefined ? [] : [params];
      execSql(source, list);
      return { lastInsertRowId: 0, changes: 0 };
    },
    getAllAsync: async <T = Record<string, unknown>>(source: string, params?: unknown) =>
      selectRows(source, params) as T[],
    getFirstAsync: async <T = Record<string, unknown>>(source: string, params?: unknown) => {
      const rows = selectRows(source, params);
      return (rows[0] ?? null) as T | null;
    },
    execAsync: async (source: string) => {
      state.statements.push(source);
    },
  };

  return {
    ...txn,
    withExclusiveTransactionAsync: async (fn) => {
      const before = state.clone();
      try {
        await fn(txn);
      } catch (error) {
        state.tables = before.tables;
        throw error;
      }
    },
  };
}

/** Table specs, re-exported so tests can assert against the same registry. */
export { BACKUP_TABLES, RESTORE_ORDER };
export type { TableSpec };
