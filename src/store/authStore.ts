import { create } from 'zustand';
import * as api from '../api/apiService';
import { getErrorMessage } from '../api/client';
import type { AuthUser } from '../models/types';
import { session } from './session';
import {
  signInWithGoogle,
  signInWithApple,
  SocialAuthCancelledError,
} from '../services/socialAuth';

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  restoring: boolean;
  isLoading: boolean;
  error: string | null;
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (fullName: string, email: string, password: string) => Promise<boolean>;
  loginWithGoogle: () => Promise<boolean>;
  loginWithApple: () => Promise<boolean>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  restoring: true,
  isLoading: false,
  error: null,

  restore: async () => {
    try {
      const token = await session.getToken();
      if (!token) {
        set({ restoring: false });
        return;
      }
      const user = await session.getUser();
      if (user) {
        set({ user, isAuthenticated: true, restoring: false });
      } else {
        set({ restoring: false });
      }
    } catch {
      set({ restoring: false });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.login({ email, password });
      await session.saveAuth(res.accessToken, res.user);
      set({ user: res.user, isAuthenticated: true, isLoading: false });
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
      set({ user: res.user, isAuthenticated: true, isLoading: false });
      return true;
    } catch (e) {
      set({ isLoading: false, error: getErrorMessage(e) });
      return false;
    }
  },

  loginWithGoogle: async () => {
    set({ isLoading: true, error: null });
    try {
      const idToken = await signInWithGoogle();
      const res = await api.googleLogin(idToken);
      await session.saveAuth(res.accessToken, res.user);
      set({ user: res.user, isAuthenticated: true, isLoading: false });
      return true;
    } catch (e) {
      if (e instanceof SocialAuthCancelledError) {
        set({ isLoading: false, error: null });
        return false;
      }
      const message = getErrorMessage(e);
      set({ isLoading: false, error: message });
      return false;
    }
  },

  loginWithApple: async () => {
    set({ isLoading: true, error: null });
    try {
      const credential = await signInWithApple();
      const res = await api.appleLogin(credential);
      await session.saveAuth(res.accessToken, res.user);
      set({ user: res.user, isAuthenticated: true, isLoading: false });
      return true;
    } catch (e) {
      if (e instanceof SocialAuthCancelledError) {
        set({ isLoading: false, error: null });
        return false;
      }
      const message = getErrorMessage(e);
      set({ isLoading: false, error: message });
      return false;
    }
  },

  logout: async () => {
    await session.clear();
    set({ user: null, isAuthenticated: false, error: null });
  },

  setUser: (user) => {
    set({ user });
    void session.updateUser(user);
  },
}));
