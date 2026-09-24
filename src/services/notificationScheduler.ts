import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as timelinesRepository from '../db/repositories/timelines';
import { navigationRef } from '../navigation/navigationRef';
import type { Timeline } from '../models/types';
import { useAuthStore } from '../store/authStore';

// Real-device local notifications for events. Each event maps 1:1 to a scheduled
// notification with a stable identifier (`birbal-ev-<timelineId>`), so editing an
// event reschedules the same slot and deleting (or app resume) cancels/re-parks
// it without ever stacking duplicates. The trigger is the exact instant stored in
// `eventDate` (local device time), and the manage/launch handlers mirror every
// firing event into the in-app Notification Center.

const ID_PREFIX = 'birbal-ev-';
const ANDROID_CHANNEL_ID = 'birbal-reminders';

// Foreground presentation: notifications must still surface while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channelReady = false;

async function ensureBaselineSetup(): Promise<void> {
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Birbal Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#7C3AED',
  });
  channelReady = true;
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
      sound: 'default',
      data: {
        timelineId: timeline.id,
        entityId: firstEntityId(timeline),
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(planned.start),
    },
  });
  return true;
}

export async function cancelEventReminder(timelineId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifierFor(timelineId)).catch(
    () => {},
  );
}

// Re-parks every scheduled event notification from local DB state, cancelling any
// previously scheduled ones first. Idempotent across app restarts (no duplicates)
// and self-heals after logout/login, permission changes, or device reboots.
export async function resyncEventReminders(userId: string): Promise<void> {
  await ensureBaselineSetup();
  if (!(await hasPermission())) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const stale = scheduled.filter((n) => (n.identifier ?? '').startsWith(ID_PREFIX));
  await Promise.all(
    stale.map((n) =>
      Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {}),
    ),
  );

  const timelines = await timelinesRepository.getAll(userId);
  await Promise.all(
    timelines.map((t) => scheduleEventReminder(t, false).catch(() => false)),
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

let pendingCalendar = false;

function navigateToCalendar(): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Calendar');
  } else {
    pendingCalendar = true;
  }
}

// Wires the two expo-notifications listeners once. Returns an unsubscribe:
// - received: the notification fired while the app was in the foreground.
// - response: the user tapped the notification (from foreground, background or a
//   cold start); reflects the firing into the Notification Center and navigates.
export function initNotificationListeners(): () => void {
  const readiness = navigationRef.addListener('ready', () => {
    if (pendingCalendar && navigationRef.isReady()) {
      pendingCalendar = false;
      navigationRef.navigate('Calendar');
    }
  });

  const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data as { timelineId?: string } | undefined;
    if (data?.timelineId) void recordFired(data.timelineId);
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data as
        | { timelineId?: string }
        | undefined;
      if (data?.timelineId) void recordFired(data.timelineId);
      navigateToCalendar();
    },
  );

  return () => {
    readiness();
    receivedSub.remove();
    responseSub.remove();
  };
}