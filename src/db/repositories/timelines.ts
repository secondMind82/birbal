import { getDb } from '../database';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Timeline, TimelineEntityLink, Entity } from '../../models/types';

export interface TimelineInput {
  id: string;
  title: string;
  description?: string | null;
  eventDate: string;
  showOnCalendar: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type TimelineUpdate = Partial<
  Pick<Timeline, 'title' | 'description' | 'eventDate' | 'showOnCalendar'>
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
): [string, string, string, string, string, number, string | null, string | null] {
  return [
    data.id,
    userId,
    data.title,
    data.description ?? '',
    data.eventDate,
    data.showOnCalendar ? 1 : 0,
    data.createdAt ?? null,
    data.updatedAt ?? null,
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
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const values = toTimelineRow(timeline, userId);
    await txn.runAsync(
      `INSERT INTO timelines (id, user_id, title, description, event_date, show_on_calendar, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      values,
    );
    if (entityIds !== undefined && entityIds.length > 0) {
      await replaceLinks(txn, userId, timeline.id, entityIds);
    }
  });
  return (await getById(userId, timeline.id))!;
}

export async function update(
  userId: string,
  id: string,
  changes: TimelineUpdate,
  entityIds?: string[],
): Promise<boolean> {
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
}

export async function remove(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.runAsync(
    'DELETE FROM timelines WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
  return result.changes > 0;
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
  const db = await getDb();
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM timelines WHERE user_id = ?', userId);

    for (const timeline of timelines) {
      const links = Array.isArray(timeline.entities)
        ? timeline.entities.filter((l) => l && l.entityId && l.entity)
        : [];

      for (const link of links) {
        await upsertEntity(txn, userId, link.entity);
      }

      await txn.runAsync(
        `INSERT INTO timelines (id, user_id, title, description, event_date, show_on_calendar, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        toTimelineRow(timeline, userId),
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
}