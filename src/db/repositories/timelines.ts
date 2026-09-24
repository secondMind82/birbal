import { getDb, serializeWrite } from '../database';
import type { SQLiteDatabase } from 'expo-sqlite';
import { isMoneyType } from '../../utils/money';
import type { Timeline, TimelineEntityLink, Entity, MoneyType } from '../../models/types';

export interface TimelineInput {
  id: string;
  title: string;
  description?: string | null;
  eventDate: string;
  showOnCalendar: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  expenseAmountPaisa?: number | null;
  expenseCategory?: string | null;
  receivableStatus?: string | null;
  moneyType?: MoneyType | null;
}

export type TimelineUpdate = Partial<
  Pick<
    Timeline,
    | 'title'
    | 'description'
    | 'eventDate'
    | 'showOnCalendar'
    | 'expenseAmountPaisa'
    | 'expenseCategory'
    | 'receivableStatus'
    | 'moneyType'
  >
> & {
  updatedAt?: string | null;
};

interface TimelineRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  event_date: string;
  show_on_calendar: number;
  created_at: string | null;
  updated_at: string | null;
  expense_amount_paise: number | null;
  expense_category: string | null;
  receivable_status: string | null;
  money_type: string | null;
}

interface EntityJoinRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  description: string | null;
  avatar: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function toTimelineRow(
  data: TimelineInput,
  userId: string,
): [
  string,
  string,
  string,
  string,
  string,
  number,
  string | null,
  string | null,
  number | null,
  string | null,
  string | null,
  string | null,
] {
  return [
    data.id,
    userId,
    data.title,
    data.description ?? '',
    data.eventDate,
    data.showOnCalendar ? 1 : 0,
    data.createdAt ?? null,
    data.updatedAt ?? null,
    data.expenseAmountPaisa ?? null,
    data.expenseCategory ?? null,
    data.receivableStatus ?? null,
    isMoneyType(data.moneyType) ? data.moneyType : null,
  ];
}

function toTimeline(dbRow: TimelineRow, entities: TimelineEntityLink[]): Timeline {
  return {
    id: dbRow.id,
    userId: dbRow.user_id,
    title: dbRow.title,
    description: dbRow.description ?? '',
    eventDate: dbRow.event_date,
    showOnCalendar: dbRow.show_on_calendar === 1,
    createdAt: dbRow.created_at,
    updatedAt: dbRow.updated_at,
    entities,
    expenseAmountPaisa: dbRow.expense_amount_paise,
    expenseCategory: dbRow.expense_category,
    receivableStatus: dbRow.receivable_status,
    moneyType: isMoneyType(dbRow.money_type) ? dbRow.money_type : null,
  };
}

async function loadEntities(
  db: SQLiteDatabase,
  timelineId: string,
): Promise<TimelineEntityLink[]> {
  const rows = await db.getAllAsync<EntityJoinRow>(
    `SELECT e.*
     FROM timeline_entities te
     JOIN entities e ON e.id = te.entity_id
     WHERE te.timeline_id = ?
     ORDER BY e.name`,
    timelineId,
  );
  return rows.map((r) => ({
    timelineId,
    entityId: r.id,
    entity: {
      id: r.id,
      userId: r.user_id,
      name: r.name,
      type: r.type,
      description: r.description,
      avatar: r.avatar,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    } satisfies Entity,
  }));
}

async function replaceLinks(
  txn: SQLiteDatabase,
  userId: string,
  timelineId: string,
  entityIds: string[],
): Promise<void> {
  const normalized = [...new Set(entityIds)];

  if (normalized.length > 0) {
    const placeholders = normalized.map(() => '?').join(', ');
    const row = await txn.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM entities WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...normalized],
    );
    const owned = row?.c ?? 0;
    if (owned !== normalized.length) {
      throw new Error('Cannot link entities that do not belong to the current user');
    }
  }

  await txn.runAsync('DELETE FROM timeline_entities WHERE timeline_id = ?', timelineId);

  for (const eid of normalized) {
    await txn.runAsync(
      'INSERT INTO timeline_entities (timeline_id, entity_id) VALUES (?, ?)',
      timelineId,
      eid,
    );
  }
}

export async function getAll(userId: string): Promise<Timeline[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TimelineRow>(
    'SELECT * FROM timelines WHERE user_id = ? ORDER BY event_date DESC',
    userId,
  );
  return Promise.all(
    rows.map(async (row) => {
      const entities = await loadEntities(db, row.id);
      return toTimeline(row, entities);
    }),
  );
}

export async function getById(userId: string, id: string): Promise<Timeline | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<TimelineRow>(
    'SELECT * FROM timelines WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
  if (!row) return null;
  const entities = await loadEntities(db, row.id);
  return toTimeline(row, entities);
}

export async function create(
  userId: string,
  timeline: TimelineInput,
  entityIds?: string[],
): Promise<Timeline> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (txn) => {
      const values = toTimelineRow(timeline, userId);
      await txn.runAsync(
        `INSERT INTO timelines (id, user_id, title, description, event_date, show_on_calendar, created_at, updated_at, expense_amount_paise, expense_category, receivable_status, money_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values,
      );
      if (entityIds !== undefined && entityIds.length > 0) {
        await replaceLinks(txn, userId, timeline.id, entityIds);
      }
    });
    return (await getById(userId, timeline.id))!;
  });
}

export async function update(
  userId: string,
  id: string,
  changes: TimelineUpdate,
  entityIds?: string[],
): Promise<boolean> {
  return serializeWrite(async () => {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (changes.title !== undefined) {
      sets.push('title = ?');
      values.push(changes.title);
    }
    if (changes.description !== undefined) {
      sets.push('description = ?');
      values.push(changes.description);
    }
    if (changes.eventDate !== undefined) {
      sets.push('event_date = ?');
      values.push(changes.eventDate);
    }
    if (changes.showOnCalendar !== undefined) {
      sets.push('show_on_calendar = ?');
      values.push(changes.showOnCalendar ? 1 : 0);
    }
    if (changes.expenseAmountPaisa !== undefined) {
      sets.push('expense_amount_paise = ?');
      values.push(changes.expenseAmountPaisa);
    }
    if (changes.expenseCategory !== undefined) {
      sets.push('expense_category = ?');
      values.push(changes.expenseCategory);
    }
    if (changes.receivableStatus !== undefined) {
      sets.push('receivable_status = ?');
      values.push(changes.receivableStatus ?? null);
    }
    if (changes.moneyType !== undefined) {
      sets.push('money_type = ?');
      values.push(isMoneyType(changes.moneyType) ? changes.moneyType : null);
    }
    if (changes.updatedAt !== undefined) {
      sets.push('updated_at = ?');
      values.push(changes.updatedAt);
    }

    if (sets.length === 0 && entityIds === undefined) return false;

    const db = await getDb();
    let success = false;

    await db.withExclusiveTransactionAsync(async (txn) => {
      const existing = await txn.getFirstAsync<{ id: string }>(
        'SELECT id FROM timelines WHERE id = ? AND user_id = ?',
        id,
        userId,
      );
      if (!existing) return;

      if (sets.length > 0) {
        await txn.runAsync(
          `UPDATE timelines SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
          [...values, id, userId],
        );
      }

      if (entityIds !== undefined) {
        await replaceLinks(txn, userId, id, entityIds);
      }

      success = true;
    });

    return success;
  });
}

export async function remove(userId: string, id: string): Promise<boolean> {
  return serializeWrite(async () => {
    const db = await getDb();
    const result = await db.runAsync(
      'DELETE FROM timelines WHERE id = ? AND user_id = ?',
      id,
      userId,
    );
    return result.changes > 0;
  });
}

// Single indexed query for the Expenses page — a timeline row IS an expense when
// its local money columns are set AND its direction is not 'receive' (credit rows
// belong to the Money-to-Receive list, never the wallet sums). Legacy rows whose
// money_type is NULL (stamped before the direction column existed) still count as
// expenses. Self-contained SELECT: no entity join, so no N+1. Sorted newest-first
// by event date (same ordering as the Timeline feed).
export async function getExpenses(userId: string): Promise<Timeline[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TimelineRow>(
    `SELECT * FROM timelines
     WHERE user_id = ?
       AND expense_amount_paise IS NOT NULL
       AND (money_type IS NULL OR money_type = 'expense')
     ORDER BY event_date DESC`,
    userId,
  );
  return rows.map((row) => toTimeline(row, []));
}

// Credit / money-to-receive rows: local direction marker is 'receive'.
// Receive/Ignore actions from the Expenses page and entity money items write
// back through setReceivableStatus. Self-contained SELECT, newest-first by date.
export async function getReceivables(userId: string): Promise<Timeline[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TimelineRow>(
    `SELECT * FROM timelines
     WHERE user_id = ? AND money_type = 'receive' AND expense_amount_paise IS NOT NULL
     ORDER BY event_date DESC`,
    userId,
  );
  return rows.map((row) => toTimeline(row, []));
}

// Resolves a pending receivable: 'received' (settled) or 'ignored' (dismissed).
// Local-only lifecycle field — the backend never learns about it, and replaceAll
// snapshots it back onto the same row on every refresh.
export async function setReceivableStatus(
  userId: string,
  id: string,
  status: string,
): Promise<boolean> {
  return serializeWrite(async () => {
    const db = await getDb();
    const result = await db.runAsync(
      'UPDATE timelines SET receivable_status = ? WHERE id = ? AND user_id = ?',
      status,
      id,
      userId,
    );
    return result.changes > 0;
  });
}

export interface MoneyAttributionInput {
  role: MoneyType;
  amountPaise: number;
  category?: string | null;
  receivableStatus?: string | null;
}

// Stamps local-only money attribution onto an already-persisted timeline row
// (created server-first with a server id). `role` makes the direction explicit:
// 'expense' = debit, 'receive' = credit. For a pending receivable the caller
// omits receivableStatus (NULL stays Pending). No-op-safe for non-matching rows.
export async function setMoneyAttribution(
  userId: string,
  id: string,
  attribution: MoneyAttributionInput,
): Promise<boolean> {
  return serializeWrite(async () => {
    const db = await getDb();
    const result = await db.runAsync(
      `UPDATE timelines
       SET expense_amount_paise = ?, expense_category = ?, receivable_status = ?, money_type = ?
       WHERE id = ? AND user_id = ?`,
      attribution.amountPaise,
      attribution.category ?? null,
      attribution.receivableStatus ?? null,
      isMoneyType(attribution.role) ? attribution.role : 'expense',
      id,
      userId,
    );
    return result.changes > 0;
  });
}

async function upsertEntity(
  txn: SQLiteDatabase,
  userId: string,
  entity: Entity,
): Promise<void> {
  const existing = await txn.getFirstAsync<{ user_id: string }>(
    'SELECT user_id FROM entities WHERE id = ?',
    entity.id,
  );

  if (existing) {
    if (existing.user_id !== userId) {
      throw new Error('Cannot link entities that do not belong to the current user');
    }
    return;
  }

  await txn.runAsync(
    `INSERT INTO entities (id, user_id, name, type, description, avatar, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    entity.id,
    userId,
    entity.name,
    entity.type,
    entity.description ?? null,
    entity.avatar ?? null,
    entity.createdAt ?? null,
    entity.updatedAt ?? null,
  );
}

// Replaces the complete authenticated user's timeline collection plus their
// timeline <-> entity relationships in one transaction. Only rows owned by
// `userId` are touched. Referenced entity records are resolved against their
// canonical entity IDs (inserted when missing locally, never duplicated).
export async function replaceAll(userId: string, timelines: Timeline[]): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (txn) => {
      // withExclusiveTransactionAsync runs on a separate native connection where
      // PRAGMA foreign_keys is OFF, so the timelines DELETE below does NOT cascade
      // to timeline_entities. Clear the user's links explicitly to keep replaceAll
      // idempotent (mirrors replaceLinks) and avoid UNIQUE(timeline_id, entity_id).

      // Local-only money attribution (expense amount/category, receivable
      // status, direction) is never part of the server payload, so snapshot it
      // BEFORE the row is wiped and re-apply it on the re-inserted row. Without
      // this, every background refresh would erode money data to NULL.
      const priorMoney = await txn.getAllAsync<{
        id: string;
        expense_amount_paise: number | null;
        expense_category: string | null;
        receivable_status: string | null;
        money_type: string | null;
      }>(
        `SELECT id, expense_amount_paise, expense_category, receivable_status, money_type
         FROM timelines
         WHERE user_id = ? AND (expense_amount_paise IS NOT NULL OR receivable_status IS NOT NULL OR money_type IS NOT NULL)`,
        userId,
      );
      const priorMoneyById = new Map(priorMoney.map((r) => [r.id, r]));

      await txn.runAsync(
        `DELETE FROM timeline_entities
         WHERE timeline_id IN (SELECT id FROM timelines WHERE user_id = ?)`,
        userId,
      );

      await txn.runAsync('DELETE FROM timelines WHERE user_id = ?', userId);

      for (const timeline of timelines) {
        const links = Array.isArray(timeline.entities)
          ? timeline.entities.filter((l) => l && l.entityId && l.entity)
          : [];

        for (const link of links) {
          await upsertEntity(txn, userId, link.entity);
        }

        const prior = priorMoneyById.get(timeline.id);
        const merged = prior
          ? ({
              ...timeline,
              expenseAmountPaisa: prior.expense_amount_paise,
              expenseCategory: prior.expense_category ?? timeline.expenseCategory ?? null,
              receivableStatus: prior.receivable_status ?? timeline.receivableStatus ?? null,
              moneyType: isMoneyType(prior.money_type) ? prior.money_type : timeline.moneyType ?? null,
            } satisfies TimelineInput)
          : timeline;

        await txn.runAsync(
          `INSERT INTO timelines (id, user_id, title, description, event_date, show_on_calendar, created_at, updated_at, expense_amount_paise, expense_category, receivable_status, money_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          toTimelineRow(merged, userId),
        );

        for (const link of links) {
          await txn.runAsync(
            'INSERT INTO timeline_entities (timeline_id, entity_id) VALUES (?, ?)',
            timeline.id,
            link.entityId,
          );
        }
      }
    });
  });
}