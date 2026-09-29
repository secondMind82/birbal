import * as Crypto from 'expo-crypto';

import { drainSmsInbox, smsCaptureAvailable } from '../../modules/birbal-sms';
import type { CapturedSms } from '../../modules/birbal-sms';
import * as smsMessagesRepository from '../db/repositories/smsMessages';
import * as timelinesRepository from '../db/repositories/timelines';
import * as entitiesRepository from '../db/repositories/entities';
import * as notificationsRepository from '../db/repositories/notifications';
import * as entitiesService from './entitiesService';
import * as timelinesService from './timelinesService';
import {
  classifyEntityType,
  extractEventDate,
  parseActivity,
  sanitizeName,
} from '../utils/activityParser';
import { findEntityByName } from '../utils/entityLookup';
import { detectExpenseCategory, parseAmountToPaise } from '../utils/money';
import { classifySms, extractSmsMoney, isBulkSender, smsPreview } from '../utils/smsFilter';
import type { Entity, SmsClassification, SmsMessage, Timeline } from '../models/types';

/**
 * The SMS workflow.
 *
 * Capture -> notification -> user decision -> records is the whole feature, and
 * the decision step is mandatory: nothing here creates a record until the user
 * saves from the edit screen. `ingestCapturedSms` only files the message and
 * raises a notification; `saveSms` is the single place where a Timeline, Entity
 * and expense/receivable come into being.
 *
 * Privacy rules that shape the code:
 *   - Message bodies are stored only in the local `sms_messages` table, which is
 *     excluded from cloud backup. They are never sent to the API or logged.
 *   - OTP-style messages are masked in the notification preview.
 *   - The classified hint is advisory; the user's edited text is what is parsed.
 *
 * Offline rules that shape the code:
 *   - Saving is local-first. The device always persists the result, and the
 *     server push is best-effort, so a message saved on a train is not lost.
 *   - Records created this way carry `source`/`source_notification_id`, which is
 *     what lets the normal server refresh keep them instead of deleting them.
 */

const MENTION_RE = /@([^\s@.,!?:;\n\r]+)/g;
const PLACE_RE = /#([^\s@.,!?:;\n\r]+)/g;
const SENDER_PREFIX_RE = /^(?:from|received from|sent by)\s*[:\-]?\s*(.+)$/i;
export function isSmsCaptureSupported(): boolean {
  return smsCaptureAvailable();
}

/** Notification id derived from the message id, so capture stays idempotent. */
function notificationIdFor(smsId: string): string {
  return `sms-${smsId}`;
}

function toIso(receivedAt: number): string {
  const d = new Date(receivedAt);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Trims a raw sender into a plausible person name ("+91 98765 43210" → "98765 43210"). */
export function describeSender(sender: string): string {
  const trimmed = sender.trim();
  if (!trimmed) return 'Unknown sender';
  return isBulkSender(trimmed) ? trimmed : trimmed;
}

export interface IngestResult {
  /** Messages that were new this time round (duplicates are not counted). */
  added: number;
  /** True when this platform/build cannot capture SMS at all. */
  unsupported: boolean;
}

/**
 * Files every message the native receiver captured and raises a notification for
 * each new one.
 *
 * Safe to call at any time and as often as you like: the native queue is drained
 * (so each message is handed over exactly once) and the local table is keyed by
 * the message identity, so re-running this can never produce a second
 * notification for the same SMS.
 */
export async function ingestCapturedSms(userId: string): Promise<IngestResult> {
  if (!smsCaptureAvailable()) {
    return { added: 0, unsupported: true };
  }

  const captured = await drainSmsInbox();
  if (captured.length === 0) {
    return { added: 0, unsupported: false };
  }

  let added = 0;
  for (const item of captured) {
    if (await storeCaptured(userId, item)) added += 1;
  }

  // Housekeeping: message bodies age out once nobody is waiting on them.
  await smsMessagesRepository.prune(userId).catch(() => 0);

  return { added, unsupported: false };
}

async function storeCaptured(userId: string, item: CapturedSms): Promise<boolean> {
  const classification = classifySms(item.sender, item.body);
  const { created, message } = await smsMessagesRepository.insertIfNew(userId, {
    id: item.id,
    sender: item.sender,
    body: item.body,
    receivedAt: toIso(item.receivedAt),
    isOtp: classification.kind === 'otp',
  });

  if (!created) {
    return false; // Already known: a redelivery, or a second drain.
  }

  await raiseSmsNotification(userId, message, classification);
  return true;
}

async function raiseSmsNotification(
  userId: string,
  message: SmsMessage,
  classification: SmsClassification,
): Promise<void> {
  const notificationId = notificationIdFor(message.id);
  await notificationsRepository.upsertAll(userId, [
    {
      id: notificationId,
      type: 'SMS',
      title: message.isOtp ? 'Verification message' : `SMS from ${describeSender(message.sender)}`,
      // Masked for OTPs so a secret is not exposed on a lock screen.
      message: smsPreview(message.body, message.isOtp),
      icon: message.isOtp ? '🔐' : '💬',
      read: false,
      createdAt: new Date().toISOString(),
    },
  ]);
  await smsMessagesRepository.setNotificationId(userId, message.id, notificationId);
}

/** Pending messages, newest first, for the notification center's review list. */
export async function listPending(userId: string): Promise<SmsMessage[]> {
  return smsMessagesRepository.listPending(userId);
}

export async function getMessage(userId: string, id: string): Promise<SmsMessage | null> {
  return smsMessagesRepository.getById(userId, id);
}

/** Classification hint shown on the edit screen; never blocks saving. */
export function hintFor(message: SmsMessage): SmsClassification {
  return classifySms(message.sender, message.body);
}

/** Marks a message reviewed and dismissed, removing it from the pending list. */
export async function ignoreSms(userId: string, id: string): Promise<boolean> {
  const resolved = await smsMessagesRepository.resolve(userId, id, { status: 'IGNORED' });
  if (resolved) {
    await dismissNotification(userId, notificationIdFor(id));
  }
  return resolved;
}

async function dismissNotification(userId: string, notificationId: string): Promise<void> {
  // Marking read (rather than deleting) keeps the notification history honest
  // and matches how every other notification in the app is dismissed.
  await notificationsRepository.markRead(userId, notificationId).catch(() => false);
}

export interface SaveSmsInput {
  /** The message the user reviewed. */
  smsId: string;
  /** Text the user edited; this, not the original body, is what gets parsed. */
  text: string;
  /** Optional explicit entity names/ids chosen by the user. */
  entityIds?: string[];
}

export interface SaveSmsResult {
  timeline: Timeline;
  /** True when this message had already been saved and nothing new was created. */
  alreadySaved: boolean;
  /** True when the record could only be written locally (no connectivity). */
  offline: boolean;
}

/**
 * Turns a reviewed message into an app record.
 *
 * Reuses the Dashboard's own parser and entity resolution so an SMS produces
 * exactly the same shape of record as a post: linked Entity, a Timeline, and —
 * when the text carries an amount — the same expense/receivable attribution the
 * Expenses page already understands.
 *
 * Idempotent: the message's stored `timeline_id` short-circuits a second save, so
 * double-tapping Save cannot create a duplicate.
 */
export async function saveSms(
  userId: string,
  input: SaveSmsInput,
): Promise<SaveSmsResult> {
  const message = await smsMessagesRepository.getById(userId, input.smsId);
  if (!message) {
    throw new Error('This message is no longer available');
  }

  if (message.status === 'PROCESSED' && message.timelineId) {
    const existing = await timelinesRepository.getById(userId, message.timelineId);
    if (existing) {
      return { timeline: existing, alreadySaved: true, offline: false };
    }
  }

  const text = input.text.trim();
  if (!text) {
    throw new Error('Nothing to save');
  }

  const parsed = parseActivity(text);
  const eventDate = extractEventDate(text);

  // Bank alerts use their own grammar ("Rs 999.00 debited"), which the diary
  // parser does not understand for amounts. When the SMS path can read a clean
  // amount + direction it wins; otherwise parseActivity keeps its say.
  const smsMoney = extractSmsMoney(text);
  const money =
    smsMoney ?? (parsed.money && parsed.money.amountPaise ? parsed.money : null);
  const amountPaise = money?.amountPaise ?? null;
  const moneyType = money?.role ?? null;

  const { linkedIds, createdLocally } = await resolveEntities(
    userId,
    text,
    input.entityIds ?? [],
    message,
  );

  const title = smsMoney
    ? moneyType === 'receive'
      ? '💰 MONEY RECEIVABLE'
      : '🛍️ EXPENSE'
    : parsed.title?.trim() || smsTitle(message);
  const description = smsMoney ? text : parsed.message?.trim() || text;

  const { timeline, offline: timelineOffline } = await persistTimeline({
    userId,
    title,
    description,
    eventDate: eventDate.toISOString(),
    moneyType,
    amountPaise,
    category: parsed.money?.category ?? detectExpenseCategory(text),
    receivableStatus: parsed.money?.status ?? null,
    linkedIds,
    message,
  });

  await smsMessagesRepository.resolve(userId, input.smsId, {
    status: 'PROCESSED',
    timelineId: timeline.id,
  });
  await markSmsNotificationRead(userId, notificationIdFor(message.id));

  // Offline means anything landed only on the device — an entity, the timeline,
  // or both. The review screen shows that so the user knows a sync is pending.
  return { timeline, alreadySaved: false, offline: createdLocally || timelineOffline };
}

function smsTitle(message: SmsMessage): string {
  const firstLine = message.body.split('\n').find((l) => l.trim().length > 0) ?? '';
  return firstLine.trim().slice(0, 60) || `SMS from ${describeSender(message.sender)}`;
}

/**
 * Links the record to the people it mentions.
 *
 * Order of preference, matching the Dashboard: names the user picked explicitly,
 * then `@` mentions and `#` places in the text, then the sender as a last
 * resort. The sender is only used when nothing else identified a person AND the
 * message reads as personal — a bank alert from "VM-HDFC" must not turn the bank
 * into a contact, and an OTP must not either.
 */
async function resolveEntities(
  userId: string,
  text: string,
  explicitIds: string[],
  message: SmsMessage,
): Promise<{ linkedIds: string[]; createdLocally: boolean }> {
  const linkedIds: string[] = [];
  let createdLocally = false;

  const cachedEntities = await entitiesRepository.getAll(userId).catch(() => [] as Entity[]);
  const cachedTimelines = await timelinesRepository.getAll(userId).catch(() => [] as Timeline[]);
  let entities = cachedEntities;
  const timelines = cachedTimelines;

  const link = (id: string) => {
    if (!linkedIds.includes(id)) linkedIds.push(id);
  };

  for (const id of explicitIds) {
    const owned = entities.find((e) => e.id === id);
    if (owned) link(owned.id);
  }

  const names: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const name = sanitizeName(m[1] ?? '');
    if (name) names.push(name);
  }
  for (const m of text.matchAll(PLACE_RE)) {
    const name = sanitizeName(m[1] ?? '');
    if (name) names.push(name);
  }

  for (const name of names) {
    const existing = findEntityByName(name, entities, timelines);
    if (existing) {
      link(existing.id);
      continue;
    }
    const created = await createLocalEntity(userId, name, message.id);
    entities = [...entities, created];
    link(created.id);
    createdLocally = true;
  }

  // Sender fallback: a personal message from someone the user has not met in
  // the app yet still deserves to be linked to that person.
  if (linkedIds.length === 0 && senderIsLinkable(message)) {
    const name = personNameFromSender(message.sender);
    const existing = findEntityByName(name, entities, timelines);
    if (existing) {
      link(existing.id);
    } else {
      const created = await createLocalEntity(userId, name, message.id);
      link(created.id);
      createdLocally = true;
    }
  }

  return { linkedIds, createdLocally };
}

/** Only a non-bulk sender on a non-OTP message can become a person. */
function senderIsLinkable(message: SmsMessage): boolean {
  return !message.isOtp && !isBulkSender(message.sender);
}

/** "+91 98765 43210" → "98765 43210"; "Shaaf" → "Shaaf". */
function personNameFromSender(sender: string): string {
  const digits = sender.replace(/^\+/, '').trim();
  return sanitizeName(digits) || sender.trim();
}

/**
 * Creates an entity, preferring the server and falling back to a local write.
 *
 * The local fallback is what makes an offline save possible; the row is stamped
 * with the originating message so a later server refresh keeps it.
 */
async function createLocalEntity(
  userId: string,
  name: string,
  smsId: string,
): Promise<Entity> {
  const request = {
    name,
    type: classifyEntityType(name),
    description: 'Automatically created from an SMS.',
  };

  try {
    return await entitiesService.createEntity(userId, request);
  } catch {
    const local: Entity = {
      id: `ent-sms-${Crypto.randomUUID()}`,
      name: request.name,
      type: request.type,
      description: `${request.description} Saved offline.`,
      sourceNotificationId: smsId,
    };
    await entitiesRepository.create(userId, {
      id: local.id,
      name: local.name,
      type: local.type,
      description: local.description ?? null,
      sourceNotificationId: smsId,
    });
    return local;
  }
}

interface PersistTimelineArgs {
  userId: string;
  title: string;
  description: string;
  eventDate: string;
  moneyType: 'expense' | 'receive' | null;
  amountPaise: number | null;
  category: string | null;
  receivableStatus: string | null;
  linkedIds: string[];
  message: SmsMessage;
}

/**
 * Writes the timeline, server-first with a local fallback.
 *
 * The local branch matters: `timelinesService.createTimeline` requires the API,
 * and an SMS saved without connectivity must still produce a record. Because the
 * row is stamped with the message id, `timelinesRepository.replaceAll` treats it
 * as device-only and will not delete it on the next refresh.
 */
async function persistTimeline(
  args: PersistTimelineArgs,
): Promise<{ timeline: Timeline; offline: boolean }> {
  const { userId, message } = args;
  const request = {
    title: args.title,
    description: args.description,
    eventDate: args.eventDate,
    entityIds: args.linkedIds,
  };

  if (args.moneyType && args.amountPaise) {
    // A credit carries a lifecycle status instead of a category, which is the
    // same distinction the Expenses and Money-to-Receive pages already make.
    const attribution =
      args.moneyType === 'receive'
        ? { role: 'receive' as const, amountPaise: args.amountPaise, status: args.receivableStatus ?? undefined }
        : { role: 'expense' as const, amountPaise: args.amountPaise, category: args.category };
    try {
      const created = await timelinesService.createTimeline(userId, request, attribution);
      return { timeline: await stampSource(userId, created.id, message.id), offline: false };
    } catch {
      // Offline: fall through to the local write below.
    }
  } else {
    try {
      const created = await timelinesService.createTimeline(userId, request);
      return { timeline: await stampSource(userId, created.id, message.id), offline: false };
    } catch {
      // Offline: fall through to the local write below.
    }
  }

  return { timeline: await createLocalTimeline(args), offline: true };
}

async function stampSource(userId: string, timelineId: string, smsId: string): Promise<Timeline> {
  await timelinesRepository.update(userId, timelineId, {
    source: 'SMS',
    sourceNotificationId: smsId,
  });
  const updated = await timelinesRepository.getById(userId, timelineId);
  if (!updated) {
    throw new Error('Failed to save the message');
  }
  return updated;
}

async function createLocalTimeline(args: PersistTimelineArgs): Promise<Timeline> {
  const now = new Date().toISOString();
  const id = `tl-sms-${Crypto.randomUUID()}`;
  await timelinesRepository.create(
    args.userId,
    {
      id,
      title: args.title,
      description: args.description,
      eventDate: args.eventDate,
      showOnCalendar: false,
      createdAt: now,
      updatedAt: now,
      expenseAmountPaisa: args.amountPaise,
      expenseCategory: args.moneyType === 'receive' ? null : args.category,
      receivableStatus: args.moneyType === 'receive' ? args.receivableStatus ?? 'pending' : null,
      moneyType: args.moneyType,
      source: 'SMS',
      sourceNotificationId: args.message.id,
    },
    args.linkedIds,
  );
  const created = await timelinesRepository.getById(args.userId, id);
  if (!created) {
    throw new Error('Failed to save the message');
  }
  return created;
}

async function markSmsNotificationRead(userId: string, notificationId: string): Promise<void> {
  // The message is no longer awaiting review, so it leaves the unread list; the
  // record it produced now shows up in the normal Timeline notifications.
  await notificationsRepository.markRead(userId, notificationId).catch(() => false);
}

/** Parsed amount for the edit screen's hint; null when the text carries none. */
export function amountFromText(text: string): number | null {
  const parsed = parseActivity(text);
  if (parsed.money?.amountPaise) return parsed.money.amountPaise;
  return parseAmountToPaise(/(\d[\d,]*)/.exec(text)?.[1] ?? '');
}

export { classifySms, smsPreview, isBulkSender, SENDER_PREFIX_RE };
