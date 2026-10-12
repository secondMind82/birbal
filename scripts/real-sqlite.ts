// A REAL SQLite harness for the repository layer.
//
// scripts/fake-sqlite.ts is a mock: it records statements and never parses SQL,
// so a repository bug (wrong column name, a bad WHERE, a dropped row) cannot be
// caught there. This harness runs the actual statements through node:sqlite
// (Node's bundled SQLite), so schema.ts migrations and every repository query
// execute for real against the same SQL the app sends.
//
// Only the small surface expo-sqlite exposes to the app is adapted:
// execAsync / runAsync / getFirstAsync / getAllAsync /
// withExclusiveTransactionAsync / closeAsync, with the same parameter binding.

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import Module from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

type Param = string | number | null;

/**
 * The database openDatabaseAsync will hand back. src/db/database.ts resolves it
 * lazily on its first call, so a test installs this before touching the
 * repository under test.
 */
let activeDb: unknown = null;

export function setActiveDb(db: unknown): void {
  activeDb = db;
}

/**
 * Intercepts require('expo-sqlite') and serves the harness instead.
 *
 * The repositories reach the driver through src/db/database.ts's getDb(), a
 * module-level singleton, so nothing in src/ needs a test-only seam: the module
 * only has to resolve. closeDatabase() resets that singleton between tests,
 * giving each one a clean database.
 */
export function installExpoSqliteShim(): void {
  type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
  type Resolver = (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
  const mod = Module as unknown as { _load: Loader; _resolveFilename: Resolver };
  if ((mod as unknown as { __birbalShim?: boolean }).__birbalShim) return;
  const original = mod._load;
  const originalResolve = mod._resolveFilename;

  // expo-modules-core ships untranspiled TypeScript under node_modules, which
  // Node will not type-strip, so a plain require() of it throws before any test
  // can run. Redirect the specifier to the compiled local stub instead.
  const redirect: Record<string, string> = {
    'expo-modules-core': require.resolve('./stubs/expo-modules-core'),
  };

  mod._resolveFilename = function patchedResolve(this: unknown, request, parent, isMain, options) {
    const target = redirect[request];
    if (target) return target;
    return originalResolve.call(this, request, parent, isMain, options);
  };

  const patched: Loader = function (this: unknown, request, parent, isMain) {
    if (request in STUBS) {
      return STUBS[request];
    }
    return original.call(this, request, parent, isMain);
  };
  (patched as unknown as { __birbalShim?: boolean }).__birbalShim = true;
  mod._load = patched;
}

/**
 * Native modules the app pulls in transitively. Only the members the app actually
 * touches are provided, so a missing one still fails loudly instead of silently
 * passing a test.
 */
/**
 * Mutable knobs behind the native stubs, so a test can drive the app's UI-facing
 * native behaviour (permission results, alert answers, the key-value store)
 * without a device.
 */
export const nativeControls = {
  platform: 'android' as string,
  /** Value Platform.Version reports; drives the Android-13+ exact-alarm prompt. */
  platformVersion: 36 as number,
  /** Every intent `Linking.sendIntent` was asked to launch, in order. */
  linkingIntents: [] as string[],
  /** Result PermissionsAndroid.check() reports for RECEIVE_SMS. */
  smsGranted: false,
  /**
   * Messages the Kotlin SmsInboxStore would be holding. Tests push real records
   * in here to exercise the JS half of the capture pipeline against the same
   * peek/ack contract the native module uses.
   */
  smsInbox: [] as Array<{ id: string; sender: string; body: string; receivedAt: number }>,
  /** Result PermissionsAndroid.request() resolves with. */
  smsRequestResult: 'granted' as string,
  /** Which button the next Alert.alert() call resolves with. */
  alertAnswer: 'continue' as string,
  /** Every alert the app raised, for asserting on copy and on nagging. */
  alerts: [] as Array<{ title: string; message?: string }>,
  /** Every permission the app actually asked for, in order. */
  permissionRequests: [] as string[],
  /** Whether the stubbed native module resolves, i.e. this build can capture. */
  smsCaptureSupported: true,
  /** Stand-in for SecureStore's key-value store. */
  secureStore: new Map<string, string>(),
  /** Result Notifications.getPermissionsAsync() reports for the notification grant. */
  notificationsGranted: true,
  /**
   * Stand-in for the OS's scheduled-notification store. `scheduleNotificationAsync`
   * writes here, `cancelScheduledNotificationAsync` deletes, and
   * `getAllScheduledNotificationsAsync` reads it back — so a test can seed a
   * still-pending reminder and assert that a resync preserves it. Keys are the
   * notification identifiers; a resync/re-schedule replaces in place (no dupes).
   */
  scheduledNotifications: new Map<
    string,
    { identifier: string; content: unknown; trigger: unknown }
  >(),
  /**
   * Every `setNotificationChannelAsync` options object, so a test can assert the
   * channel is configured the supported way (e.g. no `sound` field that names a
   * resource which does not exist — expo-notifications logs a warning for it).
   */
  notificationChannelOptions: [] as unknown[],
  /** Every alert the app raised, for asserting on copy and on nagging. */
  reset(): void {
    this.platform = 'android';
    this.platformVersion = 36;
    this.linkingIntents = [];
    this.smsGranted = false;
    this.smsInbox.length = 0;
    this.smsRequestResult = 'granted';
    this.alertAnswer = 'continue';
    this.alerts = [];
    this.permissionRequests = [];
    this.smsCaptureSupported = true;
    this.secureStore = new Map();
    this.notificationsGranted = true;
    this.scheduledNotifications = new Map();
    this.notificationChannelOptions = [];
    // The compiled stub reads this to decide whether requireNativeModule throws.
    (globalThis as { __birbalNativeControls?: unknown }).__birbalNativeControls = this;
  },
};

// The compiled expo-modules-core stub reads this object, so it must be reachable
// as soon as the harness module is evaluated.
(globalThis as { __birbalNativeControls?: unknown }).__birbalNativeControls = nativeControls;

function isCancel(word: string): boolean {
  return word.includes('cancel') || word === 'dismiss';
}

/** Resolves the alert by pressing the button whose label matches `alertAnswer`. */
const ALERT_STUB = {
  alert: (
    title: string,
    message?: string,
    buttons?: Array<{ text?: string; style?: string; onPress?: () => void }>,
    options?: { onDismiss?: () => void },
  ): void => {
    nativeControls.alerts.push({ title, message });
    const list = buttons ?? [];
    if (list.length === 0) {
      options?.onDismiss?.();
      return;
    }
    const match =
      list.find((b) => {
        const text = b.text ?? '';
        return isCancel(nativeControls.alertAnswer) ? b.style === 'cancel' : b.style !== 'cancel';
      }) ?? list[0];
    match.onPress?.();
  },
};

const PERMISSIONS_ANDROID_STUB = {
  PERMISSIONS: { RECEIVE_SMS: 'android.permission.RECEIVE_SMS' },
  check: async (): Promise<boolean> => nativeControls.smsGranted,
  request: async (permission: string): Promise<string> => {
    nativeControls.permissionRequests.push(permission);
    if (nativeControls.smsRequestResult === 'granted') {
      nativeControls.smsGranted = true;
    }
    return nativeControls.smsRequestResult;
  },
};

const SECURE_STORE_STUB = {
  getItemAsync: async (key: string) => nativeControls.secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    nativeControls.secureStore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    nativeControls.secureStore.delete(key);
  },
};

/**
 * expo-crypto is untranspiled TypeScript in node_modules too. Only the members the
 * app actually calls are provided: randomUUID backs the local ids smsService
 * mints for offline entities/timelines, and the digest pair backs backup
 * integrity. A missing member still fails loudly.
 */
const EXPO_CRYPTO_STUB = {
  randomUUID: () => randomUUID(),
  digestStringAsync: async (algorithm: string, data: string, options: { encoding: string }) => {
    const hash = createHash('sha256').update(data, 'utf8').digest(options.encoding === 'base64' ? 'base64' : 'hex');
    return hash;
  },
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex', BASE64: 'base64' },
};

/**
 * Converts a JS trigger input (`{ type:'date', date }`, as the app passes to
 * scheduleNotificationAsync) into the shape Android hands back from
 * `getAllScheduledNotificationsAsync()` — `DateTrigger.toBundle()` emits
 * `{ type:'date', repeats, value, channelId }`. Non-date triggers pass through.
 */
function toNativeTrigger(trigger: unknown): unknown {
  if (trigger && typeof trigger === 'object') {
    const t = trigger as { type?: string; date?: unknown; channelId?: string };
    if (t.type === 'date') {
      const raw = t.date;
      const value = raw instanceof Date ? raw.getTime() : Number(raw);
      return { type: 'date', repeats: false, value, channelId: t.channelId };
    }
  }
  return trigger ?? null;
}

const STUBS: Record<string, unknown> = {
  'expo-crypto': EXPO_CRYPTO_STUB,
  'expo-sqlite': {
    openDatabaseAsync: async () => activeDb,
    deleteDatabaseAsync: async () => {},
  },
  'expo-secure-store': SECURE_STORE_STUB,
  'expo-notifications': {
    getPermissionsAsync: async () => ({
      granted: nativeControls.notificationsGranted,
      status: nativeControls.notificationsGranted ? 'granted' : 'denied',
      canAskAgain: true,
    }),
    requestPermissionsAsync: async () => ({
      granted: nativeControls.notificationsGranted,
      status: nativeControls.notificationsGranted ? 'granted' : 'denied',
      canAskAgain: true,
    }),
    setNotificationHandler: () => {},
    setNotificationChannelAsync: async (_channelId: string, options?: unknown) => {
      nativeControls.notificationChannelOptions.push(options ?? null);
      return null;
    },
    getNotificationChannelsAsync: async () => [],
    AndroidImportance: { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
    SchedulableTriggerInputTypes: {
      CALENDAR: 'calendar',
      DAILY: 'daily',
      WEEKLY: 'weekly',
      MONTHLY: 'monthly',
      YEARLY: 'yearly',
      DATE: 'date',
      TIME_INTERVAL: 'timeInterval',
    },
    // Mirrors the real module closely enough for the scheduler: a scheduled
    // request is stored under its identifier (replace, never stack) and surfaces
    // from getAllScheduledNotificationsAsync() with Android's `value` trigger
    // shape — DateTrigger.toBundle() emits `{ type:'date', repeats, value }`.
    scheduleNotificationAsync: async (request: {
      identifier?: string;
      content?: unknown;
      trigger?: unknown;
    }) => {
      const identifier = request?.identifier ?? `stub-${nativeControls.scheduledNotifications.size}`;
      nativeControls.scheduledNotifications.set(identifier, {
        identifier,
        content: request?.content ?? null,
        trigger: toNativeTrigger(request?.trigger),
      });
      return identifier;
    },
    cancelScheduledNotificationAsync: async (identifier: string) => {
      nativeControls.scheduledNotifications.delete(identifier);
    },
    cancelAllScheduledNotificationsAsync: async () => {
      nativeControls.scheduledNotifications.clear();
    },
    getAllScheduledNotificationsAsync: async () => [
      ...nativeControls.scheduledNotifications.values(),
    ],
    getLastNotificationResponse: () => null,
    clearLastNotificationResponse: () => {},
    addNotificationReceivedListener: () => ({ remove: () => {} }),
    addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
  },
  // react-native ships untranspiled Flow, which Node cannot parse. Only the
  // members the imported modules actually touch are provided.
  'react-native': {
    get Platform() {
      return {
        OS: nativeControls.platform,
        Version: nativeControls.platformVersion,
        select: (o: Record<string, unknown>) => o[nativeControls.platform] ?? o.default,
      };
    },
    Alert: ALERT_STUB,
    PermissionsAndroid: PERMISSIONS_ANDROID_STUB,
    Linking: {
      openSettings: async () => true,
      openURL: async () => true,
      sendIntent: async (action: string) => {
        nativeControls.linkingIntents.push(action);
        return true;
      },
    },
    AppState: { addEventListener: () => ({ remove: () => {} }) },
  },
  '@react-navigation/native': {
    createNavigationContainerRef: () => ({
      isReady: () => false,
      navigate: () => {},
      addListener: () => () => {},
    }),
    useNavigation: () => ({ navigate: () => {}, goBack: () => {} }),
    useFocusEffect: () => {},
    useRoute: () => ({ params: {} }),
  },
  '@react-navigation/native-stack': {},
  '@react-navigation/stack': {},
  // Sign-in packages reachable from authStore -> socialAuth. They are pure ESM
  // with subpath exports Node cannot resolve, and no money path touches them.
  'expo-apple-authentication': {
    isAvailableAsync: async () => false,
    signInAsync: async () => ({ fullName: { givenName: 'Test', familyName: 'User' } }),
    getCredentialStateAsync: async () => 0,
  },
  '@react-native-google-signin/google-signin': {
    GoogleSignin: {
      configure: () => {},
      isSignedIn: async () => false,
      hasPlayServices: async () => false,
      signIn: async () => ({ user: { id: 'g1', name: 'Test User', email: 't@example.test' } }),
      getTokens: async () => ({ accessToken: 'a' }),
      signOut: async () => {},
    },
  },
};

function coerce(v: unknown): Param {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return String(v);
}

/** expo-sqlite accepts varargs or a single array; node:sqlite accepts varargs. */
function argsOf(args: unknown[]): Param[] {
  if (args.length === 1 && Array.isArray(args[0])) {
    return (args[0] as unknown[]).map(coerce);
  }
  return args.map(coerce);
}

export interface RealDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...args: unknown[]): Promise<{
    changes: number;
    lastInsertRowId: number;
  }>;
  getFirstAsync<T>(sql: string, ...args: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...args: unknown[]): Promise<T[]>;
  withExclusiveTransactionAsync<T>(fn: (txn: RealDb) => Promise<T>): Promise<T>;
  closeAsync(): Promise<void>;
}

export interface RealDbHarness {
  db: RealDb;
  raw: DatabaseSync;
  /** Every statement the app issued, in order. */
  statementsIssued(): string[];
}

/**
 * Wraps a node:sqlite database in the expo-sqlite async API surface.
 */
export function createRealDb(filename = ':memory:'): RealDbHarness {
  const raw = new DatabaseSync(filename);
  const issued: string[] = [];

  const db: RealDb = {
    async execAsync(sql: string) {
      issued.push(sql);
      raw.exec(sql);
    },
    async runAsync(sql: string, ...args: unknown[]) {
      issued.push(sql);
      const res = raw.prepare(sql).run(...argsOf(args));
      return {
        changes: Number(res.changes ?? 0),
        lastInsertRowId: Number(res.lastInsertRowid ?? 0),
      };
    },
    async getFirstAsync<T>(sql: string, ...args: unknown[]) {
      issued.push(sql);
      const row = raw.prepare(sql).get(...argsOf(args));
      return (row ?? null) as T | null;
    },
    async getAllAsync<T>(sql: string, ...args: unknown[]) {
      issued.push(sql);
      return raw.prepare(sql).all(...argsOf(args)) as T[];
    },
    async withExclusiveTransactionAsync<T>(fn: (txn: RealDb) => Promise<T>) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(db);
        raw.exec('COMMIT');
        return result;
      } catch (e) {
        try {
          raw.exec('ROLLBACK');
        } catch {
          /* the transaction was already aborted */
        }
        throw e;
      }
    },
    async closeAsync() {
      raw.close();
    },
  };

  return { db, raw, statementsIssued: () => issued };
}

/**
 * Prepares a migrated, app-ready database: installs the driver shim, points
 * openDatabaseAsync at a fresh database and lets the production getDb() run the
 * real migrations. Returns the harness plus a cleanup that resets the singleton.
 */
export async function freshDb(
  filename = ':memory:',
): Promise<RealDbHarness & { cleanup(): Promise<void> }> {
  installExpoSqliteShim();
  const { closeDatabase, initializeDatabase } = await import('../src/db/database');
  await closeDatabase().catch(() => {});
  // A file-backed database is what makes a "restart" test real: close the
  // harness, reopen the same file and the rows are genuinely still there.
  const harness = createRealDb(filename);
  setActiveDb(harness.db);
  await initializeDatabase();
  return {
    ...harness,
    cleanup: async () => {
      await closeDatabase().catch(() => {});
      setActiveDb(null);
    },
  };
}

export type { StatementSync };
