import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from './schema';

export const DATABASE_NAME = 'birbal.db';

let databasePromise: Promise<SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
      await runMigrations(db);
      return db;
    });
    databasePromise.catch(() => {
      databasePromise = null;
    });
  }
  return databasePromise;
}

export function initializeDatabase(): Promise<SQLiteDatabase> {
  return getDb();
}

export async function closeDatabase(): Promise<void> {
  if (databasePromise) {
    const db = await databasePromise;
    await db.closeAsync();
    databasePromise = null;
  }
}