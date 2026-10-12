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

// Must be the first test to run: `ensureNotificationChannel` is memoized by a
// module-level `channelReady` flag, so the channel options are only captured on
// the first setup of the process. Device log read:
//   expo-notifications: Custom sound 'default' not found in native app...
// expo-notifications treats a channel's `sound` as a bundled raw-resource name,
// so 'default' logs that warning (and resolves to the system default anyway). The
// supported way to get the system default is to omit `sound` entirely.
test('the Android channel omits a sound name that matches no bundled resource', async () => {
  const { harness, scheduler } = await setup();
  try {
    await scheduler.resyncEventReminders(USER); // triggers ensureNotificationChannel
    assert.ok(
      nativeControls.notificationChannelOptions.length > 0,
      'the notification channel setup ran',
    );
    for (const options of nativeControls.notificationChannelOptions) {
      assert.equal(
        (options as { sound?: unknown } | null)?.sound,
        undefined,
        "a channel must not name a 'sound' that is not a bundled resource (logs a warning)",
      );
    }
  } finally {
    await harness.cleanup();
  }
});

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

// Android 13+ with SCHEDULE_EXACT_ALARM denied makes expo park an inexact alarm,
// which Doze defers. The app has no JS read of `canScheduleExactAlarms()`, so it
// once sent the user to "Alarms & reminders" a single time and never again — and
// a single missed/dismissed screen silently left every reminder late forever.
// The remaining tests pin the corrected contract: the prompt is offered again
// whenever a reminder proves to have been deferred, and it is only ever raised
// by a user-initiated schedule.
const EXACT_ALARM_KEY = 'birbal_exact_alarm_prompted';
const EXACT_ALARM_INTENT = 'android.settings.REQUEST_SCHEDULE_EXACT_ALARM';

test('a user-initiated schedule offers the exact-alarm screen once, then stays quiet', async () => {
  const { harness, timelines, scheduler } = await setup();
  try {
    const at = atMinutes(60);
    await timelines.create(USER, {
      id: 'tl-exact',
      title: 'Exact',
      description: 'Exact',
      eventDate: iso(at),
      showOnCalendar: true,
    });
    const timeline = (await timelines.getById(USER, 'tl-exact'))!;

    await scheduler.scheduleEventReminder(timeline, true);

    assert.deepEqual(
      nativeControls.linkingIntents,
      [EXACT_ALARM_INTENT],
      'a user-initiated schedule points the user at the exact-alarm screen',
    );
    assert.equal(nativeControls.secureStore.get(EXACT_ALARM_KEY), '1', 'the offer is remembered');

    await scheduler.scheduleEventReminder(timeline, true);
    assert.equal(
      nativeControls.linkingIntents.length,
      1,
      'the settings screen is not reopened while the offer stands',
    );
  } finally {
    await harness.cleanup();
  }
});

test('the app-start resync never opens the exact-alarm settings on its own', async () => {
  const { harness, timelines, scheduler } = await setup();
  try {
    await timelines.create(USER, {
      id: 'tl-quiet',
      title: 'Quiet',
      description: 'Quiet',
      eventDate: iso(atMinutes(60)),
      showOnCalendar: true,
    });

    await scheduler.resyncEventReminders(USER);

    assert.deepEqual(
      nativeControls.linkingIntents,
      [],
      'resync must park reminders silently and never launch a settings screen',
    );
  } finally {
    await harness.cleanup();
  }
});

test('a deferred past-due reminder re-arms the exact-alarm prompt', async () => {
  const { harness, timelines, scheduler } = await setup();
  try {
    const at = atMinutes(-5);
    await timelines.create(USER, {
      id: 'tl-deferred',
      title: 'Deferred',
      description: 'Deferred',
      eventDate: iso(at),
      showOnCalendar: true,
    });
    park('tl-deferred', at, { title: 'Deferred' });
    nativeControls.secureStore.set(EXACT_ALARM_KEY, '1');

    await scheduler.resyncEventReminders(USER);

    assert.equal(
      nativeControls.secureStore.get(EXACT_ALARM_KEY),
      undefined,
      'a reminder that is overdue but still undelivered re-arms the prompt for the next schedule',
    );
    assert.ok(parked('tl-deferred'), 'the late-but-pending reminder itself is still preserved');
  } finally {
    await harness.cleanup();
  }
});

test('an on-time future reminder does not re-arm the exact-alarm prompt', async () => {
  const { harness, timelines, scheduler } = await setup();
  try {
    const at = atMinutes(60);
    await timelines.create(USER, {
      id: 'tl-ontime',
      title: 'On time',
      description: 'On time',
      eventDate: iso(at),
      showOnCalendar: true,
    });
    park('tl-ontime', at, { title: 'On time' });
    nativeControls.secureStore.set(EXACT_ALARM_KEY, '1');

    await scheduler.resyncEventReminders(USER);

    assert.equal(
      nativeControls.secureStore.get(EXACT_ALARM_KEY),
      '1',
      'a reminder still ahead of its instant is not evidence of a deferred alarm',
    );
  } finally {
    await harness.cleanup();
  }
});
