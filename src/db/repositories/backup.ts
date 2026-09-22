import { getDb, serializeWrite } from '../database';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Entity } from '../../models/types';
import type { BackupPayload } from '../../models/types';

// Atomic restore writer for Backup & Restore.
//
// A logical backup is applied as ONE transaction so a failed/corrupted restore
// never leaves SQLite in a partially written state. Rows are deleted and
// re-inserted with their original IDs (relationships preserved) and re-scoped to
// the authenticated `userId`. timeline_entities is cleared explicitly because
// the exclusive transaction runs on a connection where PRAGMA foreign_keys is
// OFF (no ON DELETE CASCADE inside the transaction).

export interface RestoreCounts {
  notes: number;
  diaryEntries: number;
  entities: number;
  timelines: number;
  links: number;
}

type Exec = Pick<SQLiteDatabase, 'runAsync'>;

async function insertEntity(
  txn: Exec,
  userId: string,
  entity: Entity,
): Promise<void> {
  await txn.runAsync(
    `INSERT OR IGNORE INTO entities (id, user_id, name, type, description, avatar, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entity.id,
      userId,
      entity.name,
      entity.type,
      entity.description ?? null,
      entity.avatar ?? null,
      entity.createdAt ?? null,
      entity.updatedAt ?? null,
    ],
  );
}

export async function restoreFromBackup(
  userId: string,
  backup: BackupPayload,
): Promise<RestoreCounts> {
  const counts: RestoreCounts = {
    notes: backup.notes.length,
    diaryEntries: backup.diaryEntries.length,
    entities: backup.entities.length,
    timelines: backup.timelines.length,
    links: 0,
  };

  return serializeWrite(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (txn) => {
      // 1. Clear the user's current local data (join table first).
      await txn.runAsync(
        `DELETE FROM timeline_entities
         WHERE timeline_id IN (SELECT id FROM timelines WHERE user_id = ?)`,
        userId,
      );
      await txn.runAsync('DELETE FROM timelines WHERE user_id = ?', userId);
      await txn.runAsync('DELETE FROM entities WHERE user_id = ?', userId);
      await txn.runAsync('DELETE FROM diary_entries WHERE user_id = ?', userId);
      await txn.runAsync('DELETE FROM notes WHERE user_id = ?', userId);

      // 2. Entities.
      for (const entity of backup.entities) {
        await insertEntity(txn, userId, entity);
      }

      // 3. Timelines + their entity links. Linked entities embedded in a
      //    timeline (but absent from the entities array) are upserted first so
      //    every relationship resolves; existing ids are never duplicated.
      for (const timeline of backup.timelines) {
        const links = Array.isArray(timeline.entities)
          ? timeline.entities.filter((l) => l && l.entityId && l.entity)
          : [];

        for (const link of links) {
          await insertEntity(txn, userId, link.entity);
        }

        await txn.runAsync(
          `INSERT OR IGNORE INTO timelines (id, user_id, title, description, event_date, show_on_calendar, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            timeline.id,
            userId,
            timeline.title,
            timeline.description ?? '',
            timeline.eventDate,
            timeline.showOnCalendar ? 1 : 0,
            timeline.createdAt ?? null,
            timeline.updatedAt ?? null,
          ],
        );

        for (const link of links) {
          await txn.runAsync(
            `INSERT OR IGNORE INTO timeline_entities (timeline_id, entity_id) VALUES (?, ?)`,
            [timeline.id, link.entityId],
          );
          counts.links += 1;
        }
      }

      // 4. Notes.
      for (const note of backup.notes) {
        await txn.runAsync(
          `INSERT OR IGNORE INTO notes (id, user_id, title, content, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            note.id,
            userId,
            note.title,
            note.content,
            note.pinned ? 1 : 0,
            note.createdAt ?? null,
            note.updatedAt,
          ],
        );
      }

      // 5. Diary entries.
      for (const entry of backup.diaryEntries) {
        await txn.runAsync(
          `INSERT OR IGNORE INTO diary_entries (id, user_id, title, content, mood, entry_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.id,
            userId,
            entry.title,
            entry.content,
            entry.mood,
            entry.entryDate,
            entry.createdAt ?? null,
            entry.updatedAt ?? null,
          ],
        );
      }
    });

    return counts;
  });
}