import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { addSmsReceivedListener } from '../../modules/birbal-sms';
import * as smsService from '../services/smsService';
import { useNotificationStore } from '../store/notificationStore';

/** How often a foregrounded app checks for messages captured while it was open. */
const FOREGROUND_POLL_MS = 20_000;

/**
 * Keeps the SMS inbox drained while the app runs.
 *
 * The native receiver is the source of truth and persists every message before
 * JS exists, so this hook only has to hand that queue over. It runs at three
 * points, and each one is a case where messages can be waiting:
 *
 *   - when a user signs in (messages that arrived before sign-in are attributed
 *     to the account that is now active),
 *   - whenever the app comes back to the foreground,
 *   - on a slow timer while it is already in front, so a message that arrives
 *     while the app is open still shows up without the user switching away.
 *
 * Draining is safe to repeat: the native queue is consumed once and the local
 * table is keyed by the message identity, so no notification is ever duplicated.
 */
export function useSmsIngest(userId: string | null | undefined): void {
  const refreshNotifications = useNotificationStore((s) => s.refresh);
  const ingesting = useRef(false);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    const drain = async () => {
      // Guards against overlapping drains (foreground event + timer + sign-in).
      if (ingesting.current || cancelled) return;
      ingesting.current = true;
      try {
        const result = await smsService.ingestCapturedSms(userId);
        if (!cancelled && result.added > 0) {
          await refreshNotifications();
        }
      } catch {
        // Capture is a convenience: a failure here must never break the app.
      } finally {
        ingesting.current = false;
      }
    };

    void drain();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void drain();
    });

    // Fast path for an already-running app; the queue drain above is still the
    // source of truth, so a missed event costs nothing.
    const listener = addSmsReceivedListener(() => void drain());
    const timer = setInterval(() => void drain(), FOREGROUND_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
      listener.remove();
    };
  }, [userId, refreshNotifications]);
}
