import { getDb, serializeWrite } from '../database';
import type { Note } from '../../models/types';

export interface NoteInput {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  createdAt?: string | null;
  updatedAt: string;
}

export type NoteUpdate = Partial<Pick<Note, 'title' | 'content' | 'pinned'>> & {
  updatedAt?: string;
};

interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  pinned: number;
  created_at: string | null;
  updated_at: string;
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    content: row.content,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAll(userId: string): Promise<Note[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<NoteRow>(
    'SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC',
    userId,
  );
  return rows.map(toNote);
}

export async function getById(userId: string, id: string): Promise<Note | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<NoteRow>(
    'SELECT * FROM notes WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
  return row ? toNote(row) : null;
}

export async function create(userId: string, note: NoteInput): Promise<Note> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO notes (id, user_id, title, content, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      note.id,
      userId,
      note.title,
      note.content,
      note.pinned ? 1 : 0,
      note.createdAt ?? null,
      note.updatedAt,
    );
    return (await getById(userId, note.id))!;
  });
}

export async function update(
  userId: string,
  id: string,
  changes: NoteUpdate,
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
    if (changes.pinned !== undefined) {
      sets.push('pinned = ?');
      values.push(changes.pinned ? 1 : 0);
    }
    if (changes.updatedAt !== undefined) {
      sets.push('updated_at = ?');
      values.push(changes.updatedAt);
    }

    if (sets.length === 0) return false;

    const db = await getDb();
    const result = await db.runAsync(
      `UPDATE notes SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      [...values, id, userId],
    );
    return result.changes > 0;
  });
}

export async function remove(userId: string, id: string): Promise<boolean> {
  return serializeWrite(async () => {
    const db = await getDb();
    const result = await db.runAsync(
      'DELETE FROM notes WHERE id = ? AND user_id = ?',
      id,
      userId,
    );
    return result.changes > 0;
  });
}

export async function replaceAll(userId: string, notes: Note[]): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('DELETE FROM notes WHERE user_id = ?', userId);
      for (const note of notes) {
        await txn.runAsync(
          `INSERT INTO notes (id, user_id, title, content, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          note.id,
          userId,
          note.title,
          note.content,
          note.pinned ? 1 : 0,
          note.createdAt ?? null,
          note.updatedAt,
        );
      }
    });
  });
}