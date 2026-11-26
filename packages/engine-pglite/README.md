# PGlite engine adapter

`@pocketdb/engine-pglite` adapts PGlite 0.6.0 to PocketDB's engine contract. It provides one PostgreSQL-compatible database per engine instance, with logical sessions sharing that database.

## Operations

- `query`: SQL text, positional parameters, and object or array row mode. Dates and timestamps are returned as PostgreSQL text, preserving fractional precision.
- `schema`: column metadata from `information_schema` for a schema and optional table.
- `describe-query`: parameter and result-field metadata.

Transactions are scoped to the session that issues `BEGIN`. While that transaction is active, another session receives `postgres-session-busy`; retry its request after the owner commits or rolls back. This fail-fast response keeps the worker's serialized RPC channel available to the transaction owner. Closing the owner session or stopping the instance rolls back its active transaction. Other sessions can close while the transaction is active.

Instances default to `memory://`. Set `dataDir` to a stable `idb://<name>` value to persist the database in IndexedDB across worker or page reloads. The worker holds an exclusive Web Lock keyed by that data directory until the PGlite database closes. A second cooperative tab or worker receives `postgres-storage-already-owned`; after the owner closes, another worker can open the same data directory. Use a different directory per instance to isolate stored databases.

Persistent startup and writes report `postgres-storage-unavailable` when IndexedDB or Web Locks cannot be used, and `postgres-storage-quota-exceeded` when the browser quota is reached. The default remains explicit `memory://` mode and does not request browser persistence. Browser retention is still subject to user clearing, private-context disposal and browser eviction. Ownership is cooperative: a process that bypasses the adapter's Web Lock can still corrupt shared storage.

The browser acceptance harness exercises DDL, parameterized DML, schema and query metadata, cross-session isolation, commit, rollback, and structured SQLSTATE propagation through the worker RPC boundary. The persistence browser matrix verifies close/reopen recovery, instance separation, ephemeral termination, cross-tab ownership, and quota errors in Chromium. The unit suite also verifies that startup fails with `postgres-storage-unavailable` when IndexedDB or Web Locks are unavailable.

## Portable snapshots

Instances export a gzip-compressed PGlite data-directory archive inside the PocketDB snapshot envelope. Create a new instance with `{ snapshot }` to restore it. The version 1 archive records PGlite 0.6.0 and is rejected by other engine versions pending compatibility review. The archive is validated in a temporary in-memory database before the destination is opened. Restore requires a fresh data directory; occupied directories return `snapshot-target-not-empty` and remain unchanged. Import cannot replace an active PostgreSQL database in place. See [ADR-015](../../docs/decisions/ADR-015-snapshot-formats-and-restore.md) for format and limits.
