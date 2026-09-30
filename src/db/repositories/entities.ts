import { getDb, serializeWrite } from '../database';
import type { Entity } from '../../models/types';

export interface EntityInput {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  avatar?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Local-only provenance; see the SMS note on Entity. */
  sourceNotificationId?: string | null;
}

export type EntityUpdate = Partial<Pick<Entity, 'name' | 'type' | 'description' | 'avatar'>> & {
  updatedAt?: string | null;
};

interface EntityRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  description: string | null;
  avatar: string | null;
  created_at: string | null;
  updated_at: string | null;
  source_notification_id: string | null;
}

const INSERT_SQL = `INSERT INTO entities (id, user_id, name, type, description, avatar, created_at, updated_at, source_notification_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertValues(entity: EntityInput | Entity, userId: string): (string | null)[] {
  return [
    entity.id,
    userId,
    entity.name,
    entity.type,
    entity.description ?? null,
    entity.avatar ?? null,
    entity.createdAt ?? null,
    entity.updatedAt ?? null,
    entity.sourceNotificationId ?? null,
  ];
}

function toEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    // The API answers 'Person'/'Place' in title case while the app compares
    // against 'PERSON'/'PLACE', so an entity created from an SMS did not match
    // any of those checks. Normalising once here keeps every screen's existing
    // comparison correct without touching each of them.
    type: (row.type ?? '').toUpperCase(),
    description: row.description,
    avatar: row.avatar,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceNotificationId: row.source_notification_id,
  };
}

export async function getAll(userId: string): Promise<Entity[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<EntityRow>(
    'SELECT * FROM entities WHERE user_id = ? ORDER BY name',
    userId,
  );
  return rows.map(toEntity);
}

export async function getById(userId: string, id: string): Promise<Entity | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<EntityRow>(
    'SELECT * FROM entities WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
  return row ? toEntity(row) : null;
}

/** Case-insensitive lookup by name to avoid creating duplicate entities. */
export async function findByName(userId: string, name: string): Promise<Entity | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<EntityRow>(
    'SELECT * FROM entities WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
    userId,
    name,
  );
  return row ? toEntity(row) : null;
}

export async function create(userId: string, entity: EntityInput): Promise<Entity> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.runAsync(INSERT_SQL, insertValues(entity, userId));
    return (await getById(userId, entity.id))!;
  });
}

export async function update(
  userId: string,
  id: string,
  changes: EntityUpdate,
): Promise<boolean> {
  return serializeWrite(async () => {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (changes.name !== undefined) {
      sets.push('name = ?');
      values.push(changes.name);
    }
    if (changes.type !== undefined) {
      sets.push('type = ?');
      values.push(changes.type);
    }
    if (changes.description !== undefined) {
      sets.push('description = ?');
      values.push(changes.description);
    }
    if (changes.avatar !== undefined) {
      sets.push('avatar = ?');
      values.push(changes.avatar);
    }
    if (changes.updatedAt !== undefined) {
      sets.push('updated_at = ?');
      values.push(changes.updatedAt);
    }

    if (sets.length === 0) return false;

    const db = await getDb();
    const result = await db.runAsync(
      `UPDATE entities SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      [...values, id, userId],
    );
    return result.changes > 0;
  });
}

export async function remove(userId: string, id: string): Promise<boolean> {
  return serializeWrite(async () => {
    const db = await getDb();
    const result = await db.runAsync(
      'DELETE FROM entities WHERE id = ? AND user_id = ?',
      id,
      userId,
    );
    return result.changes > 0;
  });
}

export async function replaceAll(userId: string, entities: Entity[]): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (txn) => {
      // Rows that only exist on this device. A captured SMS can create an entity
      // while the phone is offline, so the next server refresh would otherwise
      // delete work the user just did. Snapshot them (with their provenance) and
      // re-insert the ones the server does not know about.
      const localOnly = await txn.getAllAsync<EntityRow>(
        'SELECT * FROM entities WHERE user_id = ? AND source_notification_id IS NOT NULL',
        userId,
      );
      const incomingIds = new Set(entities.map((e) => e.id));
      const preserved = localOnly.filter((row) => !incomingIds.has(row.id));

      // Local-only provenance is never part of the server payload, so snapshot
      // and re-apply it onto rows the server does know about.
      const localSourceById = new Map(
        localOnly.filter((row) => incomingIds.has(row.id)).map((row) => [row.id, row.source_notification_id]),
      );

      await txn.runAsync('DELETE FROM entities WHERE user_id = ?', userId);
      for (const entity of entities) {
        await txn.runAsync(INSERT_SQL, insertValues(
          {
            ...entity,
            sourceNotificationId: localSourceById.get(entity.id) ?? entity.sourceNotificationId ?? null,
          },
          userId,
        ));
      }
      for (const row of preserved) {
        await txn.runAsync(INSERT_SQL, insertValues(toEntity(row), userId));
      }
    });
  });
}

// Persists canonical entity records referenced by timelines (from timeline
// responses) without creating duplicates. Existing records keep their owner
// and data; an id already owned by another user is rejected so relationships
// never leak across users. Runs in its own transaction, so call before
// starting a write transaction of your own.
export async function upsertEntities(
  userId: string,
  entities: Entity[],
): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const entity of entities) {
        const existing = await txn.getFirstAsync<{ user_id: string }>(
          'SELECT user_id FROM entities WHERE id = ?',
          entity.id,
        );

        if (existing) {
          if (existing.user_id !== userId) {
            throw new Error('Cannot link entities that do not belong to the current user');
          }
          continue;
        }

        await txn.runAsync(INSERT_SQL, insertValues(entity, userId));
      }
    });
  });
}