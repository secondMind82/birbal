import axios from 'axios';
import { session } from '../store/session';

export const BASE_URL = 'https://secondbrain-api-nv4i.onrender.com/';

export const client = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use(async (config) => {
  const token = await session.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) return data.message;
    if (error.response) return `Server error (${error.response.status})`;
    return 'Network error. Check your internet connection.';
  }
  return 'Something went wrong. Please try again.';
}
