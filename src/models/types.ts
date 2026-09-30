export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  username?: string | null;
  phone?: string | null;
  bio?: string | null;
  avatar?: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  fullName: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  message: string;
  accessToken: string;
  user: AuthUser;
}

export interface UpdateProfileRequest {
  fullName: string;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  bio?: string | null;
  avatar?: string | null;
}

export interface UpdateProfileResponse {
  message: string;
  user: AuthUser;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  updatedAt: string;
  createdAt?: string | null;
  userId?: string | null;
}

export interface CreateNoteRequest {
  title: string;
  content: string;
  pinned?: boolean;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  avatar?: string | null;
  userId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  // Local-only provenance: set when the entity was auto-created while saving a
  // captured SIM SMS. The originating message is the only thing that created it,
  // so on-device (possibly not-yet-synced) entities are protected from being
  // dropped by a server refresh. Never sent to the backend.
  sourceNotificationId?: string | null;
}

export interface CreateEntityRequest {
  name: string;
  type: string;
  description?: string | null;
}

export interface TimelineEntityLink {
  timelineId: string;
  entityId: string;
  entity: Entity;
}

// Direction of a locally-tracked money entry. 'expense' = debit / money paid
// out; 'receive' = credit / money owed back to the user. NULL on a timeline row
// means it carries no money attribution at all.
export type MoneyType = 'expense' | 'receive';

export interface Timeline {
  id: string;
  title: string;
  description: string;
  eventDate: string;
  showOnCalendar: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  userId?: string | null;
  entities?: TimelineEntityLink[] | null;
  // Local-only expense attribution. `expenseAmountPaisa != null` marks this entry
  // as an expense — the same underlying timeline record, never duplicated. The
  // backend contract has no concept of expenses, so these fields live only in
  // SQLite and are preserved by refresh/replaceAll. NULL = not an expense.
  expenseAmountPaisa?: number | null;
  expenseCategory?: string | null;
  // Local-only receivable lifecycle. NULL = still Pending (classified as
  // receivable at render time by the parser); 'received' / 'ignored' = the user
  // acted on the entry. Like expense fields, this is never sent to the backend.
  receivableStatus?: string | null;
  // Local-only direction marker for money attribution: 'expense' = debit /
  // money paid out, 'receive' = credit / money owed back to the user. Amount
  // presence never implies a direction, so this explicit tag is what makes the
  // classification unambiguous. NULL = not a money entry. Never sent to backend.
  moneyType?: MoneyType | null;
  // Local-only provenance. Set when the record was created by saving a captured
  // SIM SMS, so the UI can attribute the record to its message and the SMS flow
  // can find the record it already created instead of duplicating it. The
  // backend has no such concept, so these are never sent to it and are preserved
  // by refresh/replaceAll exactly like the money columns above.
  source?: TimelineSource | null;
  sourceNotificationId?: string | null;
}

/**
 * Local-only record origin, marking a row this device owns outright.
 *
 * 'SMS'   — created by saving a captured SIM message; sourceNotificationId points
 *           at the sms_messages row.
 * 'MANUAL'— created on-device by the Add Expense form when the network was down,
 *           so the server has never seen it. Carries no notification id.
 *
 * Both exist so replaceAll can hold a device-only row back instead of deleting
 * work the user just did. NULL means the server owns the row.
 */
export type TimelineSource = 'SMS' | 'MANUAL';

export interface ExpenseMeta {
  amountPaise: number;
  category: string;
}

export type Expense = Timeline & {
  expenseAmountPaisa: number;
  expenseCategory: string;
};

export interface CreateTimelineRequest {
  title: string;
  description: string;
  eventDate: string;
  entityIds?: string[];
  showOnCalendar?: boolean;
}

export interface DiaryEntry {
  id: string;
  title: string;
  content: string;
  mood: string;
  entryDate: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  userId?: string | null;
}

export interface CreateDiaryRequest {
  title: string;
  content: string;
  mood: string;
  entryDate: string;
}

// ─── Notifications ───────────────────────────────────────────────────────────
// Local-first notification model. `type` drives icon/tone; `entityId`/`timelineId`
// are optional navigation targets resolved by the Notification Center. The shape
// is intentionally push-ready (stable id, timestamps, read flag) so a future
// remote push can map 1:1 onto the same rows.
export type NotificationType =
  | 'EVENT'
  | 'BIRTHDAY'
  | 'REMINDER'
  | 'TIMELINE'
  | 'SYSTEM'
  | 'SMS';

/** Review state of a captured SMS in the local inbox. */
export type SmsStatus = 'PENDING' | 'IGNORED' | 'PROCESSED';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string | null;
  icon?: string | null;
  read: boolean;
  entityId?: string | null;
  timelineId?: string | null;
  createdAt: string;
  userId?: string | null;
}

/**
 * A SIM SMS held in the local review queue. Raw bodies never leave the device:
 * this table is excluded from cloud backup and no body is ever logged.
 */
export interface SmsMessage {
  /** Stable message identity; the primary key that makes capture idempotent. */
  id: string;
  sender: string;
  body: string;
  receivedAt: string;
  status: SmsStatus;
  /** Local privacy hint: OTP-style text is masked in the UI and aged out. */
  isOtp: boolean;
  notificationId?: string | null;
  /** Set once saved, so saving the same message again cannot duplicate it. */
  timelineId?: string | null;
  processedAt?: string | null;
  createdAt: string;
  userId?: string | null;
}

/** What the classifier decided about a message, before the user edits it. */
export interface SmsClassification {
  kind: 'financial' | 'otp' | 'other';
  /** Why it was classified this way, shown as a hint in the edit screen. */
  reason: string;
}

export interface DashboardStats {
  totalNotes: number;
  pinnedNotes: number;
  totalTimelines?: number;
  categories: number;
}

export interface DashboardResponse {
  stats: DashboardStats;
  recentNotes: Note[];
  recentEvents?: Timeline[] | null;
  recentDiary?: DiaryEntry[] | null;
}

export interface SimpleResponse {
  message: string;
}

// ─── Backup & Restore ────────────────────────────────────────────────────────
// A backup is a versioned, table-driven snapshot of every user-owned SQLite row
// (see src/db/backupTables.ts). Rows are stored RAW — column name to value —
// rather than as app model objects, so ids, exact timestamps and columns the
// current build does not model yet all survive a round trip.
//
// Envelope (v2, current):
//   { backupVersion, appVersion, createdAt, userId, encoding,
//     recordCounts, checksum, data: { [tableKey]: Row[] } }
//
// The envelope NEVER contains credentials: no access/refresh token, password or
// SecureStore value is ever read into a backup. `userId` is informational
// only — the server derives ownership from the verified JWT and the client
// re-asserts it on write.

// The wire format reserves an `encoding` field for a future compressed format,
// but only plain JSON can be verified end to end today: the checksum is taken
// over the canonical serialization of the decoded `data`, so a compressed
// payload could never be verified by a client that decompresses it first. The
// server rejects anything but 'json' and so does restorePayload(), rather than
// silently mis-hashing a base64 string.
export type BackupEncoding = 'json';

export interface BackupV2Payload {
  backupVersion: 2;
  appVersion: string;
  encoding: BackupEncoding;
  createdAt: string;
  userId: string;
  recordCounts: Record<string, number>;
  /** SHA-256 (hex) of the canonical serialization of `data`. */
  checksum: string;
  data: Record<string, Record<string, unknown>[]>;
}

// Historical v1 shape: model objects at the top level, no checksum/encoding.
// Still accepted on restore and upgraded in memory (see backupService).
export interface BackupV1Payload {
  backupVersion: 1;
  createdAt: string;
  updatedAt: string;
  userId: string;
  notes: Note[];
  diaryEntries: DiaryEntry[];
  entities: Entity[];
  timelines: Timeline[];
}

export type BackupPayload = BackupV2Payload | BackupV1Payload;

export interface BackupMetadata {
  id: string;
  backupVersion: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  appVersion: string | null;
  checksum: string | null;
  /** Always 'json' for anything this build can restore. */
  encoding: string;
  recordCounts: Record<string, number>;
}

export interface BackupInfo extends BackupMetadata {
  payload?: BackupPayload;
}
