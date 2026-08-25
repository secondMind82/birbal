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
}

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
