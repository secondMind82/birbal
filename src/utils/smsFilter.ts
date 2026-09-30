import type { SmsClassification } from '../models/types';
import { parseAmountToPaise } from './money';

/**
 * Message classification used to sort the inbox and to pre-fill the edit screen.
 *
 * Deliberately conservative and, above all, advisory. Nothing here creates a
 * record: an SMS only ever becomes a notification, and only an explicit user
 * action on the edit screen writes to the app. That is why every list below is
 * "may be", and why an unmatched message simply lands in 'other'.
 *
 * The keyword lists are data, not code, precisely so they can be extended as new
 * banks and senders appear without touching the capture path.
 */

/** A money amount present in the text: ₹1,200 / Rs. 1200 / INR 1,200. */
const AMOUNT_RE = /(?:₹|\b(?:rs\.?|inr|rupees)\s?)\s?\d[\d,]*/i;

/** First currency indicator in the text. */
const CURRENCY_RE = /₹|\b(?:rs|inr|rupees)\b\.?/i;

/** The digits that immediately follow such an indicator. */
const AMOUNT_DIGITS_RE = /^\s*(\d[\d,]*(?:\.\d{1,2})?)/;

/**
 * Verbs that put money IN to the account.
 *
 * The second group is the conversational form people actually type on the review
 * screen — "@Shaaf give me amount ₹5000", "Aman owes me ₹3,000". Without these,
 * the single most common edit produced a Timeline entry with NO amount at all,
 * because an amount with no direction is not enough to create money.
 */
const RECEIVE_VERBS =
  /\b(?:credited?|received|refunded?|reversal|reversed|cashback|deposited|added to|give\s?me|gave\s?me|pay\s?me|owes?\s?me|lends?\s?me|owed\s?me|to\s?be\s?paid\s?to\s?me)\b/i;

/** Verbs that take money OUT of the account. */
const EXPENSE_VERBS = /\b(?:debited?|paid|payment|payment of|spent|purchased?|sent|transferred?|withdrew|withdrawn|billed|charged)\b/i;

/**
 * Amount + direction for a transactional SMS, derived from bank-alert grammar
 * ("Rs 999.00 debited from your account"). Returns null when there is no amount
 * or no clear direction, so a diary-style edit falls through to parseActivity.
 */
export function extractSmsMoney(
  text: string,
): { role: 'expense' | 'receive'; amountPaise: number } | null {
  const indicator = text.match(CURRENCY_RE);
  if (!indicator) return null;
  const rest = text.slice(indicator.index! + indicator[0].length);
  const digits = rest.match(AMOUNT_DIGITS_RE);
  const amountPaise = digits ? parseAmountToPaise(digits[1]) : null;
  if (!amountPaise) return null;

  const receive = text.match(RECEIVE_VERBS);
  const expense = text.match(EXPENSE_VERBS);
  // When both directions appear ("Refund ₹200 credited"), prefer whichever verb
  // comes first in the text — the primary action precedes the balance sentence.
  if (receive && expense) {
    return receive.index! < expense.index!
      ? { role: 'receive', amountPaise }
      : { role: 'expense', amountPaise };
  }
  if (receive) return { role: 'receive', amountPaise };
  if (expense) return { role: 'expense', amountPaise };
  return null;
}

/** Sender/header words that mark a transactional (money) SMS. */
const FINANCIAL_TERMS = [
  'credited',
  'debited',
  'debit',
  'credit',
  'paid',
  'received',
  'payment',
  'transaction',
  'txn',
  'refund',
  'reversed',
  'reversal',
  'withdrawn',
  'withdrawal',
  'cashback',
  'salary',
  'payout',
  'billed',
  'invoice',
  'due',
  'outstanding',
  'balance',
  'statement',
  'a/c',
  'account',
  'upi',
  'neft',
  'imps',
  'transfer',
  'wallet',
  'deposit',
  'subscription',
  'payment of',
];

/** One-time-password wording, matched case-insensitively. */
const OTP_TERMS = [
  'otp',
  'one time password',
  'one-time password',
  'verification code',
  'verify code',
  'security code',
  'auth code',
  'login code',
  'confirmation code',
  'do not share',
  'valid for',
];

/** A bare 4-8 digit code is the other half of the OTP signal. */
const STANDALONE_CODE_RE = /\b\d{4,8}\b/;

/** A long alphanumeric token, e.g. "J7QX2M9P". */
const ALNUM_TOKEN_RE = /\b(?=[A-Z0-9]{6,}\b)(?=[^\s]*[A-Z])(?=[^\s]*\d)[A-Z0-9]+\b/;

/** Marketing / promotional traffic that the user almost never wants to keep. */
const PROMO_TERMS = [
  'offer',
  'discount',
  'sale',
  'cashback',
  'win ',
  'congratulations',
  'lucky',
  'click here',
  'unsubscribe',
  'promo',
  'free ',
];

/**
 * Shared-number sender ids, the shortcodes banks and gateways actually send
 * from. Matched case-insensitively at the start of the sender.
 */
const BULK_PREFIXES = [
  'vm',
  'vk',
  'bk',
  'ad',
  'sms',
  'msg',
  'info',
  'alert',
  'no-reply',
  'noreply',
];

/** A personal name, or a real phone number. Neither looks like a shortcode. */
const PLAIN_SENDER_RE = /^\+?[\d\s-]{6,}$/;
const SEPARATOR_RE = /[-_.]/;

export function normaliseSender(sender: string): string {
  return sender.trim().toLowerCase();
}

/**
 * True for a shared/sender-id rather than a person.
 *
 * This guards the "link the sender to the record" behaviour: a message from
 * "VM-HDFCB" must never turn the bank into a contact. A short all-letters name
 * like "ALI" is deliberately NOT treated as bulk, because a person's initials
 * look exactly like a shortcode and guessing wrong here would silently drop a
 * real person.
 */
export function isBulkSender(sender: string): boolean {
  const trimmed = normaliseSender(sender);
  if (!trimmed) return true;
  if (PLAIN_SENDER_RE.test(trimmed)) return false;
  if (BULK_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return true;
  // All-caps tokens carrying a digit or a separator are gateway ids
  // ("HDFC-BANK-2", "TXN12"), not names.
  return /^[a-z0-9]+$/.test(trimmed) === false && SEPARATOR_RE.test(trimmed);
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

function countMatches(haystack: string, terms: readonly string[]): string[] {
  return terms.filter((term) => haystack.includes(term.trim()));
}

/**
 * Classifies one captured message.
 *
 * OTP wins over financial: a bank OTP often contains a brand name and an amount
 * and would otherwise look financial, but an OTP is a secret that must be masked
 * and must never become a timeline entry.
 */
export function classifySms(sender: string, body: string): SmsClassification {
  const haystack = normalise(body);

  const otpHits = countMatches(haystack, OTP_TERMS);
  if (otpHits.length > 0) {
    return { kind: 'otp', reason: `Looks like a one-time password (${otpHits[0]})` };
  }

  // A short numeric/alphanumeric code standing alone is a strong OTP signal even
  // without the usual wording, as long as the message is short — a long message
  // that happens to contain a number is not an OTP.
  const short = haystack.length <= 160;
  if (
    short &&
    !AMOUNT_RE.test(body) &&
    !/\b(?:\d+\s?[-/]\s?\d+|date|time)\b/i.test(haystack) &&
    (STANDALONE_CODE_RE.test(body) || ALNUM_TOKEN_RE.test(body))
  ) {
    return { kind: 'otp', reason: 'Contains what looks like a verification code' };
  }

  const financialHits = countMatches(haystack, FINANCIAL_TERMS);
  const hasAmount = AMOUNT_RE.test(body);
  if (financialHits.length > 0 || (hasAmount && /\b(?:paid|sent|received|to|from)\b/.test(haystack))) {
    return {
      kind: 'financial',
      reason: financialHits.length > 0 ? `Mentions ${financialHits[0]}` : 'Contains a money amount',
    };
  }

  const promoHits = countMatches(haystack, PROMO_TERMS);
  if (promoHits.length > 0) {
    return { kind: 'other', reason: 'Looks promotional' };
  }

  return { kind: 'other', reason: 'No financial details detected' };
}

/**
 * Masked preview for OTP-style messages.
 *
 * The user still needs to recognise which message it is, so a little shape is
 * kept (length, first and last character) while the secret itself is hidden. The
 * full body is still in the local database and is shown on the edit screen,
 * where the user explicitly asked to see it.
 */
export function maskOtp(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  if (compact.length <= 4) return '•'.repeat(compact.length);
  return `${compact[0]}${'•'.repeat(Math.min(compact.length - 2, 8))}${compact[compact.length - 1]}`;
}

/** One-line preview for a notification, honouring the OTP masking rule. */
export function smsPreview(body: string, isOtp: boolean): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (isOtp) return maskOtp(flat);
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}
