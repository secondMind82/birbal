// Verification suite for the SIM SMS -> notification -> Bell pipeline.
//
// Run with:  npm run verify:sms:pipe
//
// This exercises the JS half of the pipeline that the device report says was
// broken, against real SQLite, a real HTTP API, and the same peek/ack contract
// the Kotlin inbox implements:
//
//   captured message -> local SMS persistence -> notification row -> store ->
//   NotificationCenter list / Bell badge, plus the Ignore and Save outcomes.
//
// SCOPE, stated plainly because it matters: the native BroadcastReceiver is
// Kotlin and does NOT run here. Nothing in this file proves that a real SIM
// message is captured, that RECEIVE_SMS was granted, or that the receiver is
// registered. Those are verified by inspecting the built APK and by testing on a
// physical phone. What this does prove is that IF the native layer hands a
// message over, it is never lost, never duplicated, and reaches the existing
// notification pipeline instead of a second one.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

import './stubs/preload';
import { startFakeApi, type FakeApi } from './fake-api';
import { freshDb, nativeControls } from './real-sqlite';
import type { AppNotification, Timeline } from '../src/models/types';

const USER = 'user-1';

let api: FakeApi;

before(async () => {
  api = await startFakeApi();
});

after(async () => {
  await api?.close();
});

/** Mirrors SmsInboxStore.messageId so a seeded message gets a realistic id. */
function messageId(sender: string, body: string, receivedAt: number): string {
  return createHash('sha256')
    .update(sender)
    .update('\u0000')
    .update(body)
    .update('\u0000')
    .update(String(receivedAt))
    .digest('hex')
    .slice(0, 32);
}

/** Queues a message the way the native receiver would have. */
function capture(
  sender: string,
  body: string,
  ageMs = 0,
): { id: string; sender: string; body: string; receivedAt: number } {
  const receivedAt = Date.now() - ageMs;
  const message = {
    id: messageId(sender, body, receivedAt),
    sender,
    body,
    receivedAt,
  };
  nativeControls.smsInbox.push(message);
  return message;
}

/** Direct reads against the real database, for asserting what was written. */
type Db = { raw: import('node:sqlite').DatabaseSync };
const all = <T>(db: Db, sql: string, ...args: unknown[]) =>
  db.raw.prepare(sql).all(...(args as never[])) as T[];
const one = <T>(db: Db, sql: string, ...args: unknown[]) =>
  db.raw.prepare(sql).get(...(args as never[])) as T | undefined;
const countOf = (db: Db, sql: string, ...args: unknown[]) =>
  Number(one<{ c: number }>(db, sql, ...args)?.c ?? 0);

async function signIn(userId = USER) {
  const { useAuthStore } = await import('../src/store/authStore');
  useAuthStore.getState().setUser({
    id: userId,
    email: 'pipe@example.com',
    fullName: 'Pipe Test',
  } as never);
}

/**
 * Loads a module through `require` rather than `import`, so that dropping it from
 * `require.cache` genuinely re-executes it. `import()` keeps its own registry for
 * CommonJS, which is why resetNativeModuleLookup could not undo a first lookup.
 */
function load<T>(relative: string): T {
  return createRequire(__filename)(relative) as T;
}

async function withPipeline(filename = ':memory:') {
  api.reset();
  nativeControls.reset();
  const harness = await freshDb(filename);
  const smsService = load<typeof import('../src/services/smsService')>('../src/services/smsService');
  const smsMessages = load<typeof import('../src/db/repositories/smsMessages')>(
    '../src/db/repositories/smsMessages',
  );
  const notificationStore = load<typeof import('../src/store/notificationStore')>(
    '../src/store/notificationStore',
  );
  await signIn();
  return { smsService, smsMessages, notificationStore, ...harness };
}

/** Exactly what NotificationCenter renders: the store's list. */
const bellList = (store: { getState: () => { notifications: AppNotification[] } }) =>
  store.getState().notifications;
const bellBadge = (store: { getState: () => { notificationCount: number } }) =>
  store.getState().notificationCount;

test('a captured SIM message reaches the existing Bell', async () => {
  const p = await withPipeline();
  try {
    capture('+91 90000 11111', 'Amount received ₹5,000 from Shaaf');

    const result = await p.smsService.ingestCapturedSms(USER);
    assert.equal(result.added, 1, 'the message must be filed as new');
    assert.equal(result.unsupported, false);

    await p.notificationStore.useNotificationStore.getState().refresh();

    // The Bell, read the same way NotificationCenter reads it.
    const list = bellList(p.notificationStore.useNotificationStore);
    const sms = list.find((n) => n.type === 'SMS');
    assert.ok(sms, 'the captured SMS must appear in the Bell');
    assert.match(sms.title, /90000 11111/);
    assert.match(sms.message ?? '', /5,000/);
    assert.ok(bellBadge(p.notificationStore.useNotificationStore) > 0, 'the badge must count it');

    // It went through the ONE existing notifications table, not a second system.
    const rows = all<{ type: string }>(
      p,
      'SELECT type FROM notifications WHERE user_id = ?',
      USER,
    );
    assert.equal(rows.filter((r) => r.type === 'SMS').length, 1);
  } finally {
    await p.cleanup();
  }
});

test('a captured message is persisted locally with its body, and never uploaded', async () => {
  const p = await withPipeline();
  try {
    capture('+91 90000 22222', 'Rs. 1250.00 debited for groceries');

    await p.smsService.ingestCapturedSms(USER);

    const stored = await p.smsMessages.listPending(USER);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].body, 'Rs. 1250.00 debited for groceries');
    assert.equal(stored[0].status, 'PENDING');

    // No request the app made may carry the body to the server.
    const leaked = api.requests.filter((r) =>
      JSON.stringify(r.body ?? '').includes('1250.00 debited'),
    );
    assert.equal(leaked.length, 0, 'a message body must never be sent to the API');
  } finally {
    await p.cleanup();
  }
});

test('the message survives an app restart', async () => {
  // The same file on disk both times, so the second half is a genuine restart
  // rather than a second empty database.
  const file = join(mkdtempSync(join(tmpdir(), 'birbal-sms-restart-')), 'birbal.db');
  const p = await withPipeline(file);
  try {
    capture('+91 90000 33333', 'Aman owes me ₹3,000');
    await p.smsService.ingestCapturedSms(USER);
    await p.notificationStore.useNotificationStore.getState().refresh();
  } finally {
    await p.cleanup();
  }

  const p2 = await withPipeline(file);
  try {
    await p2.notificationStore.useNotificationStore.getState().refresh();
    const sms = bellList(p2.notificationStore.useNotificationStore).find((n) => n.type === 'SMS');
    assert.ok(sms, 'the notification must still be listed after a restart');
    assert.equal((await p2.smsMessages.countPending(USER)), 1, 'and so must the local message');
  } finally {
    await p2.cleanup();
  }
});

test('a message already stored is never duplicated, however often it is drained', async () => {
  const p = await withPipeline();
  try {
    const captured = capture('+91 90000 44444', 'Payment of ₹999 done');

    const first = await p.smsService.ingestCapturedSms(USER);
    assert.equal(first.added, 1);

    // Simulate a crash before ack: the same message is handed over again.
    nativeControls.smsInbox.push({ ...captured });
    const second = await p.smsService.ingestCapturedSms(USER);
    assert.equal(second.added, 0, 'a redelivery must not count as a new message');

    await p.notificationStore.useNotificationStore.getState().refresh();
    const smsRows = bellList(p.notificationStore.useNotificationStore).filter((n) => n.type === 'SMS');
    assert.equal(smsRows.length, 1, 'exactly one Bell entry, not two');
  } finally {
    await p.cleanup();
  }
});

test('a message that cannot be stored is NOT destroyed — it stays queued natively', async () => {
  const p = await withPipeline();
  try {
    capture('+91 90000 55555', 'Amount received ₹7,000 from Kabir');

    // Make persistence fail the way a locked/corrupt database would.
    p.raw.exec('DROP TABLE sms_messages');

    await assert.rejects(
      () => p.smsService.ingestCapturedSms(USER),
      'the failure must surface to the caller rather than being swallowed',
    );

    // The critical assertion: the message is still waiting, because drain no
    // longer consumes the queue before the write succeeds.
    assert.equal(
      nativeControls.smsInbox.length,
      1,
      'a real SMS must survive a failed ingest instead of being lost',
    );
  } finally {
    await p.cleanup();
  }
});

test('a stored message is acknowledged, so the queue does not grow forever', async () => {
  const p = await withPipeline();
  try {
    capture('+91 90000 66666', 'UPI payment of ₹500 received');
    await p.smsService.ingestCapturedSms(USER);
    assert.equal(nativeControls.smsInbox.length, 0, 'the message must be acked once stored');
  } finally {
    await p.cleanup();
  }
});

test('a partially failing batch only acknowledges what was stored', async () => {
  const p = await withPipeline();
  try {
    // Two identical bodies/senders but different timestamps = two distinct ids.
    capture('+91 90000 77777', 'Amount received ₹1,000 from One');
    capture('+91 90000 77777', 'Amount received ₹2,000 from Two');
    assert.equal(nativeControls.smsInbox.length, 2);

    const smsMessages = load<typeof import('../src/db/repositories/smsMessages')>(
      '../src/db/repositories/smsMessages',
    );
    const original = smsMessages.insertIfNew;
    let calls = 0;
    // Fail the second insert only.
    (smsMessages as unknown as { insertIfNew: typeof original }).insertIfNew = async (
      ...args: Parameters<typeof original>
    ) => {
      calls += 1;
      if (calls === 2) throw new Error('database is locked');
      return original(...args);
    };

    await assert.rejects(() => p.smsService.ingestCapturedSms(USER));

    assert.equal(
      nativeControls.smsInbox.length,
      1,
      'only the stored message is acked; the failed one is retried next time',
    );
  } finally {
    await p.cleanup();
  }
});

test('Ignore resolves the message and creates nothing at all', async () => {
  const p = await withPipeline();
  try {
    const captured = capture('+91 90000 88888', 'OTP 4455 for your card');
    await p.smsService.ingestCapturedSms(USER);

    await p.smsService.ignoreSms(USER, captured.id);

    assert.equal(await p.smsMessages.countPending(USER), 0, 'the message is no longer pending');

    // Nothing in Entity, Timeline or money.
    assert.equal(countOf(p, 'SELECT COUNT(*) AS c FROM entities'), 0, 'Ignore must create no Entity');
    assert.equal(countOf(p, 'SELECT COUNT(*) AS c FROM timelines'), 0, 'Ignore must create no Timeline');
    assert.equal(
      countOf(p, 'SELECT COUNT(*) AS c FROM timelines WHERE expense_amount_paise IS NOT NULL'),
      0,
      'Ignore must create no money',
    );

    // And it leaves the Bell.
    await p.notificationStore.useNotificationStore.getState().refresh();
    assert.equal(
      bellList(p.notificationStore.useNotificationStore).filter((n) => n.type === 'SMS').length,
      0,
    );
  } finally {
    await p.cleanup();
  }
});

test('Save turns a message into an Entity, a Timeline and money, exactly once', async () => {
  const p = await withPipeline();
  try {
    const captured = capture('+91 90000 99999', 'Amount received ₹5,000 from Shaaf');
    await p.smsService.ingestCapturedSms(USER);

    const saved = await p.smsService.saveSms(USER, { smsId: captured.id, text: '@Shaaf give me amount ₹5000' });
    assert.equal(saved.offline, false, 'the API is up, so this is a server-backed save');

    // Read through the repository, so this asserts what the Timeline screen and
    // the Expenses screen actually receive, camelCased and all.
    const timelines = load<typeof import('../src/db/repositories/timelines')>(
      '../src/db/repositories/timelines',
    );
    const entities = load<typeof import('../src/db/repositories/entities')>(
      '../src/db/repositories/entities',
    );

    const [timeline] = await timelines.getAll(USER);
    assert.ok(timeline, 'Save must create a Timeline entry');
    assert.equal(timeline.expenseAmountPaisa, 500000, '₹5,000 in paise');
    assert.equal(timeline.moneyType, 'receive');
    assert.equal(timeline.source, 'SMS');
    // "give me" asks for money, so it is a receivable that is still pending,
    // and it must be pending whether or not the API was reachable.
    assert.equal(timeline.receivableStatus, 'pending');

    const all = await entities.getAll(USER);
    const shaaf = all.find((e) => e.name === 'Shaaf');
    assert.ok(shaaf, 'Save must create the Shaaf Entity');
    assert.equal(shaaf.type, 'PERSON');
    assert.equal(
      (timeline.entities ?? []).some((l) => l.entity.name === 'Shaaf'),
      true,
      'the new Entity must be linked to the Timeline',
    );

    assert.equal(await p.smsMessages.countPending(USER), 0, 'the message is resolved');
    const stored = await p.smsMessages.getById(USER, captured.id);
    assert.equal(stored?.status, 'PROCESSED');

    // Saving the same message again must be a no-op, not a second record.
    const again = await p.smsService.saveSms(USER, {
      smsId: captured.id,
      text: '@Shaaf give me amount ₹5000',
    });
    assert.equal(again.alreadySaved, true, 'a re-save must report it as already saved');
    assert.equal(again.timeline.id, timeline.id, 'and return the original Timeline entry');
    assert.equal(countOf(p, 'SELECT COUNT(*) AS c FROM timelines'), 1, 'a re-save must not create a second Timeline');
    assert.equal(countOf(p, 'SELECT COUNT(*) AS c FROM entities'), 1, 'a re-save must not create a second Entity');
  } finally {
    await p.cleanup();
  }
});

test('the same save produces the same money status online and offline', async () => {
  const online = await withPipeline();
  let onlineStatus: string | null | undefined;
  let offlineStatus: string | null | undefined;
  try {
    const a = capture('+91 90000 10101', 'Ping from Shaaf');
    await online.smsService.ingestCapturedSms(USER);
    api.setMode('online');
    await online.smsService.saveSms(USER, { smsId: a.id, text: '@Shaaf give me amount ₹5000' });
    onlineStatus = (
      one<{ receivable_status: string | null }>(
        online,
        'SELECT receivable_status FROM timelines WHERE user_id = ?',
        USER,
      ) as { receivable_status: string | null } | undefined
    )?.receivable_status;

    const b = await withPipeline();
    try {
      const c = capture('+91 90000 10101', 'Ping from Shaaf');
      await b.smsService.ingestCapturedSms(USER);
      api.setMode('offline');
      await b.smsService.saveSms(USER, { smsId: c.id, text: '@Shaaf give me amount ₹5000' });
      offlineStatus = (
        one<{ receivable_status: string | null }>(
          b,
          'SELECT receivable_status FROM timelines WHERE user_id = ?',
          USER,
        ) as { receivable_status: string | null } | undefined
      )?.receivable_status;
    } finally {
      await b.cleanup();
    }
  } finally {
    await online.cleanup();
  }

  assert.equal(onlineStatus, 'pending', 'an online save of "give me amount" is pending');
  assert.equal(
    offlineStatus,
    onlineStatus,
    'the very same message must not become a settled credit just because the API was down',
  );
});

test('Save works offline and is idempotent', async () => {
  const p = await withPipeline();
  try {
    const captured = capture('+91 90000 10101', 'Paid ₹999 for groceries at D-Mart');
    await p.smsService.ingestCapturedSms(USER);

    api.setMode('offline');
    const saved = await p.smsService.saveSms(USER, { smsId: captured.id, text: 'Paid Rohan ₹999 for groceries' });
    assert.equal(saved.offline, true, 'an offline save must be local-first');

    const row = one<{ expense_amount_paise: number; money_type: string; source: string }>(
      p,
      'SELECT expense_amount_paise, money_type, source FROM timelines WHERE user_id = ?',
      USER,
    );
    assert.ok(row, 'the offline save must be in SQLite');
    assert.equal(row.expense_amount_paise, 99900);
    assert.equal(row.money_type, 'expense');
    assert.equal(row.source, 'SMS');

    const again = await p.smsService.saveSms(USER, {
      smsId: captured.id,
      text: 'Paid Rohan ₹999 for groceries',
    });
    assert.equal(again.alreadySaved, true, 'the offline save must be idempotent');
    assert.equal(countOf(p, 'SELECT COUNT(*) AS c FROM timelines'), 1, 'the offline save must not duplicate on a retry');
    assert.equal(countOf(p, 'SELECT COUNT(*) AS c FROM entities'), 1, 'nor a second Entity');
  } finally {
    api.setMode('online');
    await p.cleanup();
  }
});

/**
 * Forces the SMS surface to be looked up again.
 *
 * modules/birbal-sms resolves the native module once and caches the answer for
 * the process lifetime, which is right for the app but means a test cannot flip
 * the "module is missing" case afterwards. Dropping the compiled modules from the
 * cache re-runs that lookup.
 */
function resetNativeModuleLookup(): void {
  const req = createRequire(__filename);
  for (const key of Object.keys(req.cache)) {
    if (key.endsWith('modules/birbal-sms/index.js') || key.endsWith('services/smsService.js')) {
      delete req.cache[key];
    }
  }
}

test('a build without the native module degrades quietly instead of crashing', async () => {
  const p = await withPipeline();
  try {
    // Set AFTER withPipeline(), which resets the controls, and drop the module
    // cache so the next require re-runs the native lookup and finds nothing.
    nativeControls.smsCaptureSupported = false;
    resetNativeModuleLookup();
    p.smsService = load<typeof import('../src/services/smsService')>('../src/services/smsService');

    const result = await p.smsService.ingestCapturedSms(USER);
    assert.equal(result.unsupported, true, 'capture must be reported as unsupported');
    assert.equal(result.added, 0);
    assert.equal(
      countOf(p, 'SELECT COUNT(*) AS c FROM notifications'),
      0,
      'nothing is invented when capture is unavailable',
    );
  } finally {
    nativeControls.smsCaptureSupported = true;
    resetNativeModuleLookup();
    await p.cleanup();
  }
});

test('messages stay put while signed out and are attributed to the account that logs in', async () => {
  const p = await withPipeline();
  try {
    const { useAuthStore } = await import('../src/store/authStore');
    useAuthStore.setState({ user: null, isAuthenticated: false });

    capture('+91 90000 12121', 'Amount received ₹2,000 from Zoya');
    // No user means no ingest, so the message is still in the native queue.
    assert.equal(nativeControls.smsInbox.length, 1, 'an unclaimed message must wait');

    await signIn(USER);
    const result = await p.smsService.ingestCapturedSms(USER);
    assert.equal(result.added, 1, 'it is filed once a user is signed in');
    assert.equal(await p.smsMessages.countPending(USER), 1);
  } finally {
    await p.cleanup();
  }
});

test('an OTP body is masked in the Bell but kept intact locally', async () => {
  const p = await withPipeline();
  try {
    const captured = capture('+91 90000 13131', 'Your OTP is 448812 for login');
    await p.smsService.ingestCapturedSms(USER);
    await p.notificationStore.useNotificationStore.getState().refresh();

    const sms = bellList(p.notificationStore.useNotificationStore).find((n) => n.type === 'SMS');
    assert.ok(sms);
    assert.doesNotMatch(sms.message ?? '', /448812/, 'the code must not be exposed in the Bell');

    const stored = await p.smsMessages.getById(USER, captured.id);
    assert.match(stored?.body ?? '', /448812/, 'and it is not corrupted locally either');
  } finally {
    await p.cleanup();
  }
});
