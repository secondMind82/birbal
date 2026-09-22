import axios from 'axios';
import * as api from '../api/apiService';
import * as notesRepository from '../db/repositories/notes';
import * as diaryRepository from '../db/repositories/diary';
import * as entitiesRepository from '../db/repositories/entities';
import * as timelinesRepository from '../db/repositories/timelines';
import { restoreFromBackup } from '../db/repositories/backup';
import type { RestoreCounts } from '../db/repositories/backup';
import type { BackupInfo, BackupMetadata, BackupPayload } from '../models/types';

export const BACKUP_VERSION = 1;

function requireUserId(userId?: string): string {
  if (!userId) {
    throw new Error('User is not authenticated');
  }
  return userId;
}

function nowIso(): string {
  return new Date().toISOString();
}

// Reads the authenticated user's local SQLite data and assembles a versioned,
// logical backup object. No server round-trip happens here; the payload is a
// plain snapshot of the productivity tables in their existing model shapes.
export async function buildBackup(userId: string): Promise<BackupPayload> {
  const [notes, diaryEntries, entities, timelines] = await Promise.all([
    notesRepository.getAll(userId),
    diaryRepository.getAll(userId),
    entitiesRepository.getAll(userId),
    timelinesRepository.getAll(userId),
  ]);
  const stamp = nowIso();
  return {
    backupVersion: BACKUP_VERSION,
    createdAt: stamp,
    updatedAt: stamp,
    userId,
    notes,
    diaryEntries,
    entities,
    timelines,
  };
}

export async function uploadBackup(userId?: string): Promise<BackupMetadata> {
  const uid = requireUserId(userId);
  const payload = await buildBackup(uid);
  return api.createBackup(payload);
}

// Fetches backup metadata (no payload) to detect whether a backup exists and to
// display the latest backup date in Settings. Returns null when the account has
// no backup yet. Network/protocol failures propagate so the UI can stay neutral.
export async function getLatestBackupInfo(userId?: string): Promise<BackupInfo | null> {
  requireUserId(userId);
  try {
    return await api.getLatestBackup();
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) {
      return null;
    }
    throw e;
  }
}

// Light but strict structural validation: correct version, ownership and the
// exact array shape the repositories + restore writer expect. Runs fully before
// any write so a corrupted payload can never touch SQLite.
export function validateBackup(value: unknown, expectedUserId: string): value is BackupPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as BackupPayload;
  if (p.backupVersion !== BACKUP_VERSION) return false;
  if (p.userId !== expectedUserId) return false;
  if (typeof p.createdAt !== 'string' || typeof p.updatedAt !== 'string') return false;
  const arrays: Array<{ id?: unknown }[] | undefined> = [
    p.notes,
    p.diaryEntries,
    p.entities,
    p.timelines,
  ];
  return arrays.every(
    (list) => Array.isArray(list) && list.every((item) => item && typeof item.id === 'string'),
  );
}

// Downloads the latest cloud backup for the authenticated user and restores it
// into local SQLite inside a single transaction. Ownership is re-checked both
// by the server (req.user.id) and locally against the authenticated user.
export async function restoreLatestBackup(
  userId?: string,
): Promise<{ restored: boolean; counts: RestoreCounts }> {
  const uid = requireUserId(userId);
  const info = await api.getLatestBackup(true);
  if (!info?.payload) {
    throw new Error('No backup available');
  }
  if (!validateBackup(info.payload, uid)) {
    throw new Error('Backup is invalid or unsupported');
  }
  const counts = await restoreFromBackup(uid, info.payload);
  return { restored: true, counts };
}