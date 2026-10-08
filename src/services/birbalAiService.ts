import * as api from '../api/apiService';
import * as diaryService from './diaryService';
import * as entitiesService from './entitiesService';
import * as expensesService from './expensesService';
import * as notesService from './notesService';
import * as timelinesService from './timelinesService';
import {
  formatPaise,
  isReceivablePending,
  localDateKey,
  localMonthKey,
  monthLabel,
  moneyLine,
} from '../utils/money';
import type { Timeline } from '../models/types';

// Birbal AI: a READ-ONLY conversational bridge. Context is assembled here, in
// the app, from the local SQLite cache (money attribution lives only on-device,
// so it can never be sent to the backend — but it IS only ever read here). The
// backend /ai/chat endpoint is inert: it just forwards the message + context to
// Gemini and returns text. No record is ever created, updated or deleted.

export interface BirbalAiResult {
  ok: boolean;
  reason?: 'network' | 'empty' | 'malformed';
  reply?: string;
}

// Bounded slices so the context stays controlled — never the entire database.
const MAX_TIMELINES = 15;
const MAX_ENTITIES = 20;
const MAX_NOTES = 15;
const MAX_DIARY = 10;

type Intent = 'money' | 'people' | 'today' | 'notes' | 'diary' | 'greeting' | 'overview';

function detectIntent(message: string): Intent {
  const q = ` ${message.toLowerCase().replace(/[.,!?]/g, '')} `;
  if (/\b(pending|credit|money|owe|owed|paid|spend|spent|expense|expenses|debit|receive|received|amount|rupee|rupees|rs\.?|₹)\b/.test(q)) {
    return 'money';
  }
  if (/\b(contact|person|people|friend|met|meet|someone|who is|who|entity|entities)\b/.test(q)) {
    return 'people';
  }
  if (/\b(today|tonight|yesterday|this week|calendar|upcoming|timeline|schedule)\b/.test(q)) {
    return 'today';
  }
  if (/\b(note|notes|memo|journal|idea|ideas)\b/.test(q)) {
    return 'notes';
  }
  if (/\b(diary|mood|feeling|how (?:was|am) i)\b/.test(q)) {
    return 'diary';
  }
  if (/\b(hello|hi|hey|namaste|summary|overview|what can you do|help)\b/.test(q)) {
    return 'greeting';
  }
  return 'overview';
}

function personNameOf(timeline: Timeline): string | undefined {
  return timeline.entities?.[0]?.entity?.name ?? undefined;
}

function sortNewestFirst<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(b).localeCompare(key(a)));
}

function moneyEntry(timeline: Timeline) {
  const amount = timeline.expenseAmountPaisa;
  if (amount == null) return undefined;
  const isCredit = timeline.moneyType === 'receive';
  const pending = isCredit && isReceivablePending(timeline.receivableStatus);
  return {
    what: timeline.title || timeline.description || 'Record',
    person: personNameOf(timeline),
    amount: formatPaise(amount),
    kind: isCredit ? (pending ? 'credit-pending' : 'credit') : 'expense',
  };
}

/**
 * Builds a controlled, read-only context object for a single question.
 * Only the slices relevant to the detected intent are included, all bounded.
 */
export async function buildContext(
  userId: string,
  userName: string | undefined,
  message: string,
): Promise<Record<string, unknown>> {
  const now = new Date();
  const monthKey = localMonthKey(now);
  const intent = detectIntent(message);

  const base = {
    userName,
    asOf: now.toISOString(),
    dayLabel: now.toLocaleDateString('en', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }),
  };

  if (intent === 'notes') {
    const notes = await notesService.getCachedNotes(userId);
    return {
      ...base,
      notes: sortNewestFirst(notes, (n) => n.updatedAt ?? n.createdAt ?? '')
        .slice(0, MAX_NOTES)
        .map((n) => ({ title: n.title, content: n.content })),
    };
  }

  if (intent === 'diary') {
    const diary = await diaryService.getCachedDiary(userId);
    return {
      ...base,
      diary: sortNewestFirst(diary, (d) => d.entryDate)
        .slice(0, MAX_DIARY)
        .map((d) => ({ date: d.entryDate.slice(0, 10), title: d.title, content: d.content, mood: d.mood })),
    };
  }

  const [timelines, entities] = await Promise.all([
    timelinesService.getCachedTimelines(userId),
    entitiesService.getCachedEntities(userId),
  ]);

  if (intent === 'money') {
    const expenses = await expensesService.getCachedExpenses(userId);
    const credits = timelines
      .filter((t) => t.moneyType === 'receive' && t.expenseAmountPaisa != null)
      .filter((t) => isReceivablePending(t.receivableStatus));
    const monthExpenses = expenses.filter(
      (e) => localMonthKey(new Date(e.eventDate)) === monthKey,
    );
    const spent = monthExpenses.reduce((sum, e) => sum + (e.expenseAmountPaisa ?? 0), 0);
    const pendingTotal = credits.reduce((sum, c) => sum + (c.expenseAmountPaisa ?? 0), 0);
    return {
      ...base,
      month: monthLabel(monthKey),
      money: {
        spentThisMonth: formatPaise(spent),
        spentThisMonthCount: monthExpenses.length,
        pendingCreditsTotal: formatPaise(pendingTotal),
        pendingCredits: credits
          .slice(0, 10)
          .map(moneyEntry)
          .filter((m): m is NonNullable<typeof m> => !!m),
        recentFinancialEntries: sortNewestFirst(timelines, (t) => t.eventDate)
          .slice(0, MAX_TIMELINES)
          .map(moneyEntry)
          .filter((m): m is NonNullable<typeof m> => !!m),
      },
    };
  }

  if (intent === 'people') {
    return {
      ...base,
      people: entities.slice(0, MAX_ENTITIES).map((e) => ({
        name: e.name,
        type: e.type,
        description: e.description ?? undefined,
      })),
      activity: sortNewestFirst(timelines, (t) => t.eventDate)
        .slice(0, MAX_TIMELINES)
        .map((t) => ({
          date: t.eventDate.slice(0, 10),
          title: t.title,
          person: personNameOf(t),
          money: moneyLine(t) || undefined,
        })),
    };
  }

  if (intent === 'today') {
    const todayKey = localDateKey(now);
    const todayEvents = timelines.filter(
      (t) => localDateKey(new Date(t.eventDate)) === todayKey,
    );
    const diary = await diaryService.getCachedDiary(userId);
    const todayDiary = diary.filter((d) => d.entryDate.slice(0, 10) === todayKey);
    return {
      ...base,
      month: monthLabel(monthKey),
      today: {
        count: todayEvents.length,
        events: todayEvents.slice(0, 15).map((t) => ({
          time: t.eventDate.includes('T') ? t.eventDate.slice(11, 16) : undefined,
          title: t.title,
          person: personNameOf(t),
          money: moneyLine(t) || undefined,
        })),
      },
      diaryToday: todayDiary.map((d) => ({ title: d.title, content: d.content, mood: d.mood })),
      upcoming: timelines
        .filter((t) => new Date(t.eventDate) > now)
        .slice(0, 5)
        .map((t) => ({ date: t.eventDate.slice(0, 10), title: t.title })),
    };
  }

  // Greeting + overview: a compact snapshot edge-list style, still bounded.
  const expenses = await expensesService.getCachedExpenses(userId);
  const spentThisMonth = expenses
    .filter((e) => localMonthKey(new Date(e.eventDate)) === monthKey)
    .reduce((sum, e) => sum + (e.expenseAmountPaisa ?? 0), 0);
  return {
    ...base,
    month: monthLabel(monthKey),
    overview: {
      peopleCount: entities.length,
      timelineCount: timelines.length,
      spentThisMonth: formatPaise(spentThisMonth),
      recentTimeline: sortNewestFirst(timelines, (t) => t.eventDate)
        .slice(0, MAX_TIMELINES)
        .map((t) => ({
          date: t.eventDate.slice(0, 10),
          title: t.title,
          person: personNameOf(t),
          money: moneyLine(t) || undefined,
        })),
    },
  };
}

/**
 * Sends one turn to the read-only AI chat endpoint and returns a friendly,
 * typed result. Never throws — failures are classified for the UI to render.
 */
export async function askBirbal(
  userId: string | undefined,
  userName: string | undefined,
  message: string,
  history: api.AiChatTurn[] = [],
): Promise<BirbalAiResult> {
  if (!userId) {
    return { ok: false, reason: 'network' };
  }

  let context: Record<string, unknown>;
  try {
    context = await buildContext(userId, userName, message);
  } catch {
    return { ok: false, reason: 'network' };
  }

  try {
    const res = await api.aiChat({
      message,
      context,
      history: history.slice(-12),
    });
    const reply = res?.reply?.trim();
    if (!reply) {
      return { ok: false, reason: 'empty' };
    }
    return { ok: true, reply };
  } catch {
    return { ok: false, reason: 'network' };
  }
}