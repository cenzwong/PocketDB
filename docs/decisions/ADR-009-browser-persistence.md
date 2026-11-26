# ADR-009: Browser persistence

- Status: accepted for P0 candidate implementation
- Date: 2026-11-24
- Reversibility: medium; storage migrations require export and recovery behavior.

## Context

TASK-005 restored PGlite 0.6.0 data through IndexedDB after reload, exported and restored a database snapshot, and persisted a separate key-value record. A worker Web Lock refused a second cooperative owner. Private-context data disappeared after context disposal; storage grants and eviction were not established. TASK-002 separately exercised OPFS sync access handles.

## Decision

Use IndexedDB as the first persistent storage candidate for P0 key-value and PGlite instances, with per-instance cooperative Web Lock ownership. Keep explicit in-memory ephemeral mode. Surface quota, private-context and origin limitations. Preserve versioned export/import as the recovery path. Evaluate OPFS per engine only when profiling or upstream support requires it.

## Alternatives considered

- OPFS worked in the raw TASK-002 worker probe but was not measured with PGlite in this plan.
- Memory-only storage avoids browser persistence behavior but cannot meet reload recovery.
- Multi-tab concurrent writers are unsafe without additional ownership and transaction evidence.

## Consequences

TASK-019 remains responsible for testing the key-value production adapter. TASK-020 completed the PGlite production-adapter checks for close/reopen recovery, ephemeral termination, instance isolation, cross-tab ownership, quota errors and unavailable-storage behavior in Chrome Canary 160.0.8181.0 and Edge 116.0.1938.62. Edge 116 is legacy feasibility evidence, not a supported-version claim. Do not promise permanent retention; browser eviction and user deletion remain possible. Private mode must fail or fall back explicitly.

## Evidence

- [TASK-005 storage results](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-005-persistence/README.md)
- [TASK-002 OPFS worker probe](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-002-static-worker/README.md)
- [TASK-020 production adapter evidence](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/board/done/TASK-020-persist-browser-local-postgresql-instances.md)
- [PGlite persistence matrix](../../packages/engine-pglite/README.md)
