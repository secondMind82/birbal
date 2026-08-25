import { create } from 'zustand';
import * as api from '../api/apiService';
import { getErrorMessage } from '../api/client';
import { session } from './session';
import type { AuthUser } from '../models/types';

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  restoring: boolean;
  isLoading: boolean;
  error: string | null;
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (fullName: string, email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  restoring: true,
  isLoading: false,
  error: null,

  restore: async () => {
    try {
      const token = await session.getToken();
      const user = await session.getUser();
      if (token && user) {
        set({ isAuthenticated: true, user });
      }
    } finally {
      set({ restoring: false });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.login({ email, password });
      await session.saveAuth(res.accessToken, res.user);
      set({ isAuthenticated: true, user: res.user, isLoading: false });
      return true;
    } catch (e) {
      set({ isLoading: false, error: getErrorMessage(e) });
      return false;
    }
  },

  signup: async (fullName, email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.signup({ fullName, email, password });
      await session.saveAuth(res.accessToken, res.user);
      set({ isAuthenticated: true, user: res.user, isLoading: false });
      return true;
    } catch (e) {
      set({ isLoading: false, error: getErrorMessage(e) });
      return false;
    }
  },

  logout: async () => {
    await session.clear();
    set({ isAuthenticated: false, user: null, error: null });
  },

  setUser: async (user) => {
    await session.updateUser(user);
    set({ user });
  },
}));
