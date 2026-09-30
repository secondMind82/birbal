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

// Offline rows need an id before the server has assigned one. Mirrors the SMS
// flow's Crypto.randomUUID() suffix so the two local-only id shapes stay
// recognisable in a database dump.
function localIdSuffix(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

// Cache-first: fetches local instantly and lets the existing background sync
// refresh timeline rows (replaceAll preserves the local expense columns).
// Only the debit direction belongs here: a credit is money coming back, so
// counting it as an expense would double-count it against the same rupee. NULL
// money_type predates the direction column and means debit.
export async function getExpenses(userId?: string): Promise<Expense[]> {
  const uid = requireUserId(userId);
  const all = await timelinesService.getTimelines(uid);
  return all
    .filter((t) => t.expenseAmountPaisa != null && (t.moneyType == null || t.moneyType === 'expense'))
    .map(asExpense);
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
//
// Offline the server call cannot happen, so the row is written to SQLite instead
// and marked source='MANUAL'. That marker is what makes replaceAll hold the row
// back on later refreshes instead of deleting an expense the user just entered.
// This is the same local-first fallback the SMS save already uses, so there is
// still only one expenses table and one Timeline repository.
export async function createExpense(
  userId: string | undefined,
  input: CreateExpenseInput,
): Promise<Expense> {
  const uid = requireUserId(userId);
  const category = isExpenseCategory(input.category) ? input.category : 'Other';
  const title = input.title.trim() || input.description.trim() || 'Expense';
  const description = input.description.trim();

  try {
    const timeline = await timelinesService.createTimeline(
      uid,
      {
        title,
        description,
        eventDate: input.eventDate,
        entityIds: [],
        showOnCalendar: false,
      },
      { amountPaise: input.amountPaise, category } satisfies ExpenseMeta,
    );
    return asExpense(timeline);
  } catch {
    // Offline (or the server is down): keep the entry on-device rather than
    // losing it. The row is a normal timeline, so it appears in the Timeline too.
    const now = new Date().toISOString();
    const id = `tl-manual-${localIdSuffix()}`;
    await timelinesRepository.create(uid, {
      id,
      title,
      description,
      eventDate: input.eventDate,
      showOnCalendar: false,
      createdAt: now,
      updatedAt: now,
      expenseAmountPaisa: input.amountPaise,
      expenseCategory: category,
      moneyType: 'expense',
      source: 'MANUAL',
    });

    const stored = await timelinesRepository.getById(uid, id);
    if (!stored) {
      throw new Error('Failed to save the expense');
    }
    return asExpense(stored);
  }
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