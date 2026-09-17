import * as api from '../api/apiService';
import * as entitiesRepository from '../db/repositories/entities';
import type { CreateEntityRequest, Entity } from '../models/types';

// Coordination between the canonical API and the local SQLite cache.
// The API remains the source of truth; SQLite only mirrors confirmed server state.

function requireUserId(userId?: string): string {
  if (!userId) {
    throw new Error('User is not authenticated');
  }
  return userId;
}

function toEntityInput(entity: Entity): entitiesRepository.EntityInput {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    description: entity.description ?? null,
    avatar: entity.avatar ?? null,
    createdAt: entity.createdAt ?? null,
    updatedAt: entity.updatedAt ?? null,
  };
}

async function persistEntity(userId: string, entity: Entity): Promise<Entity> {
  const stored = await entitiesRepository.update(userId, entity.id, {
    name: entity.name,
    type: entity.type,
    description: entity.description ?? null,
    avatar: entity.avatar ?? null,
    updatedAt: entity.updatedAt ?? null,
  });

  if (!stored) {
    await entitiesRepository.create(userId, toEntityInput(entity));
  }

  return entity;
}

export async function getCachedEntities(userId?: string): Promise<Entity[]> {
  const uid = requireUserId(userId);
  return entitiesRepository.getAll(uid);
}

export async function refreshEntities(userId?: string): Promise<Entity[]> {
  const uid = requireUserId(userId);
  const entities = await api.getEntities();
  await entitiesRepository.replaceAll(uid, entities);
  return entities;
}

export async function getEntities(userId?: string): Promise<Entity[]> {
  const uid = requireUserId(userId);
  const cached = await entitiesRepository.getAll(uid);
  if (cached.length > 0) {
    void refreshEntities(uid).catch(() => {});
    return cached;
  }
  return refreshEntities(uid);
}

export async function createEntity(
  userId: string | undefined,
  request: CreateEntityRequest,
): Promise<Entity> {
  const uid = requireUserId(userId);
  const created = await api.createEntity(request);
  return persistEntity(uid, created);
}

export async function updateEntity(
  userId: string | undefined,
  id: string,
  request: CreateEntityRequest,
): Promise<Entity> {
  const uid = requireUserId(userId);
  const updated = await api.updateEntity(id, request);
  return persistEntity(uid, updated);
}

export async function deleteEntity(
  userId: string | undefined,
  id: string,
): Promise<void> {
  const uid = requireUserId(userId);
  await api.deleteEntity(id);
  await entitiesRepository.remove(uid, id);
}
