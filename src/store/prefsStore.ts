import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export interface NotificationPrefs {
  morningHour: number;
  morningMinute: number;
  morningEnabled: boolean;
  eveningHour: number;
  eveningMinute: number;
  eveningEnabled: boolean;
  emailOnEvent: boolean;
  pushEnabled: boolean;
}

const KEY = 'notification_prefs';

const DEFAULT_PREFS: NotificationPrefs = {
  morningHour: 8,
  morningMinute: 0,
  morningEnabled: true,
  eveningHour: 18,
  eveningMinute: 0,
  eveningEnabled: true,
  emailOnEvent: false,
  pushEnabled: true,
};

interface PrefsState {
  prefs: NotificationPrefs;
  loaded: boolean;
  load: () => Promise<void>;
  setMorning: (on: boolean) => void;
  setEvening: (on: boolean) => void;
  setEmailOnEvent: (on: boolean) => void;
  setPushEnabled: (on: boolean) => void;
  setMorningTime: (h: number, m: number) => void;
  setEveningTime: (h: number, m: number) => void;
}

async function persist(prefs: NotificationPrefs) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(prefs));
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  prefs: { ...DEFAULT_PREFS },
  loaded: false,

  load: async () => {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) {
        set({ prefs: { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) }, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  setMorning: (morningEnabled) => {
    const prefs = { ...get().prefs, morningEnabled };
    set({ prefs });
    void persist(prefs);
  },

  setEvening: (eveningEnabled) => {
    const prefs = { ...get().prefs, eveningEnabled };
    set({ prefs });
    void persist(prefs);
  },

  setEmailOnEvent: (emailOnEvent) => {
    const prefs = { ...get().prefs, emailOnEvent };
    set({ prefs });
    void persist(prefs);
  },

  setPushEnabled: (pushEnabled) => {
    const prefs = { ...get().prefs, pushEnabled };
    set({ prefs });
    void persist(prefs);
  },

  setMorningTime: (morningHour, morningMinute) => {
    const prefs = { ...get().prefs, morningHour, morningMinute };
    set({ prefs });
    void persist(prefs);
  },

  setEveningTime: (eveningHour, eveningMinute) => {
    const prefs = { ...get().prefs, eveningHour, eveningMinute };
    set({ prefs });
    void persist(prefs);
  },
}));
