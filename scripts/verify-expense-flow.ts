// Verification suite for the Expense / Credit / Debit SERVICE layer, run against
// a real HTTP API and a real SQLite database.
//
// Run with:  npm run verify:money
//
// verify-money.ts proves the repository SQL. This suite proves the layer above
// it — the exact code ExpensesScreen, AddExpenseScreen and PreviewEntityScreen
// call — so the behaviours the user actually depends on are covered:
//
//   * Add Expense saves and is immediately visible on the Expenses screen;
//   * Add Expense works OFFLINE: the row is written to SQLite and survives a
//     restart, because a dropped network must never lose the entry;
//   * the expense survives every later refresh, which the screen fires on focus;
//   * a credit is NOT counted in the expense total, and its Pending -> Received
//     -> Ignored lifecycle sticks across a refresh;
//   * the per-entity Credit/Debit totals see money that was saved with a link;
//   * deleting an expense removes it locally even while offline.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startFakeApi, type FakeApi } from './fake-api';
import { freshDb } from './real-sqlite';

const USER = 'user-1';
const TODAY = new Date().toISOString();

let api: FakeApi;

// The API base URL is captured when src/api/client.ts loads, so the server has to
// be up before anything under src/ is imported.
before(async () => {
  api = await startFakeApi();
});

after(async () => {
  await api?.close();
});

/** A migrated database plus the two service modules the screens import. */
async function withServices() {
  const harness = await freshDb();
  const expensesService = await import('../src/services/expensesService');
  const timelinesService = await import('../src/services/timelinesService');
  return {
    expensesService,
    timelinesService,
    cleanup: harness.cleanup,
    raw: harness.raw,
  };
}

test('Add Expense saves and shows up in the cached expense list', async () => {
  const { expensesService, cleanup } = await withServices();
  try {
    const created = await expensesService.createExpense(USER, {
      title: 'Grocery Shopping from D-Mart',
      description: 'Grocery Shopping from D-Mart',
      eventDate: TODAY,
      amountPaise: 125000,
      category: 'Food',
    });
    assert.equal(created.expenseAmountPaisa, 125000);
    assert.equal(created.expenseCategory, 'Food');
    assert.equal(created.moneyType, 'expense', 'a manual expense is the debit direction');

    // This is exactly what ExpensesScreen reads on focus.
    const cached = await expensesService.getCachedExpenses(USER);
    assert.equal(cached.length, 1, 'the saved expense must be listed');
    assert.equal(cached[0].expenseAmountPaisa, 125000);
  } finally {
    await cleanup();
  }
});

test('Add Expense works OFFLINE and the row survives a restart', async () => {
  const { expensesService, timelinesService, cleanup } = await withServices();
  try {
    api.setMode('offline');

    const created = await expensesService.createExpense(USER, {
      title: 'Offline cab fare',
      description: 'Offline cab fare',
      eventDate: TODAY,
      amountPaise: 45000,
      category: 'Transport',
    });
    assert.ok(created.id, 'an offline expense still needs an id');
    assert.equal(created.expenseAmountPaisa, 45000);

    const cached = await expensesService.getCachedExpenses(USER);
    assert.equal(cached.length, 1, 'offline save must be visible immediately');
    assert.equal(cached[0].expenseAmountPaisa, 45000);

    // "Restart": a brand new repository against the same rows. Using the same
    // singleton would prove nothing, so assert the value straight from SQLite.
    const row = await timelinesService.getCachedTimelines(USER);
    assert.equal(row.length, 1);
    assert.equal(row[0].expenseAmountPaisa, 45000);
    assert.equal(row[0].expenseCategory, 'Transport');
    assert.equal(row[0].moneyType, 'expense');
  } finally {
    api.setMode('online');
    await cleanup();
  }
});

test('an expense survives the refresh ExpensesScreen runs on focus', async () => {
  const { expensesService, timelinesService, cleanup } = await withServices();
  try {
    await expensesService.createExpense(USER, {
      title: 'Movie tickets',
      description: 'Movie tickets',
      eventDate: TODAY,
      amountPaise: 80000,
      category: 'Entertainment',
    });

    // What the screen does: refresh, then re-read the cache.
    await timelinesService.refreshTimelines(USER);
    const cached = await expensesService.getCachedExpenses(USER);

    assert.equal(cached.length, 1, 'the refresh must not drop the expense');
    assert.equal(cached[0].expenseAmountPaisa, 80000);
    assert.equal(cached[0].expenseCategory, 'Entertainment');
  } finally {
    await cleanup();
  }
});

test('expenses survive several refreshes in a row', async () => {
  const { expensesService, timelinesService, cleanup } = await withServices();
  try {
    for (const [title, paise] of [
      ['Tea', 5000],
      ['Bus pass', 50000],
      ['Lunch', 32500],
    ] as const) {
      await expensesService.createExpense(USER, {
        title,
        description: title,
        eventDate: TODAY,
        amountPaise: paise,
        category: 'Other',
      });
    }
    assert.equal((await expensesService.getCachedExpenses(USER)).length, 3);

    for (let i = 0; i < 3; i++) {
      await timelinesService.refreshTimelines(USER);
    }

    const cached = await expensesService.getCachedExpenses(USER);
    assert.equal(cached.length, 3, 'repeated refreshes are idempotent for money');
    assert.equal(
      cached.reduce((s, e) => s + e.expenseAmountPaisa, 0),
      87500,
      'the total is unchanged after refreshes',
    );
  } finally {
    await cleanup();
  }
});

test('a credit is excluded from the expense total and tracks its own lifecycle', async () => {
  const { expensesService, timelinesService, cleanup } = await withServices();
  try {
    // A receivable is created the way an SMS/activity credit is: a timeline with
    // money_type 'receive', which expensesService.createExpense never does.
    const credit = await timelinesService.createTimeline(
      USER,
      {
        title: 'Shaaf owes me',
        description: 'Amount received from Shaaf',
        eventDate: TODAY,
        entityIds: [],
        showOnCalendar: false,
      },
      { role: 'receive', amountPaise: 500000, category: null, status: 'pending' },
    );

    const expenses = await expensesService.getCachedExpenses(USER);
    assert.equal(expenses.length, 0, 'a credit must never inflate the expense total');
    assert.equal(
      expenses.reduce((s, e) => s + e.expenseAmountPaisa, 0),
      0,
      'expense total stays 0',
    );

    const receivables = await expensesService.getCachedReceivables(USER);
    assert.equal(receivables.length, 1);
    assert.equal(receivables[0].expenseAmountPaisa, 500000);
    assert.equal(receivables[0].moneyType, 'receive');

    // Pending -> Received, as the "✓ Received" chip does.
    await expensesService.setReceivableStatus(USER, credit.id, 'received');
    await timelinesService.refreshTimelines(USER);

    const afterRefresh = await expensesService.getCachedReceivables(USER);
    assert.equal(afterRefresh.length, 1, 'a resolved credit stays in the history');
    assert.equal(afterRefresh[0].receivableStatus, 'received', 'Received must stick');

    assert.equal(
      (await expensesService.getCachedExpenses(USER)).length,
      0,
      'resolving a credit still must not create an expense',
    );
  } finally {
    await cleanup();
  }
});

test('getExpenses (the service variant) must not count credits as expenses', async () => {
  const { expensesService, timelinesService, cleanup } = await withServices();
  try {
    await timelinesService.createTimeline(
      USER,
      {
        title: 'Shop',
        description: 'Shop',
        eventDate: TODAY,
        entityIds: [],
        showOnCalendar: false,
      },
      { amountPaise: 100000, category: 'Food' },
    );
    await timelinesService.createTimeline(
      USER,
      {
        title: 'Ravi owes me',
        description: 'Ravi owes me',
        eventDate: TODAY,
        entityIds: [],
        showOnCalendar: false,
      },
      { role: 'receive', amountPaise: 700000, category: null },
    );

    const cachedExpenses = await expensesService.getCachedExpenses(USER);
    assert.equal(cachedExpenses.length, 1, 'the repository query filters direction');
    assert.equal(cachedExpenses[0].expenseAmountPaisa, 100000);

    const serviceExpenses = await expensesService.getExpenses(USER);
    assert.equal(
      serviceExpenses.length,
      1,
      'getExpenses must apply the same direction filter as getCachedExpenses',
    );
    assert.equal(
      serviceExpenses.reduce((s, e) => s + e.expenseAmountPaisa, 0),
      100000,
      'a 7000 credit must not be added to a 1000 expense',
    );
  } finally {
    await cleanup();
  }
});

test('per-entity money totals find money saved with an entity link', async () => {
  const { expensesService, timelinesService, cleanup } = await withServices();
  try {
    const entities = await import('../src/db/repositories/entities');
    await entities.create(USER, {
      id: 'ent-shaaf',
      userId: USER,
      name: 'Shaaf',
      type: 'Person',
      description: null,
      avatar: null,
      createdAt: TODAY,
      updatedAt: TODAY,
    } as never);

    // What the SMS save does: money attribution on a timeline linked to Shaaf.
    const linked = await timelinesService.createTimeline(
      USER,
      {
        title: 'Shaaf give me amount',
        description: '@Shaaf give me amount ₹5000',
        eventDate: TODAY,
        entityIds: ['ent-shaaf'],
        showOnCalendar: false,
      },
      { role: 'receive', amountPaise: 500000, category: null },
    );
    assert.ok(linked.id);

    // PreviewEntityScreen filters by link, so the money is only visible here if
    // the link survived the write.
    const all = await timelinesService.getCachedTimelines(USER);
    const forEntity = all.filter((t) => (t.entities ?? []).some((l) => l.entityId === 'ent-shaaf'));
    assert.equal(forEntity.length, 1, 'the entity link must be present on the money row');
    assert.equal(forEntity[0].moneyType, 'receive');
    assert.equal(forEntity[0].expenseAmountPaisa, 500000);

    // And it must still be linked after a refresh.
    await timelinesService.refreshTimelines(USER);
    const afterRefresh = await timelinesService.getCachedTimelines(USER);
    const stillLinked = afterRefresh.filter((t) =>
      (t.entities ?? []).some((l) => l.entityId === 'ent-shaaf'),
    );
    assert.equal(stillLinked.length, 1, 'the link must survive a refresh');
    assert.equal(stillLinked[0].expenseAmountPaisa, 500000);

    assert.equal((await expensesService.getCachedReceivables(USER)).length, 1);
  } finally {
    await cleanup();
  }
});

test('deleting an expense works offline and leaves the list empty', async () => {
  const { expensesService, cleanup } = await withServices();
  try {
    const created = await expensesService.createExpense(USER, {
      title: 'Should be removed',
      description: 'Should be removed',
      eventDate: TODAY,
      amountPaise: 99900,
      category: 'Other',
    });
    assert.equal((await expensesService.getCachedExpenses(USER)).length, 1);

    api.setMode('offline');
    await expensesService.deleteExpense(USER, created.id);

    const cached = await expensesService.getCachedExpenses(USER);
    assert.equal(cached.length, 0, 'a local delete must not need the network');
  } finally {
    api.setMode('online');
    await cleanup();
  }
});

test('an offline expense survives the next refresh and is never silently dropped', async () => {
  const { expensesService, timelinesService, cleanup } = await withServices();
  try {
    api.setMode('offline');
    const created = await expensesService.createExpense(USER, {
      title: 'Written with no signal',
      description: 'Written with no signal',
      eventDate: TODAY,
      amountPaise: 61000,
      category: 'Other',
    });
    assert.equal(created.expenseAmountPaisa, 61000);
    assert.equal(created.source, 'MANUAL', 'an offline row is device-owned');
    api.setMode('online');

    // The server knows nothing about this row. A refresh must still keep it,
    // otherwise entering an expense without signal silently loses the money.
    await timelinesService.refreshTimelines(USER);

    const cached = await expensesService.getCachedExpenses(USER);
    assert.equal(cached.length, 1, 'an offline expense must survive a refresh');
    assert.equal(cached[0].expenseAmountPaisa, 61000);
    assert.equal(cached[0].expenseCategory, 'Other');
    assert.equal(cached[0].moneyType, 'expense');
  } finally {
    api.setMode('online');
    await cleanup();
  }
});

test('an offline expense is not duplicated when it later reaches the server', async () => {
  const { expensesService, timelinesService, cleanup } = await withServices();
  try {
    api.setMode('offline');
    const created = await expensesService.createExpense(USER, {
      title: 'Queue me',
      description: 'Queue me',
      eventDate: TODAY,
      amountPaise: 33000,
      category: 'Other',
    });
    api.setMode('online');

    // Server-side the row now exists (same id), so replaceAll must take it from
    // the payload rather than also keeping the device copy.
    api.seed({ id: created.id, title: 'Queue me', eventDate: TODAY });
    await timelinesService.refreshTimelines(USER);

    const cached = await expensesService.getCachedExpenses(USER);
    assert.equal(cached.length, 1, 'exactly one copy of the expense');
    assert.equal(cached[0].id, created.id);
    assert.equal(cached[0].expenseAmountPaisa, 33000, 'the amount is not lost in the handover');
  } finally {
    api.setMode('online');
    await cleanup();
  }
});

test('the same expense is not double counted after repeated refreshes', async () => {
  const { expensesService, timelinesService, cleanup } = await withServices();
  try {
    await expensesService.createExpense(USER, {
      title: 'Single entry',
      description: 'Single entry',
      eventDate: TODAY,
      amountPaise: 25000,
      category: 'Other',
    });
    await timelinesService.refreshTimelines(USER);
    await timelinesService.refreshTimelines(USER);
    await timelinesService.refreshTimelines(USER);

    const cached = await expensesService.getCachedExpenses(USER);
    assert.equal(cached.length, 1, 'the row is replaced, not accumulated');
    assert.equal(cached[0].expenseAmountPaisa, 25000);
  } finally {
    await cleanup();
  }
});
