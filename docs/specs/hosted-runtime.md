# Hosted runtime and web experience

Scope covers M1 through M3. Hosted Mode has one authoritative browser instance. Remote operations use that engine's transaction semantics and availability follows the host browser and device. Source requirements are in [handoff sections 5–7, 9, 14–15, 20–21 and 27–32](../handoff.md).

## User workflows

| Workflow | Required behavior |
| --- | --- |
| Start | A host opens the static site, chooses an engine, names the instance, selects storage and access settings, and starts with minimal configuration. The host requires only a supported browser. |
| Operate locally | Engine-specific controls expose supported operations and display structured results and errors. Start, stop and runtime status are observable. |
| Share and join | The host copies an invitation or URI. A client opens the link or uses the SDK, authenticates, runs operations and receives correlated results. |
| Administer | The host can inspect connected clients, roles, database activity, storage estimates and engine status. The host can revoke invitations, disconnect clients, restart or terminate the instance. |
| Manage data | Users can export, import, restore, reset and delete through the host console. Show the effect of destructive operations and surface errors from unsupported or invalid imports. |

The web app clearly distinguishes hosting from joining. It is desktop-first, responsive, accessible and keyboard-operable. Controls follow negotiated engine capabilities. Warn about tab closure, sleep, storage eviction and external networking services. Offer export as a portable recovery path.

## Initial engines

| Engine | Required behavior |
| --- | --- |
| Redis-like key-value | `PING`, `GET`, `SET`, `DEL`, `EXISTS`, `MGET`, `MSET`, `INCR`, `DECR`, `EXPIRE`, `TTL`, `PERSIST`, bounded `SCAN` and `DBSIZE` are implemented by the [key-value adapter](../../packages/engine-kv/README.md), with a 64 MiB logical per-instance storage budget. Memory is the default; explicit IndexedDB storage supports reload recovery with cooperative per-instance Web Lock ownership. Binary-safe values are supported; this is not full Redis compatibility. |
| PostgreSQL | SQL, DDL/DML, bound parameters, schema inspection, transactions, isolated sessions, structured errors, browser persistence and import/export. The PGlite feasibility gate determines the supported feature and extension boundary. |

The M1 PGlite adapter uses one database per engine instance and maps logical sessions onto that shared connection. It supports `query`, `schema`, and `describe-query`; a transaction is owned by the session that issues `BEGIN` until `COMMIT`, `END`, `ROLLBACK`, session close, or instance stop. Requests from other sessions during that interval fail with `postgres-session-busy` and may be retried after the transaction completes. This fail-fast behavior preserves isolation without deadlocking the serialized worker RPC channel. SQL cancellation is checked before execution and while queued behind another engine operation; it does not interrupt an active WASM query. `memory://` is ephemeral and remains the default. An explicit `idb://<name>` data directory persists across worker or page reloads when IndexedDB and Web Locks are available. The worker holds an exclusive cooperative lock for the database lifetime, reports `postgres-storage-already-owned` to another adapter owner, and surfaces unavailable-storage and quota errors. Browser persistence passed the production adapter matrix in Chrome Canary 160.0.8181.0 and Edge 116.0.1938.62; Edge 116 is legacy feasibility evidence, not a supported-version claim. Browser eviction, user deletion, private-context disposal and adapters that bypass the lock remain outside the durability guarantee.

The local console in `apps/web` selects between the PGlite and key-value adapters and creates a dedicated engine worker only when starting a database. PostgreSQL’s worker/WASM assets are lazy loaded; its SQL editor renders rows and structured errors. The key-value command selector and key browser are built from engine capabilities, use the capability-listed operations, and display structured replies. Both consoles support **⌘+Enter** and **Ctrl+Enter**. The key-value engine uses a 64 MiB logical budget, defaults to ephemeral memory, and offers optional IndexedDB persistence with expiry-preserving reload recovery. The local console does not yet provide remote invitations or multi-instance administration. See the [M1 browser evidence](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-022-local-runtime/README.md) for the exact tested versions and remaining stable-browser gap.

Both adapters pass a shared lifecycle and capability test suite plus engine-specific tests. Engine and WASM assets are loaded on demand. Worker execution keeps the main thread responsive, provides controlled shutdown and settles pending requests on worker failure. Persistent instances must reject unsafe concurrent access from another tab.

## Session permission matrix

Session access is carried into the runtime dispatcher and engine adapter. Every caller must pass an access level: local host code explicitly requests `owner`, and remote invitation sessions pass their authenticated `read-only` or `read-write` scope. Missing or invalid scope is rejected. Read-only requests are rejected before dispatch unless the adapter explicitly advertises the operation as safe, and the adapter checks the same scope at its execution boundary. Missing read-only capabilities fail closed.

| Engine operation | Owner | Read-write | Read-only |
| --- | --- | --- | --- |
| Key-value commands | All advertised commands | All advertised commands | `PING`, `GET`, `EXISTS`, `MGET`, `TTL`, `SCAN`, `DBSIZE` |
| PostgreSQL `query` | All supported SQL | All supported SQL | One parameterized `SELECT` in the documented safe subset, executed inside a PostgreSQL read-only transaction |
| PostgreSQL `schema` and `describe-query` | Allowed | Allowed | Allowed |
| Instance lifecycle and administration | Host/runtime control only | Denied | Denied |

The PostgreSQL read-only query subset allows simple identifier projections (or `*`) from one table, optional equality predicates joined by `AND` with `$n` bound parameters, optional identifier ordering and a numeric or bound-parameter limit. It rejects arbitrary SQL, writes, CTEs, joins, functions, comments, multiple statements and transaction control. The engine transaction's read-only mode is a second enforcement layer. Permission checks must not be replaced with SQL keyword filtering. `owner` is a trusted local host scope; invitations expose only `read-only` and `read-write`.

## Storage and portability

- **Ephemeral** data lives in the active runtime session.
- **Browser persistent** data survives a normal reload in supported configurations. Surface quota, private browsing, origin and eviction limitations.
- **Exportable** snapshots carry format version and engine information. The runtime exports through the optional `exportSnapshot()` capability; imports pass `snapshot: Uint8Array` when creating an instance. The [accepted ADR-015](../decisions/ADR-015-snapshot-formats-and-restore.md) records the binary envelope, payload versions, validation limits and replacement behavior. Key-value imports replace the destination atomically in IndexedDB. PostgreSQL imports prevalidate the archive and require a fresh data directory; a failed import does not modify another existing database. The [distributed spec](later-releases.md) covers replica state and merge semantics.

The host console downloads snapshots as unencrypted `.pdb` files and restores them into a fresh instance. It switches to the restored instance only after startup succeeds, then removes the previous IndexedDB database; a failed restore leaves the active instance running. Reset creates a fresh empty instance and deletes the previous stored copy after the switch. Delete asks for confirmation, stops the worker and removes the active IndexedDB database. Memory-mode data is discarded on stop or reload. IndexedDB normally survives reload in the same browser, but browser clearing, eviction and private browsing can remove it; the console surfaces these limits and recommends exporting a snapshot.

## Operational evidence

The host's **Local diagnostics** panel reports runtime uptime, connected peers, remote request outcomes, request and engine execution timing, operation byte counts, current active requests, browser storage estimates and WebRTC state. Where browser stats are available it also reports candidate types, the selected direct or relay path, round-trip time, data-channel byte counts and buffered bytes. Missing browser transport statistics are reported as unavailable. Signalling failures show a recovery action without storing endpoint text.

The in-memory event journal is capped at 100 entries. Diagnostic export uses an allow-list of counts, timings, transport states, safe error codes and event labels. It excludes invitation links and capabilities, signaling URLs and query strings, peer and session identifiers, SQL text, key/value arguments and arbitrary error messages. Export is generated locally and no remote telemetry is sent. Browser storage usage and quota are origin-wide estimates, not measurements of only the active database. Active request count and the data-channel buffered amount are exposed; an engine worker's internal queue depth is not currently available.

GitHub Pages is the deployment target. Verify HTTPS, project base paths, client routes and invitation links, worker and WASM asset loading, cache versioning and reproducible CI builds. Investigate header, threading and storage restrictions during feasibility and test the real deployment at release.

| Gate | Acceptance evidence |
| --- | --- |
| M1 | Start both engines, execute operations in a worker, stop cleanly and recover persistent instances after reload across the supported reference browser matrix. |
| M2 | Two physical devices complete an authenticated remote key-value write/read. Also demonstrate a remote parameterized PostgreSQL query and authorization rejection. |
| M3 | Two laptops complete host creation, invitation, remote reads/writes, SDK operations, activity inspection, persistent reload and export on the deployed site, with failure and security evidence. |

Reference benchmarks are provisional until the method and browsers are agreed. Measure key-value startup under 2 s and PostgreSQL startup under 5 s once assets load, direct connect under 10 s in favorable conditions, small key-value operations under 100 ms p95 on the same LAN, at least five clients and at least 50 MB persisted. Measure responsiveness, cold and warm startup, direct and relayed paths, execution versus transport time, memory, bundle size and storage. See the [release gates](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/project/RELEASE_PLAN.md).
