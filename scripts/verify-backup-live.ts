// Live end-to-end check of the exact bytes the mobile app puts on the wire.
//
//   cd birbal && npm run verify:backup:live
//
// It uses the MOBILE canonicalStringify (src/services/backupCanonical.ts) and a
// Node SHA-256 standing in for expo-crypto's digestStringAsync, so the payload
// is byte-for-byte what a device would send. Against a running API it proves:
//   1. signup -> token -> authenticated backup upload succeeds;
//   2. the server's recomputed checksum matches the client's (a mismatch here
//      would mean every real upload is rejected);
//   3. a payload over 100kb is accepted (Express' default limit would 413);
//   4. download returns the identical data section;
//   5. a second account can neither read nor delete the first's backup;
//   6. a tampered payload and a cross-account payload are both refused.
//
// Usage: BIRBAL_API_URL=http://localhost:3000 npm run verify:backup:live

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { canonicalStringify } from '../src/services/backupCanonical';
import { computeRecordCounts, describeCounts } from '../src/services/backupCounts';

const BASE = (process.env.BIRBAL_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const stamp = Date.now();
const ACCOUNT_A = {
  fullName: 'Backup Tester A',
  email: `backup.a.${stamp}@example.test`,
  password: 'Passw0rd!test',
};
const ACCOUNT_B = {
  fullName: 'Backup Tester B',
  email: `backup.b.${stamp}@example.test`,
  password: 'Passw0rd!test',
};

/** Stands in for expo-crypto: both produce a SHA-256 hex digest. */
const sha256 = (input: string) => createHash('sha256').update(input, 'utf8').digest('hex');
const checksumOfData = (data: unknown) => sha256(canonicalStringify(data));

function buildPayload(userId: string) {
  const data = {
    entities: [
      {
        id: 'live-e1',
        user_id: userId,
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
        id: 'live-t1',
        user_id: userId,
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
        id: 'live-t2',
        user_id: userId,
        title: 'Groceries',
        description: '',
        event_date: '2026-03-05',
        show_on_calendar: 0,
        created_at: null,
        updated_at: null,
        expense_amount_paise: 2450,
        expense_category: 'Food',
        receivable_status: 'received',
        money_type: 'expense',
      },
    ],
    timeline_entities: [{ timeline_id: 'live-t1', entity_id: 'live-e1' }],
    notes: [
      {
        id: 'live-n1',
        user_id: userId,
        title: 'Shopping list',
        // ~140kb, so the request cannot pass Express' 100kb default limit.
        content: 'milk, eggs, bread. '.repeat(10_000),
        pinned: 1,
        created_at: null,
        updated_at: '2026-01-04T00:00:00.000Z',
      },
    ],
    diary_entries: [
      {
        id: 'live-d1',
        user_id: userId,
        title: 'Good day',
        content: 'shipped backup & restore',
        mood: 'happy',
        entry_date: '2026-01-05',
        created_at: null,
        updated_at: null,
      },
    ],
    notifications: [
      {
        id: 'live-no1',
        user_id: userId,
        type: 'EVENT',
        title: 'Dentist',
        message: 'in 3 days',
        icon: null,
        read: 0,
        entity_id: 'live-e1',
        timeline_id: 'live-t1',
        created_at: '2026-02-01T00:00:00.000Z',
      },
    ],
  };

  return {
    backupVersion: 2 as const,
    appVersion: '1.0.0',
    encoding: 'json' as const,
    createdAt: new Date().toISOString(),
    userId,
    recordCounts: computeRecordCounts(data),
    checksum: checksumOfData(data),
    data,
  };
}

async function api(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as any) } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function signup(account: { fullName: string; email: string; password: string }) {
  const res = await api('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(account),
  });
  assert.equal(res.status, 201, `signup failed: ${JSON.stringify(res.body)}`);
  // Same field the app's authStore reads (src/store/authStore.ts:56).
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

const results: string[] = [];
function pass(name: string) {
  results.push(`  PASS  ${name}`);
}

async function main() {
  console.log(`Birbal backup & restore — live check against ${BASE}\n`);

  const a = await signup(ACCOUNT_A);
  const b = await signup(ACCOUNT_B);
  pass(`created two accounts (${a.userId} / ${b.userId})`);

  // 1. Upload.
  const payload = buildPayload(a.userId);
  const bodyBytes = Buffer.byteLength(JSON.stringify({ payload }), 'utf8');
  assert.ok(bodyBytes > 100_000, `payload should exceed 100kb, got ${bodyBytes}`);
  const upload = await api('/backups', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ payload }),
  });
  assert.equal(upload.status, 201, `upload failed: ${JSON.stringify(upload.body)}`);
  assert.equal(upload.body.checksum, payload.checksum, 'server stored a different checksum');
  assert.equal(upload.body.appVersion, '1.0.0');
  assert.equal(upload.body.recordCounts.timelines, 2);
  assert.equal(upload.body.recordCounts.events, 1);
  assert.equal(upload.body.recordCounts.expenses, 2);
  pass(`uploaded ${bodyBytes} bytes (${describeCounts(payload.recordCounts)})`);
  pass('server recomputed the client SHA-256 checksum successfully');

  // 2. Download.
  const latest = await api('/backups/latest?includePayload=true', { token: a.token });
  assert.equal(latest.status, 200);
  assert.equal(latest.body.checksum, payload.checksum);
  assert.equal(checksumOfData(latest.body.payload.data), payload.checksum, 'downloaded data is corrupt');
  assert.deepEqual(JSON.parse(canonicalStringify(latest.body.payload.data)), payload.data);
  pass('downloaded payload is byte-identical and re-verifies against its checksum');

  // 3. Metadata-only lookup.
  const info = await api('/backups/latest', { token: a.token });
  assert.equal(info.status, 200);
  assert.ok(!('payload' in info.body), 'metadata lookup must not echo the payload');
  pass('metadata lookup returns no payload');

  // 4. History.
  const list = await api('/backups', { token: a.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  pass('backup history lists the snapshot');

  // 5. Isolation.
  const bSees = await api('/backups/latest?includePayload=true', { token: b.token });
  assert.equal(bSees.status, 404, 'a second account must not see the backup');
  const bList = await api('/backups', { token: b.token });
  assert.deepEqual(bList.body, []);
  const bDelete = await api(`/backups/${upload.body.id}`, { method: 'DELETE', token: b.token });
  assert.equal(bDelete.status, 404, 'a second account must not delete the backup');
  const stillThere = await api('/backups/latest', { token: a.token });
  assert.equal(stillThere.status, 200, 'the backup must survive another account delete attempt');
  pass('accounts are isolated for read, list and delete');

  // 6. Rejections.
  const tampered = await api('/backups', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ payload: { ...payload, data: { ...payload.data, notes: [] } } }),
  });
  assert.equal(tampered.status, 400);
  pass('a tampered payload is refused');

  const crossAccount = await api('/backups', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ payload: buildPayload(b.userId) }),
  });
  assert.equal(crossAccount.status, 403);
  pass('a payload claiming another account is refused');

  const withCredentials = await api('/backups', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({
      payload: { ...payload, data: { ...payload.data, notes: [{ ...payload.data.notes[0], password: 'x' }] } },
    }),
  });
  assert.equal(withCredentials.status, 400);
  pass('a payload containing credentials is refused');

  const futureVersion = await api('/backups', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ payload: { ...payload, backupVersion: 99 } }),
  });
  assert.equal(futureVersion.status, 400);
  pass('an unsupported backup version is refused');

  const anonymous = await api('/backups/latest');
  assert.equal(anonymous.status, 401);
  pass('unauthenticated access is refused');

  // 7. A legacy v1 upload still works, so old clients are not locked out.
  const v1 = {
    backupVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId: a.userId,
    notes: [],
    diaryEntries: [],
    entities: [],
    timelines: [],
  };
  const legacy = await api('/backups', {
    method: 'POST',
    token: a.token,
    body: JSON.stringify({ payload: v1 }),
  });
  assert.equal(legacy.status, 201);
  assert.equal(legacy.body.backupVersion, 1);
  pass('a legacy v1 payload is still accepted');

  // Cleanup so repeat runs stay clean.
  await api(`/backups/${upload.body.id}`, { method: 'DELETE', token: a.token });
  await api(`/backups/${legacy.body.id}`, { method: 'DELETE', token: a.token });

  console.log(results.join('\n'));
  console.log(`\nAll ${results.length} live checks passed.`);
}

main().catch((error) => {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
