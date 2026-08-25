import { create } from 'zustand';
import * as api from '../api/apiService';
import type { Timeline } from '../models/types';

interface NotificationState {
  reminders: Timeline[];
  notificationCount: number;
  loading: boolean;
  fetchReminders: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const useNotificationStore = create<NotificationState>((set) => ({
  reminders: [],
  notificationCount: 0,
  loading: false,

  fetchReminders: async () => {
    set({ loading: true });
    try {
      const timelines = await api.getTimelines();
      const now = Date.now();
      const in24h = now + 24 * 60 * 60 * 1000;
      const in30m = now + 30 * 60 * 1000;

      const upcoming = timelines.filter((t) => {
        const start = new Date(t.eventDate).getTime();
        return !isNaN(start) && start > now && start <= in24h;
      });
      upcoming.sort((a, b) => a.eventDate.localeCompare(b.eventDate));

      const count = timelines.filter((t) => {
        const start = new Date(t.eventDate).getTime();
        return !isNaN(start) && start > now && start <= in30m;
      }).length;

      set({ reminders: upcoming, notificationCount: count });
    } catch {
      set({ reminders: [], notificationCount: 0 });
    } finally {
      set({ loading: false });
    }
  },

  startPolling: () => {
    if (pollTimer) return;
    void useNotificationStore.getState().fetchReminders();
    pollTimer = setInterval(() => {
      void useNotificationStore.getState().fetchReminders();
    }, 60000);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    set({ reminders: [], notificationCount: 0 });
  },
}));
