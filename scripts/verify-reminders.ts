// Verification suite for scheduled event reminders across an app restart.
//
// Run with:  npm run verify:reminders
//
// The device report was "the meeting reminder only appears after I open the app".
// One cause is a late (inexact) Android alarm, but the app made it worse on every
// start: `resyncEventReminders()` cancelled every parked `birbal-ev-` reminder and
// recreated it from the DB, and a reminder whose nominal time had passed could no
// longer be recreated (`start <= Date.now()`), so it was silently dropped.
//
// These tests pin the corrected contract against REAL SQLite and a stand-in for
// the OS scheduled-notification store (see nativeControls.scheduledNotifications):
//
//   * a reminder still present in `getAllScheduledNotificationsAsync()` has NOT
//     fired — the OS only returns notifications it has not delivered yet — so a
//     past-due-but-pending reminder must survive the restart resync untouched;
//   * reminders are cancelled only when their event was deleted or changed;
//   * missing upcoming reminders are parked exactly once (no duplicates);
//   * logout clearing leaves mirrored system notifications alone.
//
// This is not a device alarm test: it proves the JS scheduler stops destroying
// pending reminders, not that Android delivers an exact alarm on time.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import './stubs/preload';
import { freshDb, nativeControls } from './real-sqlite';

const USER = 'user-1';
const ID_PREFIX = 'birbal-ev-';

/** Loads a migrated DB harness plus the production scheduler/repository. */
async function setup() {
  nativeControls.reset();
  const harness = await freshDb();
  const timelines = await import('../src/db/repositories/timelines');
  const scheduler = await import('../src/services/notificationScheduler');
  return { harness, timelines, scheduler };
}

const atMinutes = (m: number) => Date.now() + m * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Parks a reminder in the OS store exactly as a real schedule would have: the
 * identifier is `birbal-ev-<timelineId>` and the trigger carries the fire instant.
 */
function park(timelineId: string, atMs: number, content: unknown = { title: timelineId }) {
  nativeControls.scheduledNotifications.set(`${ID_PREFIX}${timelineId}`, {
    identifier: `${ID_PREFIX}${timelineId}`,
    content,
    trigger: { type: 'date', repeats: false, value: atMs, channelId: 'birbal-reminders' },
  });
}

function parked(timelineId: string) {
  return nativeControls.scheduledNotifications.get(`${ID_PREFIX}${timelineId}`);
}

function parkedValue(timelineId: string): number | undefined {
  return (parked(timelineId)?.trigger as { value?: number } | undefined)?.value;
}

test('a past-due reminder that has not fired survives an app-restart resync', async () => {
  const { harness, timelines, scheduler } = await setup();
  try {
    const at = atMinutes(-5);
    await timelines.create(USER, {
      id: 'tl-late',
      title: 'Late meeting',
      description: 'Late meeting',
      eventDate: iso(at),
      showOnCalendar: true,
    });
    const original = { title: 'Late meeting', body: 'still pending' };
    park('tl-late', at, original);

    await scheduler.resyncEventReminders(USER);

    const entry = parked('tl-late');
    assert.ok(
      entry,
      'a pending reminder must not be cancelled just because its nominal instant passed',
    );
    assert.equal(entry!.content, original, 'the untouched original stays parked');
  } finally {
    await harness.cleanup();
  }
});

test('a reminder for a deleted event is cancelled', async () => {
  const { harness, scheduler } = await setup();
  try {
    park('tl-ghost', atMinutes(60));
    await scheduler.resyncEventReminders(USER);
    assert.equal(parked('tl-ghost'), undefined, 'a reminder with no event must not linger');
  } finally {
    await harness.cleanup();
  }
});

test('an event whose time changed is re-parked at the new instant', async () => {
  const { harness, timelines, scheduler } = await setup();
  try {
    const newAt = atMinutes(120);
    await timelines.create(USER, {
      id: 'tl-moved',
      title: 'Moved',
      description: 'Moved',
      eventDate: iso(newAt),
      showOnCalendar: true,
    });
    park('tl-moved', atMinutes(60), { title: 'old' });

    await scheduler.resyncEventReminders(USER);

    assert.equal(parkedValue('tl-moved'), newAt, 'the reminder follows the new event time');
  } finally {
    await harness.cleanup();
  }
});

test('an upcoming event with no reminder is parked exactly once and never duplicated', async () => {
  const { harness, timelines, scheduler } = await setup();
  try {
    const at = atMinutes(60);
    await timelines.create(USER, {
      id: 'tl-new',
      title: 'New',
      description: 'New',
      eventDate: iso(at),
      showOnCalendar: true,
    });

    await scheduler.resyncEventReminders(USER);
    assert.equal(parkedValue('tl-new'), at, 'the missing reminder is parked at its event time');

    const size = nativeControls.scheduledNotifications.size;
    await scheduler.resyncEventReminders(USER);
    assert.equal(
      nativeControls.scheduledNotifications.size,
      size,
      'a second resync must not stack a duplicate',
    );
    assert.ok(parked('tl-new'), 'the reminder is still there after the second resync');
  } finally {
    await harness.cleanup();
  }
});

test('an unchanged future reminder is preserved rather than recreated', async () => {
  const { harness, timelines, scheduler } = await setup();
  try {
    const at = atMinutes(90);
    await timelines.create(USER, {
      id: 'tl-keep',
      title: 'Keep',
      description: 'Keep',
      eventDate: iso(at),
      showOnCalendar: true,
    });
    const original = { title: 'Keep', body: 'untouched' };
    park('tl-keep', at, original);

    await scheduler.resyncEventReminders(USER);

    assert.equal(
      parked('tl-keep')?.content,
      original,
      'a valid pending reminder is left exactly as it was',
    );
  } finally {
    await harness.cleanup();
  }
});

test('resync is a no-op while the notification permission is denied', async () => {
  const { harness, timelines, scheduler } = await setup();
  try {
    nativeControls.notificationsGranted = false;
    await timelines.create(USER, {
      id: 'tl-nope',
      title: 'No permission',
      description: 'No permission',
      eventDate: iso(atMinutes(60)),
      showOnCalendar: true,
    });

    await scheduler.resyncEventReminders(USER);

    assert.equal(
      parked('tl-nope'),
      undefined,
      'without permission nothing is parked (and nothing is cancelled)',
    );
  } finally {
    await harness.cleanup();
  }
});

test('clearing reminders never touches mirrored system notifications', async () => {
  const { harness, scheduler } = await setup();
  try {
    nativeControls.scheduledNotifications.set('birbal-sys-x', {
      identifier: 'birbal-sys-x',
      content: { title: 'Mirror' },
      trigger: { channelId: 'birbal-reminders' },
    });
    park('tl-x', atMinutes(60));

    await scheduler.clearAllEventReminders();

    assert.ok(
      nativeControls.scheduledNotifications.has('birbal-sys-x'),
      'a mirrored shade notification is not an event reminder and must survive logout clearing',
    );
    assert.equal(parked('tl-x'), undefined, 'event reminders are cleared on logout');
  } finally {
    await harness.cleanup();
  }
});
