import { getDb, serializeWrite } from '../database';
import type { DiaryEntry } from '../../models/types';

export interface DiaryInput {
  id: string;
  title: string;
  content: string;
  mood: string;
  entryDate: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type DiaryUpdate = Partial<Pick<DiaryEntry, 'title' | 'content' | 'mood' | 'entryDate'>> & {
  updatedAt?: string | null;
};

interface DiaryRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  mood: string;
  entry_date: string;
  created_at: string | null;
  updated_at: string | null;
}

function toEntry(row: DiaryRow): DiaryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    mood: row.mood,
    entryDate: row.entry_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAll(userId: string): Promise<DiaryEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DiaryRow>(
    'SELECT * FROM diary_entries WHERE user_id = ? ORDER BY entry_date DESC, created_at DESC',
    userId,
  );
  return rows.map(toEntry);
}

export async function getById(userId: string, id: string): Promise<DiaryEntry | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DiaryRow>(
    'SELECT * FROM diary_entries WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
  return row ? toEntry(row) : null;
}

export async function create(userId: string, entry: DiaryInput): Promise<DiaryEntry> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO diary_entries (id, user_id, title, content, mood, entry_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      userId,
      entry.title,
      entry.content,
      entry.mood,
      entry.entryDate,
      entry.createdAt ?? null,
      entry.updatedAt ?? null,
    );
    return (await getById(userId, entry.id))!;
  });
}

export async function update(
  userId: string,
  id: string,
  changes: DiaryUpdate,
): Promise<boolean> {
  return serializeWrite(async () => {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (changes.title !== undefined) {
      sets.push('title = ?');
      values.push(changes.title);
    }
    if (changes.content !== undefined) {
      sets.push('content = ?');
      values.push(changes.content);
    }
    if (changes.mood !== undefined) {
      sets.push('mood = ?');
      values.push(changes.mood);
    }
    if (changes.entryDate !== undefined) {
      sets.push('entry_date = ?');
      values.push(changes.entryDate);
    }
    if (changes.updatedAt !== undefined) {
      sets.push('updated_at = ?');
      values.push(changes.updatedAt);
    }

    if (sets.length === 0) return false;

    const db = await getDb();
    const result = await db.runAsync(
      `UPDATE diary_entries SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      [...values, id, userId],
    );
    return result.changes > 0;
  });
}

export async function remove(userId: string, id: string): Promise<boolean> {
  return serializeWrite(async () => {
    const db = await getDb();
    const result = await db.runAsync(
      'DELETE FROM diary_entries WHERE id = ? AND user_id = ?',
      id,
      userId,
    );
    return result.changes > 0;
  });
}

export async function replaceAll(
  userId: string,
  entries: DiaryEntry[],
): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('DELETE FROM diary_entries WHERE user_id = ?', userId);
      for (const entry of entries) {
        await txn.runAsync(
          `INSERT INTO diary_entries (id, user_id, title, content, mood, entry_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          entry.id,
          userId,
          entry.title,
          entry.content,
          entry.mood,
          entry.entryDate,
          entry.createdAt ?? null,
          entry.updatedAt ?? null,
        );
      }
    });
  });
}