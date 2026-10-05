import axios from 'axios';
import Constants from 'expo-constants';
import * as api from '../api/apiService';
import { getDb } from '../db/database';
import { SCHEMA_VERSION } from '../db/schema';
import { validateBackupRows } from '../db/backupValidation';
import {
  getLatestSnapshot,
  readSnapshot,
  restoreFromSnapshot,
  restoreRows,
  type BackupRows,
  type RestoreResult,
} from '../db/repositories/backup';
import { computeRecordCounts, describeCounts } from './backupCounts';
import { checksumsMatch, checksumOfData } from './backupIntegrity';
import { migrateV1ToV2Rows } from './backupMigration';
import type {
  BackupEncoding,
  BackupPayload,
  BackupV1Payload,
  BackupV2Payload,
  BackupInfo,
  BackupMetadata,
} from '../models/types';

// Birbal's Backup & Restore, mobile half.
//
// Safety model
// ------------
//   * Payloads never contain credentials — only user-owned SQLite rows.
//   * Ownership comes from the authenticated session. `payload.userId` is
//     cross-checked locally and re-asserted on write, never trusted.
//   * Everything is validated (version, structure, checksum) BEFORE the first
//     write, and the write itself is one transaction preceded by a committed
//     local safety snapshot.
//   * A restore never mixes in rows from another account, and repeating the
//     same restore twice produces the same local state.

export const BACKUP_VERSION = 2;
export const MIN_SUPPORTED_BACKUP_VERSION = 1;

export type BackupPhase = 'idle' | 'preparing' | 'uploading' | 'downloading' | 'validating' | 'restoring' | 'done';

export interface BackupProgress {
  phase: BackupPhase;
  message: string;
}

export interface RestoreSummary {
  totalRows: number;
  rowsByTable: Record<string, number>;
  /** Human-facing counts: "12 timelines · 5 events · 3 expenses". */
  label: string;
  backupCreatedAt: string | null;
  fromSnapshot: boolean;
}

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export type BackupErrorCode =
  | 'unauthenticated'
  | 'offline'
  | 'not-found'
  | 'invalid'
  | 'checksum'
  | 'version'
  | 'forbidden'
  | 'server'
  | 'unknown';

function appVersion(): string {
  const version =
    Constants.expoConfig?.version ??
    (Constants.expoConfig?.extra as { birbalVersion?: string } | undefined)?.birbalVersion;
  return typeof version === 'string' && version.length > 0 ? version : 'unknown';
}

function requireUserId(userId?: string | null): string {
  if (!userId || typeof userId !== 'string') {
    throw new BackupError('unauthenticated', 'Sign in to back up or restore your data.');
  }
  return userId;
}

/** Maps a transport/API failure onto a message the user can act on. */
function describeError(error: unknown): BackupError {
  if (error instanceof BackupError) return error;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (!error.response) {
      return new BackupError(
        'offline',
        'Internet connection is required to back up or restore data.',
      );
    }
    if (status === 404) {
      return new BackupError('not-found', 'No backup found for this account.');
    }
    if (status === 401 || status === 403) {
      return new BackupError(
        'forbidden',
        'This backup belongs to a different account. Sign in with the original account to restore it.',
      );
    }
    if (status === 413) {
      return new BackupError('server', 'This backup is too large to upload.');
    }
    return new BackupError('server', 'The backup service is unavailable right now. Try again shortly.');
  }

  if (error instanceof Error) {
    return new BackupError('invalid', error.message);
  }
  return new BackupError('unknown', 'Backup failed for an unknown reason.');
}

// ─── Concurrency guard ───────────────────────────────────────────────────────
// Prevents a double-tap (or a backup racing a restore) from interleaving writes.
// Module-scoped, so every screen shares the same lock.
let inFlight: Promise<unknown> | null = null;

async function exclusive<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight) {
    throw new BackupError('unknown', 'Another backup or restore is already in progress.');
  }
  const promise = run();
  inFlight = promise;
  try {
    return await promise;
  } finally {
    if (inFlight === promise) inFlight = null;
  }
}

export function isBackupBusy(): boolean {
  return inFlight !== null;
}

// ─── Building ────────────────────────────────────────────────────────────────

/**
 * Reads local SQLite and assembles the v2 envelope. No network access; the
 * payload is a raw, checksummed snapshot of the user's own rows.
 */
export async function buildBackup(
  userId: string,
  onProgress?: (p: BackupProgress) => void,
): Promise<BackupV2Payload> {
  const uid = requireUserId(userId);
  onProgress?.({ phase: 'preparing', message: 'Reading your data…' });

  const db = await getDb();
  const data = await readSnapshot(db, uid);

  // TEMP DEBUG: Log timeline money rows
  try {
    const timelines = Array.isArray(data.timelines) ? data.timelines : [];
    const moneyRows = timelines.filter((t: any) => 
      t.expense_amount_paise !== null && t.expense_amount_paise !== undefined
    );
    console.log('[BACKUP DEBUG] buildBackup - uid:', uid);
    console.log('[BACKUP DEBUG] timelines total:', timelines.length);
    console.log('[BACKUP DEBUG] money-related timelines:', moneyRows.length);
    moneyRows.forEach((t: any, i: number) => {
      console.log(`[BACKUP DEBUG] money[${i}]:`, {
        id: t.id,
        amt: t.expense_amount_paise,
        money_type: t.money_type,
        receivable_status: t.receivable_status,
        expense_category: t.expense_category,
        source: t.source,
        source_notification_id: t.source_notification_id,
      });
    });
  } catch (e) {
    console.error('[BACKUP DEBUG] logging failed:', e);
  }

  const validation = validateBackupRows(data);
  if (!validation.ok) {
    throw new BackupError('invalid', `Local data could not be prepared: ${validation.error}`);
  }

  onProgress?.({ phase: 'preparing', message: 'Securing your data…' });
  const checksum = await checksumOfData(data);

  return {
    backupVersion: BACKUP_VERSION,
    appVersion: appVersion(),
    encoding: 'json' as BackupEncoding,
    createdAt: new Date().toISOString(),
    userId: uid,
    recordCounts: computeRecordCounts(data),
    checksum,
    data,
  };
}

/** Uploads a fresh snapshot for the authenticated account. */
export async function uploadBackup(
  userId?: string | null,
  onProgress?: (p: BackupProgress) => void,
): Promise<{ metadata: BackupMetadata; totalRows: number }> {
  const uid = requireUserId(userId);
  return exclusive(async () => {
    const payload = await buildBackup(uid, onProgress);
    const totalRows = payload.recordCounts.total ?? 0;
    onProgress?.({
      phase: 'uploading',
      message: `Uploading ${totalRows} record${totalRows === 1 ? '' : 's'}…`,
    });
    const metadata = await api.createBackup(payload);
    onProgress?.({ phase: 'done', message: 'Backup complete' });
    void notifyBackupComplete(totalRows);
    return { metadata, totalRows };
  });
}

// ─── Reading cloud state ─────────────────────────────────────────────────────

/**
 * Metadata-only lookup used by Settings. Returns null when the account has no
 * backup yet; a real connectivity failure is surfaced instead of being
 * reported as "no backup", so the UI never lies about the account's state.
 */
export async function getLatestBackupInfo(userId?: string | null): Promise<BackupInfo | null> {
  requireUserId(userId);
  try {
    return await api.getLatestBackup(false);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    throw describeError(error);
  }
}

export async function listBackups(userId?: string | null): Promise<BackupMetadata[]> {
  requireUserId(userId);
  try {
    return await api.listBackups(20);
  } catch (error) {
    throw describeError(error);
  }
}

// ─── Restoring ───────────────────────────────────────────────────────────────

/** Envelope shape as seen after only shallow validation. */
type RawBackupEnvelope = {
  backupVersion?: unknown;
  appVersion?: unknown;
  encoding?: unknown;
  createdAt?: unknown;
  userId?: unknown;
  checksum?: unknown;
  recordCounts?: unknown;
  data?: unknown;
};

/** Verifies envelope version, ownership and (when present) the data checksum. */
export async function validatePayload(
  payload: unknown,
  expectedUserId: string,
): Promise<BackupRows> {
  if (!payload || typeof payload !== 'object') {
    throw new BackupError('invalid', 'This backup is not in a readable format.');
  }
  const p = payload as RawBackupEnvelope;
  const version = p.backupVersion;

  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new BackupError('invalid', 'This backup has no valid version marker.');
  }
  if (version > BACKUP_VERSION || version < MIN_SUPPORTED_BACKUP_VERSION) {
    throw new BackupError(
      'version',
      version > BACKUP_VERSION
        ? 'This backup was made by a newer version of Birbal. Update the app to restore it.'
        : 'This backup format is too old to restore. Please update the app.',
    );
  }
  // Reject anything this build cannot decode rather than hashing a string that
  // was meant to be an object. The checksum is only meaningful for plain JSON.
  const encoding = typeof p.encoding === 'string' ? p.encoding : 'json';
  if (encoding !== 'json') {
    throw new BackupError(
      'version',
      'This backup is compressed in a format this version of Birbal cannot read. Please update the app.',
    );
  }
  if (typeof p.userId !== 'string' || p.userId !== expectedUserId) {
    throw new BackupError(
      'forbidden',
      'This backup belongs to a different account. Sign in with the original account to restore it.',
    );
  }

  // v1 → v2, then validate and integrity-check the upgraded rows.
  const data: BackupRows =
    version === 1
      ? migrateV1ToV2Rows(payload as BackupV1Payload)
      : (p.data as BackupRows);

  const validation = validateBackupRows(data);
  if (!validation.ok) {
    throw new BackupError('invalid', `This backup cannot be restored: ${validation.error}`);
  }

  if (version === 2 && typeof p.checksum === 'string' && p.checksum.length > 0) {
    const actual = await checksumOfData(data);
    if (!checksumsMatch(actual, p.checksum)) {
      throw new BackupError(
        'checksum',
        'This backup is damaged and was not restored. Your existing data is untouched.',
      );
    }
  }

  return data;
}

async function afterRestoreRefresh(userId: string): Promise<void> {
  // The restored rows replace what the repositories cached, so every derived
  // surface has to be rebuilt: local notifications (read state included) and
  // the event reminders derived from `timelines`.
  try {
    const { useNotificationStore } = await import('../store/notificationStore');
    await useNotificationStore.getState().refresh();
  } catch {
    // A notification refresh failure must not fail an otherwise good restore.
  }
  try {
    const { resyncEventReminders } = await import('./notificationScheduler');
    await resyncEventReminders(userId);
  } catch {
    // Same reasoning: reminders are rebuilt on next launch.
  }
}

async function notifyBackupComplete(totalRows: number): Promise<void> {
  try {
    const { useNotificationStore } = await import('../store/notificationStore');
    await useNotificationStore.getState().system(
      'Backup completed',
      `${totalRows} record${totalRows === 1 ? '' : 's'} saved to your Birbal account.`,
    );
  } catch {
    // Cosmetic only.
  }
}

/**
 * Downloads the latest cloud backup for the authenticated account and replaces
 * local data with it. Validates fully, saves a local safety snapshot, restores
 * in one transaction and refreshes derived state. A repeated restore of the
 * same backup is a no-op.
 */
export async function restoreLatestBackup(
  userId?: string | null,
  onProgress?: (p: BackupProgress) => void,
): Promise<RestoreSummary> {
  const uid = requireUserId(userId);
  return exclusive(async () => {
    onProgress?.({ phase: 'downloading', message: 'Downloading your backup…' });

    let info: BackupInfo;
    try {
      info = await api.getLatestBackup(true);
    } catch (error) {
      throw describeError(error);
    }
    if (!info?.payload) {
      throw new BackupError('not-found', 'No backup found for this account.');
    }

    onProgress?.({ phase: 'validating', message: 'Verifying your backup…' });
    const data = await validatePayload(info.payload, uid);

    onProgress?.({ phase: 'restoring', message: 'Restoring your data…' });
    let result: RestoreResult;
    try {
      result = await restoreRows(uid, data, {
        appVersion: appVersion(),
        schemaVersion: SCHEMA_VERSION,
        reason: 'pre-restore',
      });
    } catch (error) {
      // SQLite rolled back, so local data is still the pre-restore state.
      throw new BackupError(
        'invalid',
        `Your data could not be restored and was left unchanged. ${describeError(error).message}`,
      );
    }

    await afterRestoreRefresh(uid);
    onProgress?.({ phase: 'done', message: 'Restore complete' });

    return {
      totalRows: result.totalRows,
      rowsByTable: result.rowsByTable,
      label: describeCounts(computeRecordCounts(data)),
      backupCreatedAt: typeof info.createdAt === 'string' ? info.createdAt : null,
      fromSnapshot: false,
    };
  });
}

/** Undoes the most recent restore using the pre-restore local snapshot. */
export async function rollbackRestore(
  userId?: string | null,
  onProgress?: (p: BackupProgress) => void,
): Promise<RestoreSummary> {
  const uid = requireUserId(userId);
  return exclusive(async () => {
    onProgress?.({ phase: 'restoring', message: 'Rolling back to your previous data…' });
    let result: RestoreResult;
    try {
      result = await restoreFromSnapshot(uid);
    } catch (error) {
      throw describeError(error);
    }
    await afterRestoreRefresh(uid);
    onProgress?.({ phase: 'done', message: 'Rollback complete' });
    return {
      totalRows: result.totalRows,
      rowsByTable: result.rowsByTable,
      label: describeCounts(result.rowsByTable),
      backupCreatedAt: null,
      fromSnapshot: true,
    };
  });
}

export async function hasLocalSnapshot(userId?: string | null): Promise<boolean> {
  const uid = requireUserId(userId);
  return (await getLatestSnapshot(uid)) !== null;
}

export { describeError as describeBackupError, appVersion as getAppVersion };
