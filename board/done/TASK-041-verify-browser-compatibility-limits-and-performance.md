---
id: TASK-041
title: Verify browser compatibility, limits and performance
priority: high
created: 2026-11-24
depends_on: [TASK-032, TASK-037, TASK-038, TASK-039]
labels: [m3, epic-21, delivery]
---

# Goal

Verify browser compatibility, limits and performance.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-21. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 27, 28.
- **Decisions** ADR-014
- **Estimated effort** 4 engineer-days.

# Scope

Establish a reference environment and record latency, startup, worker responsiveness, memory, storage, bundle and concurrency evidence.

# Acceptance Criteria

- [x] Record results against provisional targets in handoff §28 for cold/warm, direct/relay and dataset tests, with failures and unknowns labeled.
- [x] Run failure cases for host lifecycle, duplicate traffic, quota, interrupted transactions and oversized responses. Publish a supported browser matrix.

# Implementation Notes

Added [browser performance and limits evidence](../../artifacts/task-041-performance/README.md), a repeatable startup-measurement probe, and raw Chrome/Edge startup JSON. Stable Chrome and Edge Linux-container suites passed for the web app, KV persistence and PostgreSQL persistence. The task-032 direct peer harness records 20 sequential remote KV reads; Chrome p95 was 13 ms. Relay, 50 MB dataset capacity, five-client concurrency, memory use and native Mac performance remain labeled unknown because those were not measured.

# Validation

Environment: macOS 27.0.1 arm64 host; OrbStack Linux x86_64 test container under emulation; Node v24.22.3; pnpm 11.25.0; Chrome 158.0.8127.88; Edge 158.0.4370.33.

- `pnpm --filter @pocketdb/web test:browser` — passed under stable Chrome and Edge.
- `pnpm --filter @pocketdb/engine-kv test:browser` — passed under stable Chrome and Edge, including IndexedDB quota rollback.
- `pnpm --filter @pocketdb/engine-pglite test:browser` — passed under stable Chrome and Edge, including persistent reload and quota rollback.
- `node artifacts/task-041-performance/measure-startup.mjs` — passed under both stable browsers. KV cold start was 366–372 ms; PostgreSQL cold start was 3,273–3,552 ms. Warm p95 was 153–157 ms (KV) and 2,298–2,304 ms (PostgreSQL). These measurements start after app assets load.
- Two-container TASK-032 direct KV run — 20 sequential GET samples; Chrome p50 4.3 ms and p95 13 ms over the local container bridge.
- `pnpm check` and `pnpm test` — passed on the Mac host after the browser signaling fix. Includes formatting, lint, typechecks, duplicate delivery, size limits, transaction cleanup and runtime failure tests.
- `pnpm build` — passed; `du -sh apps/web/dist` reported 17 MB. PGlite WASM/data were 9.0/6.0 MB; initial entry and shared chunks were 137/376 KB.
- `node --check artifacts/task-041-performance/measure-startup.mjs`, `node --check artifacts/task-032-two-container-peers/peer.mjs`, `bash -n artifacts/task-032-two-container-peers/run.sh`, and `git diff --check` — passed.

Limitations: no TURN/relay provider, separate-network test, 50 MB fixture, five-client stress run, memory profile, large-result throughput profile or native macOS stable-browser benchmark was available. These remain explicit unknowns, not passing claims. Release-level physical-device and sleep/wake tests remain TASK-043.
