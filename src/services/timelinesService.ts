import * as api from '../api/apiService';
import * as timelinesRepository from '../db/repositories/timelines';
import * as entitiesRepository from '../db/repositories/entities';
import { isMoneyType } from '../utils/money';
import { cancelEventReminder, scheduleEventReminder } from './notificationScheduler';
import type { ExpenseMeta, CreateTimelineRequest, Timeline, MoneyType } from '../models/types';

// Coordination between the canonical API and the local SQLite cache.
// The API remains the source of truth; SQLite only mirrors confirmed server state.
// Money attribution is the one deliberately local-only exception: it lives on the
// timeline row (amount + direction + receivable lifecycle), is never sent to the
// backend, and is preserved by replaceAll.

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
    expenseAmountPaisa: timeline.expenseAmountPaisa ?? null,
    expenseCategory: timeline.expenseCategory ?? null,
  };
}

function entityIdsOf(timeline: Timeline): string[] {
  return Array.isArray(timeline.entities)
    ? timeline.entities.map((l) => l.entityId).filter(Boolean)
    : [];
}

// Directional money attribution passed by callers (e.g. the parser's own
// classification: 'receive' = credit, 'expense' = debit). Amount is paise.
// `status` is the optional derived lifecycle hook (CREDIT pending/received,
// DEBIT paid) — when absent the attribution is stamped without touching status.
export interface MoneyAttribution {
  role: MoneyType;
  amountPaise: number;
  category?: string | null;
  status?: string;
}

// Normalizes both accepted money shapes into one attested attribution. ExpenseMeta
// (the manual Add Expense form) implies 'expense' and always carries a category;
// MoneyAttribution (parser output) carries an explicit role and optional category
// (a credit keeps null; an expense defaults to 'Other'). MoneyType is attested
// against the local vocabulary before it is trusted.
function toMoneyAttribution(money: ExpenseMeta | MoneyAttribution): MoneyAttribution {
  if ('role' in money) {
    return {
      role: isMoneyType(money.role) ? money.role : 'expense',
      amountPaise: money.amountPaise,
      category: money.category ?? (money.role === 'receive' ? null : 'Other'),
      status: money.status,
    };
  }
  return { role: 'expense', amountPaise: money.amountPaise, category: money.category };
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

  // Holdover timestamps come wholesale from the server. Expense attribution is
  // passed through ONLY when the input carries it, so editing an expense from the
  // Timeline screen (whose server payload lacks expense fields) never erases it.
  const changes: timelinesRepository.TimelineUpdate = {
    title: timeline.title,
    description: timeline.description ?? '',
    eventDate: timeline.eventDate,
    showOnCalendar: timeline.showOnCalendar,
    updatedAt: timeline.updatedAt ?? null,
  };
  if (timeline.expenseAmountPaisa !== undefined) {
    changes.expenseAmountPaisa = timeline.expenseAmountPaisa;
    changes.expenseCategory = timeline.expenseCategory ?? null;
  }

  const stored = await timelinesRepository.update(userId, timeline.id, changes, linked);

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
  // Return the persisted rows, not the raw server payload: local-only money
  // attribution (amount/direction/receivable status) lives in SQLite and is
  // absent from the API response, so callers must read it back from the DB.
  return timelinesRepository.getAll(uid);
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
  money?: ExpenseMeta | MoneyAttribution,
): Promise<Timeline> {
  const uid = requireUserId(userId);
  const created = await api.createTimeline(request);
  const persisted = await persistTimeline(uid, created, request.entityIds ?? []);
  if (money) {
    const attribution = toMoneyAttribution(money);
    // Local-only stamp on the SAME server-owned row — the backend never learns
    // about money fields, so keeping them consistent is our responsibility.
    await timelinesRepository.setMoneyAttribution(uid, persisted.id, {
      role: attribution.role,
      amountPaise: attribution.amountPaise,
      category: attribution.category ?? null,
      receivableStatus: attribution.status ?? null,
    });
    persisted.expenseAmountPaisa = attribution.amountPaise;
    persisted.expenseCategory = attribution.category ?? null;
    persisted.moneyType = attribution.role;
    persisted.receivableStatus = attribution.status ?? null;
  } else {
    // Park the device-level local notification for the event (stable id dedupes).
    void scheduleEventReminder(created).catch(() => {});
  }
  return persisted;
}

export async function updateTimeline(
  userId: string | undefined,
  id: string,
  request: CreateTimelineRequest,
  money?: ExpenseMeta | MoneyAttribution,
): Promise<Timeline> {
  const uid = requireUserId(userId);
  const updated = await api.updateTimeline(id, request);
  const persisted = await persistTimeline(uid, updated, request.entityIds ?? []);
  if (money) {
    const attribution = toMoneyAttribution(money);
    await timelinesRepository.setMoneyAttribution(uid, persisted.id, {
      role: attribution.role,
      amountPaise: attribution.amountPaise,
      category: attribution.category ?? null,
      receivableStatus: attribution.status ?? null,
    });
    persisted.expenseAmountPaisa = attribution.amountPaise;
    persisted.expenseCategory = attribution.category ?? null;
    persisted.moneyType = attribution.role;
    persisted.receivableStatus = attribution.status ?? null;
  } else {
    // Reschedule the same event slot with the new date/time (old one is cancelled
    // inside scheduleEventReminder before the updated one is parked).
    void scheduleEventReminder(updated).catch(() => {});
  }
  return persisted;
}

export async function deleteTimeline(
  userId: string | undefined,
  id: string,
): Promise<void> {
  const uid = requireUserId(userId);
  await timelinesRepository.remove(uid, id);
  void cancelEventReminder(id).catch(() => {});
  void api.deleteTimeline(id).catch(() => {});
}