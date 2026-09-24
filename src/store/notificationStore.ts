import { create } from 'zustand';
import * as notificationsRepository from '../db/repositories/notifications';
import type { NotificationInput } from '../db/repositories/notifications';
import type { AppNotification, Timeline } from '../models/types';
import * as timelinesService from '../services/timelinesService';
import { parseActivity } from '../utils/activityParser';
import { useAuthStore } from './authStore';

interface NotificationState {
  notifications: AppNotification[];
  notificationCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  system: (title: string, message: string) => Promise<void>;
  push: (input: NotificationInput) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

function cleanTitle(timeline: Timeline): string {
  return (timeline.title ?? '').replace(/@/g, '').trim() || 'Event Details';
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

// Derives notifications from genuine app data (upcoming events, reminders,
// birthdays, recent timeline entries). Stable ids + INSERT OR IGNORE make the
// set idempotent across refreshes and app restarts.
function buildNotifications(timelines: Timeline[]): NotificationInput[] {
  const now = Date.now();
  const out: NotificationInput[] = [];

  for (const t of timelines) {
    const d = new Date(t.eventDate);
    const start = d.getTime();
    if (isNaN(start)) continue;

    const title = cleanTitle(t);
    const firstEntity = (t.entities ?? [])[0]?.entity;
    const person = (t.entities ?? []).find((l) => l.entity.type === 'PERSON')?.entity;
    const timeText = d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });

    // Upcoming event + reminder within the window
    if (start > now && start <= now + 24 * 60 * 60 * 1000) {
      const mins = Math.max(1, Math.round((start - now) / 60000));
      if (start <= now + 30 * 60 * 1000) {
        out.push({
          id: `rem-${t.id}`,
          type: 'REMINDER',
          title: 'Reminder',
          message: `"${title}" is scheduled for ${timeText}.`,
          icon: '⏰',
          timelineId: t.id,
          entityId: firstEntity?.id,
          createdAt: new Date(now).toISOString(),
        });
      }
      out.push({
        id: `evt-${t.id}`,
        type: 'EVENT',
        title,
        message:
          mins < 60
            ? `Starts in ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`
            : `Starts in ${Math.floor(mins / 60)} ${
                Math.floor(mins / 60) === 1 ? 'hour' : 'hours'
              }.`,
        icon: '📅',
        timelineId: t.id,
        entityId: firstEntity?.id,
        createdAt: new Date(now).toISOString(),
      });
    }

    // Birthday today
    if (isToday(d)) {
      const parsed = parseActivity(`${t.title} ${t.description ?? ''}`);
      if (/BIRTHDAY/i.test(parsed.title)) {
        const name = person?.name ?? title;
        out.push({
          id: `bday-${t.id}-${d.toISOString().slice(0, 10)}`,
          type: 'BIRTHDAY',
          title: 'Birthday reminder',
          message: `${name}'s birthday is today.`,
          icon: '🎂',
          entityId: person?.id ?? firstEntity?.id,
          timelineId: t.id,
          createdAt: new Date(now).toISOString(),
        });
      }
    }

    // Recently added timeline entry
    const created = t.createdAt ? new Date(t.createdAt).getTime() : start;
    if (!isNaN(created) && created > now - 60 * 60 * 1000 && created <= now + 60000) {
      out.push({
        id: `tl-${t.id}`,
        type: 'TIMELINE',
        title: 'Timeline updated',
        message: `"${title}" was added to your timeline.`,
        icon: '✨',
        timelineId: t.id,
        entityId: firstEntity?.id,
        createdAt: t.createdAt ?? new Date(now).toISOString(),
      });
    }
  }

  return out;
}

function recomputeNotifications(
  notifications: AppNotification[],
  unread: number,
): Partial<NotificationState> {
  return { notifications, notificationCount: unread };
}

async function pushSystem(title: string, message: string): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  await notificationsRepository.upsertAll(userId, [
    {
      id: `sys-${Date.now()}`,
      type: 'SYSTEM',
      title,
      message,
      icon: '💾',
      createdAt: new Date().toISOString(),
    },
  ]);
  const notifications = await notificationsRepository.getAll(userId);
  const unread = await notificationsRepository.countUnread(userId);
  useNotificationStore.setState(recomputeNotifications(notifications, unread));
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  notificationCount: 0,
  loading: false,

  refresh: async () => {
    const userId = currentUserId();
    if (!userId) return;
    set({ loading: true });
    try {
      const timelines = await timelinesService.getTimelines(userId);
      await notificationsRepository.upsertAll(userId, buildNotifications(timelines));
      const notifications = await notificationsRepository.getAll(userId);
      const unread = await notificationsRepository.countUnread(userId);
      set({ ...recomputeNotifications(notifications, unread), loading: false });
    } catch {
      const notifications = await notificationsRepository.getAll(userId).catch(() => []);
      const unread = await notificationsRepository.countUnread(userId).catch(() => 0);
      set({ ...recomputeNotifications(notifications, unread), loading: false });
    }
  },

  markRead: async (id: string) => {
    const userId = currentUserId();
    if (!userId) return;
    await notificationsRepository.markRead(userId, id);
    const list = get().notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n,
    );
    set(recomputeNotifications(list, Math.max(0, get().notificationCount - 1)));
  },

  markAllRead: async () => {
    const userId = currentUserId();
    if (!userId) return;
    await notificationsRepository.markAllRead(userId);
    set(recomputeNotifications(
      get().notifications.map((n) => ({ ...n, read: true })),
      0,
    ));
  },

  system: pushSystem,

  // Persists a single externally-sourced notification (e.g. a real-device local
  // notification that fired) and refreshes the in-memory list + unread count.
  push: async (input: NotificationInput) => {
    const userId = currentUserId();
    if (!userId) return;
    await notificationsRepository.upsertAll(userId, [input]);
    const notifications = await notificationsRepository.getAll(userId);
    const unread = await notificationsRepository.countUnread(userId);
    set(recomputeNotifications(notifications, unread));
  },

  startPolling: () => {
    if (pollTimer) return;
    void get().refresh();
    pollTimer = setInterval(() => {
      void get().refresh();
    }, 60000);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));