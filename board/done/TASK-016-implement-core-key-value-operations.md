---
id: TASK-016
title: Implement core key-value operations
priority: high
created: 2026-11-24
depends_on: [TASK-014]
labels: [m1, epic-06, delivery]
---

# Goal

Implement core key-value operations.

# Context

- **Milestone** M1 · Local database runtime
- **Parent epic** EPIC-06. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 9.
- **Decisions** ADR-004
- **Estimated effort** 3 engineer-days.

# Scope

Implement the Redis-like in-memory adapter and core command validation for PING, GET, SET, DEL, EXISTS, MGET, MSET, INCR and DECR.

# Acceptance Criteria

- [x] Contract and command tests cover missing keys, invalid arguments, integer behavior and batch semantics.
- [x] Use binary-safe values where supported and document the value and error model.

# Implementation Notes

Added `@pocketdb/engine-kv`, an ephemeral `EngineAdapter` for PING, GET, SET, DEL, EXISTS, MGET, MSET, INCR and DECR. Keys use strings; values are stored as owned bytes and returned through defensive copies. Session data is shared within an instance and isolated between instances. Batch writes validate fully before mutation; counters use signed 64-bit `bigint` arithmetic. `KeyValueCommandError` codes survive runtime and worker dispatch through the generic `EngineOperationError` contract. Added reusable engine-contract and command tests, and documented operation payloads, batch semantics, binary value handling, stable errors and limitations in the package README and hosted runtime spec.

# Validation

Environment: macOS arm64, Node.js 26.13.0, pnpm 11.25.0, Chrome 160.0.8181.0.

- `CI=true pnpm install --frozen-lockfile` — passed for all five workspace projects.
- `pnpm check` — passed (Biome format/lint and runtime, protocol, key-value and web TypeScript checks).
- `pnpm test` — passed (4 files, 38 tests; 10 key-value contract and command tests cover missing keys, invalid arguments, signed 64-bit integer boundaries, binary copy safety, command arity, atomic batch validation and instance/session behavior).
- `pnpm test:browser` — passed in Chrome; all six worker checks passed, including structured engine error propagation.
- `pnpm build` — passed; Vite production build succeeded.
- `git diff --check`, board dependency validation (66 tasks), Markdown local-link scan and source/docs whitespace scan — passed.

The adapter intentionally excludes expiration, scanning, persistence, memory limits and binary keys; those are separate tickets or non-goals. It does not claim Redis compatibility.
