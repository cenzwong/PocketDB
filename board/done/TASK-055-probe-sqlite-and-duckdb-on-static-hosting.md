---
id: TASK-055
title: Probe SQLite and DuckDB on static hosting
priority: medium
created: 2026-11-24
depends_on: [TASK-002]
labels: [m6, epic-18, spike]
---

# Goal

Probe SQLite and DuckDB on static hosting.

# Context

- **Milestone** M6 · Engine expansion
- **Parent epic** EPIC-18. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 25, 29.
- **Decisions** ADR-001, ADR-014
- **Estimated effort** 4 engineer-days.

# Scope

Run SP-10 for both WASM engines under the intended static host restrictions. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Record worker, WASM, OPFS and header behavior with a representative query and file round-trip for each candidate.
- [x] Recommend compatible builds, browser limitations or a scope/hosting decision with measured impact.

# Implementation Notes

Added the reproducible [SQLite and DuckDB probe](../../artifacts/task-055-static-sqlite-duckdb/README.md), pinned source dependencies, Vite build, local HTTPS verification runner, and raw [browser and asset results](../../artifacts/task-055-static-sqlite-duckdb/results.json). The experiment tested SQLite WASM 3.54.1-build1 and DuckDB-Wasm 1.32.0 (DuckDB core v1.4.3) in Chrome Canary 160.0.8181.0 on macOS arm64. Both worker/WASM SQL probes and file round-trips passed at a headerless Pages-style project path and an isolated COOP/COEP control.

The measured `opfs-sahpool` SQLite path and DuckDB single-threaded MVP path both worked without isolation headers. SQLite completed explicit export/import of a 16 KiB DB file. DuckDB checkpointed an OPFS database, closed it, then reopened and queried it from a fresh worker. The built SQLite WASM was 879,084 bytes (407,455 gzip); DuckDB MVP WASM was 39,362,651 bytes (8,779,312 gzip). Recommend SQLite for a general-purpose embedded SQL file engine; lazy-load DuckDB as an optional analytical engine because its tested WASM bundle is much larger. Updated ADR-001 and ADR-014 with evidence links and limitations. No hosting-target or estimate change is recommended.

# Validation

Environment: macOS 27.0.1 arm64, Node 26.13.0, npm 11.14.1, Chrome Canary 160.0.8181.0. The preview used a locally generated HTTPS certificate and the `/PocketDB/` project prefix.

- `npm ci --offline --ignore-scripts --no-audit --no-fund` — passed from the pinned package lock.
- `npm run verify -- /private/tmp/pocketdb-task055/cert.pem /private/tmp/pocketdb-task055/key.pem` — passed. The runner built production assets, served a baseline without COOP/COEP and an isolated control with COOP `same-origin` and COEP `require-corp`, and exercised both candidate engines in each profile. Worker JavaScript and WASM loaded from the project path; WASM returned `application/wasm`. Both SQL queries and database file round-trips passed in both profiles.
- `node --check verify.mjs` — passed.

This proves the tested packages in one headless Chromium version on one Mac against a local static HTTPS preview. A live GitHub Pages CDN, current stable browser matrix, Gecko/WebKit/mobile, quotas/eviction, multi-tab contention and DuckDB threading remain unverified and are retained for TASK-040/TASK-041. SQLite SAH-pool storage is single-owner; the probe does not establish multi-tab safety.
