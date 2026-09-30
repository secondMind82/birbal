// Money + local-date helpers for the Expenses feature.
//
// Amounts are stored as INTEGER paise (never floats) for exact math. Rupee display
// uses manual Indian digit grouping (1,23,456) so output is deterministic on both
// Hermes (no reliable Intl) and JSC. Date keys are built from LOCAL calendar values
// so "Today", "This Week" and "This Month" never drift across UTC boundaries.

import type { MoneyType, TimelineSource } from '../models/types';
import type { BirbalTheme } from '../theme';

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

// Keyword hints per category (English + common Hinglish spellings). First
// category with any hit wins, so priority order matters ('food' before bills).
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [ExpenseCategory, readonly string[]]> = [
  ['Grocery', ['grocery', 'grocerie', 'kirana', 'sabzi', 'vegetable', 'supermarket', 'dmart', 'd-mart', 'big bazaar', 'ration', 'milk']],
  ['Food', ['restaurant', 'cafe', 'café', 'dinner', 'lunch', 'breakfast', 'brunch', 'snack', 'food', 'pizza', 'biryani', 'chai', 'coffee', 'swiggy', 'zomato', 'eat']],
  ['Transport', ['fuel', 'petrol', 'diesel', 'cab', 'uber', 'ola', 'auto', 'taxi', 'bus', 'train', 'metro', 'rickshaw', 'bike', 'toll', 'parking', 'transport']],
  ['Shopping', ['shopping', 'clothes', 'dress', 'shirt', 'kurta', 'saree', 'shoes', 'mall', 'amazon', 'flipkart', 'jeans', 'trousers']],
  ['Bills', ['electricity', 'electric', 'water', 'gas', 'internet', 'wifi', 'recharge', 'mobile bill', 'phone', 'rent', 'emi', 'bill']],
  ['Health', ['medical', 'hospital', 'doctor', 'medicine', 'medicin', 'chemist', 'pharmacy', 'gym', 'clinic', 'health']],
  ['Entertainment', ['movie', 'cinema', 'concert', 'netflix', 'entertainment', 'game', 'cricket', 'football', 'holiday', 'trip']],
];

// Picks the most likely expense category from free text ("bought groceries" ->
// 'Grocery'). Falls back to 'Other' when nothing matches; credits (role
// 'receive') keep null and never take a category.
export function detectExpenseCategory(text: string | null | undefined): string {
  const lower = (' ' + (text ?? '').toLowerCase() + ' ');
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return 'Other';
}

// Direction values for the local money_type column on timeline rows.
export const MONEY_TYPES: readonly MoneyType[] = ['expense', 'receive'];

export function isMoneyType(value?: string | null): value is MoneyType {
  return !!value && (MONEY_TYPES as readonly string[]).includes(value);
}

// Values accepted in the local-only timelines.source column. Anything else is
// treated as NULL, which is what makes a server-owned row (source NULL) the
// only thing replaceAll is allowed to delete.
export const TIMELINE_SOURCES: readonly TimelineSource[] = ['SMS', 'MANUAL'];

export function isTimelineSource(value?: string | null): value is TimelineSource {
  return !!value && (TIMELINE_SOURCES as readonly string[]).includes(value);
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
/**
 * How a money row should look and read on the Timeline.
 *
 * The Timeline keeps every financial field it always had — Credit Received,
 * Credit Pending, Debit Amount, amount, and the Paid/Received/Pending status —
 * and this is the single place that decides which of them applies to a row, so
 * the card and the Expenses page can never disagree about what a record means.
 *
 * It lives here, rather than inside the screen, because "is this credit, and is
 * it settled?" is a rule about the data and not about how it is drawn.
 */
export type MoneyTone = 'received' | 'pending' | 'debit' | 'ignored';

export interface MoneyPresentation {
  tone: MoneyTone;
  /** Section heading over the amount, e.g. "Credit Received" / "Debit Amount". */
  amountLabel: string;
  /** Status badge text, e.g. "Received" / "Pending" / "Paid". */
  statusLabel: string;
  /** Short headline, e.g. "Payment Received". */
  headline: string;
  amountPaise: number;
  /** Category for a debit, when the row carries a meaningful one. */
  category?: string | null;
}

/** The money fields a presentation depends on. */
interface MoneyFields {
  moneyType?: MoneyType | null;
  expenseAmountPaisa?: number | null;
  receivableStatus?: string | null;
  expenseCategory?: string | null;
}

/**
 * Returns how to present a timeline row's money, or null when the row carries no
 * amount and so is not a financial card at all.
 *
 * Direction, not wording, decides the treatment: a NULL money_type is a debit
 * (those rows predate the direction column), and 'receive' is a credit whose
 * receivable status decides Received vs Pending.
 */
export function moneyPresentation(fields: MoneyFields): MoneyPresentation | null {
  const amount = fields.expenseAmountPaisa;
  if (amount == null) return null;

  if (fields.moneyType === 'receive') {
    if (isReceivablePending(fields.receivableStatus)) {
      return {
        tone: 'pending',
        amountLabel: 'Credit Pending',
        statusLabel: 'Pending',
        headline: 'Payment Pending',
        amountPaise: amount,
      };
    }
    if (fields.receivableStatus === 'received') {
      return {
        tone: 'received',
        amountLabel: 'Credit Received',
        statusLabel: 'Received',
        headline: 'Payment Received',
        amountPaise: amount,
      };
    }
    return {
      tone: 'ignored',
      amountLabel: 'Credit Ignored',
      statusLabel: 'Ignored',
      headline: 'Payment Ignored',
      amountPaise: amount,
    };
  }

  const category =
    fields.expenseCategory && fields.expenseCategory !== 'Other' ? fields.expenseCategory : null;
  return {
    tone: 'debit',
    amountLabel: 'Debit Amount',
    statusLabel: 'Paid',
    headline: 'Payment Made',
    amountPaise: amount,
    category,
  };
}

/**
 * A plain-text rendering of the same facts, for places that only have one line
 * (the current metadata row, accessibility labels and tests).
 */
export function moneyLine(fields: MoneyFields): string {
  const p = moneyPresentation(fields);
  if (!p) return '';
  const parts = [p.amountLabel, formatPaise(p.amountPaise), p.statusLabel];
  if (p.category) parts.push(p.category);
  return parts.join(' · ');
}

/**
 * The accent + very light wash for a money tone.
 *
 * Received reads green, Pending reads red, a dismissed credit reads neutral, and
 * a debit reads in the brand accent so it is clearly its own thing without
 * borrowing either status colour. Exported so the Timeline can tint the whole
 * card and this panel can tint its block from the same decision.
 */
export function moneyToneColors(
  t: BirbalTheme,
  tone: MoneyPresentation['tone'],
): { accent: string; wash: string } {
  return {
    accent:
      tone === 'received' ? t.success : tone === 'pending' ? t.danger : tone === 'ignored' ? t.textSecondary : t.accent,
    wash:
      tone === 'received'
        ? t.successSoft
        : tone === 'pending'
          ? t.dangerSoft
          : tone === 'ignored'
            ? t.surfaceVariant
            : t.accentSoft,
  };
}
