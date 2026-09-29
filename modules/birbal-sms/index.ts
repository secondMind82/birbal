import { NativeModule, requireNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

/**
 * JS surface of the local `birbal-sms` native module.
 *
 * The native side persists every captured SMS to a private file the moment the
 * broadcast arrives, so this module only ever has to drain that queue. That is
 * what makes background capture work: if the app was killed when the SMS landed,
 * the message is still waiting on the next start.
 *
 * Every call is defensive. The module does not exist on iOS/web, and a device
 * can also be missing telephony entirely, so `smsCaptureAvailable()` is the
 * supported way to ask and `drainSmsInbox()` degrades to an empty list.
 */

export interface CapturedSms {
  /** Stable SHA-256 identity of the message; identical for redeliveries. */
  id: string;
  sender: string;
  body: string;
  /** Epoch milliseconds reported by the telephony stack. */
  receivedAt: number;
}

type BirbalSmsNativeModule = {
  isAvailable(): Promise<boolean>;
  drain(): Promise<CapturedSms[]>;
  pendingCount(): Promise<number>;
} & NativeModule;

/** Since SDK 52 the native module object is itself an event emitter. */
type BirbalSmsEventModule = BirbalSmsNativeModule & {
  addListener(eventName: 'onSmsReceived', listener: () => void): EventSubscription;
};

const NO_SUBSCRIPTION: EventSubscription = { remove() {} };

let cached: BirbalSmsNativeModule | null | undefined;

function native(): BirbalSmsNativeModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireNativeModule<BirbalSmsNativeModule>('BirbalSms');
  } catch {
    // No native module on this platform (iOS, web, or a build made before the
    // module was added). SMS capture is simply unavailable.
    cached = null;
  }
  return cached;
}

/** True when this build can capture SIM SMS at all. */
export function smsCaptureAvailable(): boolean {
  return native() !== null;
}

/**
 * Returns every SMS captured since the last drain and clears the native queue.
 * Returns an empty list on any platform or failure — callers must never have to
 * special-case a missing module.
 */
export async function drainSmsInbox(): Promise<CapturedSms[]> {
  const module = native();
  if (!module) return [];
  try {
    const items = await module.drain();
    if (!Array.isArray(items)) return [];
    return items.filter(
      (item): item is CapturedSms =>
        !!item && typeof item.id === 'string' && typeof item.body === 'string',
    );
  } catch {
    return [];
  }
}

/** How many messages the native queue is holding, without consuming them. */
export async function pendingSmsCount(): Promise<number> {
  const module = native();
  if (!module) return 0;
  try {
    const count = await module.pendingCount();
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Best-effort signal that the native queue changed. The receiver cannot assume a
 * JS runtime exists, so this event is only a fast path for an already-open app;
 * `drainSmsInbox()` on start/foreground remains the source of truth.
 *
 * Always returns a subscription so callers can unconditionally `remove()`.
 */
export function addSmsReceivedListener(listener: () => void): EventSubscription {
  const module = native() as BirbalSmsEventModule | null;
  if (!module) return NO_SUBSCRIPTION;
  try {
    return module.addListener('onSmsReceived', listener) ?? NO_SUBSCRIPTION;
  } catch {
    return NO_SUBSCRIPTION;
  }
}
