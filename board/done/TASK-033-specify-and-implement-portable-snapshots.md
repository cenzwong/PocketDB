---
id: TASK-033
title: Specify and implement portable snapshots
priority: high
created: 2026-11-24
depends_on: [TASK-019, TASK-020]
labels: [m3, epic-08, delivery]
---

# Goal

Specify and implement portable snapshots.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-08. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 14, 26.
- **Decisions** ADR-009, ADR-015
- **Estimated effort** 4 engineer-days.

# Scope

Resolve ADR-015 and implement versioned key-value and PostgreSQL export and validated restore.

# Acceptance Criteria

- [x] Round-trip both engines into a fresh instance, preserve key expiry and verify malformed or incompatible input leaves existing data intact.
- [x] Document snapshot contents, format compatibility and replace semantics; test interrupted import or rollback behavior.

# Implementation Notes

Resolved ADR-015 and implemented the version 1 PocketDB snapshot envelope plus optional runtime export through direct engines and worker RPC. Key-value snapshots preserve binary values, exact JavaScript keys and absolute expiry; importing into IndexedDB replaces the entire key set in one rollback-safe transaction. PostgreSQL snapshots contain PGlite 0.6.0 gzip data-directory archives, validated in a temporary database before import. PostgreSQL restore requires a new, empty data directory; an occupied destination is rejected before mutation. See the [ADR](../../docs/decisions/ADR-015-snapshot-formats-and-restore.md), [runtime documentation](../../packages/runtime/README.md), and [validation artifacts](../../artifacts/task-033-snapshots/README.md).

# Validation

Passed `pnpm check`, `pnpm test` (110 tests across the workspace), and `pnpm build`. The build completed with PGlite `node:module` externalization and direct-eval warnings. `pnpm --filter @pocketdb/engine-kv test:browser` passed in Chrome 160.0.8181.0: fresh IndexedDB restore returned `fresh-idb`; malformed and foreign-engine imports returned `snapshot-invalid` and `snapshot-incompatible`; an over-quota import returned `key-value-storage-quota-exceeded`, and the pre-import value remained readable. `pnpm --filter @pocketdb/engine-pglite test:browser` passed in Chrome 160.0.8181.0: a worker round-trip restored `worker-round-trip`; malformed and foreign-engine imports were rejected; importing to an occupied data directory returned `snapshot-target-not-empty`, and the original row remained readable. `pnpm exec biome format --write` formatted the changed TypeScript and browser harness files. Browser harnesses bind a local Vite server and were run with local-network access.

PostgreSQL live replacement of an occupied data directory is intentionally unsupported; restore into a fresh directory and switch to the validated instance. The 256 MiB envelope bound and PGlite 0.6.0 compatibility boundary are documented in ADR-015. Physical-device tests are not part of this ticket.
