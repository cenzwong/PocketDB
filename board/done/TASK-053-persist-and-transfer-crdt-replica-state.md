---
id: TASK-053
title: Persist and transfer CRDT replica state
priority: medium
created: 2026-11-24
depends_on: [TASK-051]
labels: [m5, epic-17, delivery]
---

# Goal

Persist and transfer CRDT replica state.

# Context

- **Milestone** M5 · Distributed database mode
- **Parent epic** EPIC-17. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 14.
- **Decisions** ADR-009, ADR-013, ADR-015
- **Estimated effort** 4 engineer-days.

# Scope

Implement local replica persistence, binary export/import and separate merge and isolated restore flows.

# Acceptance Criteria

- [x] Test offline reload, restart, interrupted restore and merge semantics with observable state agreement.
- [x] Document state size, quota and retention limitations and validate import boundaries.

# Implementation Notes

Added `IndexedDBReplicaPersistence` in `packages/engine-yjs/src/persistence.ts`. It restores one full Yjs state per replica ID, uses an exclusive Web Lock to prevent competing same-origin writers, persists updates transactionally, exposes `flush()`/`close()` durability boundaries, and reports storage quota/unavailable failures. Portable snapshots use the shared versioned PocketDB envelope with payload `yjs-state-v1` and Yjs 13.6.33 compatibility. `restoreReplicaSnapshot()` creates an isolated replica; `mergeReplicaSnapshot()` validates and merges into existing state using Yjs semantics without mutating the destination if validation or the size bound fails. Full replica state is capped at 256 MiB. Updated package scripts, ADR-013/ADR-015, and the engine README with quota, retention, eviction, private-context and unencrypted-storage limits.

# Validation

- `pnpm --filter @pocketdb/engine-yjs typecheck` — passed.
- `pnpm --filter @pocketdb/engine-yjs test` — passed, 11 unit tests for local structures and authenticated synchronization.
- `pnpm --filter @pocketdb/engine-yjs test:browser` — passed in Chrome 160.0.8181.0; verified IndexedDB recovery after page reload and close/reopen, same-replica lock rejection/release, isolated restore, merge preserving local and imported values, malformed/incompatible import rejection without destination mutation, and matching state after reopening in another tab.
- `pnpm check` — passed formatting, lint and all workspace typechecks.
- `pnpm test` — passed all workspace unit suites.
- `git diff --check` — passed.
- Browser quota exhaustion was not forced in this run; the 256 MiB implementation ceiling and browser-controlled quota/retention limitations are documented. No cross-device or physical-device result is claimed.
