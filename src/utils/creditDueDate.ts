const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_PATTERN = MONTHS.join('|');
const WEEKDAYS = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday';
const DATE_TOKEN = String.raw`(?:today|tomorrow|${WEEKDAYS}|\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTH_PATTERN})\s+\d{4}|(?:${MONTH_PATTERN})\s+\d{1,2},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4})`;

export type CreditDueGroup = 'Overdue' | 'Due Today' | 'Upcoming' | 'No Due Date';

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDate(year: number, monthIndex: number, day: number): Date | null {
  const date = new Date(year, monthIndex, day);
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return null;
  return date;
}

function dateFromToken(token: string, now: Date): Date | null {
  const normalized = token.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/, '$1');
  if (normalized === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (normalized === 'tomorrow') {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    date.setDate(date.getDate() + 1);
    return date;
  }
  const weekday = WEEKDAYS.split('|').indexOf(normalized);
  if (weekday >= 0) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7));
    return date;
  }

  let match = normalized.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (match) return validDate(Number(match[3]), MONTHS.indexOf(match[2]), Number(match[1]));
  match = normalized.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match) return validDate(Number(match[3]), MONTHS.indexOf(match[1]), Number(match[2]));
  match = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return validDate(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return null;
}

/** Extract a date only when text explicitly associates it with repayment. */
export function extractCreditDueDate(text: string, now: Date = new Date()): string | null {
  const dueDateCue = new RegExp(String.raw`\bdue(?:\s+date)?\s+(?:(?:on|by)\s+)?(${DATE_TOKEN})\b`, 'i');
  const repaymentCue = new RegExp(
    String.raw`\b(?:will|shall|should|can|is\s+going\s+to)\s+(?:return|repay|pay\s+back|give\s+me)\b[^.!?;]{0,120}?\b(?:on|by)\s+(${DATE_TOKEN})\b`,
    'i',
  );
  const match = text.match(dueDateCue) ?? text.match(repaymentCue);
  if (!match?.[1]) return null;
  const date = dateFromToken(match[1], now);
  return date ? localDateKey(date) : null;
}

export function classifyCreditDueDate(
  dueDate: string | null | undefined,
  now: Date = new Date(),
): CreditDueGroup {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return 'No Due Date';
  const [, year, month, day] = dueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  if (!year || !validDate(Number(year), Number(month) - 1, Number(day))) return 'No Due Date';
  const dueKey = dueDate;
  const todayKey = localDateKey(now);
  if (dueKey < todayKey) return 'Overdue';
  if (dueKey === todayKey) return 'Due Today';
  return 'Upcoming';
}

/** Date-only credit reminders fire at 9:00 AM in the device's local timezone. */
export function creditDueReminderTime(dueDate: string): Date | null {
  const match = dueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = validDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!date) return null;
  date.setHours(9, 0, 0, 0);
  return date;
}
