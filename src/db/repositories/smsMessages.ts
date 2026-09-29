import { getDb, serializeWrite } from '../database';
import type { SmsMessage, SmsStatus } from '../../models/types';

/**
 * Local inbox for captured SIM SMS.
 *
 * Everything in here is per-device and private: raw bodies are never uploaded,
 * never logged, and the table is excluded from cloud backup (see
 * src/db/backupTables.ts). Rows are user-scoped like every other business table
 * so one account's messages can never surface under another.
 *
 * The table id is the stable message identity computed natively (hash of sender,
 * body and telephony timestamp), which makes capture idempotent: Android can
 * redeliver the same broadcast, and a duplicate INSERT is a no-op rather than a
 * second notification.
 */

export interface SmsInput {
  id: string;
  sender: string;
  body: string;
  /** ISO 8601. */
  receivedAt: string;
  isOtp: boolean;
}

export interface SmsSaveResult {
  /** True when this message was new, false when it was already known. */
  created: boolean;
  message: SmsMessage;
}

/** Processed/ignored messages older than this are pruned to bound local growth. */
const RESOLVED_RETENTION_DAYS = 30;
/** Pending messages older than this are pruned: an unseen month-old SMS is noise. */
const PENDING_RETENTION_DAYS = 90;

interface SmsRow {
  id: string;
  user_id: string;
  sender: string;
  body: string;
  received_at: string;
  status: SmsStatus;
  is_otp: number;
  notification_id: string | null;
  timeline_id: string | null;
  processed_at: string | null;
  created_at: string;
}

function toMessage(row: SmsRow): SmsMessage {
  return {
    id: row.id,
    userId: row.user_id,
    sender: row.sender,
    body: row.body,
    receivedAt: row.received_at,
    status: row.status,
    isOtp: row.is_otp === 1,
    notificationId: row.notification_id,
    timelineId: row.timeline_id,
    processedAt: row.processed_at,
    createdAt: row.created_at,
  };
}

function assertStatus(status: string): SmsStatus {
  if (status === 'PENDING' || status === 'IGNORED' || status === 'PROCESSED') return status;
  return 'PENDING';
}

export async function getById(userId: string, id: string): Promise<SmsMessage | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SmsRow>(
    'SELECT * FROM sms_messages WHERE id = ? AND user_id = ?',
    id,
    userId,
  );
  return row ? toMessage(row) : null;
}

export async function getByNotificationId(userId: string, notificationId: string): Promise<SmsMessage | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SmsRow>(
    'SELECT * FROM sms_messages WHERE notification_id = ? AND user_id = ?',
    notificationId,
    userId,
  );
  return row ? toMessage(row) : null;
}

/** Pending messages, newest first — the source for the notification center list. */
export async function listPending(userId: string): Promise<SmsMessage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SmsRow>(
    `SELECT * FROM sms_messages
     WHERE user_id = ? AND status = 'PENDING'
     ORDER BY received_at DESC`,
    userId,
  );
  return rows.map(toMessage);
}

export async function countPending(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM sms_messages WHERE user_id = ? AND status = 'PENDING'`,
    userId,
  );
  return row?.c ?? 0;
}

/**
 * Stores a captured message, ignoring one that is already known.
 *
 * Uses INSERT OR IGNORE on the primary key, so two racing ingests of the same
 * broadcast (for example a foreground drain and a start-up drain) cannot produce
 * a duplicate row. The second caller gets `created: false` and the existing row.
 */
export async function insertIfNew(
  userId: string,
  input: SmsInput,
): Promise<SmsSaveResult> {
  return serializeWrite(async () => {
    const db = await getDb();
    const result = await db.runAsync(
      `INSERT OR IGNORE INTO sms_messages
         (id, user_id, sender, body, received_at, status, is_otp, created_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      input.id,
      userId,
      input.sender,
      input.body,
      input.receivedAt,
      input.isOtp ? 1 : 0,
      new Date().toISOString(),
    );
    const message = await getById(userId, input.id);
    if (!message) {
      throw new Error('Failed to store captured SMS');
    }
    return { created: result.changes > 0, message };
  });
}

/** Links the inbox row to the notification it produced. */
export async function setNotificationId(
  userId: string,
  id: string,
  notificationId: string,
): Promise<void> {
  await serializeWrite(async () => {
    const db = await getDb();
    await db.runAsync(
      'UPDATE sms_messages SET notification_id = ? WHERE id = ? AND user_id = ?',
      notificationId,
      id,
      userId,
    );
  });
}

export interface SmsResolveInput {
  status: Extract<SmsStatus, 'IGNORED' | 'PROCESSED'>;
  timelineId?: string | null;
}

/**
 * Closes out a reviewed message.
 *
 * `timelineId` is stored for PROCESSED messages and is the idempotency key for
 * the save flow: if it is already set, the record was created before and the
 * caller must not create another one.
 */
export async function resolve(
  userId: string,
  id: string,
  input: SmsResolveInput,
): Promise<boolean> {
  return serializeWrite(async () => {
    const db = await getDb();
    const status = assertStatus(input.status);
    const result = await db.runAsync(
      `UPDATE sms_messages
       SET status = ?,
           timeline_id = COALESCE(?, timeline_id),
           processed_at = COALESCE(processed_at, ?)
       WHERE id = ? AND user_id = ?`,
      status,
      input.timelineId ?? null,
      new Date().toISOString(),
      id,
      userId,
    );
    return result.changes > 0;
  });
}

/**
 * Deletes message bodies that nobody is waiting on any more.
 *
 * Bodies are the sensitive part, so resolved messages are kept only briefly and
 * unreviewed ones are eventually dropped too. Only the review queue is
 * affected — the timeline/entity records a message produced are untouched.
 */
export async function prune(userId: string): Promise<number> {
  return serializeWrite(async () => {
    const db = await getDb();
    const result = await db.runAsync(
      `DELETE FROM sms_messages
       WHERE user_id = ?
         AND (
           (status IN ('IGNORED', 'PROCESSED')
             AND processed_at IS NOT NULL
             AND processed_at < datetime('now', ?))
           OR (status = 'PENDING'
             AND created_at < datetime('now', ?))
         )`,
      userId,
      `-${RESOLVED_RETENTION_DAYS} days`,
      `-${PENDING_RETENTION_DAYS} days`,
    );
    return result.changes;
  });
}

/** Count used by the Settings screen; no bodies are read. */
export async function countByStatus(userId: string): Promise<Record<SmsStatus, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ status: SmsStatus; c: number }>(
    'SELECT status, COUNT(*) AS c FROM sms_messages WHERE user_id = ? GROUP BY status',
    userId,
  );
  const out: Record<SmsStatus, number> = { PENDING: 0, IGNORED: 0, PROCESSED: 0 };
  for (const row of rows) out[assertStatus(row.status)] = row.c;
  return out;
}

/** Test/support helper: removes every message for a user. */
export async function clear(userId: string): Promise<number> {
  return serializeWrite(async () => {
    const db = await getDb();
    const result = await db.runAsync('DELETE FROM sms_messages WHERE user_id = ?', userId);
    return result.changes;
  });
}
