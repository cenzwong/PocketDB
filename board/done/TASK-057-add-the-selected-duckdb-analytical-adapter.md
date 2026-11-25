---
id: TASK-057
title: Add the selected DuckDB analytical adapter
priority: low
created: 2026-11-24
depends_on: [TASK-022, TASK-055]
labels: [m6, epic-18, delivery]
---

# Goal

Add the selected DuckDB analytical adapter.

# Context

- **Milestone** M6 · Engine expansion
- **Parent epic** EPIC-18. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 31.
- **Decisions** ADR-004, ADR-009, ADR-010, ADR-014
- **Estimated effort** 5 engineer-days.

# Scope

After use-case prioritization and static evidence review, integrate a DuckDB WASM worker with supported dataset ingestion and analytical result formats.

# Acceptance Criteria

- [x] Exercise CSV, JSON and Parquet ingestion and representative aggregates in browser tests.
- [x] Publish supported types, result formats, resource bounds and browser-loading evidence.

# Implementation Notes

Implemented `@pocketdb/engine-duckdb` with a lazy single-threaded DuckDB-Wasm worker, CSV/JSON/Parquet import, bounded Arrow-to-JSON query results, parameter support and exact decimal/large-integer string normalization. Added app engine selection/import controls, runtime owner-only import dispatch, invitation/protocol support, and read-only/read-write capability manifests. Published the supported contract and TASK-057 browser evidence.

The app currently keeps DuckDB in session memory. The adapter's OPFS fresh-worker reopen attempt failed with `_setThrew is not defined`, so OPFS is not advertised as a supported capability. TASK-055's direct DuckDB-Wasm OPFS checkpoint/reopen result is documented separately and does not replace this adapter evidence. Stable Chrome/Edge, Firefox, Safari, mobile and live Pages CDN remain unverified.

# Validation

Environment: macOS 27.0.1 arm64, Node 25.8.1, Chrome Canary 160.0.8181.0.

- `pnpm --filter @pocketdb/engine-duckdb test:browser` — passed. Imported 3 CSV rows, 3 JSON rows and 3 Parquet rows; checked grouped aggregates and 10,000-row truncation in a non-cross-origin-isolated browser context. Compact output: [results.json](../../artifacts/task-057-duckdb-adapter/results.json).
- `pnpm --filter @pocketdb/engine-duckdb test` — passed (1 test).
- `pnpm check` — passed (format, lint, and all package typechecks).
- `pnpm test` — passed across all packages.
- `pnpm build` — passed. Existing upstream PGlite `node:module` externalization and direct-eval warnings remain.
- `git diff --check` — passed.
- `python3 -m json.tool docs/capabilities/v1/duckdb-read-only.json` and `...duckdb-read-write.json` — both parsed successfully.

The attempted adapter OPFS reopen check failed, so persistence remains disabled and the app explicitly reports temporary session memory. TASK-055 records a separate raw DuckDB-Wasm loading probe: Chrome Canary 160 loaded the MVP bundle without cross-origin isolation; the built WASM asset measured 39.4 MB raw / 8.8 MB gzip. It is not stable-browser or live-CDN evidence.
