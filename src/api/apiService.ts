import { client } from './client';
import type {
  AuthResponse,
  AuthUser,
  CreateDiaryRequest,
  CreateEntityRequest,
  CreateNoteRequest,
  CreateTimelineRequest,
  DashboardResponse,
  DiaryEntry,
  Entity,
  LoginRequest,
  Note,
  SimpleResponse,
  SignupRequest,
  Timeline,
  UpdateProfileRequest,
  UpdateProfileResponse,
} from '../models/types';

// Auth
export const login = (request: LoginRequest) =>
  client.post<AuthResponse>('auth/login', request).then((r) => r.data);

export const signup = (request: SignupRequest) =>
  client.post<AuthResponse>('auth/signup', request).then((r) => r.data);

export const googleLogin = (idToken: string) =>
  client.post<AuthResponse>('auth/google', { idToken }).then((r) => r.data);

export const appleLogin = (request: {
  identityToken: string;
  email?: string | null;
  fullName?: string;
}) => client.post<AuthResponse>('auth/apple', request).then((r) => r.data);

export const getProfile = () =>
  client.get<AuthUser>('auth/profile').then((r) => r.data);

export const updateProfile = (request: UpdateProfileRequest) =>
  client.patch<UpdateProfileResponse>('auth/profile', request).then((r) => r.data);

// Dashboard
export const getDashboard = () =>
  client.get<DashboardResponse>('dashboard').then((r) => r.data);

// Timeline
export const getTimelines = () =>
  client.get<Timeline[]>('timeline').then((r) => r.data);

export const createTimeline = (request: CreateTimelineRequest) =>
  client.post<Timeline>('timeline', request).then((r) => r.data);

export const updateTimeline = (id: string, request: CreateTimelineRequest) =>
  client.patch<Timeline>(`timeline/${id}`, request).then((r) => r.data);

export const deleteTimeline = (id: string) =>
  client.delete<SimpleResponse>(`timeline/${id}`).then((r) => r.data);

// Diary
export const getDiaryEntries = () =>
  client.get<DiaryEntry[]>('diary').then((r) => r.data);

export const createDiaryEntry = (request: CreateDiaryRequest) =>
  client.post<DiaryEntry>('diary', request).then((r) => r.data);

export const updateDiaryEntry = (id: string, request: CreateDiaryRequest) =>
  client.patch<DiaryEntry>(`diary/${id}`, request).then((r) => r.data);

export const deleteDiaryEntry = (id: string) =>
  client.delete<SimpleResponse>(`diary/${id}`).then((r) => r.data);

// Notes
export const getNotes = () =>
  client.get<Note[]>('notes').then((r) => r.data);

export const createNote = (request: CreateNoteRequest) =>
  client.post<Note>('notes', request).then((r) => r.data);

export const updateNote = (id: string, request: CreateNoteRequest) =>
  client.patch<Note>(`notes/${id}`, request).then((r) => r.data);

export const deleteNote = (id: string) =>
  client.delete<SimpleResponse>(`notes/${id}`).then((r) => r.data);

// Entities
export const getEntities = () =>
  client.get<Entity[]>('entities').then((r) => r.data);

export const createEntity = (request: CreateEntityRequest) =>
  client.post<Entity>('entities', request).then((r) => r.data);

export const updateEntity = (id: string, request: CreateEntityRequest) =>
  client.patch<Entity>(`entities/${id}`, request).then((r) => r.data);

export const deleteEntity = (id: string) =>
  client.delete<SimpleResponse>(`entities/${id}`).then((r) => r.data);
