# Hosted Mode quick start

PocketDB is a static web app. A database runs in the host's browser worker and
uses that browser's memory or IndexedDB. Keep the host page open and the device
awake while clients are connected.

## Start the console

From a clean checkout, install the pinned dependencies and start Vite:

```sh
pnpm install --frozen-lockfile
pnpm --filter @pocketdb/web dev
```

Open the printed local URL. Choose **PostgreSQL** or **Key-value**, set an
instance name, choose memory or IndexedDB where available, and select **Start**.
Memory storage is temporary. IndexedDB is scoped to the browser origin and
instance name and can be cleared or evicted; export snapshots for recovery.

## SQL demo

With PostgreSQL running, enter and run:

```sql
CREATE TABLE notes (id integer PRIMARY KEY, body text NOT NULL);
INSERT INTO notes VALUES (1, 'hello from PocketDB');
SELECT id, body FROM notes;
```

Run with the **Run query** button or **⌘+Enter**/**Ctrl+Enter**. SQL executes in the local
PostgreSQL worker. The browser engine supports PGlite's PostgreSQL subset; it
does not provide a claim of complete PostgreSQL server compatibility.

## Key-value demo

Choose **Key-value**, start the instance, then use the command selector and JSON
argument array:

```json
SET ["greeting", "hello"]
GET ["greeting"]
```

The key browser shows the stored value. Run commands with **Execute command**
or **⌘+Enter**/**Ctrl+Enter**. The implemented command set is `PING`, `GET`,
`SET`, `DEL`, `EXISTS`, `MGET`, `MSET`, `INCR`, `DECR`, `EXPIRE`, `TTL`,
`PERSIST`, bounded `SCAN`, and `DBSIZE`. This is a Redis-inspired subset, not
Redis protocol or full Redis compatibility. Values may be strings or binary.

## Invite a client

Remote sharing requires a room-signaling service that implements the replaceable
PocketDB signaling contract. PocketDB does not run or select that service. The
host and client must enter the same HTTPS signaling endpoint. HTTP is accepted
only for loopback development. The web console's invitation does not embed the
signaling endpoint.

1. In host mode, enter the signaling endpoint and choose the invitation access
   scope. Prefer read-only unless the client needs writes.
2. Create the invitation and copy its link. Read-write invitations are bearer
   capabilities; share them only with the intended client.
3. Open the invitation link in another browser tab or device. The link fills
   the invitation field and selects client mode. Enter the same signaling
   endpoint and select **Connect**.
4. Use only the operations displayed by the host. PostgreSQL read-only access
   is restricted to a validated parameterized `SELECT` subset; the engine and
   host also enforce authorization.

The capability is carried in the URL fragment. Browsers do not send the
fragment to the static host, but it remains visible in page memory, history and
copied text. Do not put invitation links in logs, screenshots or public issue
reports. Each invitation admits one authenticated peer. After disconnect or
revocation, create a fresh invitation to reconnect.

The signaling adapter uses `POST` and `GET` at
`<endpoint>/signal/<roomId>/offer` and
`<endpoint>/signal/<roomId>/answer`; a pending description returns `404`. The
provider must implement these routes and its own access controls, retention and
redacted logs. See the [transport contract](../../packages/transport/README.md)
and [remote access contract](../specs/remote-access.md) before choosing a
provider.

## Limits

- Static hosting supplies the app and assets; it does not host the database.
- Connections depend on browser WebRTC, the signaling provider and ICE
  reachability. Direct, same-network behavior has been exercised. Public
  cross-network and relay-only reachability remain release checks.
- The WebRTC data-channel message cap is 16 KiB by default; large results may
  fail rather than being fragmented.
- Closing or sleeping the host can interrupt clients. Established sessions do
  not resume automatically; reconnect with a new invitation after the host is
  available.
- Browser persistence is origin-scoped and subject to quota, private browsing,
  user deletion and eviction.

See [deployment requirements](../deployment.md),
[browser support evidence](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/board/done/TASK-041-verify-browser-compatibility-limits-and-performance.md),
and [release evidence requirements](../../PROJECT.md#delivery-and-release-gates).
