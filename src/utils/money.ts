// Money + local-date helpers for the Expenses feature.
//
// Amounts are stored as INTEGER paise (never floats) for exact math. Rupee display
// uses manual Indian digit grouping (1,23,456) so output is deterministic on both
// Hermes (no reliable Intl) and JSC. Date keys are built from LOCAL calendar values
// so "Today", "This Week" and "This Month" never drift across UTC boundaries.

import type { MoneyType } from '../models/types';

export const EXPENSE_CATEGORIES = [
  'Grocery',
  'Food',
  'Transport',
  'Shopping',
  'Bills',
  'Health',
  'Entertainment',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

// Direction values for the local money_type column on timeline rows.
export const MONEY_TYPES: readonly MoneyType[] = ['expense', 'receive'];

export function isMoneyType(value?: string | null): value is MoneyType {
  return !!value && (MONEY_TYPES as readonly string[]).includes(value);
}

// Receivable lifecycle on a receive-direction entry. Pending = classified but
// not yet actioned; the user resolves it with Receive (settled) or Ignore.
export const RECEIVABLE_STATUSES = ['pending', 'received', 'ignored'] as const;

export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

// Full money status vocabulary for both directions: CREDIT entries are
// 'pending' (default) or 'received' (money already back); DEBIT entries are
// 'paid'. 'ignored' is the user's explicit dismissal on a credit entry.
export const MONEY_STATUSES = ['pending', 'received', 'paid', 'ignored'] as const;

export type MoneyStatus = (typeof MONEY_STATUSES)[number];

export function isMoneyStatus(value?: string | null): value is MoneyStatus {
  return !!value && (MONEY_STATUSES as readonly string[]).includes(value);
}

export function isReceivableStatus(value?: string | null): value is ReceivableStatus {
  return !!value && (RECEIVABLE_STATUSES as readonly string[]).includes(value);
}

// NULL (legacy) or 'pending' both mean unresolved.
export function isReceivablePending(status?: string | null): boolean {
  return !isReceivableStatus(status) || status === 'pending';
}

// Accepts "1250", "1,250", "1,250.50", "₹1,250", "Rs 1250". Returns paise or null.
export function parseAmountToPaise(raw: string): number | null {
  const cleaned = (raw ?? '').replace(/₹|Rs\.?|,|\s|−|\-/g, '').trim();
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const rupees = parseInt(match[1], 10);
  const paise = match[2] ? parseInt(match[2].padEnd(2, '0'), 10) : 0;
  const total = rupees * 100 + paise;
  if (!Number.isFinite(total) || total <= 0) return null;
  return total;
}

// 123456 -> "1,23,456"
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 0) {
    const take = Math.min(2, rest.length);
    parts.unshift(rest.slice(rest.length - take));
    rest = rest.slice(0, rest.length - take);
  }
  return parts.join(',') + ',' + last3;
}

// paise -> "₹1,250" (whole rupees) or "₹1,250.50" (has paise).
export function formatPaise(paise: number | null | undefined): string {
  if (paise == null || !Number.isFinite(paise)) return '₹0';
  const rupees = Math.floor(paise / 100);
  const p = Math.round(paise % 100);
  const sign = rupees < 0 ? '−' : '';
  const body = groupIndian(String(Math.abs(rupees)));
  return `${sign}₹${body}${p ? '.' + String(p).padStart(2, '0') : ''}`;
}

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function localMonthKey(d: Date): string {
  return localDateKey(d).slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en', { month: 'long', year: 'numeric' });
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + delta);
  return localMonthKey(d);
}

// Local 12am today — every "Today" boundary uses the device clock, never UTC.
export function todayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function weekStart(): Date {
  const start = todayStart();
  start.setDate(start.getDate() - start.getDay());
  return start;
}

export function yearStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1);
}

// Length of the period following `start` (exclusive end).
export function periodEndsInDays(start: Date, days: number): Date {
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return end;
}