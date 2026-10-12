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
