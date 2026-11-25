---
id: TASK-018
title: Integrate the PGlite SQL adapter
priority: high
created: 2026-11-24
depends_on: [TASK-014]
labels: [m1, epic-07, delivery]
---

# Goal

Integrate the PGlite SQL adapter.

# Context

- **Milestone** M1 · Local database runtime
- **Parent epic** EPIC-07. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 9, 15.
- **Decisions** ADR-004, ADR-010
- **Estimated effort** 5 engineer-days.

# Scope

Map PGlite sessions, parameters, schema inspection, transactions and structured errors into the engine contract.

# Acceptance Criteria

- [x] Run DDL, DML and parameterized queries in a browser and validate results and errors.
- [x] Verify session isolation, commit and rollback against reference engine versions using the feasibility decision.

# Implementation Notes

Added `packages/engine-pglite`, pinned to the PGlite 0.6.0 feasibility version, and integrated it with the engine contract and web workspace. The adapter supports query, schema inspection, query description, bound parameters, structured SQLSTATE errors, and per-instance serialized execution. Logical sessions share an instance; one session owns an explicit transaction until commit, rollback, owner close, or instance stop. Other sessions receive retryable `postgres-session-busy` while that transaction is active. This avoids deadlocking the serialized worker RPC channel while preserving transaction isolation. Browser coverage runs through the actual engine worker and covers DDL/DML, bound parameters, schema and query metadata, isolation, commit, rollback, and SQLSTATE errors.

Updated `docs/specs/hosted-runtime.md` and added `packages/engine-pglite/README.md` with supported operations and transaction behavior. The default `memory://` mode and persistent data directory configuration are present, but browser persistence, multi-tab ownership, recovery, export/import, and interruption during an active query are outside this task's validated scope.

# Validation

On macOS arm64 with Node 26.13.0, pnpm 11.25.0, and PGlite 0.6.0:

- `pnpm format` — passed.
- `pnpm check` — passed formatting, lint, and typechecks for all workspace packages.
- `pnpm test` — passed, 46 unit tests across runtime (9), protocol (18), engine-kv (10), engine-pglite (8), and web (1).
- `pnpm build` — passed Vite production build.
- `pnpm test:browser` — passed runtime worker checks and PGlite SQL checks in Chrome 160.0.8181.0 on macOS. Browser checks covered DDL/DML and bound parameters, schema and query metadata, transaction isolation/commit/rollback, structured SQLSTATE propagation, main-thread responsiveness, cancellation, queue recovery, and worker termination.

Browser persistence/reload, physical-device execution, database export/import, and interruption of a currently executing WASM query remain unverified and are not acceptance criteria for this task.
