---
id: TASK-015
title: Run engine sessions in a database worker
priority: high
created: 2026-11-24
depends_on: [TASK-014]
labels: [m1, epic-02, delivery]
---

# Goal

Run engine sessions in a database worker.

# Context

- **Milestone** M1 · Local database runtime
- **Parent epic** EPIC-02. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 9, 15.
- **Decisions** ADR-004, ADR-010
- **Estimated effort** 4 engineer-days.

# Scope

Implement worker messaging, queueing, cancellation where supported, shutdown and structured termination errors.

# Acceptance Criteria

- [x] Browser tests show successful dispatch, bounded queue behavior and pending request settlement on worker termination.
- [x] Concurrent requests retain their session identity and the UI remains responsive during reference workload execution.

# Implementation Notes

Implemented `WorkerEngineAdapter` and `installEngineWorker` in `packages/runtime`, including serialized RPC, a bounded outstanding-request queue, request timeouts, abort forwarding, structured worker errors and deterministic termination of failed workers. `EngineOperationError` preserves engine-defined error codes through runtime dispatch and worker RPC. The browser contract harness exercises two sessions and shared instance data, concurrent session identity, queue rejection, cancellation and recovery, page responsiveness, structured engine errors, and pending request settlement after termination. Updated runtime, architecture and development docs. Cancellation of engine work requires the engine adapter to honor the supplied `AbortSignal`.

# Validation

Environment: macOS arm64, Node.js 26.13.0, pnpm 11.25.0, Chrome 160.0.8181.0.

- `CI=true pnpm install --frozen-lockfile` — passed.
- `pnpm format` — passed; no changes after the final formatting pass.
- `pnpm check` — passed (Biome format, lint and both workspace TypeScript checks).
- `pnpm test` — passed (2 files, 10 tests across the TASK-015 validation run; the runtime suite now also covers structured engine error propagation).
- `pnpm test:browser` — passed in Chrome 160.0.8181.0; all six worker checks passed, including structured engine error preservation, bounded queue behavior, concurrent session identity, cancellation recovery, main-thread responsiveness and worker termination settlement.
- `pnpm build` — passed; Vite emitted the web entry point and relative asset bundle.
- `git diff --check`, board dependency validation (66 tasks), and Markdown local-link validation — passed.

Browser cancellation is cooperative: engine adapters must observe the signal. This harness validates a signal-aware fixture; production engine cancellation remains subject to its engine API.
