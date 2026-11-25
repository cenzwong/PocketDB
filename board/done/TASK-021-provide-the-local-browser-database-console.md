---
id: TASK-021
title: Provide the local browser database console
priority: high
created: 2026-11-24
depends_on: [TASK-015, TASK-016, TASK-018]
labels: [m1, epic-10, delivery]
---

# Goal

Provide the local browser database console.

# Context

- **Milestone** M1 · Local database runtime
- **Parent epic** EPIC-10. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 5, 20, 31.
- **Decisions** ADR-004, ADR-010, ADR-014
- **Estimated effort** 4 engineer-days.

# Scope

Add engine selection, instance configuration and start and stop flows with SQL and key-value consoles and structured results.

# Acceptance Criteria

- [x] Keyboard-operable flows start and query each engine inside its worker and show actionable execution errors.
- [x] Engine features follow capabilities and WASM is loaded on demand.

# Implementation Notes

Implemented the local PostgreSQL and key-value console in `apps/web`. Each engine runs in its own worker through `DatabaseRuntime` and `WorkerEngineAdapter`; the UI starts/stops instances, executes SQL or key-value commands, and renders structured results and actionable errors. Engine-specific controls are derived from adapter capabilities. The PGlite worker and WASM/data assets load only when PostgreSQL is started. Added keyboard shortcuts for execution, a persistent PostgreSQL configuration flow, and a key browser using the supported scan/read/TTL operations.

Changed the web app entry point, styles, worker entry points, browser tests, and package dependencies/scripts. Updated the root browser-test script, lockfile, development/runtime docs, and README.

Limitations: the console is local and single-origin; it does not add remote access. Key-value IndexedDB persistence was added in TASK-019. Build output includes upstream PGlite `eval` and `node:module` externalization warnings. Browser automation emitted macOS headless display-link warnings, but the suites completed successfully.

# Validation

Environment: macOS 27.0.1 arm64, Node v26.13.0, pnpm 11.25.0, Chrome/HeadlessChrome 160.0.8181.0. Commands were run with `/tmp/pocketdb-task013-toolchain/node-v26.13.0-darwin-arm64/bin` prepended to `PATH`.

- `pnpm check` — passed.
- `pnpm test` — passed, 71 tests across runtime, protocol, transport, key-value, PGlite, and web packages.
- `pnpm build` — passed; PGlite worker plus separate WASM and data assets emitted. The upstream warnings above remain.
- `pnpm test:browser` — passed across the browser suites, including the web console integration. Coverage included SQL success/syntax error, PostgreSQL IndexedDB stop/reopen/read, key-value SET/GET and key listing, malformed command feedback, keyboard execution, storage ownership, memory termination, and quota reporting.
- Manual in-app browser check — both engine consoles started; `SELECT 1 AS ready` rendered a result row, and a key-value SET rendered in the key browser. Keyboard execution and stopped state were confirmed.
- `git diff --check` — passed. Whitespace scan over changed and added implementation/docs files found no trailing whitespace.

Acceptance criteria are met for the local browser console. No physical-device acceptance is part of this task.
