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
}

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
  | 'SYSTEM';

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
// Logical, versioned snapshot of a user's SQLite productivity data. The payload
// reuses the existing model shapes (no invented fields); timestamps keep the ISO
// text format the repositories already write to SQLite.

export interface BackupPayload {
  backupVersion: number;
  createdAt: string;
  updatedAt: string;
  userId: string;
  notes: Note[];
  diaryEntries: DiaryEntry[];
  entities: Entity[];
  timelines: Timeline[];
}

export interface BackupMetadata {
  id: string;
  backupVersion: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface BackupInfo extends BackupMetadata {
  payload?: BackupPayload;
}
