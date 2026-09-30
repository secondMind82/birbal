// A stand-in for `expo-modules-core` so the local birbal-sms JS surface can be
// loaded outside a React Native runtime.
//
// The real package resolves to untranspiled TypeScript inside node_modules, which
// Node refuses to type-strip, so requiring it in a test would fail before any
// assertion ran. real-sqlite.ts redirects resolution of 'expo-modules-core' here,
// and the behaviour is driven by nativeControls.smsCaptureSupported.

export const captured = {
  drained: 0,
  acked: 0,
};

/**
 * A stand-in for the Kotlin inbox, with the same peek/ack contract as
 * SmsInboxStore: `drain` never clears anything, and only `ack` removes ids.
 *
 * Tests seed it with the messages a real receiver would have written, so the JS
 * half of the pipeline can be exercised for real. This is still NOT proof that a
 * SIM message is captured — that is the Kotlin receiver, and it can only be proven
 * on a physical phone.
 */
interface StubInboxMessage {
  id: string;
  sender: string;
  body: string;
  receivedAt: number;
}

function inbox(): StubInboxMessage[] {
  const controls = (
    globalThis as { __birbalNativeControls?: { smsInbox: StubInboxMessage[] } }
  ).__birbalNativeControls;
  return controls?.smsInbox ?? [];
}

/** Mirrors NativeModule closely enough for shape checks. */
export class NativeModule {}

export interface EventSubscription {
  remove(): void;
}

export function requireNativeModule<T>(name: string): T {
  // Support is toggled through the shared controls; smsCaptureAvailable() reads it
  // lazily so a test can flip it before/after the module is first required.
  const controls = (globalThis as { __birbalNativeControls?: { smsCaptureSupported: boolean } })
    .__birbalNativeControls;
  if (!controls?.smsCaptureSupported) {
    // Exactly what the real runtime throws for a missing module; the app treats
    // this as "this build cannot capture SMS".
    throw new Error(`Cannot find native module '${name}'`);
  }
  return {
    isAvailable: async () => true,
    drain: async () => {
      captured.drained += 1;
      return inbox().map((m) => ({ ...m }));
    },
    ack: async (ids: string[]) => {
      captured.acked += ids.length;
      const set = new Set(ids);
      const queue = inbox();
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (set.has(queue[i].id)) queue.splice(i, 1);
      }
    },
    pendingCount: async () => inbox().length,
    addListener: () => ({ remove: () => {} }),
  } as unknown as T;
}
