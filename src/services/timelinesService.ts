import * as api from '../api/apiService';
import * as timelinesRepository from '../db/repositories/timelines';
import * as entitiesRepository from '../db/repositories/entities';
import type { CreateTimelineRequest, Timeline } from '../models/types';

// Coordination between the canonical API and the local SQLite cache.
// The API remains the source of truth; SQLite only mirrors confirmed server state.

function requireUserId(userId?: string): string {
  if (!userId) {
    throw new Error('User is not authenticated');
  }
  return userId;
}

function toTimelineInput(timeline: Timeline): timelinesRepository.TimelineInput {
  return {
    id: timeline.id,
    title: timeline.title,
    description: timeline.description ?? '',
    eventDate: timeline.eventDate,
    showOnCalendar: timeline.showOnCalendar,
    createdAt: timeline.createdAt ?? null,
    updatedAt: timeline.updatedAt ?? null,
  };
}

function entityIdsOf(timeline: Timeline): string[] {
  return Array.isArray(timeline.entities)
    ? timeline.entities.map((l) => l.entityId).filter(Boolean)
    : [];
}

// Persists a server-confirmed timeline and reconciles its timeline <-> entity
// relationships. Embedded entities (canonical IDs) are stored before linking so
// all relationships resolve. When the server response omits the entities array,
// the confirmed request's entityIds are used as the reconciled link set.
async function persistTimeline(
  userId: string,
  timeline: Timeline,
  requestEntityIds: string[],
): Promise<Timeline> {
  const embedded = Array.isArray(timeline.entities) ? timeline.entities : [];
  const linked =
    embedded.length > 0 ? entityIdsOf(timeline) : [...new Set(requestEntityIds)];

  if (embedded.length > 0) {
    await entitiesRepository.upsertEntities(
      userId,
      embedded.map((l) => l.entity),
    );
  }

  const stored = await timelinesRepository.update(
    userId,
    timeline.id,
    {
      title: timeline.title,
      description: timeline.description ?? '',
      eventDate: timeline.eventDate,
      showOnCalendar: timeline.showOnCalendar,
      updatedAt: timeline.updatedAt ?? null,
    },
    linked,
  );

  if (!stored) {
    await timelinesRepository.create(userId, toTimelineInput(timeline), linked);
  }

  return timeline;
}

export async function getCachedTimelines(userId?: string): Promise<Timeline[]> {
  const uid = requireUserId(userId);
  return timelinesRepository.getAll(uid);
}

export async function refreshTimelines(userId?: string): Promise<Timeline[]> {
  const uid = requireUserId(userId);
  const timelines = await api.getTimelines();
  await timelinesRepository.replaceAll(uid, timelines);
  return timelines;
}

export async function getTimelines(userId?: string): Promise<Timeline[]> {
  const uid = requireUserId(userId);
  const cached = await timelinesRepository.getAll(uid);
  if (cached.length > 0) {
    void refreshTimelines(uid).catch(() => {});
    return cached;
  }
  return refreshTimelines(uid);
}

export async function createTimeline(
  userId: string | undefined,
  request: CreateTimelineRequest,
): Promise<Timeline> {
  const uid = requireUserId(userId);
  const created = await api.createTimeline(request);
  return persistTimeline(uid, created, request.entityIds ?? []);
}

export async function updateTimeline(
  userId: string | undefined,
  id: string,
  request: CreateTimelineRequest,
): Promise<Timeline> {
  const uid = requireUserId(userId);
  const updated = await api.updateTimeline(id, request);
  return persistTimeline(uid, updated, request.entityIds ?? []);
}

export async function deleteTimeline(
  userId: string | undefined,
  id: string,
): Promise<void> {
  const uid = requireUserId(userId);
  await api.deleteTimeline(id);
  await timelinesRepository.remove(uid, id);
}