// Verification suite for Birbal Expense / Credit / Debit SQLite persistence.
//
// Run with:  npm run verify:money
//
// scripts/fake-sqlite.ts never parses SQL, so it cannot catch a repository bug.
// This suite executes the REAL statements against node:sqlite: schema.ts runs
// its actual migrations and timelines.ts / entities.ts run their actual
// queries, so a wrong column, a bad WHERE or a row lost across a refresh fails
// here instead of on the user's phone.
//
// Covered:
//   * an expense stamped onto a timeline is returned by getExpenses;
//   * a credit (money_type 'receive') is returned by getReceivables and NOT by
//     getExpenses, so the two screens cannot double-count each other;
//   * receivable status transitions persist and are readable back;
//   * money + links SURVIVE replaceAll, which every ExpensesScreen focus runs;
//   * a locally-saved (source='SMS') row survives replaceAll even though the
//     server payload never mentioned it;
//   * rows are scoped to their owner: one user never sees another's money;
//   * a deleted expense leaves both lists and the DB.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { freshDb } from './real-sqlite';

const USER = 'user-1';
const OTHER_USER = 'user-2';

const NOW = '2026-09-30T10:00:00.000Z';

function serverTimeline(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tl-1',
    userId: USER,
    title: 'Team dinner',
    description: '',
    eventDate: NOW,
    showOnCalendar: false,
    createdAt: NOW,
    updatedAt: NOW,
    entities: [],
    ...overrides,
  } as never;
}

async function loaded() {
  const harness = await freshDb();
  const timelines = await import('../src/db/repositories/timelines');
  const entities = await import('../src/db/repositories/entities');
  return { ...harness, timelines, entities };
}

test('an expense stamped on a timeline is returned by getExpenses', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(USER, serverTimeline() as never);
    await timelines.setMoneyAttribution(USER, 'tl-1', {
      role: 'expense',
      amountPaise: 125000,
      category: 'Food',
    });

    const expenses = await timelines.getExpenses(USER);
    assert.equal(expenses.length, 1, 'expense should be listed');
    assert.equal(expenses[0].expenseAmountPaisa, 125000, 'amount in paise');
    assert.equal(expenses[0].expenseCategory, 'Food');
    assert.equal(expenses[0].moneyType, 'expense');

    const receivables = await timelines.getReceivables(USER);
    assert.equal(receivables.length, 0, 'an expense is never a receivable');
  } finally {
    await cleanup();
  }
});

test('a credit is a receivable and never shows up as an expense', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(USER, serverTimeline({ id: 'tl-2' }) as never);
    await timelines.setMoneyAttribution(USER, 'tl-2', {
      role: 'receive',
      amountPaise: 500000,
      category: null,
    });

    const receivables = await timelines.getReceivables(USER);
    assert.equal(receivables.length, 1);
    assert.equal(receivables[0].expenseAmountPaisa, 500000);
    assert.equal(receivables[0].moneyType, 'receive');
    assert.equal(receivables[0].receivableStatus, null, 'unset status means Pending');

    const expenses = await timelines.getExpenses(USER);
    assert.equal(expenses.length, 0, 'a credit must not inflate the expense total');
  } finally {
    await cleanup();
  }
});

test('a receivable with no amount is not treated as a receivable', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(USER, serverTimeline({ id: 'tl-3' }) as never);
    await timelines.setMoneyAttribution(USER, 'tl-3', {
      role: 'receive',
      amountPaise: 0,
      category: null,
    });
    const receivables = await timelines.getReceivables(USER);
    assert.equal(receivables.length, 1, 'a 0-amount row still carries a real attribution');
  } finally {
    await cleanup();
  }
});

test('receivable status transitions persist and read back', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(USER, serverTimeline({ id: 'tl-4' }) as never);
    await timelines.setMoneyAttribution(USER, 'tl-4', {
      role: 'receive',
      amountPaise: 250000,
      category: null,
    });

    const changed = await timelines.setReceivableStatus(USER, 'tl-4', 'received');
    assert.equal(changed, true, 'the UPDATE must match the row');

    const after = await timelines.getReceivables(USER);
    assert.equal(after[0].receivableStatus, 'received');

    await timelines.setReceivableStatus(USER, 'tl-4', 'ignored');
    const ignored = await timelines.getReceivables(USER);
    assert.equal(ignored[0].receivableStatus, 'ignored');
  } finally {
    await cleanup();
  }
});

test('money and entity links SURVIVE replaceAll, which every ExpensesScreen focus runs', async () => {
  const { timelines, entities, cleanup } = await loaded();
  try {
    await entities.create(USER, {
      id: 'ent-1',
      userId: USER,
      name: 'Shaaf',
      type: 'Person',
      description: null,
      avatar: null,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);

    await timelines.create(USER, serverTimeline() as never, ['ent-1']);
    await timelines.setMoneyAttribution(USER, 'tl-1', {
      role: 'expense',
      amountPaise: 125000,
      category: 'Food',
    });

    // The server payload carries NO money fields (money is local-only) but does
    // carry the entity link, exactly as timeline.service.ts's findAll includes it.
    await timelines.replaceAll(USER, [
      serverTimeline({
        entities: [
          {
            timelineId: 'tl-1',
            entityId: 'ent-1',
            entity: {
              id: 'ent-1',
              userId: USER,
              name: 'Shaaf',
              type: 'Person',
              description: null,
              avatar: null,
              createdAt: NOW,
              updatedAt: NOW,
            },
          },
        ],
      }) as never,
    ]);

    const expenses = await timelines.getExpenses(USER);
    assert.equal(expenses.length, 1, 'expense must not be eroded by a refresh');
    assert.equal(expenses[0].expenseAmountPaisa, 125000);
    assert.equal(expenses[0].expenseCategory, 'Food');
    assert.equal(expenses[0].moneyType, 'expense');

    const all = await timelines.getAll(USER);
    assert.equal(all[0]?.entities?.length, 1, 'entity link must survive the refresh');
    assert.equal(all[0]?.entities[0]?.entityId, 'ent-1');
  } finally {
    await cleanup();
  }
});

test('a payload with no entities key keeps the local link; an explicit empty array clears it', async () => {
  const { timelines, entities, cleanup } = await loaded();
  try {
    await entities.create(USER, {
      id: 'ent-2',
      userId: USER,
      name: 'Shaaf',
      type: 'Person',
      description: null,
      avatar: null,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    await timelines.create(USER, serverTimeline({ id: 'tl-link' }) as never, ['ent-2']);
    assert.equal((await timelines.getAll(USER))[0]?.entities?.length, 1);

    // Case A: the server omits the entities array entirely (older/partial
    // payload). persistTimeline already treats "no array" as "unknown" and falls
    // back to the request's entityIds; replaceAll must not silently drop links.
    const omitted = serverTimeline({ id: 'tl-link' }) as Record<string, unknown>;
    delete omitted.entities;
    await timelines.replaceAll(USER, [omitted as never]);
    assert.equal(
      (await timelines.getAll(USER))[0]?.entities?.length,
      1,
      'an omitted entities key must not unlink the entity',
    );

    // Case B: the server sends an explicit empty array — it is authoritative and
    // the link really was removed.
    await timelines.replaceAll(USER, [serverTimeline({ id: 'tl-link' }) as never]);
    assert.equal(
      (await timelines.getAll(USER))[0]?.entities?.length,
      0,
      'an explicit empty array means the link was removed',
    );
  } finally {
    await cleanup();
  }
});

test('a receivable status survives replaceAll', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(USER, serverTimeline({ id: 'tl-5' }) as never);
    await timelines.setMoneyAttribution(USER, 'tl-5', {
      role: 'receive',
      amountPaise: 500000,
      category: null,
    });
    await timelines.setReceivableStatus(USER, 'tl-5', 'received');

    await timelines.replaceAll(USER, [serverTimeline({ id: 'tl-5' }) as never]);

    const receivables = await timelines.getReceivables(USER);
    assert.equal(receivables.length, 1);
    assert.equal(receivables[0].receivableStatus, 'received', 'Received must stay Received');
    assert.equal(receivables[0].moneyType, 'receive', 'direction must stay receive');
  } finally {
    await cleanup();
  }
});

test('an SMS-saved row the server never saw survives replaceAll', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(
      USER,
      {
        ...(serverTimeline({ id: 'tl-local' }) as object),
        expenseAmountPaisa: 80000,
        expenseCategory: 'Other',
        moneyType: 'expense',
        source: 'SMS',
        sourceNotificationId: 'ntf-1',
      } as never,
    );

    // Server knows only about a different, unrelated row.
    await timelines.replaceAll(USER, [serverTimeline({ id: 'tl-server' }) as never]);

    const expenses = await timelines.getExpenses(USER);
    assert.equal(expenses.length, 1, 'the offline SMS expense must not be deleted');
    assert.equal(expenses[0].id, 'tl-local');
    assert.equal(expenses[0].expenseAmountPaisa, 80000);
    assert.equal(expenses[0].source, 'SMS');

    const all = await timelines.getAll(USER);
    assert.equal(all.length, 2, 'both the local SMS row and the server row exist');
  } finally {
    await cleanup();
  }
});

test('money is scoped to its owner', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(USER, serverTimeline({ id: 'tl-a', userId: USER }) as never);
    await timelines.setMoneyAttribution(USER, 'tl-a', {
      role: 'expense',
      amountPaise: 100000,
      category: 'Food',
    });
    await timelines.create(OTHER_USER, serverTimeline({ id: 'tl-b', userId: OTHER_USER }) as never);
    await timelines.setMoneyAttribution(OTHER_USER, 'tl-b', {
      role: 'expense',
      amountPaise: 999,
      category: 'Other',
    });

    const mine = await timelines.getExpenses(USER);
    const theirs = await timelines.getExpenses(OTHER_USER);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].expenseAmountPaisa, 100000);
    assert.equal(theirs.length, 1);
    assert.equal(theirs[0].expenseAmountPaisa, 999, 'no cross-user leakage');
  } finally {
    await cleanup();
  }
});

test('a cross-user money write is refused', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(USER, serverTimeline({ id: 'tl-own' }) as never);
    const changed = await timelines.setMoneyAttribution(OTHER_USER, 'tl-own', {
      role: 'expense',
      amountPaise: 1,
      category: 'Other',
    });
    assert.equal(changed, false, 'must not write another user\'s row');

    const row = await timelines.getById(USER, 'tl-own');
    assert.equal(row?.expenseAmountPaisa, null, 'the row is untouched');
  } finally {
    await cleanup();
  }
});

test('deleting an expense removes it from the list and the DB', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(USER, serverTimeline({ id: 'tl-6' }) as never);
    await timelines.setMoneyAttribution(USER, 'tl-6', {
      role: 'expense',
      amountPaise: 700,
      category: 'Other',
    });
    assert.equal((await timelines.getExpenses(USER)).length, 1);

    await timelines.remove(USER, 'tl-6');
    assert.equal((await timelines.getExpenses(USER)).length, 0, 'gone from the expense list');
    assert.equal((await timelines.getReceivables(USER)).length, 0);
    assert.equal(await timelines.getById(USER, 'tl-6'), null);
  } finally {
    await cleanup();
  }
});

test('editing a timeline from a server payload without money keeps the money', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(USER, serverTimeline() as never);
    await timelines.setMoneyAttribution(USER, 'tl-1', {
      role: 'expense',
      amountPaise: 420000,
      category: 'Travel',
    });

    // The Timeline edit screen sends a payload with no expense fields at all.
    await timelines.update(
      USER,
      'tl-1',
      { title: 'Renamed', description: '', eventDate: NOW, showOnCalendar: false },
      [],
    );

    const expenses = await timelines.getExpenses(USER);
    assert.equal(expenses.length, 1, 'a rename must not erase the amount');
    assert.equal(expenses[0].expenseAmountPaisa, 420000);
    assert.equal(expenses[0].expenseCategory, 'Travel');
    assert.equal(expenses[0].title, 'Renamed');
  } finally {
    await cleanup();
  }
});

test('the date used for filtering is the event date, not the capture time', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(
      USER,
      serverTimeline({ id: 'tl-old', eventDate: '2026-01-15T09:00:00.000Z' }) as never,
    );
    await timelines.setMoneyAttribution(USER, 'tl-old', {
      role: 'expense',
      amountPaise: 100,
      category: 'Other',
    });
    await timelines.create(USER, serverTimeline({ id: 'tl-new' }) as never);
    await timelines.setMoneyAttribution(USER, 'tl-new', {
      role: 'expense',
      amountPaise: 200,
      category: 'Other',
    });

    const expenses = await timelines.getExpenses(USER);
    const dates = expenses.map((e) => e.eventDate);
    assert.deepEqual(
      dates,
      [NOW, '2026-01-15T09:00:00.000Z'],
      'getExpenses must return newest-first so month buckets are correct',
    );
  } finally {
    await cleanup();
  }
});

test('replaceAll keeps only the caller user rows and leaves other users alone', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    await timelines.create(OTHER_USER, serverTimeline({ id: 'tl-other', userId: OTHER_USER }) as never);
    await timelines.setMoneyAttribution(OTHER_USER, 'tl-other', {
      role: 'expense',
      amountPaise: 4242,
      category: 'Other',
    });

    await timelines.replaceAll(USER, [serverTimeline({ id: 'tl-new-only' }) as never]);

    const theirs = await timelines.getExpenses(OTHER_USER);
    assert.equal(theirs.length, 1, 'the other user keeps their row');
    assert.equal(theirs[0].expenseAmountPaisa, 4242);
  } finally {
    await cleanup();
  }
});

test('multiple expenses sum to the right total', async () => {
  const { timelines, cleanup } = await loaded();
  try {
    const amounts = [125000, 50000, 33300, 1];
    for (let i = 0; i < amounts.length; i++) {
      const id = `tl-sum-${i}`;
      await timelines.create(USER, serverTimeline({ id }) as never);
      await timelines.setMoneyAttribution(USER, id, {
        role: 'expense',
        amountPaise: amounts[i],
        category: 'Other',
      });
    }
    const expenses = await timelines.getExpenses(USER);
    assert.equal(expenses.length, 4);
    assert.equal(
      expenses.reduce((sum, e) => sum + (e.expenseAmountPaisa ?? 0), 0),
      amounts.reduce((a, b) => a + b, 0),
      'no paise rounding or truncation',
    );
  } finally {
    await cleanup();
  }
});
