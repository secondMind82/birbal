import * as api from '../api/apiService';
import * as notesRepository from '../db/repositories/notes';
import type { CreateNoteRequest, Note } from '../models/types';

// Coordination between the canonical API and the local SQLite cache.
// The API remains the source of truth; SQLite only mirrors confirmed server state.

function requireUserId(userId?: string): string {
  if (!userId) {
    throw new Error('User is not authenticated');
  }
  return userId;
}

function toNoteInput(note: Note): notesRepository.NoteInput {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    pinned: note.pinned,
    createdAt: note.createdAt ?? null,
    updatedAt: note.updatedAt,
  };
}

async function persistNote(userId: string, note: Note): Promise<Note> {
  const stored = await notesRepository.update(userId, note.id, {
    title: note.title,
    content: note.content,
    pinned: note.pinned,
    updatedAt: note.updatedAt,
  });
  if (!stored) {
    await notesRepository.create(userId, toNoteInput(note));
  }
  return note;
}

export async function getCachedNotes(userId?: string): Promise<Note[]> {
  const uid = requireUserId(userId);
  return notesRepository.getAll(uid);
}

export async function refreshNotes(userId?: string): Promise<Note[]> {
  const uid = requireUserId(userId);
  const notes = await api.getNotes();
  await notesRepository.replaceAll(uid, notes);
  return notes;
}

export async function getNotes(userId?: string): Promise<Note[]> {
  const uid = requireUserId(userId);
  const cached = await notesRepository.getAll(uid);
  if (cached.length > 0) {
    void refreshNotes(uid).catch(() => {});
    return cached;
  }
  return refreshNotes(uid);
}

export async function createNote(
  userId: string | undefined,
  request: CreateNoteRequest,
): Promise<Note> {
  const uid = requireUserId(userId);
  const created = await api.createNote(request);
  return persistNote(uid, created);
}

export async function updateNote(
  userId: string | undefined,
  id: string,
  request: CreateNoteRequest,
): Promise<Note> {
  const uid = requireUserId(userId);
  const updated = await api.updateNote(id, request);
  return persistNote(uid, updated);
}

export async function deleteNote(
  userId: string | undefined,
  id: string,
): Promise<void> {
  const uid = requireUserId(userId);
  await notesRepository.remove(uid, id);
  void api.deleteNote(id).catch(() => {});
}

export async function togglePin(
  userId: string | undefined,
  note: Note,
): Promise<Note> {
  const uid = requireUserId(userId);
  const updated = await api.updateNote(note.id, {
    title: note.title,
    content: note.content,
    pinned: !note.pinned,
  });
  return persistNote(uid, updated);
}