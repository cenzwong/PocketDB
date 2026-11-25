---
id: TASK-058
title: Select and prototype document storage
priority: low
created: 2026-11-24
depends_on: [TASK-022]
labels: [m6, epic-18, delivery]
---

# Goal

Select and prototype document storage.

# Context

- **Milestone** M6 · Engine expansion
- **Parent epic** EPIC-18. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 31.
- **Decisions** ADR-002, ADR-004
- **Estimated effort** 3 engineer-days.

# Scope

Validate use cases and compare hosted JSON and CRDT document candidates. Use hosted mode for an initial prototype. Reuse TASK-054 evidence before selecting a distributed candidate for implementation.

# Acceptance Criteria

- [x] A reproducible prototype covers CRUD, nested data, indexing or query needs and storage portability for the selected case.
- [x] Record an ADR if architecture changes and open follow-up implementation tasks only for the selected scope.

# Implementation Notes

Added `packages/engine-pglite/test/document-storage-prototype.test.ts` and the report and machine-readable result in `artifacts/task-058-document-storage/`. Selected hosted project documents stored as JSONB in the existing PostgreSQL/PGlite engine. Compared PostgreSQL JSONB, SQLite JSON functions and Yjs shared types in the report. This reuses the current SQL adapter, so it changes no architecture and needs no ADR or new implementation ticket. CRDT implementation selection remains deferred until TASK-054 supplies multi-peer evidence. JSONL proves record-level import/export to a fresh PGlite instance; it does not claim cross-engine schema/SQL compatibility. The GIN assertion proves the index path is available; the test forces it because the small fixture's estimated sequential scan is cheaper, so it is not performance evidence.

# Validation

Environment: macOS 27.0.1 arm64, Node.js v25.8.1, pnpm 11.25.0, PGlite 0.6.0.

- `pnpm --filter @pocketdb/engine-pglite exec vitest run test/document-storage-prototype.test.ts` — passed, 1 test. CRUD, nested JSON fields, containment query, GIN plan path, and 511-record JSONL import into a fresh database passed.
- `pnpm --filter @pocketdb/engine-pglite test` — passed, 13 tests across 2 files.
- `pnpm --filter @pocketdb/engine-pglite typecheck` — passed.
- `pnpm exec biome format packages/engine-pglite/test/document-storage-prototype.test.ts` — passed, no formatting changes required after formatting.
- `git diff --check` — passed.

Remaining boundary: no deployed-host, multi-client, cross-engine migration, or production-scale performance evidence. These are outside the selected hosted prototype; distributed candidate selection still requires TASK-054.
