import * as api from '../api/apiService';
import * as diaryRepository from '../db/repositories/diary';
import type { CreateDiaryRequest, DiaryEntry } from '../models/types';

// Coordination between the canonical API and the local SQLite cache.
// The API remains the source of truth; SQLite only mirrors confirmed server state.

function requireUserId(userId?: string): string {
  if (!userId) {
    throw new Error('User is not authenticated');
  }
  return userId;
}

function toDiaryInput(entry: DiaryEntry): diaryRepository.DiaryInput {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    mood: entry.mood,
    entryDate: entry.entryDate,
    createdAt: entry.createdAt ?? null,
    updatedAt: entry.updatedAt ?? null,
  };
}

async function persistEntry(userId: string, entry: DiaryEntry): Promise<DiaryEntry> {
  const stored = await diaryRepository.update(userId, entry.id, {
    title: entry.title,
    content: entry.content,
    mood: entry.mood,
    entryDate: entry.entryDate,
    updatedAt: entry.updatedAt ?? null,
  });
  if (!stored) {
    await diaryRepository.create(userId, toDiaryInput(entry));
  }
  return entry;
}

export async function getCachedDiary(userId?: string): Promise<DiaryEntry[]> {
  const uid = requireUserId(userId);
  return diaryRepository.getAll(uid);
}

export async function refreshDiary(userId?: string): Promise<DiaryEntry[]> {
  const uid = requireUserId(userId);
  const entries = await api.getDiaryEntries();
  await diaryRepository.replaceAll(uid, entries);
  return entries;
}

export async function getDiary(userId?: string): Promise<DiaryEntry[]> {
  const uid = requireUserId(userId);
  const cached = await diaryRepository.getAll(uid);
  if (cached.length > 0) {
    void refreshDiary(uid).catch(() => {});
    return cached;
  }
  return refreshDiary(uid);
}

export async function createEntry(
  userId: string | undefined,
  request: CreateDiaryRequest,
): Promise<DiaryEntry> {
  const uid = requireUserId(userId);
  const created = await api.createDiaryEntry(request);
  return persistEntry(uid, created);
}

export async function updateEntry(
  userId: string | undefined,
  id: string,
  request: CreateDiaryRequest,
): Promise<DiaryEntry> {
  const uid = requireUserId(userId);
  const updated = await api.updateDiaryEntry(id, request);
  return persistEntry(uid, updated);
}

export async function deleteEntry(
  userId: string | undefined,
  id: string,
): Promise<void> {
  const uid = requireUserId(userId);
  await api.deleteDiaryEntry(id);
  await diaryRepository.remove(uid, id);
}