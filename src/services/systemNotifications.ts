import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { NotificationInput } from '../db/repositories/notifications';

/**
 * The Android system-notification mirror.
 *
 * The in-app Bell and the Android shade are two views of the same event. This
 * module is the only bridge between them: it takes the bell rows a caller has
 * just written and posts each one to the shade as a real local notification, so
 * a message or birthday is visible without opening the app.
 *
 * It deliberately does NOT decide *which* rows are new — that is the caller's
 * job via `insertNew`, whose INSERT OR IGNORE is the single source of dedupe.
 * Posting is keyed by the bell row id both in the identifier (Android replaces a
 * notification posted twice under the same identifier) and in the tap payload,
 * so a row can surface at most once and a tap always resolves to its origin.
 *
 * Scope: only the bell types that never reach the shade on their own. EVENT and
 * REMINDER are already delivered by the scheduled event reminder
 * (`scheduleEventReminder`), so mirroring them here would stack a second
 * notification for the same event.
 */

// Single Android channel for every Birbal system notification. The id is kept
// stable so a channel the user already configured keeps its settings, while the
// name/description describe what actually lands here now.
export const ANDROID_CHANNEL_ID = 'birbal-reminders';
const CHANNEL_NAME = 'Birbal';
const CHANNEL_DESCRIPTION = 'Reminders, messages and updates from Birbal.';

// Notification identifiers are namespaced so a tap handler can tell a mirrored
// notification apart from a scheduled event reminder.
export const SYSTEM_ID_PREFIX = 'birbal-sys-';

const MIRRORED_TYPES: ReadonlySet<NotificationInput['type']> = new Set([
  'BIRTHDAY',
  'TIMELINE',
  'SMS',
  'SYSTEM',
]);

let channelReady = false;

/**
 * Creates/updates the single Android channel. Idempotent; a no-op off Android.
 *
 * Called before both permission requests and any post, because on Android 13+
 * the OS only shows the notification-permission prompt once a channel exists.
 */
export async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: CHANNEL_NAME,
    description: CHANNEL_DESCRIPTION,
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#7C3AED',
    // No `sound`: a channel sound is a bundled raw-resource filename, and
    // expo-notifications logs "Custom sound 'default' not found" when the
    // `sound` option does not exist as a resource. Omitting it makes Android
    // fall back to the system default notification sound (Settings.System
    // .DEFAULT_NOTIFICATION_URI) — the same audible behaviour, without the log.
  });
  channelReady = true;
}

async function ensurePermission(): Promise<boolean> {
  await ensureNotificationChannel();
  const perms = await Notifications.getPermissionsAsync();
  if (perms.granted) return true;
  // Once the user has denied for good, asking again does nothing but spin; the
  // Bell keeps working regardless.
  if (!perms.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

function identifierFor(id: string): string {
  return `${SYSTEM_ID_PREFIX}${id}`;
}

/**
 * Mirrors the given *newly-inserted* bell rows to the Android shade.
 *
 * Android keys a notification by its identifier, so if this is ever reached
 * twice for the same row the second post replaces the first instead of stacking.
 * No-op on iOS and when permission is denied, so the in-app Bell behaves exactly
 * as before on every platform.
 */
export async function presentSystemNotifications(
  inputs: NotificationInput[],
): Promise<void> {
  if (Platform.OS !== 'android') return;
  const eligible = inputs.filter((n) => MIRRORED_TYPES.has(n.type));
  if (eligible.length === 0) return;

  // Best-effort by design: a build or device where notifications are
  // unavailable must never break the flow that raised the notification (SMS
  // ingest, bell refresh). The in-app Bell remains the source of truth.
  try {
    if (!(await ensurePermission())) return;
    await Promise.all(
      eligible.map((n) =>
        Notifications.scheduleNotificationAsync({
          identifier: identifierFor(n.id),
          content: {
            title: n.title,
            body: n.message ?? undefined,
            // Carried through the tap so the listener can resolve exactly this row.
            data: {
              notificationId: n.id,
              type: n.type,
              entityId: n.entityId ?? null,
              timelineId: n.timelineId ?? null,
            },
          },
          // A channel-aware trigger with no schedule presents immediately on the
          // given Android channel.
          trigger: { channelId: ANDROID_CHANNEL_ID },
        }).catch(() => ''),
      ),
    );
  } catch {
    // Swallowed on purpose; see above.
  }
}
