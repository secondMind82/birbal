// Verification suite for Timeline financial presentation.
//
// Run with:  npm run verify:money
//
// The Timeline must keep showing every financial field it always had — Credit
// Received, Credit Pending, Debit Amount, the amount, and the Paid/Received/
// Pending status — and must keep showing them for a NON-financial row too. This
// suite pins the rule that decides which of those applies, so a card can never
// lose a status or call a debit a credit.
//
// It also pins Timeline <-> Expense parity: one timeline row is one record, so
// the same money shows up on both views without a second Timeline entry being
// created.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Must stay first: patches the module resolver so the theme's react-native
// import resolves to a stub instead of real React Native.
import './stubs/preload';
import { freshDb } from './real-sqlite';
import { moneyPresentation, moneyLine, moneyToneColors, formatPaise } from '../src/utils/money';
import { colors, darkColors } from '../src/theme';

const USER = 'user-1';
const TODAY = new Date().toISOString();

/** Parses a '#rgb', '#rrggbb', 'rgb(...)' or 'rgba(...)' token into channels + alpha. */
function parse(token: string): { r: number; g: number; b: number; a: number } {
  const s = token.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/.exec(s);
  assert.ok(m, `cannot parse colour token: ${token}`);
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

/**
 * Flattens a possibly translucent wash over the page background, because that
 * composite is what the eye actually sees as the card colour.
 */
function over(token: string, background: string) {
  const top = parse(token);
  const base = parse(background);
  const mix = (t: number, b: number) => Math.round(t * top.a + b * (1 - top.a));
  return {
    r: mix(top.r, base.r),
    g: mix(top.g, base.g),
    b: mix(top.b, base.b),
  };
}

/** Channel distance between two composited colours. */
function distance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/** Relative luminance of a composited colour, 0 (black) to 1 (white). */
function luminance(c: { r: number; g: number; b: number }): number {
  const [r, g, b] = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.3722 * b;
}

for (const [name, t] of Object.entries({ light: colors, dark: darkColors })) {
  test(`${name}: Received is a LIGHT GREEN card`, () => {
    const { accent, wash } = moneyToneColors(t, 'received');
    assert.equal(accent, t.success);
    assert.equal(wash, t.successSoft);
    const seen = over(wash, t.background);
    assert.ok(seen.g > seen.r && seen.g > seen.b, `wash must read green, got rgb(${seen.r},${seen.g},${seen.b})`);
    // A tint of the page, never the saturated accent filled in as a block.
    assert.ok(
      distance(seen, over(t.background, t.background)) < distance(seen, parse(accent)),
      'wash must sit near the background, not on the accent',
    );
    assert.ok(name === 'dark' ? luminance(seen) < 0.35 : luminance(seen) > 0.78, `${wash} is not a light tint`);
  });

  test(`${name}: Pending is a LIGHT RED card`, () => {
    const { accent, wash } = moneyToneColors(t, 'pending');
    assert.equal(accent, t.danger);
    assert.equal(wash, t.dangerSoft);
    const seen = over(wash, t.background);
    assert.ok(seen.r > seen.g && seen.r > seen.b, `wash must read red, got rgb(${seen.r},${seen.g},${seen.b})`);
    assert.ok(
      distance(seen, over(t.background, t.background)) < distance(seen, parse(accent)),
      'wash must sit near the background, not on the accent',
    );
    assert.ok(name === 'dark' ? luminance(seen) < 0.35 : luminance(seen) > 0.78, `${wash} is not a light tint`);
  });

  test(`${name}: Debit reads clearly, without borrowing a status colour`, () => {
    const debit = moneyToneColors(t, 'debit');
    const seen = over(debit.wash, t.background);
    // Distinct from green AND from red at the pixel level.
    const green = over(t.successSoft, t.background);
    const red = over(t.dangerSoft, t.background);
    assert.ok(distance(seen, green) > 24, `debit is too close to the received wash (${distance(seen, green)})`);
    assert.ok(distance(seen, red) > 24, `debit is too close to the pending wash (${distance(seen, red)})`);
    assert.ok(name === 'dark' ? luminance(seen) < 0.35 : luminance(seen) > 0.78, 'debit must be a light tint too');
    assert.equal(debit.accent, t.accent);
    assert.equal(debit.wash, t.accentSoft);
    assert.notEqual(debit.accent, t.success, 'debit must not read as received');
    assert.notEqual(debit.accent, t.danger, 'debit must not read as pending');
    assert.notEqual(debit.wash, t.successSoft);
    assert.notEqual(debit.wash, t.dangerSoft);
  });

  test(`${name}: the three money tones never collide`, () => {
    const seen = (['received', 'pending', 'debit'] as const).map((tone) => {
      const c = moneyToneColors(t, tone);
      return `${c.accent}|${c.wash}`;
    });
    assert.equal(new Set(seen).size, 3, `tones must look different: ${seen.join(' , ')}`);
  });
}

test('ignored is neutral, not a third status colour', () => {
  const c = moneyToneColors(colors, 'ignored');
  assert.equal(c.accent, colors.textSecondary);
  assert.equal(c.wash, colors.surfaceVariant);
});

test('the Timeline still renders the money panel and no longer drops the money line', () => {
  const src = readFileSync(join(process.env.BIRBAL_ROOT!, 'src/screens/TimelineScreen.tsx'), 'utf8');
  assert.match(src, /moneyPresentation\(event\)/, 'the card must derive its money presentation');
  assert.match(src, /<MoneyPanel money=\{money\} \/>/, 'the card must render the money panel');
  assert.match(src, /moneyToneColors\(t, money\.tone\)/, 'the card must be tinted by tone');
  // The old single metadata line must not come back and replace the panel.
  assert.doesNotMatch(src, /MONEY RECEIVABLE/, 'the old one-line money label is gone');
  assert.doesNotMatch(src, /EXPENSE · \$\{/, 'the old one-line money label is gone');
});

test('every label the design calls for is produced by the presentation rule', () => {
  const labels = [
    moneyPresentation({ moneyType: 'receive', expenseAmountPaisa: 500000, receivableStatus: 'received' }),
    moneyPresentation({ moneyType: 'receive', expenseAmountPaisa: 300000, receivableStatus: 'pending' }),
    moneyPresentation({ moneyType: 'expense', expenseAmountPaisa: 99900 }),
  ].map((p) => p?.amountLabel);
  assert.deepEqual(labels, ['Credit Received', 'Credit Pending', 'Debit Amount']);
});

test('credit RECEIVED presents as Credit Received', () => {
  const p = moneyPresentation({
    moneyType: 'receive',
    expenseAmountPaisa: 500000,
    receivableStatus: 'received',
  });
  assert.ok(p);
  assert.equal(p.tone, 'received');
  assert.equal(p.amountLabel, 'Credit Received');
  assert.equal(p.statusLabel, 'Received');
  assert.equal(p.headline, 'Payment Received');
  assert.equal(p.amountPaise, 500000);
  assert.match(moneyLine({ moneyType: 'receive', expenseAmountPaisa: 500000, receivableStatus: 'received' }), /Credit Received · ₹5,000 · Received/);
});

test('credit PENDING presents as Credit Pending, including an unset status', () => {
  for (const status of [null, undefined, 'pending']) {
    const p = moneyPresentation({
      moneyType: 'receive',
      expenseAmountPaisa: 300000,
      receivableStatus: status,
    });
    assert.ok(p, `status ${String(status)} must still present`);
    assert.equal(p.tone, 'pending');
    assert.equal(p.amountLabel, 'Credit Pending');
    assert.equal(p.statusLabel, 'Pending');
  }
});

test('an ignored credit is not shown as pending or received', () => {
  const p = moneyPresentation({
    moneyType: 'receive',
    expenseAmountPaisa: 300000,
    receivableStatus: 'ignored',
  });
  assert.ok(p);
  assert.equal(p.tone, 'ignored');
  assert.equal(p.statusLabel, 'Ignored');
});

test('debit presents as Debit Amount / Paid and keeps its category', () => {
  const p = moneyPresentation({ moneyType: 'expense', expenseAmountPaisa: 99900, expenseCategory: 'Grocery' });
  assert.ok(p);
  assert.equal(p.tone, 'debit');
  assert.equal(p.amountLabel, 'Debit Amount');
  assert.equal(p.statusLabel, 'Paid');
  assert.equal(p.category, 'Grocery');
  assert.match(moneyLine({ moneyType: 'expense', expenseAmountPaisa: 99900, expenseCategory: 'Grocery' }), /Debit Amount · ₹999 · Paid · Grocery/);
});

test('a debit with no meaningful category omits it rather than showing "Other"', () => {
  assert.equal(moneyPresentation({ moneyType: 'expense', expenseAmountPaisa: 100, expenseCategory: 'Other' })?.category, null);
  assert.equal(moneyPresentation({ moneyType: 'expense', expenseAmountPaisa: 100, expenseCategory: null })?.category, null);
});

test('a NULL money_type is a debit, so pre-direction rows are never read as credit', () => {
  const p = moneyPresentation({ moneyType: null, expenseAmountPaisa: 75000 });
  assert.ok(p);
  assert.equal(p.tone, 'debit');
  assert.equal(p.statusLabel, 'Paid');
});

test('a non-financial row presents nothing, so its card is left alone', () => {
  assert.equal(moneyPresentation({ moneyType: null, expenseAmountPaisa: null }), null);
  assert.equal(moneyPresentation({ moneyType: 'receive', expenseAmountPaisa: null, receivableStatus: 'received' }), null);
  assert.equal(moneyPresentation({}), null);
  assert.equal(moneyLine({ expenseAmountPaisa: null }), '');
});

test('amounts render with Indian grouping and no rounding drift', () => {
  assert.equal(formatPaise(500000), '₹5,000');
  assert.equal(formatPaise(300000), '₹3,000');
  assert.equal(formatPaise(99900), '₹999');
  assert.equal(formatPaise(123456789), '₹12,34,567.89');
  assert.equal(formatPaise(0), '₹0');
});

test('the four demo cases present distinctly', () => {
  // 1. Credit Received 5,000  2. Credit Pending 3,000  3. Debit 999
  // 4. A normal non-financial entry.
  const tones = [
    moneyPresentation({ moneyType: 'receive', expenseAmountPaisa: 500000, receivableStatus: 'received' })?.tone,
    moneyPresentation({ moneyType: 'receive', expenseAmountPaisa: 300000, receivableStatus: 'pending' })?.tone,
    moneyPresentation({ moneyType: 'expense', expenseAmountPaisa: 99900 })?.tone,
    moneyPresentation({ expenseAmountPaisa: null })?.tone,
  ];
  assert.deepEqual(tones, ['received', 'pending', 'debit', undefined]);
  // Three financial rows must never collapse onto one tone.
  assert.equal(new Set(tones.slice(0, 3)).size, 3, 'each money state reads differently');
});

test('Timeline and Expense show the same record without duplicating it', async () => {
  const harness = await freshDb();
  try {
    const timelines = await import('../src/db/repositories/timelines');
    const expensesService = await import('../src/services/expensesService');

    const server = {
      id: 'tl-both',
      userId: USER,
      title: 'Shaaf give me amount',
      description: 'Amount received ₹5,000 from Shaaf',
      eventDate: TODAY,
      showOnCalendar: false,
      createdAt: TODAY,
      updatedAt: TODAY,
      entities: [],
    };

    await timelines.create(USER, server as never);
    await timelines.setMoneyAttribution(USER, 'tl-both', {
      role: 'receive',
      amountPaise: 500000,
      category: null,
    });
    await timelines.setReceivableStatus(USER, 'tl-both', 'received');

    // The Timeline row.
    const all = await timelines.getAll(USER);
    assert.equal(all.length, 1, 'exactly one timeline entry for the transaction');
    const onTimeline = moneyPresentation(all[0]);
    assert.equal(onTimeline?.tone, 'received');
    assert.equal(onTimeline?.amountLabel, 'Credit Received');

    // The same money on the Expense page, read from SQLite.
    const receivables = await expensesService.getCachedReceivables(USER);
    assert.equal(receivables.length, 1);
    assert.equal(receivables[0].id, 'tl-both', 'the same row, not a copy');
    const onExpense = moneyPresentation(receivables[0]);
    assert.equal(onExpense?.tone, 'received');
    assert.equal(onExpense?.amountPaise, 500000);

    // And the Expenses page must not also list it as an expense.
    assert.equal((await expensesService.getCachedExpenses(USER)).length, 0);
  } finally {
    await harness.cleanup();
  }
});

test('a pending credit appears on both views with matching Pending state', async () => {
  const harness = await freshDb();
  try {
    const timelines = await import('../src/db/repositories/timelines');
    const expensesService = await import('../src/services/expensesService');

    await timelines.create(USER, {
      id: 'tl-pend',
      userId: USER,
      title: 'Aman',
      description: 'Aman owes me',
      eventDate: TODAY,
      showOnCalendar: false,
      createdAt: TODAY,
      updatedAt: TODAY,
      entities: [],
    } as never);
    await timelines.setMoneyAttribution(USER, 'tl-pend', {
      role: 'receive',
      amountPaise: 300000,
      category: null,
    });

    assert.equal(moneyPresentation((await timelines.getAll(USER))[0])?.statusLabel, 'Pending');
    const onExpense = await expensesService.getCachedReceivables(USER);
    assert.equal(moneyPresentation(onExpense[0])?.statusLabel, 'Pending');
    assert.equal(onExpense[0].expenseAmountPaisa, 300000);
  } finally {
    await harness.cleanup();
  }
});

test('presentation survives a restart, because it is derived from stored columns', async () => {
  // Both harnesses open the same on-disk file, so the second one really is the
  // app coming back up rather than a second empty database.
  const file = join(mkdtempSync(join(tmpdir(), 'birbal-restart-')), 'birbal.db');
  const h1 = await freshDb(file);
  try {
    const timelines = await import('../src/db/repositories/timelines');
    await timelines.create(USER, {
      id: 'tl-restart',
      userId: USER,
      title: 'Grocery Shopping',
      description: 'Grocery Shopping',
      eventDate: TODAY,
      showOnCalendar: false,
      createdAt: TODAY,
      updatedAt: TODAY,
      entities: [],
    } as never);
    await timelines.setMoneyAttribution(USER, 'tl-restart', {
      role: 'expense',
      amountPaise: 99900,
      category: 'Grocery',
    });
  } finally {
    await h1.cleanup();
  }

  // A brand new database + repository over the same file, i.e. an app restart.
  const h2 = await freshDb(file);
  try {
    const timelines = await import('../src/db/repositories/timelines');
    const row = (await timelines.getAll(USER))[0];
    const p = moneyPresentation(row);
    assert.equal(p?.tone, 'debit');
    assert.equal(p?.statusLabel, 'Paid');
    assert.equal(p?.amountPaise, 99900);
  } finally {
    await h2.cleanup();
  }
});
