// A real HTTP stand-in for the Birbal API.
//
// The API base URL is read from EXPO_PUBLIC_API_URL when src/api/client.ts loads,
// so a test can point axios at this server and exercise the genuine request path
// (real sockets, real status codes, real timeouts) instead of mocking the
// client. `mode` lets a test simulate the phone being offline: 'offline' refuses
// every connection the way a dropped network does.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StoredTimeline {
  id: string;
  userId: string;
  title: string;
  description: string;
  eventDate: string;
  showOnCalendar: boolean;
  createdAt: string;
  updatedAt: string;
  entities: Array<{ entityId: string; entity: Record<string, unknown> }>;
}

export interface FakeApi {
  url: string;
  /** Rows the server currently holds, in insertion order. */
  timelines: StoredTimeline[];
  /** Entities the server holds. SMS saves create one per @mention. */
  entities: Array<Record<string, unknown>>;
  /** Every request the app made, for asserting what was sent. */
  requests: Array<{ method: string; url: string; body: unknown }>;
  setMode(mode: 'online' | 'offline'): void;
  /** Empties the server, so one test's seed cannot leak into the next. */
  reset(): void;
  /** Seeds a row as if it already existed on the server. */
  seed(timeline: Partial<StoredTimeline> & { id: string }): StoredTimeline;
  close(): Promise<void>;
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Starts the server and sets EXPO_PUBLIC_API_URL so a subsequently-required
 * src/api/client.ts targets it. Must be called BEFORE importing the app modules.
 */
export async function startFakeApi(): Promise<FakeApi> {
  const timelines: StoredTimeline[] = [];
  const entities: Array<Record<string, unknown>> = [];
  const requests: FakeApi['requests'] = [];
  let mode: 'online' | 'offline' = 'online';

  const server: Server = createServer((req, res) => {
    void (async () => {
      if (mode === 'offline') {
        // Destroy the socket: axios sees a network error, exactly like airplane
        // mode, instead of a well-formed HTTP failure the app could treat as data.
        req.socket.destroy();
        return;
      }
      const body = await readBody(req);
      const url = (req.url ?? '').split('?')[0];
      requests.push({ method: req.method ?? 'GET', url, body });

      if (url === '/entities' && req.method === 'GET') {
        send(res, 200, entities);
        return;
      }
      if (url === '/entities' && req.method === 'POST') {
        const input = (body ?? {}) as Record<string, unknown>;
        const now = new Date().toISOString();
        const row = {
          id: String(input.id ?? nextId('ent')),
          userId: 'user-1',
          name: String(input.name ?? ''),
          type: input.type === 'PLACE' ? 'Place' : 'Person',
          description: (input.description as string | null) ?? null,
          avatar: (input.avatar as string | null) ?? null,
          createdAt: now,
          updatedAt: now,
        };
        entities.push(row);
        send(res, 201, row);
        return;
      }
      if (url === '/timeline' && req.method === 'GET') {
        send(res, 200, timelines);
        return;
      }
      if (url === '/timeline' && req.method === 'POST') {
        const input = (body ?? {}) as Record<string, unknown>;
        const now = new Date().toISOString();
        const row: StoredTimeline = {
          id: String(input.id ?? nextId('tl')),
          userId: 'user-1',
          title: String(input.title ?? ''),
          description: String(input.description ?? ''),
          eventDate: String(input.eventDate ?? now),
          showOnCalendar: Boolean(input.showOnCalendar),
          createdAt: now,
          updatedAt: now,
          // Mirrors timeline.service.ts's create include: the entity is echoed
          // back so a save can reconcile links without a second round trip.
          entities: ((input.entityIds as string[] | undefined) ?? []).map((entityId) => ({
            entityId,
            entity: {
              id: entityId,
              userId: 'user-1',
              name: `Entity ${entityId}`,
              type: 'Person',
              description: null,
              avatar: null,
              createdAt: now,
              updatedAt: now,
            },
          })),
        };
        timelines.push(row);
        send(res, 201, row);
        return;
      }
      if (url.startsWith('/timeline/') && req.method === 'PATCH') {
        const id = url.slice('/timeline/'.length);
        const row = timelines.find((t) => t.id === id);
        if (!row) {
          send(res, 404, { message: 'Timeline not found' });
          return;
        }
        const input = (body ?? {}) as Record<string, unknown>;
        row.title = String(input.title ?? row.title);
        row.description = String(input.description ?? row.description);
        row.eventDate = String(input.eventDate ?? row.eventDate);
        row.showOnCalendar = Boolean(input.showOnCalendar);
        row.updatedAt = new Date().toISOString();
        row.entities = ((input.entityIds as string[] | undefined) ?? []).map((entityId) => ({
          entityId,
          entity: {
            id: entityId,
            userId: 'user-1',
            name: `Entity ${entityId}`,
            type: 'Person',
            description: null,
            avatar: null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        }));
        send(res, 200, row);
        return;
      }
      if (url.startsWith('/timeline/') && req.method === 'DELETE') {
        const id = url.slice('/timeline/'.length);
        const idx = timelines.findIndex((t) => t.id === id);
        if (idx >= 0) timelines.splice(idx, 1);
        send(res, 200, { success: true });
        return;
      }
      send(res, 404, { message: `No fake route for ${req.method} ${url}` });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/`;
  process.env.EXPO_PUBLIC_API_URL = url;

  return {
    url,
    timelines,
    entities,
    requests,
    setMode(next) {
      mode = next;
    },
    reset() {
      timelines.length = 0;
      entities.length = 0;
      requests.length = 0;
      mode = 'online';
    },
    seed(partial) {
      const now = new Date().toISOString();
      const row: StoredTimeline = {
        id: partial.id,
        userId: partial.userId ?? 'user-1',
        title: partial.title ?? 'Seeded',
        description: partial.description ?? '',
        eventDate: partial.eventDate ?? now,
        showOnCalendar: partial.showOnCalendar ?? false,
        createdAt: partial.createdAt ?? now,
        updatedAt: partial.updatedAt ?? now,
        entities: partial.entities ?? [],
      };
      timelines.push(row);
      return row;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
