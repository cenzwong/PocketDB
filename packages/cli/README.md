# PocketDB CLI

The private `@pocketdb/cli` workspace package provides `pocketdb connect`,
`query`, `ping`, `inspect`, and `export` commands over the authenticated Node
client. It requires Node.js `>=24 <27`, a browser-hosted PocketDB instance, a
valid invitation, and the host's signaling endpoint. The host must remain open.
The CLI is not published; ADR-016 keeps first package release behind a separate
approval gate.

Build the CLI from the repository root with `pnpm --filter @pocketdb/cli build`.
Run the built executable locally with `node packages/cli/bin/pocketdb.mjs`.

## Commands

Every command accepts an invitation URI as its first positional value, or a
safer non-argument source:

- `--uri-env NAME` reads the URI from an environment variable.
- `--uri-stdin` reads one URI from standard input and trims surrounding
  whitespace.

For unattended scripts, prefer stdin or an environment variable over a literal
URI in command arguments; invitation capabilities are credentials. The CLI
never prints the invitation or includes it in output errors. JSON output is
selected with `--json`; human output is the default. `--json` errors are written
as one JSON object to stderr.

```sh
export POCKETDB_SIGNALING_ENDPOINT='https://signal.example/api'
export POCKETDB_INVITATION='pocketdb://...'
node packages/cli/bin/pocketdb.mjs connect --uri-env POCKETDB_INVITATION --json
node packages/cli/bin/pocketdb.mjs ping --uri-env POCKETDB_INVITATION --json
node packages/cli/bin/pocketdb.mjs inspect --uri-env POCKETDB_INVITATION --json
node packages/cli/bin/pocketdb.mjs query --uri-env POCKETDB_INVITATION \
  --query 'SELECT value FROM items WHERE value = $1' \
  --params '["example"]' --timeout-ms 30000 --json
```

`connect` verifies peer authentication and returns engine, access and
capability metadata. KV `ping` uses the KV PING operation. SQL `ping` uses the
authorized schema operation because read-only PostgreSQL intentionally permits
only a bounded SELECT grammar and cannot run `SELECT 1`. `inspect` returns the
authorized SQL schema (or KV capabilities). `query` requires a SQL engine and
relies on the invitation's engine-side permissions.

SQL `export` requires a read-only invitation and one explicit `SELECT` query.
It adds a bounded `LIMIT` (default 1,000 rows) and emits JSON Lines inside a
JSON result object. `--max-rows` can be set from 1 to 100,000. Existing LIMITs
and multi-statement queries are rejected; binary values are tagged with their
base64 form. KV export is unsupported because the current client contract does
not expose a key enumeration operation.

`connect --port N` keeps the authenticated remote client open and starts a
PostgreSQL v3 subset for a standard PostgreSQL driver. The default listener is
`127.0.0.1`; use `--host HOST --allow-remote-bind` to listen beyond loopback.
The bridge has no local password authentication or TLS. A non-loopback listener
gives any reachable client the invitation's full authority. Use a fresh
read-write invitation only for the intended driver session and stop the bridge
when done. Each invitation owns one local driver connection; separate driver
sessions need separate invitations and bridge processes.

The verified PostgreSQL subset covers protocol v3 startup, text-format simple
and parameterized queries, result rows, and transactions. Rolling back to a
savepoint keeps the transaction open. The bridge rolls back any open
transaction when the driver disconnects. The engine serializes
active transactions: another invitation receives PostgreSQL `55006` until that
transaction commits or rolls back. Binary formats, COPY, notifications,
cancellation, portal row limits/cursors, local PostgreSQL authentication,
TLS, pooling, and exact server metadata are unsupported. SQL permissions remain
enforced by the invitation and host engine.

`connect --protocol resp --port N` starts the RESP2 subset for a standard Redis
driver. Set Node Redis to RESP2. The bridge supports `PING`, `GET`, `SET`, `DEL`,
`QUIT`, and Node Redis's `CLIENT SETINFO LIB-NAME` / `LIB-VER` startup commands.
Keys must be valid UTF-8 strings; values remain binary-safe. A bridge accepts one
local Redis socket. Separate sessions use separate invitations and processes,
and share the browser instance's key-value data. Browser-host loss closes local
Redis sockets and stops that bridge listener. The bridge has no AUTH or TLS;
non-loopback binding exposes the invitation authority to reachable clients.
RESP3, `HELLO`, Redis transactions, subscriptions, scripting, expiry options,
cluster behavior, and clients beyond Node Redis 6.4.0 and redis-py 8.2.0 in
RESP2 mode are unverified. See the [native driver matrix](../../docs/compatibility/native-drivers.md)
and [Python examples](../../examples/python/README.md).

```sh
node packages/cli/bin/pocketdb.mjs connect --uri-env POCKETDB_INVITATION \
  --protocol resp --port 6379 --json
npm add redis@6.4.0
node --input-type=module -e 'import { createClient } from "redis"; const c = createClient({ url: "redis://127.0.0.1:6379", RESP: 2 }); await c.connect(); console.log(await c.ping()); await c.close();'
```

```sh
node packages/cli/bin/pocketdb.mjs connect --uri-env POCKETDB_INVITATION \
  --port 5432 --json
psql 'postgresql://pocketdb@127.0.0.1:5432/demo'
```

`--timeout-ms` configures request timeout; `--connect-timeout-ms` configures
connection setup timeout. Both accept 1–600,000 milliseconds. Set
`POCKETDB_ICE_STUN_HOST` and optional `POCKETDB_ICE_STUN_PORT` when the network
requires a STUN server. `POCKETDB_SIGNALING_ENDPOINT` is required.

Exit status is 0 for success or Ctrl-C shutdown, 2 for usage/configuration or
port conflicts, 3 for permission errors, 4 for connection/timeout errors and
remote host disconnect, 5 for engine/query/unsupported operations, and 1 for
other failures. A timeout after dispatch can leave the operation outcome
unknown; the JSON error preserves the client code. Startup JSON contains the
protocol, local host and port, and engine; it never includes the invitation. A
remote disconnect closes the listener and returns code 4.

## Verification

`pnpm --filter @pocketdb/cli test` runs command parsing and mocked-client tests.
`pnpm --filter @pocketdb/cli test:browser` starts the browser app and a local
signaling service, then invokes the executable as a child process for KV and
PostgreSQL operations. It uses fresh single-peer invitations. The PostgreSQL
wire acceptance connects `node-postgres` to two bridge processes; see the
[TASK-046 report](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-046-postgres-bridge/README.md) and
[results](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-046-postgres-bridge/results.json). Earlier CLI
coverage is in [the TASK-045 result](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-045-cli/results.json).
RESP2 results are recorded in the [TASK-047 report](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-047-resp-bridge/README.md)
and [results](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-047-resp-bridge/results.json). Lifecycle
evidence for port conflicts, Ctrl-C, host loss and cleanup is in the
[TASK-048 report](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-048-cli-bridge-lifecycle/README.md) and
[results](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-048-cli-bridge-lifecycle/results.json).
