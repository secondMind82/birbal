// One-time, explain-first request for the SIM SMS permission.
//
// Why this exists: RECEIVE_SMS is a runtime permission, and until it is granted
// Android delivers no SMS_RECEIVED broadcast to the app at all. The permission
// control lives in Settings, so on a fresh install nothing ever told the user it
// was needed — the app simply looked broken. This prompts at the moment the
// expectation is created instead: when the user opens the Notification Center
// expecting messages and finds none.
//
// Privacy posture is unchanged and matches SmsPermissionCard:
//   * nothing is requested on mount, and nothing is captured until granted;
//   * the explanation comes BEFORE the system dialog, so the ask is never a
//     surprise;
//   * only RECEIVE_SMS is requested — no contacts, call log or message history;
//   * a refusal is remembered, so the user is asked once and then left alone;
//     Android's own "never ask again" is honoured by offering Settings instead of
//     a dialog that can no longer appear.
//
// Persisted flags use SecureStore because it is the only key-value store already
// wired into the app, and the values are tiny.

import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type SmsPermissionStatus =
  | 'unsupported'
  | 'granted'
  | 'undetermined'
  | 'denied'
  | 'blocked';

const RECEIVE_SMS = PermissionsAndroid.PERMISSIONS.RECEIVE_SMS;

const REFUSED_KEY = 'sms_permission_refused';
const ASKED_AT_KEY = 'sms_permission_asked_at';

/**
 * How long a "Not now" keeps the app quiet.
 *
 * This was previously permanent, which made the feature look broken rather than
 * declined: one tap on "Not now" meant SMS capture could never be offered again
 * for the life of the install, with nothing on screen saying why the Bell was
 * empty. A cooldown lets the user say "not now" and still be asked later, while
 * still not nagging. A real denial of the SYSTEM dialog is treated as final and
 * remembered separately, because that one is an explicit answer.
 */
const ASK_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/**
 * The current permission state, or 'unsupported' when this build cannot capture
 * SMS at all (iOS/web, or a build made without the native module).
 *
 * `captureSupported` is passed in rather than imported: this module is only
 * about the permission, and pulling the SMS service (and the native module
 * behind it) in would make it untestable and give it a lifecycle it does not own.
 */
export async function getSmsPermissionStatus(captureSupported: boolean): Promise<SmsPermissionStatus> {
  if (Platform.OS !== 'android' || !captureSupported) {
    return 'unsupported';
  }
  try {
    const granted = await PermissionsAndroid.check(RECEIVE_SMS);
    return granted ? 'granted' : 'undetermined';
  } catch {
    return 'unsupported';
  }
}

/** Clears the remembered refusal so the user can be asked again (Settings flow). */
export async function resetSmsPermissionAsk(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(REFUSED_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(ASKED_AT_KEY).catch(() => {}),
  ]);
}

async function readFlag(key: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(key)) === '1';
  } catch {
    return false;
  }
}

async function writeFlag(key: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, '1');
  } catch {
    /* a failed flag write only means we may ask once more later */
  }
}

async function writeAskedAt(): Promise<void> {
  try {
    await SecureStore.setItemAsync(ASKED_AT_KEY, String(Date.now()));
  } catch {
    /* no timestamp just means the cooldown cannot be honoured this once */
  }
}

/** True while a recent "Not now" is still cooling down. */
async function withinCooldown(): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(ASKED_AT_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < ASK_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/**
 * Offers the permission once, at a moment the user has just expressed the
 * expectation that they would receive messages.
 *
 * Resolves true when the permission is granted by the end of the call, so the
 * caller can immediately drain anything the native queue collected while the
 * dialog was up. Silent no-op when already granted, unsupported, or already
 * refused.
 */
export async function offerSmsCapture(captureSupported: boolean): Promise<boolean> {
  const status = await getSmsPermissionStatus(captureSupported);

  if (status === 'unsupported' || status === 'granted') {
    return status === 'granted';
  }

  // Turned the system permission down: that is a real answer, so it is final
  // and the ask stays silent. Settings remains the way back.
  if (await readFlag(REFUSED_KEY)) {
    return false;
  }
  // A recent "Not now": quiet for now, not forever.
  if (await withinCooldown()) {
    return false;
  }

  const outcome = await new Promise<'granted' | 'denied' | 'blocked' | 'dismissed'>(
    (resolve) => {
      Alert.alert(
        'Turn on message capture?',
        'Birbal can read incoming SIM messages so a bank alert or a message from a friend becomes an expense, money you are owed, or a timeline event — without you typing it in.\n\nMessages stay on this device, are never uploaded, and every one waits for you to review it. Your contacts and call log are never accessed.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve('dismissed') },
          { text: 'Continue', onPress: () => resolve('granted') },
        ],
        { cancelable: true, onDismiss: () => resolve('dismissed') },
      );
    },
  );

  if (outcome === 'dismissed') {
    // "Not now" is a soft no: start the cooldown so the next bell tap is quiet,
    // but leave the door open. A Settings visit clears it outright.
    await writeAskedAt();
    return false;
  }

  let result: 'granted' | 'denied' | 'blocked';
  try {
    const request = await PermissionsAndroid.request(RECEIVE_SMS);
    result =
      request === 'granted' ? 'granted' : request === 'never_ask_again' ? 'blocked' : 'denied';
  } catch {
    result = 'denied';
  }

  if (result === 'granted') {
    await resetSmsPermissionAsk();
    return true;
  }

  // The system dialog was declined outright, so remember it as final.
  await writeFlag(REFUSED_KEY);

  if (result === 'blocked') {
    // Android will not show the dialog again, so Settings is the only route left.
    Alert.alert(
      'Turn on message capture in Android settings',
      'Android will not ask again, so it has to be re-enabled in the system settings.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void Linking.openSettings() },
      ],
    );
  }

  return false;
}
