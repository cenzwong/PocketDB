---
id: TASK-017
title: Add key expiration, scanning and memory limits
priority: high
created: 2026-11-24
depends_on: [TASK-016]
labels: [m1, epic-06, delivery]
---

# Goal

Add key expiration, scanning and memory limits.

# Context

- **Milestone** M1 · Local database runtime
- **Parent epic** EPIC-06. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 9.
- **Decisions** ADR-004
- **Estimated effort** 3 engineer-days.

# Scope

Complete EXPIRE, TTL, PERSIST, SCAN and DBSIZE and implement the key-value memory budget.

# Acceptance Criteria

- [x] Use clock-controlled tests for expiry, persistence of expiry state and scanning and counting behavior.
- [x] Verify bounded writes, coherent batch outcomes and documented limits.

# Implementation Notes

Added `EXPIRE`, `TTL`, `PERSIST`, bounded cursor `SCAN` with `MATCH`/`COUNT`, and live-key `DBSIZE`. Expiration is lazy. `SET`/`MSET` clear expiry, `INCR`/`DECR` preserve it, and `PERSIST` removes it. Engine capabilities now advertise command set version 2 and the default memory budget.

Added a default 64 MiB per-instance logical storage budget, reducible with `maxMemoryBytes`. Accounting uses UTF-8 key bytes, value bytes and 128 bytes per entry. `SET`, `MSET`, `INCR` and `DECR` reject over-budget writes with `key-value-memory-limit`; batch writes are validated and sized before mutation. Expired entries are reclaimed before capacity checks. Added 5 tests for clock-controlled expiry/TTL/PERSIST, scan and size behavior, budget boundaries, atomic failed batches and expired-byte reclamation.

Documented command semantics, memory accounting and limits in the engine README and hosted-runtime spec. This does not claim full Redis compatibility, exact JavaScript heap accounting, eviction, persistence, or a background expiry scheduler.

# Validation

Environment: macOS 27.0 arm64, Node v26.13.0, pnpm 11.25.0.

- `pnpm format` — passed.
- `pnpm check` — passed (Biome format and lint plus all workspace TypeScript checks).
- `pnpm --filter @pocketdb/engine-kv typecheck` — passed.
- `pnpm --filter @pocketdb/engine-kv test` — passed; 15 engine tests.
- `pnpm test` — passed; 70 tests across runtime, protocol, transport, key-value engine, PGlite and web.
- `pnpm build` — passed; Vite production build completed.
- `git diff --check` — passed; no trailing whitespace found in engine sources, tests, documentation or ticket notes.
