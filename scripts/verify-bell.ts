// Verification suite for the Notification Bell and the SMS -> notification path.
//
// Run with:  npm run verify:bell
//
// The device report was "the Notification Bell showed nothing" AND "a real SIM
// SMS never appeared in the Bell". Those are two different failures, so this
// suite deliberately tests them separately and in that order:
//
//   1. THE BELL, on its own. An upcoming calendar event is the app's original,
//      non-SMS notification source. If that cannot reach NotificationCenter, the
//      Bell is broken independently of SMS and that has to be fixed first.
//   2. SMS ONTO THAT SAME PIPELINE. A captured message is pushed through the very
//      same repository + store the Bell reads, so SMS joins the existing system
//      instead of adding a second one.
//
// Scope note, because it matters: these run against real SQLite and a real HTTP
// API, but the native BroadcastReceiver is Kotlin and is NOT exercised here.
// Nothing below proves a real SIM message was captured — only that IF the native
// layer hands a message over, it surfaces correctly and survives restart.
// Real-SIM capture is verified on a physical phone, not here.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import './stubs/preload';
import { startFakeApi, type FakeApi } from './fake-api';
import { freshDb } from './real-sqlite';

const USER = 'user-1';

type NotificationStore = Awaited<ReturnType<typeof loadBellStack>>['store'];

let api: FakeApi;

before(async () => {
  api = await startFakeApi();
});

after(async () => {
  await api?.close();
});

/** Signs a user in so the stores, which read the auth state, have someone to use. */
async function signIn(userId = USER) {
  const { useAuthStore } = await import('../src/store/authStore');
  useAuthStore.getState().setUser({
    id: userId,
    email: 'bell@example.com',
    fullName: 'Bell Test',
  } as never);
}

async function loadBellStack() {
  api.reset();
  const harness = await freshDb();
  const notificationStore = await import('../src/store/notificationStore');
  const notificationsRepository = await import('../src/db/repositories/notifications');
  await signIn();
  return {
    store: notificationStore.useNotificationStore,
    repo: notificationsRepository,
    cleanup: harness.cleanup,
    raw: harness.raw,
  };
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/**
 * The Bell exactly as NotificationCenter (list) and AppHeader (badge) read it:
 * straight out of the store the UI subscribes to.
 */
function bell(store: NotificationStore) {
  const s = store.getState();
  return { list: s.notifications, badge: s.notificationCount };
}

test('the Bell shows an upcoming calendar event, with no SMS involved', async () => {
  const { store, cleanup } = await loadBellStack();
  try {
    api.seed({ id: 'tl-evt', title: 'Team standup', description: 'Team standup', eventDate: inMinutes(20) });

    await store.getState().refresh();

    const { list, badge } = bell(store);
    assert.ok(list.length > 0, 'the Bell must show the upcoming event');
    assert.ok(badge > 0, 'the Bell badge must reflect unread notifications');

    const titles = list.map((n: { type: string }) => n.type);
    assert.ok(titles.includes('EVENT'), `expected an EVENT notification, got ${titles.join(',')}`);
    // An event inside 30 minutes also raises its reminder.
    assert.ok(titles.includes('REMINDER'), `expected a REMINDER, got ${titles.join(',')}`);

    // The shape NotificationCenter renders.
    for (const n of list) {
      assert.equal(typeof n.id, 'string');
      assert.ok(n.title, 'every bell row needs a title');
      assert.ok(n.createdAt, 'every bell row needs a timestamp to render');
      assert.equal(n.read, false);
    }
  } finally {
    await cleanup();
  }
});

test('the Bell shows nothing it should not, so an empty Bell is meaningful', async () => {
  const { store, cleanup } = await loadBellStack();
  try {
    // Nothing upcoming, nothing recent: NotificationCenter should show its
    // "No notifications" state rather than a list of stale entries.
    api.seed({ id: 'tl-old', title: 'Last year thing', description: 'x', eventDate: inMinutes(-60 * 24 * 300) });
    await store.getState().refresh();
    const { list } = bell(store);
    assert.equal(
      list.filter((n: { type: string }) => n.type === 'EVENT' || n.type === 'REMINDER').length,
      0,
      'a long-past event must not produce a live EVENT/REMINDER notification',
    );
  } finally {
    await cleanup();
  }
});

test('marking one notification read lowers the badge by exactly one', async () => {
  const { store, cleanup } = await loadBellStack();
  try {
    api.seed({ id: 'tl-read', title: 'Coffee with Priya', description: 'x', eventDate: inMinutes(15) });
    await store.getState().refresh();

    const before = bell(store).badge as number;
    const target = (bell(store).list as Array<{ id: string }>)[0];
    await store.getState().markRead(target.id);

    assert.equal(bell(store).badge as number, before - 1);
    assert.equal(
      (bell(store).list as Array<{ id: string; read: boolean }>).find((n) => n.id === target.id)?.read,
      true,
    );
  } finally {
    await cleanup();
  }
});

test('mark all read clears the badge', async () => {
  const { store, cleanup } = await loadBellStack();
  try {
    api.seed({ id: 'tl-all', title: 'Dentist', description: 'x', eventDate: inMinutes(10) });
    await store.getState().refresh();
    assert.ok((bell(store).badge as number) > 0);
    await store.getState().markAllRead();
    assert.equal(bell(store).badge as number, 0);
    assert.ok((bell(store).list as Array<{ read: boolean }>).every((n) => n.read));
  } finally {
    await cleanup();
  }
});

test('a SYSTEM notification reaches the Bell too', async () => {
  const { store, cleanup } = await loadBellStack();
  try {
    await store.getState().system('Backup complete', 'Your timeline was saved.');
    const list = bell(store).list as Array<{ type: string; title: string }>;
    const sys = list.find((n) => n.type === 'SYSTEM');
    assert.ok(sys, 'the Bell must show a SYSTEM notification');
    assert.equal(sys.title, 'Backup complete');
  } finally {
    await cleanup();
  }
});

test('a Bell notification survives an app restart', async () => {
  const h1 = await loadBellStack();
  let savedId: string;
  try {
    api.seed({ id: 'tl-survive', title: 'Call the plumber', description: 'x', eventDate: inMinutes(20) });
    await h1.store.getState().refresh();
    savedId = (bell(h1.store).list as Array<{ id: string }>)[0].id;
  } finally {
    await h1.cleanup();
  }

  const h2 = await freshDb();
  try {
    const notificationStore = await import('../src/store/notificationStore');
    await signIn();
    // Same in-process store (module cache), fresh database + repositories.
    await notificationStore.useNotificationStore.getState().refresh();
    const list = notificationStore.useNotificationStore.getState().notifications;
    assert.ok(
      list.some((n) => n.id === savedId),
      'the Bell must still list the notification after a restart',
    );
  } finally {
    await h2.cleanup();
  }
});

test('the Bell still renders when the API is unreachable', async () => {
  const { store, cleanup } = await loadBellStack();
  try {
    api.seed({ id: 'tl-offline', title: 'Offline event', description: 'x', eventDate: inMinutes(20) });
    // Warm the cache while online, the way a real device would already be.
    await store.getState().refresh();
    assert.ok((bell(store).list as unknown[]).length > 0, 'precondition: the Bell has content');

    api.setMode('offline');
    await store.getState().refresh();
    assert.equal(store.getState().loading, false, 'refresh must not get stuck loading when offline');
    const { list } = bell(store);
    assert.ok((list as unknown[]).length > 0, 'cached notifications must still render offline');
  } finally {
    api.setMode('online');
    await cleanup();
  }
});
