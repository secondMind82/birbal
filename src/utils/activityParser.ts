import { parseAmountToPaise, formatPaise } from './money';
export interface DetailRow {
  emoji: string;
  label: string;
  value: string;
}

export interface ParsedActivity {
  title: string;
  matched: boolean;
  details: DetailRow[];
  message: string;
  // Optional structured money classification. 'receive' = money owed back TO the
  // user (rendered as Pending + Receive/Ignore in the Timeline); 'expense' =
  // money the user paid out. Amount is in paise (0 when the text carries none).
  // Status is the derived money lifecycle: CREDIT default 'pending', auto-'received'
  // when the text says the money came back, DEBIT 'paid'.
  money?: MoneyDetection;
}

export interface MoneyDetection {
  role: 'receive' | 'expense';
  amountPaise: number;
  status?: string;
}

const DAY_MAP: Record<string, string> = {
  sunday: 'Sunday',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  today: 'Today',
  tomorrow: 'Tomorrow',
};

const MONEY_TERMS =
  /\b(?:money|cash|rupees?|rs\.?|paisa|amount|refund)\b|\b\d[\d,]*\b|₹/i;

// Money owed BACK to the user: explicit pay-back / give-back / return phrases, or
// a monetary phrase ("take ₹5000 from me ... give it back"). Kept tight so normal
// notes ("give me a call back") never classify as receivable.
const RECEIVABLE_RE =
  /\b(?:pay\s+me(?:\s+back)?|will\s+give\s+me\b|refund|borrow(?:ed|s)?)\b|(?:money|cash|rupees|rs\.?|paisa)\b[^.!?;]{0,30}\b(?:back|return)\b|(?:return|give)\b[^.!?;]{0,30}\b(?:back\s+the\s+)?money\b/i;

const EXPENSE_RE =
  /\b(?:bought|purchased?|spent|spend|shopping|cost|paid\s+for)\b/i;

// Money PAID OUT to someone: an explicit give/lend verb immediately followed by
// an explicit amount indicator. The amount is required so "I gave him a call" is
// never classified as money.
const MONEY_GIVEN_RE =
  /\b(?:gave|given|lent|loaned)\b[^.!?;]{0,40}(?:₹|rs\.?|rupees|paisa)\s*\d/i;

// Money RETURNED to the user: an explicit return/repaid/paid-back verb with an
// explicit amount ("shaaf returned ₹2000" = credit). Amount required so "she
// returned the money" stays a plain note when no figure is stated.
const MONEY_RETURNED_RE =
  /\b(?:returned?|repaid|paid\s+back|gave\s+back)\b[^.!?;]{0,40}(?:₹|rs\.?|rupees|paisa)\s*\d/i;

// Amount is only ever read from an explicit money indicator (₹, rs, rupees,
// paisa) — never from a bare number, so dates like "23/09/2026" can't be picked
// up as an amount. Returns paise (0 when absent).
function moneyAmountPaise(text: string): number {
  const rupee = text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/i);
  const rs =
    text.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|rupees|paisa)/i);
  const raw = rupee?.[1] ?? rs?.[1];
  if (!raw) return 0;
  return parseAmountToPaise(`₹${raw.replace(/,/g, '')}`) ?? 0;
}

function isReceivableText(text: string): boolean {
  if (RECEIVABLE_RE.test(text)) return true;
  if (MONEY_RETURNED_RE.test(text)) return true;
  const giveBack = /\bgive\b[^.!?;]{0,40}\bback\b/i.test(text);
  return giveBack && MONEY_TERMS.test(text);
}

const LOCATIONS = ['office', 'home', 'restaurant', 'cafe', 'café', 'hotel', 'garden', 'hall', 'masjid'];

const WEEKDAYS = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday';

const PUNCT = '\\s"\'@()\\[\\]{}\\.\\,\\;\\.:\\!\\?\\-';

export function sanitizeName(raw: string): string {
  return (raw ?? '')
    .replace(new RegExp(`^[${PUNCT}]+`), '')
    .replace(new RegExp(`[${PUNCT}]+$`), '');
}

export function extractEventDate(text: string): Date {
  const base = new Date();

  const timeMatch = text.match(/(\d{1,2})(:(\d{2}))?\s*(am|pm)/i);
  const numericMatch = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);

  let dateSet = false;

  if (numericMatch) {
    base.setFullYear(parseInt(numericMatch[3], 10), parseInt(numericMatch[2], 10) - 1, parseInt(numericMatch[1], 10));
    dateSet = true;
  } else if (/\btomorrow\b/i.test(text)) {
    base.setDate(base.getDate() + 1);
    dateSet = true;
  } else if (/\btoday\b/i.test(text)) {
    dateSet = true;
  } else if (/\btonight\b|\bthis evening\b/i.test(text)) {
    dateSet = true;
  } else {
    const nextWeekday = text.match(new RegExp(`\\bnext\\s+(${WEEKDAYS})\\b`, 'i'));
    const rawWeekday = text.match(new RegExp(`\\b(${WEEKDAYS})\\b`, 'i'));
    if (nextWeekday) {
      base.setDate(base.getDate() + daysUntilWeekday(base, weekdayIndex(nextWeekday[1]), true));
      dateSet = true;
    } else if (rawWeekday) {
      base.setDate(base.getDate() + daysUntilWeekday(base, weekdayIndex(rawWeekday[1]), false));
      dateSet = true;
    }
  }

  if (dateSet && timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    const amPm = timeMatch[4].toLowerCase();
    if (amPm === 'pm' && hour < 12) hour += 12;
    if (amPm === 'am' && hour === 12) hour = 0;
    base.setHours(hour, minute, 0, 0);
  }

  return dateSet ? base : new Date();
}

function weekdayIndex(name: string): number {
  const map: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return map[name.toLowerCase()];
}

function daysUntilWeekday(from: Date, target: number, strict: boolean): number {
  let diff = (target - from.getDay() + 7) % 7;
  if (strict && diff === 0) diff = 7;
  return diff;
}

export function parseActivity(text: string, person?: string): ParsedActivity {
  const lower = ' ' + text.toLowerCase() + ' ';
  const cleanText = (text ?? '').trim();
  const personName = (person ?? sanitizeName(cleanText.split(/\s+/)[0] ?? '')).trim();
  const details: DetailRow[] = [];

  const dayMatch = text.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|today|tomorrow)\b/i,
  );
  if (dayMatch) {
    details.push({ emoji: '📅', label: 'Day', value: DAY_MAP[dayMatch[1].toLowerCase()] ?? dayMatch[1] });
  }

  const timeMatch =
    text.match(/\b(after|before)\s+(namaz\s*-?\s*e\s*-?\s*(?:isha|maghrib|fajr|zuhr|asr)|isha|maghrib|fajr|zuhr|asr)\b/i) ||
    text.match(/(\d{1,2})(:(\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    const raw = timeMatch[0].trim();
    if (/namaz|isha|maghrib|fajr|zuhr|asr/i.test(raw)) {
      details.push({ emoji: '🕌', label: 'Time', value: raw.replace(/\s+/g, ' ') });
    } else {
      const hrs = parseInt(timeMatch[1], 10);
      const ampm = (timeMatch[4] ?? (hrs >= 12 ? 'pm' : 'am')).toLowerCase();
      const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
      const mm = timeMatch[3] ? `:${timeMatch[3]}` : ':00';
      details.push({ emoji: '⏰', label: 'Time', value: `${h12}${mm} ${ampm.toUpperCase()}` });
    }
  }

  const contribMatch = text.match(/(?:contribution|contro|contrib|contribute|contri)\s+(?:rs\.?|rupees)?\s*(\d+)/i);
  if (contribMatch) {
    details.push({ emoji: '💰', label: 'Contribution', value: `₹${contribMatch[1]} per person` });
  }

  const locMatch = text.match(new RegExp(`\\b(?:at|in)\\s+(${LOCATIONS.join('|')})\\b`, 'i'));
  if (locMatch) {
    const loc = locMatch[1].toLowerCase();
    details.push({ emoji: '📍', label: 'Location', value: `${loc[0].toUpperCase()}${loc.slice(1)}` });
  }

  if (/\bparty\b/i.test(lower)) {
    return {
      title: '🎉 PARTY ANNOUNCEMENT 🎉',
      matched: true,
      details: personName
        ? [{ emoji: '🤝', label: 'Hosted by', value: personName }, ...details]
        : details,
      message: '✨ Come, Eat & Enjoy! ✨ Everyone is invited ❤️',
    };
  }
  if (/\b(dinner|dawat|feast|lunch|meal)\b/i.test(lower)) {
    return {
      title: lower.includes('dinner') ? '🍽️ DINNER ANNOUNCEMENT 🍽️' : '🍽️ DAWAT REMINDER 🍽️',
      matched: true,
      details: personName
        ? [{ emoji: '🤝', label: 'Hosted by', value: personName }, ...details]
        : details,
      message: '✨ Come, Eat & Enjoy! ✨ Everyone is invited ❤️',
    };
  }
  if (/\bmeeting\b/i.test(lower)) {
    return {
      title: '🤝 MEETING',
      matched: true,
      details,
      message: personName ? `Meeting with ${personName}.` : '',
    };
  }

  // Money owed BACK to the user. Additive classification — replaces the NOTE
  // fallback for entries like "shaaf will take ₹5000 from me and give it back".
  // Status: 'received' when the wording says the money already came back
  // (returned/repaid/paid back), otherwise 'pending'.
  if (isReceivableText(text)) {
    const amountPaise = moneyAmountPaise(text);
    const status = MONEY_RETURNED_RE.test(text) ? 'received' : 'pending';
    return {
      title: '💰 MONEY RECEIVABLE',
      matched: true,
      details: [
        ...(amountPaise > 0
          ? [{ emoji: '💰', label: 'Amount', value: formatPaise(amountPaise) }]
          : []),
        ...details,
      ],
      message: cleanText,
      money: { role: 'receive', amountPaise, status },
    };
  }

  // Money the user paid OUT (expense). Distinct from the PAYMENT REMINDER branch
  // so bought/spent/gave entries never render as a payable/owed item. Status:
  // DEBIT entries are recorded as already 'paid'.
  if (EXPENSE_RE.test(lower) || MONEY_GIVEN_RE.test(lower)) {
    const amountPaise = moneyAmountPaise(text);
    return {
      title: '🛍️ EXPENSE',
      matched: true,
      details: [
        ...(amountPaise > 0
          ? [{ emoji: '💰', label: 'Amount', value: formatPaise(amountPaise) }]
          : []),
        ...details,
      ],
      message: cleanText,
      money: { role: 'expense', amountPaise, status: 'paid' },
    };
  }
  if (/\b(pay|payment|owes|paid|receive|send|transfer)\b/i.test(lower)) {
    const amtMatch = text.match(/₹?\s*(\d+)/) || text.match(/(\d+)\s*(?:rs\.?|rupees)/i);
    const rest = personName
      ? text.replace(new RegExp(escapeRegex(personName), 'ig'), '').replace(/\s+/g, ' ').trim()
      : cleanText;
    return {
      title: '💰 PAYMENT REMINDER',
      matched: true,
      details: amtMatch
        ? [{ emoji: '💰', label: 'Amount', value: `${personName} owes ₹${amtMatch[1]}.` }, ...details]
        : details,
      message: rest,
    };
  }
  if (/\bbirthday\b/i.test(lower)) {
    return {
      title: '🎂 BIRTHDAY',
      matched: true,
      details: personName
        ? [{ emoji: '🎉', label: 'Wishing', value: `${personName} a very happy birthday!` }]
        : details,
      message: '',
    };
  }
  return {
    title: '',
    matched: false,
    details,
    message: cleanText,
  };
}

export function activityEmoji(title: string): string {
  const upper = title.toUpperCase();
  if (upper.includes('PARTY')) return '🎉';
  if (upper.includes('MEETING')) return '🤝';
  if (upper.includes('PAYMENT') || /\bPAY\b/.test(upper)) return '💰';
  if (upper.includes('BIRTHDAY')) return '🎂';
  if (/(DINNER|DAWAT|FEAST|LUNCH)/.test(upper)) return '🍽️';
  if (upper.includes('NOTE')) return '📝';
  return firstEmoji(title) ?? '📅';
}

function firstEmoji(s: string): string | null {
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0xfe00 && cp <= 0xfe0f)
    ) {
      return ch;
    }
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DEGREE_COURSES = new Set([
  'bums',
  'mbbs',
  'bams',
  'bhms',
  'bds',
  'bpharm',
  'be',
  'btech',
  'bsc',
  'ba',
  'bcom',
  'bca',
  'bba',
  'llb',
  'mba',
  'msc',
  'ma',
  'mcom',
  'mca',
  'mtech',
  'llm',
  'phd',
  'md',
  'ms',
  'diploma',
  'degree',
]);

const PLACE_KEYWORDS = new Set([
  'mumbai',
  'bangalore',
  'bengaluru',
  'delhi',
  'hyderabad',
  'chennai',
  'kolkata',
  'pune',
  'ahmedabad',
  'jaipur',
  'lucknow',
  'kanpur',
  'nagpur',
  'indore',
  'bhopal',
  'patna',
  'goa',
  'agra',
  'london',
  'paris',
  'tokyo',
  'dubai',
  'singapore',
  'toronto',
  'sydney',
  'newyork',
  'america',
  'india',
]);

const TECH_KEYWORDS = new Set([
  'react',
  'reactnative',
  'javascript',
  'typescript',
  'python',
  'java',
  'kotlin',
  'swift',
  'flutter',
  'dart',
  'nodejs',
  'angular',
  'vue',
  'nextjs',
  'graphql',
  'mongodb',
  'postgresql',
  'mysql',
  'redis',
  'docker',
  'kubernetes',
  'aws',
  'azure',
  'firebase',
  'tailwind',
  'webpack',
  'vite',
  'git',
  'github',
  'gitlab',
  'expo',
]);

const ORGANIZATION_SUFFIXES = [
  'inc',
  'ltd',
  'limited',
  'llc',
  'corp',
  'corporation',
  'co',
  'group',
  'tech',
  'technologies',
  'soft',
  'sys',
  'labs',
  'global',
  'digital',
  'solutions',
  'bank',
  'banking',
  'telecom',
  'communications',
  'motors',
  'industries',
  'enterprises',
];

export function classifyEntityType(name: string): string {
  const clean = sanitizeName(name);
  const lower = clean.toLowerCase();
  const upper = clean.toUpperCase();

  if (!lower) return 'PERSON';

  if (DEGREE_COURSES.has(lower)) return 'COURSE';
  if (PLACE_KEYWORDS.has(lower)) return 'PLACE';
  if (TECH_KEYWORDS.has(lower)) return 'TECHNOLOGY';

  if (TECH_KEYWORDS.has(lower.replace(/[\s._-]+/g, ''))) return 'TECHNOLOGY';

  if (clean === upper && clean.length >= 2 && clean.length <= 8) return 'COMPANY';

  if (ORGANIZATION_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return 'COMPANY';
  }

  return 'PERSON';
}

export function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? 'Just now' : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (d.getFullYear() === new Date().getFullYear()) {
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}