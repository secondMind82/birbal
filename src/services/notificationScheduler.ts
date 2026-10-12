import * as Notifications from 'expo-notifications';
import { CommonActions } from '@react-navigation/native';
import { Linking, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as timelinesRepository from '../db/repositories/timelines';
import * as smsMessagesRepository from '../db/repositories/smsMessages';
import { navigationRef } from '../navigation/navigationRef';
import type { AppNotification, Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';
import { ANDROID_CHANNEL_ID, ensureNotificationChannel } from './systemNotifications';

// Real-device local notifications for events. Each event maps 1:1 to a scheduled
// notification with a stable identifier (`birbal-ev-<timelineId>`), so editing an
// event reschedules the same slot and deleting (or app resume) cancels/re-parks
// it without ever stacking duplicates. The trigger is the exact instant stored in
// `eventDate` (local device time), and the manage/launch handlers mirror every
// firing event into the in-app Notification Center.

const ID_PREFIX = 'birbal-ev-';

// A reminder the OS still reports as pending this long after its instant has
// demonstrably been deferred (not just the normal jitter of an inexact alarm).
const OVERDUE_GRACE_MS = 60_000;

// Foreground presentation: notifications must still surface while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Channel and permission setup live with the system-notification mirror, so a
// scheduled reminder and a mirrored bell row share one Android channel.
async function ensureBaselineSetup(): Promise<void> {
  await ensureNotificationChannel();
}

function identifierFor(timelineId: string): string {
  return `${ID_PREFIX}${timelineId}`;
}

async function hasPermission(): Promise<boolean> {
  const perms = await Notifications.getPermissionsAsync();
  return perms.granted;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  await ensureBaselineSetup();
  if (await hasPermission()) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

// Android 13+ (API 33+) denies SCHEDULE_EXACT_ALARM by default, so expo's DATE
// trigger falls back to an inexact alarm (`setAndAllowWhileIdle`). Under Doze
// that alarm is deferred to the next maintenance window — frequently not until
// the device or the app next wakes, which the user experiences as "the reminder
// only appears after I open the app". JS has no way to read
// alarmManager.canScheduleExactAlarms(), so we send the user to the system
// "Alarms & reminders" screen once and remember it. Only ever called on a
// user-initiated schedule (not the login/app-start resync) so the settings screen
// never opens on its own.
//
// The "already offered" mark is deliberately NOT permanent. A single dismissed
// screen — or one never seen because an earlier build had already set the mark —
// used to disable exact alarms silently forever. `resyncEventReminders` re-arms
// the prompt whenever the OS reports a reminder that is past its instant but
// still undelivered, which is the signature of a deferred inexact alarm.
const EXACT_ALARM_PROMPT_KEY = 'birbal_exact_alarm_prompted';

async function ensureExactAlarmPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const apiLevel = Number(Platform.Version);
  if (!Number.isFinite(apiLevel) || apiLevel < 33) return;
  try {
    if (await SecureStore.getItemAsync(EXACT_ALARM_PROMPT_KEY)) return;
    // Open first, mark only after: a failure here leaves the prompt armed for
    // the next user-initiated schedule instead of consuming the one attempt.
    try {
      await Linking.sendIntent('android.settings.REQUEST_SCHEDULE_EXACT_ALARM');
    } catch {
      await Linking.openSettings().catch(() => {});
    }
    await SecureStore.setItemAsync(EXACT_ALARM_PROMPT_KEY, '1');
  } catch {
    // Best-effort: the reminder still parks (inexactly) if this is unavailable.
  }
}

function cleanTitle(timeline: Timeline): string {
  return (timeline.title ?? '').replace(/@/g, '').trim() || 'Event';
}

function firstEntityId(timeline: Timeline): string | null {
  return (timeline.entities ?? [])[0]?.entity.id ?? null;
}

function scheduleInput(
  timeline: Timeline,
  requestPermission: boolean,
): { ok: boolean; start: number } {
  const start = new Date(timeline.eventDate).getTime();
  if (!timeline.id || !Number.isFinite(start) || start <= Date.now()) {
    return { ok: false, start };
  }
  return { ok: true, start };
}

// The instant a scheduled notification will fire. Android surfaces its DateTrigger
// as `{ type: 'date', value }`, but the field is named `date` on the JS input side
// and `timestamp` in places, so accept all three rather than assume one shape.
function scheduledTriggerTime(trigger: unknown): number | null {
  if (!trigger || typeof trigger !== 'object') return null;
  const t = trigger as { date?: unknown; value?: unknown; timestamp?: unknown };
  const raw = t.date ?? t.value ?? t.timestamp;
  if (raw === null || raw === undefined) return null;
  const ms =
    raw instanceof Date
      ? raw.getTime()
      : typeof raw === 'string'
        ? Date.parse(raw)
        : Number(raw);
  return Number.isFinite(ms) ? ms : null;
}

// A parked reminder is current only while its event still exists AND the instant
// it was scheduled for is exactly the event's present `eventDate`. An unreadable
// trigger time (`null`) keeps the reminder: the whole point here is to never drop
// a pending reminder on a guess.
function reminderIsCurrent(
  timeline: Timeline | undefined,
  scheduledAt: number | null,
): boolean {
  if (!timeline) return false;
  const current = new Date(timeline.eventDate).getTime();
  if (!Number.isFinite(current)) return false;
  return scheduledAt === null || scheduledAt === current;
}

// Schedules (or reschedules) a single event's notification at its exact
// `eventDate` instant. The stable identifier dedupes: any previous planned
// notification for the same event is cancelled before the new one is parked.
export async function scheduleEventReminder(
  timeline: Timeline,
  requestPermission = true,
): Promise<boolean> {
  const planned = scheduleInput(timeline, requestPermission);
  if (!planned.ok) return false;

  await ensureBaselineSetup();
  if (!(await hasPermission())) {
    if (!requestPermission || !(await ensureNotificationPermission())) return false;
  }

  // A user-initiated schedule is the right moment to ask for exact-alarm access;
  // the login/app-start resync (requestPermission = false) stays silent.
  if (requestPermission) await ensureExactAlarmPermission();

  const title = cleanTitle(timeline);
  const timeText = new Date(planned.start).toLocaleTimeString('en', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const body =
    (timeline.description ?? '').trim() || `Scheduled for ${timeText}.`;

  await Notifications.cancelScheduledNotificationAsync(identifierFor(timeline.id)).catch(
    () => {},
  );
  await Notifications.scheduleNotificationAsync({
    identifier: identifierFor(timeline.id),
    content: {
      title,
      body,
      data: {
        timelineId: timeline.id,
        entityId: firstEntityId(timeline),
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(planned.start),
      channelId: ANDROID_CHANNEL_ID,
    },
  });
  return true;
}

export async function cancelEventReminder(timelineId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifierFor(timelineId)).catch(
    () => {},
  );
}

// Re-parks scheduled event notifications from local DB state WITHOUT dropping a
// still-pending one. `getAllScheduledNotificationsAsync()` only returns
// notifications the OS has not delivered yet, so a reminder still in that list has
// not fired even if its nominal instant has passed — an inexact alarm under Doze
// can be late by an hour or more. Rescheduling from scratch on every app start
// used to cancel exactly those late-but-pending reminders (the "reminder only
// appears after I open the app" report), so a parked reminder is now preserved
// whenever it still matches a live, unchanged event. Only reminders whose event
// was deleted or whose `eventDate` changed are cancelled; every event left without
// a pending reminder is (re)parked. Idempotent across restarts (no duplicates) and
// self-heals after logout/login, permission changes or reboots. It also re-arms
// the exact-alarm prompt (and logs a fixed diagnostic) when it finds a reminder
// that is overdue but still undelivered — the signature of a Doze-deferred alarm.
export async function resyncEventReminders(userId: string): Promise<void> {
  await ensureBaselineSetup();
  if (!(await hasPermission())) return;

  const timelines = await timelinesRepository.getAll(userId);
  const byId = new Map(timelines.map((t) => [t.id, t]));

  // Keep every still-pending reminder that is still valid; cancel the rest.
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const parked = new Set<string>();
  let overduePending = 0;
  for (const request of pending) {
    const identifier = request.identifier ?? '';
    if (!identifier.startsWith(ID_PREFIX)) continue;
    const timelineId = identifier.slice(ID_PREFIX.length);
    const scheduledAt = scheduledTriggerTime(request.trigger);
    if (reminderIsCurrent(byId.get(timelineId), scheduledAt)) {
      parked.add(timelineId);
      // Still pending past its instant = the OS has not delivered it yet, the
      // signature of an inexact alarm deferred by Doze. Re-arm the exact-alarm
      // prompt so the next user-initiated schedule offers the fix.
      if (scheduledAt !== null && scheduledAt <= Date.now() - OVERDUE_GRACE_MS) {
        overduePending += 1;
      }
    } else {
      await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
    }
  }
  if (overduePending > 0) {
    await SecureStore.deleteItemAsync(EXACT_ALARM_PROMPT_KEY).catch(() => {});
    console.warn(
      `[birbal] ${overduePending} event reminder(s) overdue but still undelivered; ` +
        'Alarms & reminders (SCHEDULE_EXACT_ALARM) may be disabled. ' +
        'Re-armed the exact-alarm prompt for the next scheduled reminder.',
    );
  }

  // (Re)park only the events that have no valid pending reminder.
  await Promise.all(
    timelines
      .filter((t) => !parked.has(t.id))
      .map((t) => scheduleEventReminder(t, false).catch(() => false)),
  );
}

export async function clearAllEventReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(
    () => [],
  );
  const owned = scheduled.filter((n) => (n.identifier ?? '').startsWith(ID_PREFIX));
  await Promise.all(
    owned.map((n) =>
      Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}),
    ),
  );
}

// Mirrors a fired event into the in-app Notification Center as an unread EVENT
// entry. INSERT OR IGNORE (stable `evt-<id>`) keeps received + tap handlers from
// ever duplicating the row.
async function recordFired(timelineId: string): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  const timeline = await timelinesRepository.getById(userId, timelineId).catch(() => null);
  if (!timeline) return;

  const title = cleanTitle(timeline);
  const { useNotificationStore } = await import('../store/notificationStore');
  await useNotificationStore.getState().push({
    id: `evt-${timeline.id}`,
    type: 'EVENT',
    title,
    message: `"${title}" is scheduled for today.`,
    icon: '📅',
    timelineId: timeline.id,
    entityId: (timeline.entities ?? [])[0]?.entity.id ?? null,
    createdAt: new Date().toISOString(),
  });
}

// Payload every Birbal notification carries into a tap. Mirrored notifications
// set `type` + `notificationId`; a scheduled event reminder carries `timelineId`.
type NotificationData = {
  type?: AppNotification['type'];
  entityId?: string | null;
  timelineId?: string | null;
  notificationId?: string;
};

// A tap can arrive before the navigator is mounted (cold start), so the route is
// parked here and replayed by the `ready` listener below.
let pendingNav: (() => void) | null = null;

function navigate(fn: () => void): void {
  if (navigationRef.isReady()) fn();
  else pendingNav = fn;
}

function goToDashboard(): void {
  navigate(() =>
    navigationRef.dispatch(
      CommonActions.navigate({ name: 'Main', params: { screen: 'Dashboard' } }),
    ),
  );
}

// Resolves a tapped notification to a real screen. The destination is validated
// first — an SMS is the only target that can go stale, since its message may
// have been reviewed or ignored after the notification was posted — and anything
// unrecognised falls back to the Dashboard rather than doing nothing.
async function routeFromData(data: NotificationData | undefined): Promise<void> {
  if (data?.type === 'SMS') {
    const userId = useAuthStore.getState().user?.id ?? null;
    const smsId = (data.notificationId ?? '').replace(/^sms-/, '');
    const message =
      userId && smsId
        ? await smsMessagesRepository.getById(userId, smsId).catch(() => null)
        : null;
    // A reviewed or ignored message is no longer actionable, so a stale tap
    // lands on the Dashboard instead of reopening a resolved message.
    if (message?.status === 'PENDING') navigate(() => navigationRef.navigate('SmsReview', { smsId }));
    else goToDashboard();
    return;
  }

  if (data?.type === 'TIMELINE') {
    navigate(() => navigationRef.navigate('Timeline'));
    return;
  }
  if (data?.type === 'BIRTHDAY') {
    navigate(() => navigationRef.navigate('Entities'));
    return;
  }
  // A scheduled event reminder carries a timelineId but no `type`.
  if (data?.timelineId) {
    navigate(() => navigationRef.navigate('Calendar'));
    return;
  }
  if (data?.entityId) {
    navigate(() => navigationRef.navigate('Entities'));
    return;
  }
  goToDashboard();
}

async function handleTap(notification: Notifications.Notification): Promise<void> {
  const data = notification.request.content.data as NotificationData | undefined;
  // Only the scheduled reminder produces the bell row it fired; a mirrored
  // notification already owns its bell row, so it must not be recorded again.
  if (notification.request.identifier.startsWith(ID_PREFIX) && data?.timelineId) {
    void recordFired(data.timelineId);
  }
  await routeFromData(data);
}

// Wires the two expo-notifications listeners once. Returns an unsubscribe:
// - received: the notification fired while the app was in the foreground.
// - response: the user tapped the notification (foreground, background or cold
//   start); reflects a fired reminder into the Notification Center and routes.
export function initNotificationListeners(): () => void {
  const readiness = navigationRef.addListener('ready', () => {
    if (pendingNav && navigationRef.isReady()) {
      const fn = pendingNav;
      pendingNav = null;
      fn();
    }
  });

  const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
    if (!notification.request.identifier.startsWith(ID_PREFIX)) return;
    const data = notification.request.content.data as { timelineId?: string } | undefined;
    if (data?.timelineId) void recordFired(data.timelineId);
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      Notifications.clearLastNotificationResponse();
      void handleTap(response.notification);
    },
  );

  return () => {
    readiness();
    receivedSub.remove();
    responseSub.remove();
  };
}

/**
 * Handles the tap that launched the app, which never runs through the response
 * listener. Reads the most recent response once on mount and routes it the same
 * way as a live tap; `navigate()` defers until the navigator is ready.
 */
export async function handleInitialNotificationResponse(): Promise<void> {
  const response = Notifications.getLastNotificationResponse();
  if (!response) return;
  await handleTap(response.notification);
  Notifications.clearLastNotificationResponse();
}