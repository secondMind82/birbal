// Verification suite for the SMS permission prompt.
//
// Run with:  npm run verify:money
//
// RECEIVE_SMS is a runtime permission: until it is granted, Android delivers no
// SMS_RECEIVED broadcast to the app, so a build that never asks looks silently
// broken. These tests pin the behaviour that fixes that without becoming
// intrusive or overreaching:
//
//   * nothing is requested when capture is unsupported or already granted;
//   * the explanation comes BEFORE the system dialog, and the dialog is shown;
//   * a refusal is remembered, so the bell does not nag on every open;
//   * Android's "never ask again" routes to Settings instead of a dead dialog;
//   * granting clears the remembered refusal and reports success, so the caller
//     drains anything the receiver captured while the dialog was up;
//   * only RECEIVE_SMS is ever requested.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { nativeControls, installExpoSqliteShim } from './real-sqlite';

installExpoSqliteShim();

beforeEach(() => {
  nativeControls.reset();
});

// The prompt asks smsService whether this build can capture at all, which resolves
// the stubbed native module. real-sqlite.ts redirects 'expo-modules-core' to a
// compiled stub whose availability is driven by nativeControls, so flipping that
// flag is all it takes to model a build with (or without) the native module.
async function loadPrompt(captureSupported: boolean) {
  // The prompt takes capture support as an argument, so modelling "this build has
  // no native module" is a plain boolean rather than a module-graph trick.
  return { prompt: await import('../src/services/smsPermission'), captureSupported };
}

test('already granted: no dialog, reports success so the caller can drain', async () => {
  const { prompt, captureSupported } = await loadPrompt(true);
  nativeControls.smsGranted = true;

  const granted = await prompt.offerSmsCapture(captureSupported);

  assert.equal(granted, true, 'caller is told it may drain');
  assert.equal(nativeControls.alerts.length, 0, 'no needless dialog when already granted');
});

test('unsupported build: silent no-op, never nags the user', async () => {
  const { prompt, captureSupported } = await loadPrompt(false);

  const granted = await prompt.offerSmsCapture(captureSupported);

  assert.equal(granted, false);
  assert.equal(
    nativeControls.alerts.length,
    0,
    'a build without the native module must not ask for a permission it cannot use',
  );
});

test('iOS: silent no-op', async () => {
  const { prompt, captureSupported } = await loadPrompt(true);
  nativeControls.platform = 'ios';

  assert.equal(await prompt.offerSmsCapture(captureSupported), false);
  assert.equal(nativeControls.alerts.length, 0);
});

test('first open: explains BEFORE the system dialog, then requests', async () => {
  const { prompt, captureSupported } = await loadPrompt(true);
  nativeControls.smsGranted = false;
  nativeControls.alertAnswer = 'continue';

  const granted = await prompt.offerSmsCapture(captureSupported);

  assert.equal(granted, true);
  assert.equal(nativeControls.alerts.length, 1, 'exactly one explanation');
  const copy = nativeControls.alerts[0];
  assert.match(copy.title, /message capture/i);
  assert.ok(copy.message, 'the explanation must carry the why');
  // The privacy promise has to be in the pre-dialog copy, not after the fact.
  assert.match(copy.message ?? '', /never uploaded/i);
  assert.match(copy.message ?? '', /stay on this device/i);
  assert.match(copy.message ?? '', /review/i);
  assert.match(copy.message ?? '', /contacts and call log are never accessed/i);
  assert.equal(nativeControls.smsGranted, true, 'the grant was actually applied');
});

test('a refusal is remembered, so the bell does not nag again', async () => {
  const { prompt, captureSupported } = await loadPrompt(true);
  nativeControls.smsGranted = false;
  nativeControls.alertAnswer = 'cancel';
  nativeControls.smsRequestResult = 'denied';

  assert.equal(await prompt.offerSmsCapture(captureSupported), false, 'declined');
  assert.equal(nativeControls.alerts.length, 1);

  // Every later bell tap must stay quiet.
  assert.equal(await prompt.offerSmsCapture(captureSupported), false);
  assert.equal(await prompt.offerSmsCapture(captureSupported), false);
  assert.equal(nativeControls.alerts.length, 1, 'asked once, then left alone');
});

test('never_ask_again routes to Settings instead of a dialog that cannot appear', async () => {
  const { prompt, captureSupported } = await loadPrompt(true);
  nativeControls.smsGranted = false;
  nativeControls.alertAnswer = 'continue';
  nativeControls.smsRequestResult = 'never_ask_again';

  assert.equal(await prompt.offerSmsCapture(captureSupported), false);
  assert.equal(nativeControls.smsGranted, false);
  assert.equal(nativeControls.alerts.length, 2, 'the explanation, then the settings notice');
  assert.match(nativeControls.alerts[1].title, /android settings/i);
  assert.ok(
    nativeControls.alerts[1].message?.includes('will not ask again'),
    'says why the dialog is gone',
  );
});

test('granting clears a remembered refusal so Settings stays a way back in', async () => {
  const { prompt, captureSupported } = await loadPrompt(true);

  nativeControls.alertAnswer = 'cancel';
  nativeControls.smsRequestResult = 'denied';
  assert.equal(await prompt.offerSmsCapture(captureSupported), false);
  assert.equal(nativeControls.alerts.length, 1);

  // Settings resets the flag, then the user grants there.
  await prompt.resetSmsPermissionAsk();
  nativeControls.smsGranted = false;
  nativeControls.alertAnswer = 'continue';
  nativeControls.smsRequestResult = 'granted';
  assert.equal(await prompt.offerSmsCapture(captureSupported), true);
  assert.equal(nativeControls.alerts.length, 2, 'asked again after the explicit reset');
});

test('only RECEIVE_SMS is requested, never READ_SMS or anything else', async () => {
  const { prompt, captureSupported } = await loadPrompt(true);
  nativeControls.smsGranted = false;
  nativeControls.alertAnswer = 'continue';
  nativeControls.smsRequestResult = 'denied';

  await prompt.offerSmsCapture(captureSupported);

  assert.deepEqual(
    nativeControls.permissionRequests,
    ['android.permission.RECEIVE_SMS'],
    'capture is broadcast-only: message history is never read',
  );
  assert.ok(
    !nativeControls.permissionRequests.some((p) => p.includes('READ_SMS')),
    'READ_SMS must never be requested',
  );
});
