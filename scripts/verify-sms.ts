// Verification for the SIM SMS capture workflow.
//
// Scope: everything in this feature that can be proven without a device. That is
// the classifier, the privacy helpers, entity resolution, and the structural
// guarantees that make the feature safe — dedupe, provenance, and the promise
// that a message body never leaves the device.
//
// The native receiver and the real permission dialog are exercised on a device
// (see the run notes); nothing here pretends to cover them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { classifySms, extractSmsMoney, isBulkSender, maskOtp, smsPreview } from '../src/utils/smsFilter';
import { findEntityByName } from '../src/utils/entityLookup';
import { BACKUP_TABLES } from '../src/db/backupTables';
import type { Entity } from '../src/models/types';

const ROOT = process.env.BIRBAL_ROOT ?? resolve(__dirname, '../../..');

// ─── Classification ─────────────────────────────────────────────────────────

test('bank transaction alerts classify as financial', () => {
  const samples = [
    'Your a/c XX1234 has been debited by Rs. 1,250.00 on 12-03-2026. Avl bal Rs. 4,300.50',
    'Rs 5000 credited to your HDFC account via UPI. Ref 1234567890',
    'Your payment of ₹999.00 was successful. Thank you.',
    '₹250 refunded to your wallet',
  ];
  for (const body of samples) {
    assert.equal(classifySms('HDFC', body).kind, 'financial', body);
  }
});

test('one-time passwords classify as otp and take priority over money words', () => {
  const otp = classifySms('AMAZON', 'Your OTP is 482913. Do not share with anyone.');
  assert.equal(otp.kind, 'otp');

  // A bank OTP mentions the brand and can look financial; the secret wins.
  const bankOtp = classifySms('HDFCCB', '123456 is your one time password for the card ending 4421');
  assert.equal(bankOtp.kind, 'otp');

  // A bare short code with no money wording is still an OTP.
  const bare = classifySms('VK12345', '482913');
  assert.equal(bare.kind, 'otp');
});

test('ordinary messages are not financial', () => {
  const samples = [
    'Hey are we still on for tomorrow?',
    'Running 10 mins late, start without me',
    'Your OTP is 482913', // otp, checked separately
  ];
  assert.equal(classifySms('A friend', samples[0]).kind, 'other');
  assert.equal(classifySms('A friend', samples[1]).kind, 'other');
});

test('a date or a long message is not mistaken for a bare code', () => {
  const longWithNumber = `Meeting moved to 2026-04-02 at 15:30, agenda item 4 covers the budget. ` +
    `Please read the deck before then and bring the updated numbers for the forecast.`;
  assert.notEqual(classifySms('Someone', longWithNumber).kind, 'otp');
});

test('classification explains itself', () => {
  const result = classifySms('HDFC', 'Rs. 100 debited from your account');
  assert.equal(result.kind, 'financial');
  assert.ok(result.reason.length > 0, 'a reason is shown in the review screen');
});

// ─── Privacy ────────────────────────────────────────────────────────────────

test('otp previews are masked and never contain the code', () => {
  const body = 'Your OTP is 482913. Do not share with anyone.';
  const preview = smsPreview(body, true);
  assert.ok(!preview.includes('482913'), 'the secret leaked into the preview');
  assert.ok(preview.includes('•'));

  const masked = maskOtp('482913');
  assert.ok(!masked.includes('4829'));
  assert.equal(masked.length, 6);
});

test('otp bodies are very short, all-masked', () => {
  assert.equal(maskOtp('482'), '•••');
  assert.equal(maskOtp('12'), '••');
});

test('non-otp previews are readable and truncated', () => {
  const long = 'a'.repeat(200);
  const preview = smsPreview(long, false);
  assert.ok(preview.length <= 120);
  assert.ok(preview.endsWith('...'));
  assert.equal(smsPreview('short message', false), 'short message');
});

test('whitespace is collapsed so a preview is one line', () => {
  assert.equal(smsPreview('a\n\n  b\tc', false), 'a b c');
});

// ─── Bank-alert money parsing ───────────────────────────────────────────────

test('a debit SMS becomes an expense with the exact paise amount', () => {
  const m = extractSmsMoney('Your a/c XX1234 has been debited by Rs. 1250.00 on 12-03-2026. Avl bal Rs. 4300.50');
  assert.deepEqual(m, { role: 'expense', amountPaise: 125000 });
});

test('a credit SMS becomes a receivable', () => {
  const m = extractSmsMoney('Rs 5000 credited to your HDFC account via UPI. Ref 1234567890');
  assert.deepEqual(m, { role: 'receive', amountPaise: 500000 });
});

test('INR and ₹ amounts both parse', () => {
  assert.deepEqual(extractSmsMoney('INR 2,345.67 charged on card 4421'), { role: 'expense', amountPaise: 234567 });
  assert.deepEqual(extractSmsMoney('₹250 refunded to your wallet'), { role: 'receive', amountPaise: 25000 });
});

test('the money someone is asked for on the review screen still counts', () => {
  // The documented flow is: Bell -> Edit -> "@Shaaf give me amount ₹5000" -> Save.
  // "give me" is how people ask for money they are owed, so it must produce a
  // receivable rather than silently dropping the amount.
  assert.deepEqual(extractSmsMoney('@Shaaf give me amount ₹5000'), { role: 'receive', amountPaise: 500000 });
  assert.deepEqual(extractSmsMoney('Aman owes me ₹3,000'), { role: 'receive', amountPaise: 300000 });
  // Two things must stay conservative, or the Timeline fills with fake money:
  // a bare number with no currency marker, and an amount with no direction.
  assert.equal(extractSmsMoney('give me 2000'), null);
  assert.equal(extractSmsMoney('@Rohan grocery ₹999'), null);
});

test('the balance sentence does not override the primary action direction', () => {
  const m = extractSmsMoney('Paid Rs 999.00 to SHAFT. Available balance Rs 7000.00');
  assert.deepEqual(m, { role: 'expense', amountPaise: 99900 });
});

test('a diary edit without a currency indicator has no bank money', () => {
  assert.equal(extractSmsMoney('@Ali I will credit 7000'), null);
  assert.equal(extractSmsMoney('I bought a monitor for 20000'), null);
  assert.equal(extractSmsMoney('no numbers here'), null);
});

// ─── Sender handling ────────────────────────────────────────────────────────

test('bulk senders are recognised so no fake person is created', () => {
  assert.equal(isBulkSender('VM-HDFCB'), true);
  assert.equal(isBulkSender('VK12345'), true);
  assert.equal(isBulkSender('AD-LOGIN'), true);
  assert.equal(isBulkSender('NO-REPLY'), true);
  assert.equal(isBulkSender('HDFC-BANK-2'), true);
});

test('real numbers and named senders are not treated as bulk', () => {
  assert.equal(isBulkSender('+919876543210'), false);
  assert.equal(isBulkSender('9876543210'), false);
  assert.equal(isBulkSender('Shaaf'), false);
  // A short all-caps name is a person, not a shortcode: a person's initials
  // look exactly like a bank sender id and guessing wrong here would silently
  // drop someone the user actually knows.
  assert.equal(isBulkSender('ALI'), false);
  assert.equal(isBulkSender('Mom'), false);
});

test('an empty sender is treated as bulk (never a person)', () => {
  assert.equal(isBulkSender('   '), true);
});

// ─── Entity resolution ──────────────────────────────────────────────────────

function entity(name: string, id = `e-${name}`): Entity {
  return { id, name, type: 'PERSON' };
}

test('entity lookup ignores case and surrounding punctuation', () => {
  const entities = [entity('Alice')];
  // Same matching the Dashboard composer uses.
  assert.equal(findEntityByName('alice', entities)?.id, 'e-Alice');
  assert.equal(findEntityByName('@Alice.', entities)?.id, 'e-Alice');
  assert.equal(findEntityByName('  Ali ce ', entities), undefined);
});

test('entity lookup prefers an exact match over a substring', () => {
  const entities = [entity('Ali'), entity('Alina')];
  assert.equal(findEntityByName('Ali', entities)?.id, 'e-Ali');
});

test('entity lookup returns nothing for an unknown person', () => {
  assert.equal(findEntityByName('Nobody', [entity('Ali')]), undefined);
  assert.equal(findEntityByName('', [entity('Ali')]), undefined);
});

// ─── Structural guarantees ──────────────────────────────────────────────────

test('raw message bodies are never part of a backup', async () => {
  const keys = BACKUP_TABLES.map((s) => s.key);
  assert.ok(!keys.includes('sms_messages'), 'the SMS inbox must stay off the cloud');
});

test('the sms table and the provenance columns exist in the schema', async () => {
  const sql = await readFile(resolve(ROOT, 'src/db/schema.ts'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS sms_messages/);
  assert.match(sql, /ALTER TABLE timelines ADD COLUMN source TEXT/);
  assert.match(sql, /ALTER TABLE timelines ADD COLUMN source_notification_id TEXT/);
  assert.match(sql, /ALTER TABLE entities ADD COLUMN source_notification_id TEXT/);
});

test('the registry marks the post-v2 columns optional so old backups stay valid', async () => {
  const timelines = BACKUP_TABLES.find((s) => s.key === 'timelines');
  const entities = BACKUP_TABLES.find((s) => s.key === 'entities');
  assert.deepEqual([...(timelines?.optionalColumns ?? [])].sort(), [
    'source',
    'source_notification_id',
  ]);
  assert.deepEqual([...(entities?.optionalColumns ?? [])], ['source_notification_id']);
  // Optional columns are still read and written, just not demanded of a row.
  assert.ok(timelines?.columns.includes('source'));
  assert.ok(entities?.columns.includes('source_notification_id'));
});

test('the receiver asks for the SMS permission and nothing else', async () => {
  const manifest = await readFile(
    resolve(ROOT, 'modules/birbal-sms/android/src/main/AndroidManifest.xml'),
    'utf8',
  );
  const permissions = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(permissions, ['android.permission.RECEIVE_SMS']);
  // The history/contacts permissions that would be a privacy problem. Matched
  // as a permission attribute so the explanatory comment above is not a false
  // positive.
  assert.ok(!/android:name="android\.permission\.READ_(SMS|CONTACTS|CALL_LOG)"/.test(manifest));
  assert.match(manifest, /android\.provider\.Telephony\.SMS_RECEIVED/);
  // Only the telephony system may deliver the broadcast.
  assert.match(manifest, /android:permission="android\.permission\.BROADCAST_SMS"/);
});

test('no SMS body can reach the network layer', async () => {
  const service = await readFile(resolve(ROOT, 'src/services/smsService.ts'), 'utf8');
  // The only api.* call in the service is a timeline/entity write; the service
  // must never hand a message body to the client.
  const apiCalls = [...service.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(apiCalls, [], 'smsService talks to the API only via the domain services');
  assert.ok(!/\bsendSms|uploadSms|postSms/.test(service));
});

test('the native queue never logs message content', async () => {
  const store = await readFile(
    resolve(ROOT, 'modules/birbal-sms/android/src/main/java/com/secondbrain/birbalsms/SmsInboxStore.kt'),
    'utf8',
  );
  assert.ok(!/Log\.[vdiew]\(/.test(store), 'no logcat writes in the SMS path');
});
