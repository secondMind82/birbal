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
}

function toEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    description: row.description,
    avatar: row.avatar,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

export async function create(userId: string, entity: EntityInput): Promise<Entity> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.runAsync(
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
      await txn.runAsync('DELETE FROM entities WHERE user_id = ?', userId);
      for (const entity of entities) {
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
    });
  });
}