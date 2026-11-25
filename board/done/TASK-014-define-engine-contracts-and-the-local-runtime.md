---
id: TASK-014
title: Define engine contracts and the local runtime
priority: high
created: 2026-11-24
depends_on: [TASK-013]
labels: [m1, epic-02, delivery]
---

# Goal

Define engine contracts and the local runtime.

# Context

- **Milestone** M1 · Local database runtime
- **Parent epic** EPIC-02. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 8, 9, 24.
- **Decisions** ADR-002, ADR-003, ADR-004
- **Estimated effort** 3 engineer-days.

# Scope

Implement typed engine capability, lifecycle, session, execution and error contracts with runtime registration and routing.

# Acceptance Criteria

- [x] A reusable contract suite exercises start, session open/close, execute, health and stop against a test adapter.
- [x] Verify instance isolation and lifecycle failures. Engine packages have no UI or transport dependency.

# Implementation Notes

Added `packages/runtime` with the transport- and UI-independent engine contract, capability descriptions, structured runtime errors, adapter registry and instance/session router. Runtime sessions are bound to one instance. Startup failure rolls back registration; stop closes sessions and removes routing even when cleanup reports an error. A reusable adapter suite and in-memory adapter cover lifecycle and execution, with separate runtime tests for isolation, routing and failures.

Documented the runtime boundary in [packages/runtime/README.md](../../packages/runtime/README.md), the [target architecture](../../docs/architecture/README.md) and [ADR-004](../../docs/decisions/ADR-004-engine-adapter-contract.md). Worker execution, persistence, authorization, snapshots and remote protocol routing remain with their owning tickets.

# Validation

macOS arm64, Node.js 26.13.0 and pnpm 11.25.0:

- `pnpm format` — passed; formatted the app and runtime package.
- `pnpm check` — passed format, lint and TypeScript checks for both workspace packages.
- `pnpm test` — passed 2 test files and 9 tests, including 8 runtime contract/isolation/lifecycle checks.
- `pnpm build` — passed the Vite production build.
- `git diff --check` and relative Markdown link scan — passed.

The tests use an in-memory adapter and prove the runtime contract and routing behavior. They do not establish PGlite or browser worker behavior, which remain in later tickets.
