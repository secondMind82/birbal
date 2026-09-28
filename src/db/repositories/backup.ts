import { getDb, serializeWrite } from '../database';
import {
  clearSnapshot as engineClearSnapshot,
  getLatestSnapshotWith,
  readSnapshot,
  restoreFromSnapshotWith,
  restoreRows as engineRestoreRows,
  saveSnapshotWith,
  type BackupDb,
  type BackupExecutor,
  type RestoreResult,
  type StoredSnapshot,
} from '../backupEngine';
import type { BackupRows } from '../models/backupRows';

// Device-bound wrappers around the pure engine in ../backupEngine.
//
// Every write goes through serializeWrite, the app's single write queue, so a
// restore can never interleave with a normal repository write.

export type { BackupRows, BackupDb, BackupExecutor, RestoreResult, StoredSnapshot };
export { readSnapshot };

export interface RestoreOptions {
  takeSnapshot?: boolean;
  appVersion?: string | null;
  schemaVersion?: number;
  reason?: string;
}

async function db(): Promise<BackupDb> {
  return (await getDb()) as unknown as BackupDb;
}

export async function getLatestSnapshot(userId: string): Promise<StoredSnapshot | null> {
  return getLatestSnapshotWith(await db(), userId);
}

/** Captures the user's current local state as a rollback safety net. */
export async function saveSnapshot(
  userId: string,
  reason: string,
  appVersion: string | null,
  schemaVersion: number,
): Promise<string> {
  return serializeWrite(async () => saveSnapshotWith(await db(), userId, reason, appVersion, schemaVersion));
}

/** Replaces the user's local rows with a validated backup, in one transaction. */
export async function restoreRows(
  userId: string,
  data: BackupRows,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  return serializeWrite(async () => engineRestoreRows(await db(), userId, data, options));
}

/** Rolls local data back to the pre-restore snapshot. */
export async function restoreFromSnapshot(userId: string): Promise<RestoreResult> {
  return serializeWrite(async () => restoreFromSnapshotWith(await db(), userId));
}

export async function clearSnapshot(userId: string): Promise<void> {
  return serializeWrite(async () => {
    await engineClearSnapshot(await db(), userId);
  });
}
