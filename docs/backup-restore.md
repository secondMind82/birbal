# Backup & Restore

Birbal stores every user-owned row in a local SQLite database. This feature backs
that database up to the account on the API, and restores it on any other device
signed in to the **same account**.

## What is included

| Table | Contents |
| --- | --- |
| `entities` | People, places, organisations, events |
| `timelines` | Timeline entries, calendar events and expenses |
| `timeline_entities` | The links between them |
| `notes` | Notes |
| `diary_entries` | Diary entries |
| `notifications` | Reminders and their read/unread state |

Excluded on purpose: `app_meta` (local bookkeeping) and `backup_snapshots` (the
local undo copy itself). Your password, session tokens and every other
SecureStore value are never read into a backup — and the API rejects any
upload containing credential-shaped keys, so a client bug cannot leak one.

Events and expenses are **not** separate tables. An event is a `timelines` row
with `show_on_calendar = 1`, and an expense is one with an
`expense_amount_paise` value. They are stored once and counted as views, so the
copies can never drift apart.

## Wire format (v2)

```jsonc
{
  "backupVersion": 2,
  "appVersion": "1.0.0",
  "createdAt": "2026-09-28T13:58:41.000Z",
  "userId": "cmukzef…",
  "encoding": "json",
  "recordCounts": { "entities": 1, "timelines": 1, "total": 5, … },
  "checksum": "c30a152e376a…",   // SHA-256 of the canonical `data`
  "data": { "entities": [ /* raw SQLite rows */ ], "timelines": [ … ], … }
}
```

Rows are stored **raw** — column name to value — rather than as app model
objects, so ids, exact timestamps and columns the current build does not model
yet all survive a round trip.

The checksum is taken over a *canonical* serialization (recursively sorted object
keys), so the same data hashes identically regardless of key order. The
canonicalizer is implemented twice, once per repo
(`secondbrain-api/src/backup/backup-format.ts` and
`birbal/src/services/backupCanonical.ts`), and
`npm run verify:backup` asserts the two agree byte for byte.

`encoding` is reserved for a future compressed format but only `json` is
accepted today. A compressed payload could never be verified — the checksum is
over the decoded data — so accepting one would store backups that no client
could ever restore.

**v1 backups** (the original shape, with model objects at the top level) are
still accepted and upgraded in memory.

## How a restore works

1. **Validate.** Version, ownership and the SHA-256 checksum are checked
   before a single row is written. A damaged or foreign backup is refused with
   the existing data untouched.
2. **Snapshot.** The current local rows are written to `backup_snapshots` and
   committed. This is the undo copy.
3. **Replace.** In a single `EXCLUSIVE` transaction: the user's rows are
   deleted, the backup's rows are inserted parents-first, `PRAGMA
   foreign_key_check` runs, and each table's row count is verified. Any failure
   throws, which rolls the transaction back.
4. **Refresh.** Notifications and the reminders derived from `timelines` are
   rebuilt.

Restoring is idempotent — repeating it produces the same database. It replaces
local data rather than merging, so records created after the backup are removed.

## Undo

After a restore, **Undo last restore** appears in Settings and puts the pre-restore
data back. Only the newest snapshot is kept, and it is consumed by the undo.
The button is shown by reading `backup_snapshots` on mount, so it survives an
app restart rather than only existing in the screen's state.

An empty snapshot is valid for undo: restoring onto a brand-new device and then
undoing returns it to empty. This is the one case where a zero-row payload is
allowed; a cloud backup containing nothing is still treated as a mistake.

## API

All routes require `Authorization: Bearer <token>` and act only on the account
the token belongs to. A payload whose `userId` disagrees is rejected with `403`.

| Route | Purpose |
| --- | --- |
| `POST /backups` | Upload a backup |
| `GET /backups/latest?includePayload=true` | Newest backup, optionally with the payload |
| `GET /backups` | Backup history (metadata only) |
| `DELETE /backups/:id` | Delete a backup |

`GET /backups/latest` returns metadata only, so opening Settings never
downloads the whole payload. The size cap is 12 MiB, enforced both by the
service and by the Express body parser.

Note on the body parser: `NestFactory.create` installs Express' default `json()`
parser with its 100kb limit *during creation*, so registering another parser
afterwards does nothing — the first one has already rejected the request. The app
is therefore created with `bodyParser: false` and the parsers are installed in
`src/app.setup.ts` before anything else.

## Testing

```bash
# In birbal: 31 cases, no device or API required
npm run verify:backup

# In birbal: 13 checks against a running API, real HTTP, real PostgreSQL
BIRBAL_API_URL=http://localhost:3000 npm run verify:backup:live

# In secondbrain-api: 10 cases against real PostgreSQL, including a
# >100kb authenticated HTTP round trip
npm run test:e2e
```

`verify:backup:live` builds its payload with the **mobile** canonicalizer and a
192kb note, so it catches any client/server drift in the hash or the size limit.

## Manual test (two devices, one account)

1. On device A: create a note, an entity and a timeline event. Back up. Settings
   should show a format version, size, record counts and a checksum.
2. Sign in to the same account on device B, then create a note that is not in
   the backup.
3. Restore. That note disappears and the backed-up data is in place.
4. Undo. The note comes back.
