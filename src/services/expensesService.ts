import * as timelinesRepository from '../db/repositories/timelines';
import * as timelinesService from './timelinesService';
import type { Expense, ExpenseMeta, Timeline } from '../models/types';
import { isExpenseCategory } from '../utils/money';

// Expense orchestration. An expense IS a timeline row carrying local-only
// expense attribution (amount in paise + category); this service is a thin,
// purpose-specific view over the existing Timeline repository/service so the
// Expenses page and the Timeline stay the SAME underlying record.

function requireUserId(userId?: string): string {
  if (!userId) {
    throw new Error('User is not authenticated');
  }
  return userId;
}

function asExpense(timeline: Timeline): Expense {
  if (timeline.expenseAmountPaisa == null) {
    throw new Error('Timeline entry is not an expense');
  }
  return {
    ...timeline,
    expenseAmountPaisa: timeline.expenseAmountPaisa,
    expenseCategory: timeline.expenseCategory ?? 'Other',
  };
}

// Instant render: local SQLite only, no network, no entity join (no N+1).
export async function getCachedExpenses(userId?: string): Promise<Expense[]> {
  const uid = requireUserId(userId);
  const rows = await timelinesRepository.getExpenses(uid);
  return rows.filter((t) => t.expenseAmountPaisa != null).map(asExpense);
}

// Instant render for credit / money-to-receive rows (receive direction). Same
// local-only playback as expenses, unresolved rows only — resolved ones leave
// the inbox to the entity money history.
export async function getCachedReceivables(userId?: string): Promise<Timeline[]> {
  const uid = requireUserId(userId);
  return timelinesRepository.getReceivables(uid);
}

// Resolves a pending receivable: 'received' (settled) or 'ignored' (dismissed).
// Writes ONLY the local status column on the same server-owned timeline row —
// no API call, survives refresh because replaceAll restores local money fields.
export async function setReceivableStatus(
  userId: string | undefined,
  timelineId: string,
  status: string,
): Promise<boolean> {
  const uid = requireUserId(userId);
  return timelinesRepository.setReceivableStatus(uid, timelineId, status);
}

// Cache-first: feetches local instantly and lets the existing background sync
// refresh timeline rows (replaceAll preserves the local expense columns).
export async function getExpenses(userId?: string): Promise<Expense[]> {
  const uid = requireUserId(userId);
  const all = await timelinesService.getTimelines(uid);
  return all.filter((t) => t.expenseAmountPaisa != null).map(asExpense);
}

export interface CreateExpenseInput {
  title: string;
  description: string;
  eventDate: string;
  amountPaise: number;
  category: string;
}

// Creates ONE timeline record server-first (existing contract), then stamps the
// expense attribution locally on that same row. The entry is a normal Timeline
// entry too, so it shows up in the Timeline feed and syncs like any other event.
export async function createExpense(
  userId: string | undefined,
  input: CreateExpenseInput,
): Promise<Expense> {
  const uid = requireUserId(userId);
  const category = isExpenseCategory(input.category) ? input.category : 'Other';
  const timeline = await timelinesService.createTimeline(
    uid,
    {
      title: input.title.trim() || input.description.trim() || 'Expense',
      description: input.description.trim(),
      eventDate: input.eventDate,
      entityIds: [],
      showOnCalendar: false,
    },
    { amountPaise: input.amountPaise, category } satisfies ExpenseMeta,
  );
  return asExpense(timeline);
}

// Deleting an expense reuses the existing local-first timeline delete (SQLite
// removal first, background API delete). Works fully offline for the local side.
export async function deleteExpense(
  userId: string | undefined,
  id: string,
): Promise<void> {
  const uid = requireUserId(userId);
  await timelinesService.deleteTimeline(uid, id);
}