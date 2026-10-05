// Verification suite for Birbal Backup & Restore.
//
// Run with:  npm run verify:backup
//
// It covers the parts of the feature that are pure logic and therefore testable
// without an emulator:
//   * canonical serialization + SHA-256 are byte-identical to the SERVER
//     implementation, so an upload is never rejected by the server's integrity
//     check and a download is never rejected by the client's;
//   * the v1 -> v2 format upgrade keeps every row, link and money field;
//   * validation rejects malformed payloads before any write;
//   * the restore engine is atomic, idempotent, ownership-safe and
//     referentially intact, proven against an in-memory SQLite stand-in;
//   * the table registry matches the columns the migrations actually create.
//
// Anything that needs a real device (actual network calls, OS notification
// permissions, the real expo-sqlite driver) is verified by the manual
// same-account test described in docs/backup-restore.md.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { BACKUP_TABLES, DELETE_ORDER, RESTORE_ORDER, TABLES_BY_KEY } from '../src/db/backupTables';
import { validateBackupRows } from '../src/db/backupValidation';
import {
  getLatestSnapshotWith,
  restoreFromSnapshotWith,
  runRestoreTransaction,
  saveSnapshotWith,
} from '../src/db/backupEngine';
import type { BackupRows } from '../src/db/models/backupRows';
import { canonicalStringify } from '../src/services/backupCanonical';
import { computeRecordCounts, describeCounts, isInternalCountKey } from '../src/services/backupCounts';
import { migrateV1ToV2Rows } from '../src/services/backupMigration';
import { checksumsMatch } from '../src/services/backupCanonical';
import type { BackupV1Payload } from '../src/models/types';

// The server's implementation, imported so the two can never silently drift.
import {
  canonicalStringify as serverCanonicalStringify,
  checksumOfData as serverChecksumOfData,
  findForbiddenKeys as serverFindForbiddenKeys,
} from '../../SecondBrain/secondbrain-api/src/backup/backup-format';

import { fakeDb, resetState, seed, statementsIssued, visibleTo } from './fake-sqlite';

const USER = 'user-1';
const OTHER_USER = 'user-2';

/**
 * Fills in the columns a fixture did not provide, so an expectation can be
 * compared against a restored row. Optional columns (those added to a table
 * after some backups were already taken) restore as NULL.
 */
function withOptionalColumns(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const optional = new Set(
    BACKUP_TABLES.flatMap((spec) => spec.optionalColumns ?? []),
  );
  return rows.map((row) => {
    const filled: Record<string, unknown> = { ...row };
    for (const spec of BACKUP_TABLES) {
      for (const col of spec.optionalColumns ?? []) {
        if (col in filled) continue;
        // A column only belongs to the table the row came from; infer it by
        // checking which spec's non-optional columns the row actually has.
        const required = spec.columns.filter((c) => !optional.has(c));
        if (required.every((c) => c in filled)) filled[col] = null;
      }
    }
    return filled;
  });
}

function sampleRows(): BackupRows {
  return {
    entities: [
      {
        id: 'e1',
        user_id: USER,
        name: 'Alice',
        type: 'PERSON',
        description: 'friend',
        avatar: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ],
    timelines: [
      {
        id: 't1',
        user_id: USER,
        title: 'Dentist',
        description: 'checkup',
        event_date: '2026-03-01',
        show_on_calendar: 1,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-02T00:00:00.000Z',
        expense_amount_paise: 5000,
        expense_category: 'Health',
        receivable_status: null,
        money_type: 'expense',
      },
      {
        id: 't2',
        user_id: USER,
        title: 'Note to self',
        description: '',
        event_date: '2026-03-02',
        show_on_calendar: 0,
        created_at: null,
        updated_at: null,
        expense_amount_paise: null,
        expense_category: null,
        receivable_status: null,
        money_type: null,
      },
    ],
    timeline_entities: [{ timeline_id: 't1', entity_id: 'e1' }],
    notes: [
      {
        id: 'n1',
        user_id: USER,
        title: 'Shopping',
        content: 'spent 100',
        pinned: 1,
        created_at: '2026-01-03T00:00:00.000Z',
        updated_at: '2026-01-04T00:00:00.000Z',
      },
    ],
    diary_entries: [
      {
        id: 'd1',
        user_id: USER,
        title: 'Day one',
        content: 'good',
        mood: 'happy',
        entry_date: '2026-01-05',
        created_at: '2026-01-05T00:00:00.000Z',
        updated_at: '2026-01-05T00:00:00.000Z',
      },
    ],
    notifications: [
      {
        id: 'no1',
        user_id: USER,
        type: 'EVENT',
        title: 'Dentist',
        message: null,
        icon: null,
        read: 0,
        entity_id: null,
        timeline_id: 't1',
        created_at: '2026-02-01T00:00:00.000Z',
      },
    ],
    sms_messages: [
      {
        id: 'sms1',
        user_id: USER,
        sender: 'HDFC',
        body: 'Debit of Rs 500.00 on card xxxx done at Store',
        received_at: '2026-01-06T10:00:00.000Z',
        status: 'PENDING',
        is_otp: 0,
        notification_id: null,
        timeline_id: null,
        processed_at: null,
        created_at: '2026-01-06T10:00:00.000Z',
      },
    ],
  };
}

// ─── Client/server format parity ─────────────────────────────────────────────

test('canonical serialization is byte-identical to the server', () => {
  const cases: unknown[] = [
    { hello: 'world' },
    { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } },
    { nested: { arr: [null, true, false, 0, -1, 1.5, ''] } },
    sampleRows(),
  ];

  for (const value of cases) {
    assert.equal(
      canonicalStringify(value),
      serverCanonicalStringify(value),
      'canonical forms diverged between client and server',
    );
  }
});

test('client checksum equals server checksum for the same data', () => {
  const data = sampleRows();
  // Stands in for expo-crypto's digestStringAsync, which cannot run outside a
  // device. The digest itself is SHA-256 either way; what this proves is that
  // both sides hash the SAME bytes.
  const clientSide = createHash('sha256').update(canonicalStringify(data), 'utf8').digest('hex');
  assert.equal(clientSide, serverChecksumOfData(data));
  assert.ok(checksumsMatch(clientSide, serverChecksumOfData(data)));
});

test('a tampered backup fails the checksum comparison', () => {
  const good = sampleRows();
  const tampered = structuredClone(good);
  tampered.notes[0].content = 'spent 1000';
  assert.ok(!checksumsMatch(serverChecksumOfData(good), serverChecksumOfData(tampered)));
});

test('a backup containing credentials is detected server-side', () => {
  assert.deepEqual(serverFindForbiddenKeys(sampleRows()), []);
  assert.equal(
    serverFindForbiddenKeys({ data: { notes: [{ id: 'n1', password: 'x' }] } }).length,
    1,
  );
});

// ─── Registry / schema agreement ─────────────────────────────────────────────

test('every registered table has a primary key, parent and column list', () => {
  for (const spec of BACKUP_TABLES) {
    assert.ok(spec.key.length > 0, 'missing key');
    assert.ok(spec.table.length > 0, `missing table for ${spec.key}`);
    assert.ok(spec.columns.length > 0, `missing columns for ${spec.key}`);
    assert.ok(
      spec.userScoped === (spec.columns.includes('user_id')),
      `${spec.key}: userScoped must match the presence of a user_id column`,
    );
    assert.ok(
      !spec.userScoped === !!spec.parentKey,
      `${spec.key}: a non-user-scoped table must declare a parentKey`,
    );
    for (const col of spec.columns) {
      assert.match(col, /^[a-z_]+$/, `${spec.key}.${col} must be a plain snake_case column`);
    }
  }
});

test('table keys are unique and registry lookups resolve', () => {
  const keys = BACKUP_TABLES.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.equal(TABLES_BY_KEY[key].key, key);
});

test('restore order puts parents before children and delete order is its reverse', () => {
  const orderOf = (list: typeof RESTORE_ORDER) => Object.fromEntries(list.map((s, i) => [s.key, i]));
  const restore = orderOf(RESTORE_ORDER);
  const del = orderOf(DELETE_ORDER);
  assert.ok(restore.entities! < restore.timelines!);
  assert.ok(restore.timelines! < restore.timeline_entities!);
  for (const spec of RESTORE_ORDER) {
    assert.equal(del[spec.key], RESTORE_ORDER.length - 1 - restore[spec.key]);
  }
});

test('registry columns exist in the migrations that create them', async () => {
  const { readFile } = await import('node:fs/promises');
  // The compiled test lives under .verify-build/, so the project root is passed
  // in by the npm script; the fallback keeps the file runnable by hand.
  const root = process.env.BIRBAL_ROOT ?? resolve(__dirname, '../../..');
  const sql = await readFile(resolve(root, 'src/db/schema.ts'), 'utf8');

  // Collect the real column set per table from the migration DDL.
  const columns = new Map<string, Set<string>>();
  const collect = (table: string, body: string) => {
    const set = columns.get(table) ?? new Set<string>();
    for (const m of body.matchAll(/^\s{10}([a-z_]+)\s+(TEXT|INTEGER)/gm)) set.add(m[1]);
    columns.set(table, set);
  };

  // A column list is indented two levels inside CREATE TABLE and closes on its
  // own line at the inner indentation, which is what bounds the match even when
  // one migration creates several tables in a single execAsync block.
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\s{8}\);/g)) {
    collect(m[1], m[2]);
  }
  for (const m of sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN ([a-z_]+) (?:TEXT|INTEGER)/g)) {
    const set = columns.get(m[1]) ?? new Set<string>();
    set.add(m[2]);
    columns.set(m[1], set);
  }

  for (const spec of BACKUP_TABLES) {
    const actual = columns.get(spec.table);
    assert.ok(actual, `no migration creates table ${spec.table}`);
    for (const col of spec.columns) {
      assert.ok(actual!.has(col), `${spec.table}.${col} is not created by any migration`);
    }
  }
});

test('app_meta and backup_snapshots are never included in a backup', () => {
  const tables = BACKUP_TABLES.map((s) => s.table);
  assert.ok(!tables.includes('app_meta'), 'device/schema metadata must not be backed up');
  assert.ok(!tables.includes('backup_snapshots'), 'local safety snapshots must not be backed up');
});

// ─── Record counts ───────────────────────────────────────────────────────────

test('record counts derive events and expenses from timelines', () => {
  const counts = computeRecordCounts(sampleRows());
  assert.equal(counts.timelines, 2);
  assert.equal(counts.events, 1);
  assert.equal(counts.expenses, 1);
  assert.equal(counts.notes, 1);
  assert.equal(counts.diary_entries, 1);
  assert.equal(describeCounts(counts), '2 timelines · 1 event · 1 expense · 1 note · 1 diary · 1 entity · 1 notification · 1 SMS message');
});

test('total counts physical rows and never double-counts derived events/expenses', () => {
  const rows = sampleRows();
  const counts = computeRecordCounts(rows);

  const physical =
    (rows.entities?.length ?? 0) +
    (rows.timelines?.length ?? 0) +
    (rows.timeline_entities?.length ?? 0) +
    (rows.notes?.length ?? 0) +
    (rows.diary_entries?.length ?? 0) +
    (rows.notifications?.length ?? 0) +
    (rows.sms_messages?.length ?? 0);

  assert.equal(counts.total, physical, 'total must equal the number of rows written to SQLite');
  // events + expenses are views of the same timeline rows, so adding them in
  // would report more "records" than the database actually holds.
  assert.notEqual(counts.total, physical + counts.events! + counts.expenses!);
  assert.ok(counts.total! < physical + counts.events! + counts.expenses!);
});

test('internal count keys are hidden from user-facing summaries', () => {
  assert.ok(isInternalCountKey('total'));
  assert.ok(isInternalCountKey('contacts'));
  assert.ok(!isInternalCountKey('timelines'));
});

// ─── Validation ──────────────────────────────────────────────────────────────

test('accepts a well-formed snapshot', () => {
  const result = validateBackupRows(sampleRows());
  assert.ok(result.ok, result.error);
  assert.equal(result.totalRows, 8); // 1 entity + 2 timelines + 1 link + note + diary + notification + sms
});

test('ignores unknown tables instead of failing (forward compatibility)', () => {
  const result = validateBackupRows({ ...sampleRows(), future_table: [{ x: 1 }] });
  assert.ok(result.ok, result.error);
  assert.equal(result.totalRows, 8);
});

test('accepts an empty backup only when the caller opts in (rollback to a new device)', () => {
  const empty = { notes: [], timelines: [], entities: [] };
  assert.equal(validateBackupRows(empty).ok, false, 'a cloud backup of nothing is still a mistake');
  assert.equal(validateBackupRows(empty, { allowEmpty: true }).ok, true);
  assert.equal(validateBackupRows({}, { allowEmpty: true }).ok, true);
});

test('rejects an empty backup', () => {
  const result = validateBackupRows({ entities: [], timelines: [] });
  assert.ok(!result.ok);
  assert.match(result.error!, /no records/i);
});

test('rejects a non-object payload', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.ok(!validateBackupRows(bad).ok);
  }
});

test('rejects unknown columns and missing columns', () => {
  const withExtra = sampleRows();
  (withExtra.notes[0] as Record<string, unknown>).is_admin = 1;
  assert.match(validateBackupRows(withExtra).error!, /unsupported column "is_admin"/);

  const withMissing = sampleRows();
  delete (withMissing.notes[0] as Record<string, unknown>).updated_at;
  assert.match(validateBackupRows(withMissing).error!, /missing column "updated_at"/);
});

test('rejects a missing required value and a non-list table', () => {
  const blank = sampleRows();
  blank.entities[0].name = '';
  assert.match(validateBackupRows(blank).error!, /missing required value "name"/);

  const badList = sampleRows() as unknown as Record<string, unknown>;
  badList.notes = { nope: true };
  assert.match(validateBackupRows(badList).error!, /is not a list/);
});

// ─── Restore engine ──────────────────────────────────────────────────────────

test('restore writes every table and preserves ids, timestamps and money fields', async () => {
  resetState();
  const db = fakeDb();
  const rows = sampleRows();

  const written = await runRestoreTransaction(db, USER, rows);
  assert.deepEqual(written, {
    entities: 1,
    timelines: 2,
    timeline_entities: 1,
    notes: 1,
    diary_entries: 1,
    notifications: 1,
    sms_messages: 1,
  });

  const after = visibleTo(USER);
  assert.deepEqual(after.timelines, withOptionalColumns(rows.timelines));
  assert.deepEqual(after.entities, withOptionalColumns(rows.entities));
  assert.deepEqual(after.notes, rows.notes);
  assert.deepEqual(after.diary_entries, rows.diary_entries);
  assert.deepEqual(after.notifications, rows.notifications);
  assert.deepEqual(after.timeline_entities, rows.timeline_entities);
  assert.equal(after.timelines[0].expense_amount_paise, 5000);
  assert.equal(after.timelines[0].money_type, 'expense');
  assert.equal(after.timelines[0].show_on_calendar, 1);
});

test('a backup taken before the SMS columns existed still restores', async () => {
  resetState();
  const db = fakeDb();
  // A payload from before schema 8: no `source` / `source_notification_id`
  // keys at all. It must validate and restore, with the new columns left NULL,
  // rather than being rejected as corrupt — otherwise adding a column would
  // invalidate every backup a user already has.
  const legacy = sampleRows() as BackupRows;
  for (const row of legacy.timelines) {
    delete (row as Record<string, unknown>).source;
    delete (row as Record<string, unknown>).source_notification_id;
  }
  for (const row of legacy.entities) {
    delete (row as Record<string, unknown>).source_notification_id;
  }

  assert.ok(validateBackupRows(legacy).ok, 'a legacy payload must still validate');

  await runRestoreTransaction(db, USER, legacy);
  const after = visibleTo(USER);
  assert.equal(after.timelines.length, 2);
  assert.equal(after.timelines[0].source, null);
  assert.equal(after.timelines[0].source_notification_id, null);
  assert.equal(after.entities[0].source_notification_id, null);
  // The rest of the row is untouched by the missing keys.
  assert.equal(after.timelines[0].expense_amount_paise, 5000);
});

test('a new backup round-trips the SMS provenance columns', async () => {
  resetState();
  const db = fakeDb();
  const rows = sampleRows();
  const timeline = rows.timelines[0] as Record<string, unknown>;
  timeline.source = 'SMS';
  timeline.source_notification_id = 'sms-abc';
  const entity = rows.entities[0] as Record<string, unknown>;
  entity.source_notification_id = 'sms-abc';

  assert.ok(validateBackupRows(rows).ok);
  await runRestoreTransaction(db, USER, rows);

  const after = visibleTo(USER);
  assert.equal(after.timelines[0].source, 'SMS');
  assert.equal(after.timelines[0].source_notification_id, 'sms-abc');
  assert.equal(after.entities[0].source_notification_id, 'sms-abc');
});

test('a backup round-trips a MANUAL-source row so an offline expense is not lost', async () => {
  resetState();
  const db = fakeDb();
  const rows = sampleRows();
  const timeline = rows.timelines[0] as Record<string, unknown>;
  // Add Expense writes source='MANUAL' with no notification id when the network
  // is down. That marker is what keeps replaceAll from deleting the row, so it
  // has to survive a backup/restore round trip too.
  timeline.source = 'MANUAL';
  timeline.source_notification_id = null;
  timeline.expense_amount_paise = 61000;
  timeline.money_type = 'expense';

  assert.ok(validateBackupRows(rows).ok);
  await runRestoreTransaction(db, USER, rows);

  const after = visibleTo(USER);
  assert.equal(after.timelines[0].source, 'MANUAL', 'the device-owned marker must persist');
  assert.equal(after.timelines[0].source_notification_id, null);
  assert.equal(after.timelines[0].expense_amount_paise, 61000, 'the amount survives');
  assert.equal(after.timelines[0].money_type, 'expense');
});

test('restore is idempotent: repeating it does not duplicate rows', async () => {
  resetState();
  const db = fakeDb();
  const rows = sampleRows();

  await runRestoreTransaction(db, USER, rows);
  const first = JSON.stringify(visibleTo(USER));
  await runRestoreTransaction(db, USER, rows);
  const second = JSON.stringify(visibleTo(USER));

  assert.equal(first, second, 'a second restore changed local state');
  assert.equal(visibleTo(USER).notes.length, 1);
  assert.equal(visibleTo(USER).timelines.length, 2);
});

test('restore replaces local data rather than merging it', async () => {
  resetState();
  const db = fakeDb();
  seed(
    {
      ...sampleRows(),
      notes: [
        {
          id: 'stale',
          user_id: USER,
          title: 'Old note',
          content: 'to be replaced',
          pinned: 0,
          created_at: null,
          updated_at: null,
        },
      ],
    },
    USER,
  );

  await runRestoreTransaction(db, USER, sampleRows());
  const after = visibleTo(USER);
  assert.equal(after.notes.length, 1);
  assert.equal(after.notes[0].id, 'n1');
  assert.ok(!after.notes.some((n) => n.id === 'stale'));
});

test('restore never touches another account data and re-asserts ownership', async () => {
  resetState();
  const db = fakeDb();
  const other = {
    ...sampleRows(),
    notes: [
      {
        id: 'other-note',
        user_id: OTHER_USER,
        title: 'Not yours',
        content: 'secret',
        pinned: 0,
        created_at: null,
        updated_at: null,
      },
    ],
  };
  seed(other, OTHER_USER);

  // The payload claims its rows belong to someone else...
  const hostile = structuredClone(sampleRows()) as BackupRows;
  for (const spec of BACKUP_TABLES) {
    if (!spec.userScoped) continue; // join rows carry no user_id by design
    const rows = hostile[spec.key] as Record<string, unknown>[] | undefined;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) row.user_id = OTHER_USER;
  }

  await runRestoreTransaction(db, USER, hostile);

  const mine = visibleTo(USER);
  const theirs = visibleTo(OTHER_USER);
  assert.equal(mine.notes[0].user_id, USER, 'rows must be re-scoped to the authenticated user');
  assert.deepEqual(
    theirs.notes.map((n) => n.id),
    ['other-note'],
    'the other account must be untouched',
  );
});

test('a broken entity link aborts the restore and leaves data unchanged', async () => {
  resetState();
  const db = fakeDb();
  seed(sampleRows(), USER);
  const before = JSON.stringify(visibleTo(USER));

  const broken = structuredClone(sampleRows());
  broken.timeline_entities = [{ timeline_id: 't1', entity_id: 'does-not-exist' }];

  await assert.rejects(
    () => runRestoreTransaction(db, USER, broken),
    /referential integrity/i,
  );
  assert.equal(JSON.stringify(visibleTo(USER)), before, 'a failed restore must change nothing');
});

test('an invalid payload is rejected before any SQL runs', async () => {
  resetState();
  const db = fakeDb();
  await assert.rejects(
    () => runRestoreTransaction(db, USER, { notes: 'nope' } as never),
    /not a list/,
  );
  assert.equal(
    statementsIssued().filter((s) => /^(INSERT|DELETE)/.test(s)).length,
    0,
    'validation must run before any write',
  );
});

// ─── v1 -> v2 migration ──────────────────────────────────────────────────────

test('v1 payloads upgrade without losing rows, links or money fields', () => {
  const v1 = {
    backupVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    userId: USER,
    entities: [
      {
        id: 'e1',
        name: 'Alice',
        type: 'PERSON',
        description: 'friend',
        avatar: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: null,
      },
    ],
    timelines: [
      {
        id: 't1',
        title: 'Dentist',
        description: 'checkup',
        eventDate: '2026-03-01',
        showOnCalendar: true,
        createdAt: null,
        updatedAt: null,
        expenseAmountPaisa: 5000,
        expenseCategory: 'Health',
        receivableStatus: 'received',
        moneyType: 'expense',
        entities: [{ entityId: 'e1', entity: null }],
      },
    ],
    notes: [
      {
        id: 'n1',
        title: 'Shopping',
        content: 'spent 100',
        pinned: true,
        createdAt: null,
        updatedAt: '2026-01-04T00:00:00.000Z',
      },
    ],
    diaryEntries: [
      {
        id: 'd1',
        title: 'Day one',
        content: 'good',
        mood: 'happy',
        entryDate: '2026-01-05',
        createdAt: null,
        updatedAt: null,
      },
    ],
  } as unknown as BackupV1Payload;

  const v2 = migrateV1ToV2Rows(v1);
  assert.equal(v2.timelines.length, 1);
  assert.equal(v2.timelines[0].expense_amount_paise, 5000);
  assert.equal(v2.timelines[0].money_type, 'expense');
  assert.equal(v2.timelines[0].receivable_status, 'received');
  assert.equal(v2.timelines[0].show_on_calendar, 1);
  assert.deepEqual(v2.timeline_entities, [{ timeline_id: 't1', entity_id: 'e1' }]);
  assert.equal(v2.notes[0].pinned, 1);
  assert.equal(v2.diary_entries[0].entry_date, '2026-01-05');
  assert.deepEqual(v2.notifications, []);
  assert.ok(validateBackupRows(v2).ok, 'a migrated v1 payload must be restorable');
});

test('a v1 payload with an entity only inside a link is preserved', () => {
  const v1 = {
    backupVersion: 1,
    createdAt: 'x',
    updatedAt: 'x',
    userId: USER,
    entities: [],
    timelines: [
      {
        id: 't1',
        title: 'Lunch',
        description: '',
        eventDate: '2026-03-01',
        showOnCalendar: false,
        entities: [
          {
            entityId: 'e9',
            entity: { id: 'e9', name: 'Cafe', type: 'PLACE', description: null, avatar: null },
          },
        ],
      },
    ],
    notes: [],
    diaryEntries: [],
  } as unknown as BackupV1Payload;

  const v2 = migrateV1ToV2Rows(v1);
  assert.equal(v2.entities.length, 1);
  assert.equal(v2.entities[0].id, 'e9');
  assert.equal(v2.timeline_entities.length, 1);
});

test('v1 duplicate links collapse to the join table primary key', () => {
  const v1 = {
    backupVersion: 1,
    createdAt: 'x',
    updatedAt: 'x',
    userId: USER,
    entities: [{ id: 'e1', name: 'A', type: 'PERSON' }],
    timelines: [
      {
        id: 't1',
        title: 'x',
        description: '',
        eventDate: '2026-03-01',
        showOnCalendar: false,
        entities: [
          { entityId: 'e1', entity: null },
          { entityId: 'e1', entity: null },
        ],
      },
    ],
    notes: [],
    diaryEntries: [],
  } as unknown as BackupV1Payload;
  const v2 = migrateV1ToV2Rows(v1);
  assert.equal(v2.timeline_entities.length, 1);
  assert.ok(validateBackupRows(v2).ok);
});

// ─── Safety snapshot ─────────────────────────────────────────────────────────

test('a snapshot is taken before the restore and can roll it back', async () => {
  resetState();
  const db = fakeDb();
  const original = sampleRows();
  seed(original, USER);

  await saveSnapshotWith(db, USER, 'pre-restore', '1.0.0', 7);

  // Simulate a bad restore, then roll back to the snapshot.
  const bad = structuredClone(sampleRows());
  bad.notes = [
    {
      id: 'oops',
      user_id: USER,
      title: 'Wrong',
      content: 'bad restore',
      pinned: 0,
      created_at: null,
      updated_at: null,
    },
  ];
  await runRestoreTransaction(db, USER, bad);
  assert.deepEqual(
    visibleTo(USER).notes.map((n) => n.id),
    ['oops'],
  );

  const result = await restoreFromSnapshotWith(db, USER);
  assert.equal(result.restoredFrom, 'snapshot');
  assert.deepEqual(
    visibleTo(USER).notes.map((n) => n.id),
    ['n1'],
  );
});

test('rolling back returns a new device to its empty pre-restore state', async () => {
  resetState();
  const db = fakeDb();

  // The device had no records before the restore, so the snapshot is empty.
  await saveSnapshotWith(db, USER, 'pre-restore', '1.0.0', 7);
  assert.equal(visibleTo(USER).notes.length, 0);

  // A cloud restore then brings the account's data over.
  await runRestoreTransaction(db, USER, sampleRows());
  assert.equal(visibleTo(USER).notes.length, 1);

  // Undoing it must be allowed, and must clear the restored rows. If an empty
  // snapshot were rejected here the user would be stuck with the restored data.
  const result = await restoreFromSnapshotWith(db, USER);
  assert.equal(result.restoredFrom, 'snapshot');
  assert.equal(result.totalRows, 0);
  assert.equal(visibleTo(USER).notes.length, 0);
  assert.equal(visibleTo(USER).timelines.length, 0);
});

test('only the newest snapshot per user is kept', async () => {
  resetState();
  const db = fakeDb();
  seed(sampleRows(), USER);

  await saveSnapshotWith(db, USER, 'first', '1.0.0', 7);
  await saveSnapshotWith(db, USER, 'second', '1.0.0', 7);

  const latest = await getLatestSnapshotWith(db, USER);
  assert.equal(latest?.reason, 'second');
});
