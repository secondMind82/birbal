import { getDb, serializeWrite } from '../database';
import type { AppNotification } from '../../models/types';

export interface NotificationInput {
  id: string;
  type: AppNotification['type'];
  title: string;
  message?: string | null;
  icon?: string | null;
  read?: boolean;
  entityId?: string | null;
  timelineId?: string | null;
  createdAt?: string | null;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string | null;
  icon: string | null;
  read: number;
  entity_id: string | null;
  timeline_id: string | null;
  created_at: string;
}

const NOTIFICATION_COLUMNS =
  'id, user_id, type, title, message, icon, read, entity_id, timeline_id, created_at';

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as AppNotification['type'],
    title: row.title,
    message: row.message,
    icon: row.icon,
    read: row.read === 1,
    entityId: row.entity_id,
    timelineId: row.timeline_id,
    createdAt: row.created_at,
  };
}

export async function getAll(userId: string): Promise<AppNotification[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<NotificationRow>(
    `SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE user_id = ? ORDER BY read ASC, created_at DESC`,
    userId,
  );
  return rows.map(toNotification);
}

export async function countUnread(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read = 0',
    userId,
  );
  return row?.count ?? 0;
}

// INSERT OR IGNORE keeps notification ids idempotent: re-running generation on
// every refresh/app start never duplicates a notification with a stable id.
export async function upsertAll(userId: string, items: NotificationInput[]): Promise<void> {
  if (items.length === 0) return;
  return serializeWrite(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const item of items) {
        await txn.runAsync(
          `INSERT OR IGNORE INTO notifications
             (id, user_id, type, title, message, icon, read, entity_id, timeline_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          item.id,
          userId,
          item.type,
          item.title,
          item.message ?? null,
          item.icon ?? null,
          item.read ? 1 : 0,
          item.entityId ?? null,
          item.timelineId ?? null,
          item.createdAt ?? new Date().toISOString(),
        );
      }
    });
  });
}

export async function markRead(userId: string, id: string): Promise<boolean> {
  return serializeWrite(async () => {
    const db = await getDb();
    const result = await db.runAsync(
      'UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?',
      id,
      userId,
    );
    return result.changes > 0;
  });
}

export async function markAllRead(userId: string): Promise<void> {
  return serializeWrite(async () => {
    const db = await getDb();
    await db.runAsync(
      'UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0',
      userId,
    );
  });
}