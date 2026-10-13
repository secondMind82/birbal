// Verification suite for natural-language event time parsing.
//
// Run with:  npm run verify:dates
//
// Device report: an event typed as "khalid I have meeting today 1 52 pm" showed
// up on the Entity timeline as "Oct 14, 2026, 4:00 AM" — two days after "today".
//
// Root cause: `extractEventDate` matched the time with
//   /(\d{1,2})(:(\d{2}))?\s*(am|pm)/i
// which requires the minutes to be colon-joined. On "1 52 pm" it skipped the
// "1" (no colon, next token is "52", not am/pm) and matched "52 pm" instead:
// hour = 52, minute = 0, and since 52 is neither < 12 nor === 12 the code left it
// as-is. `setHours(52, 0, 0, 0)` then rolled the Date forward two days to 04:00.
//
// The fix accepts a space-separated minute pair ("1 52 pm" = 1:52 PM) and rejects
// impossible clock values so no number can ever overflow the Date again. These
// tests pin both the parse and the rendered "Time" detail.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import './stubs/preload';

import { extractEventDate, parseActivity, parseClockTime } from '../src/utils/activityParser';
import { classifyCreditDueDate, extractCreditDueDate } from '../src/utils/creditDueDate';

test('a promised repayment date is extracted as a local date and attached to the credit', () => {
  const now = new Date(2026, 9, 1, 12);
  const text = 'Shaaf will return my ₹50,000 on 15 October 2026.';
  assert.equal(extractCreditDueDate(text, now), '2026-10-15');
  const parsed = parseActivity(text);
  assert.equal(parsed.money?.role, 'receive');
  assert.equal(parsed.money?.status, 'pending');
  assert.equal(parsed.money?.amountPaise, 5_000_000);
  assert.equal(parsed.money?.dueDate, '2026-10-15');
});

test('bare amount in a give-me repayment promise parses its explicit due date', () => {
  const now = new Date(2026, 9, 1, 12);
  const parsed = parseActivity('Ahmed Bhai will give me 2000 on 15 October 2026');
  assert.equal(parsed.money?.role, 'receive');
  assert.equal(parsed.money?.amountPaise, 200_000);
  assert.equal(parsed.money?.status, 'pending');
  assert.equal(parsed.money?.dueDate, '2026-10-15');
  assert.equal(classifyCreditDueDate(parsed.money?.dueDate, now), 'Upcoming');
});

test('a transaction date alone is not mistaken for a repayment due date', () => {
  assert.equal(
    extractCreditDueDate('I lent Shaaf ₹50,000 on 15 October 2026.', new Date(2026, 9, 1)),
    null,
  );
});

test('credit due dates classify as overdue, today, upcoming, or absent by local day', () => {
  const now = new Date(2026, 9, 15, 16);
  assert.equal(classifyCreditDueDate('2026-10-14', now), 'Overdue');
  assert.equal(classifyCreditDueDate('2026-10-15', now), 'Due Today');
  assert.equal(classifyCreditDueDate('2026-10-16', now), 'Upcoming');
  assert.equal(classifyCreditDueDate(null, now), 'No Due Date');
});

test('parseClockTime reads a space-separated minute pair as hours:minutes', () => {
  assert.deepEqual(parseClockTime('1 52 pm'), { hour24: 13, minute: 52, raw: '1 52 pm' });
});

test('parseClockTime still reads colon- and dot-joined times', () => {
  assert.deepEqual(parseClockTime('3:30 pm'), { hour24: 15, minute: 30, raw: '3:30 pm' });
  assert.deepEqual(parseClockTime('9.05am'), { hour24: 9, minute: 5, raw: '9.05am' });
});

test('parseClockTime rejects impossible clock values instead of overflowing', () => {
  assert.equal(parseClockTime('52 pm'), null, "a bare '52 pm' is not a clock time");
  assert.equal(parseClockTime('1 99 pm'), null, 'minutes above 59 are rejected');
  assert.equal(parseClockTime('0 am'), null, 'hour 0 is invalid with an am/pm marker');
});

test('parseClockTime maps the 12 o\'clock boundaries correctly', () => {
  assert.equal(parseClockTime('12 am')?.hour24, 0);
  assert.equal(parseClockTime('12 pm')?.hour24, 12);
});

test('extractEventDate keeps "today 1 52 pm" on today, at 13:52', () => {
  const now = new Date();
  const result = extractEventDate('khalid I have meeting today 1 52 pm');
  assert.equal(result.getFullYear(), now.getFullYear());
  assert.equal(result.getMonth(), now.getMonth());
  assert.equal(result.getDate(), now.getDate(), 'must not roll forward to another day');
  assert.equal(result.getHours(), 13);
  assert.equal(result.getMinutes(), 52);
  assert.equal(result.getSeconds(), 0);
});

test('extractEventDate does not overflow when the time is malformed', () => {
  const now = new Date();
  const result = extractEventDate('meeting today 52 pm');
  assert.equal(result.getDate(), now.getDate(), 'a bogus time must not shift the day');
  assert.equal(result.getHours(), now.getHours(), 'no time is applied when none is valid');
});

test('extractEventDate applies a valid colon time', () => {
  const result = extractEventDate('dinner today 8:15 pm');
  assert.equal(result.getHours(), 20);
  assert.equal(result.getMinutes(), 15);
});

test('extractEventDate advances to tomorrow for "tomorrow 9 am"', () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const result = extractEventDate('call tomorrow 9 am');
  assert.equal(result.getDate(), tomorrow.getDate());
  assert.equal(result.getHours(), 9);
  assert.equal(result.getMinutes(), 0);
});

test('parseActivity renders the spaced time as "1:52 PM"', () => {
  const details = parseActivity('meeting today 1 52 pm').details;
  const time = details.find((d) => d.label === 'Time');
  assert.ok(time, 'a valid time produces a Time detail');
  assert.equal(time!.value, '1:52 PM');
});

test('parseActivity renders midnight and noon correctly', () => {
  const midnight = parseActivity('flight today 12 am').details.find((d) => d.label === 'Time');
  const noon = parseActivity('lunch today 12 pm').details.find((d) => d.label === 'Time');
  assert.equal(midnight?.value, '12:00 AM');
  assert.equal(noon?.value, '12:00 PM');
});

// --- Spaced-colon clock forms -------------------------------------------------
// Device report: "faiz meeting with shaaf at 12 : 30 pm" produced no time at all.
// parseClockTime required the minutes to be colon-joined with NO surrounding
// spaces, so the space before the colon made the whole match fail.

test('parseClockTime reads a colon with spaces on either side', () => {
  assert.deepEqual(parseClockTime('12:30 pm'), { hour24: 12, minute: 30, raw: '12:30 pm' });
  assert.deepEqual(parseClockTime('12 : 30 pm'), {
    hour24: 12,
    minute: 30,
    raw: '12 : 30 pm',
  });
  assert.deepEqual(parseClockTime('1 : 00 PM'), { hour24: 13, minute: 0, raw: '1 : 00 PM' });
});

// --- Bare clock with no day ---------------------------------------------------
// A valid time with no day keyword used to be discarded and replaced by `now`.
// It is now the next occurrence of that wall time on the device.

function fmt12(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

test('the reported meeting text resolves to 12:30, not the moment it was typed', () => {
  const result = extractEventDate('faiz meeting with shaaf at 12 : 30 pm');
  assert.equal(result.getHours(), 12);
  assert.equal(result.getMinutes(), 30);
  assert.equal(result.getSeconds(), 0);
  assert.ok(result.getTime() >= Date.now(), 'the instant is schedulable (not a past fallback)');
});

test('a bare future clock stays on today', () => {
  const ahead = new Date(Date.now() + 30 * 60_000);
  const result = extractEventDate(`meeting at ${fmt12(ahead)}`);
  assert.equal(result.getDate(), ahead.getDate());
  assert.equal(result.getMonth(), ahead.getMonth());
  assert.equal(result.getHours(), ahead.getHours());
  assert.equal(result.getMinutes(), ahead.getMinutes());
  assert.equal(result.getSeconds(), 0);
});

test('a bare clock that already passed rolls to tomorrow', () => {
  const past = new Date(Date.now() - 30 * 60_000);
  const expected = new Date(past);
  expected.setDate(expected.getDate() + 1);
  const result = extractEventDate(`meeting at ${fmt12(past)}`);
  assert.equal(result.getDate(), expected.getDate());
  assert.equal(result.getHours(), expected.getHours());
  assert.equal(result.getMinutes(), expected.getMinutes());
  assert.ok(result.getTime() > Date.now(), 'a passed time must not be saved in the past');
});
