# Runtime contracts

`@pocketdb/runtime` defines engine capabilities, per-instance lifecycle, sessions, execution requests, health and structured runtime errors. It has no UI or transport dependency.

`DatabaseRuntime` registers an adapter by stable engine ID, creates independently identified instances, binds each session to one instance, routes requests through that session and closes sessions before stopping an instance. A stopped or failed instance is removed from runtime routing. Adapters keep engine-specific request typing and validation at their boundary; the common request envelope does not claim equivalent engine semantics.

`EngineOperationError` carries engine-defined stable codes through runtime dispatch and worker RPC. `EngineRuntimeError` remains the runtime's lifecycle and worker failure vocabulary.

`WorkerEngineAdapter` runs an engine instance behind a dedicated worker. It serializes calls through a bounded queue (32 pending calls by default), preserves the instance and session IDs in each message, forwards `AbortSignal` cancellation, applies a 30-second request timeout, and rejects pending calls with structured errors when the worker fails or stops. If its own watchdog expires, it terminates the worker and settles every pending call; callers must treat an already-dispatched mutation as having an unknown outcome. `installEngineWorker` is the worker-side dispatcher and closes open sessions during orderly shutdown. A browser contract harness checks routing, queue bounds, cancellation, termination settlement and page responsiveness with a reference workload. Engine-specific cancellation still depends on the adapter honoring the supplied signal; PGlite cannot currently cancel a query already executing.

Session access is retained by the dispatcher and adapter. Read-only requests require an explicit safe-operation capability and are checked before engine execution; adapters enforce the same boundary. PostgreSQL read-only SQL is limited to a parameterized SELECT subset inside a read-only transaction. Missing permission support fails closed.

Engines may advertise `portableSnapshots` and implement `exportSnapshot()`; the runtime returns snapshot bytes through `DatabaseRuntime.exportSnapshot(instanceId)`, including through worker RPC. Import bytes are passed as `snapshot: Uint8Array` in the engine configuration when starting a new instance. Engine-specific payload formats, size limits and restore semantics are defined by [ADR-015](../../docs/decisions/ADR-015-snapshot-formats-and-restore.md). This API does not route remote snapshot export or import; remote protocol routing belongs to its separate implementation ticket.

## Adapter verification

`testing/engine-contract.ts` exports a reusable Vitest contract suite. Each adapter can supply an instance/config/request fixture and run the common capability, startup, health, session, execution and stop expectations. Runtime tests also verify isolation, request routing, cleanup and lifecycle errors.

Run the package checks from the repository root with `pnpm --filter @pocketdb/runtime typecheck`, `pnpm --filter @pocketdb/runtime test` and `pnpm test:browser`.
