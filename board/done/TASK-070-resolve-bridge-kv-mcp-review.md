---
id: TASK-070
title: Resolve bridge KV and MCP review findings
priority: medium
created: 2026-11-25
depends_on: [TASK-069]
labels: [review, verification]
---

# Goal

Resolve the three attached inline findings on [PR #1](https://github.com/cenzwong/PocketDB/pull/1).

# Scope

PostgreSQL bridge savepoint status and disconnect cleanup, memory-only KV bookkeeping, and MCP bigint results.

# Acceptance Criteria

- [x] Each finding has a scoped fix and a regression check.
- [x] Pass workspace verification and update the existing PR.

# Implementation Notes

- The PostgreSQL bridge distinguishes savepoint rollback from transaction termination. Its driver regression checks ReadyForQuery during savepoint recovery and verifies full rollback on disconnect.
- The KV adapter records dirty and deleted keys only when it has a persistent database. The regression checks both explicit deletion and expiry in a memory-only instance.
- MCP serializes nested bigint values as decimal strings. The registered SQL tool test checks that text and structured results match after a successful write with RETURNING.

# Validation

On Node 26.13.0, pnpm 11.25.0, and Chromium 160.0.8182.0:

- `pnpm check` passed formatting, lint, workspace type checks, and board validation.
- `pnpm test` passed all 165 workspace unit tests, including the three focused regressions.
- `pnpm --filter @pocketdb/engine-kv test:browser` passed the IndexedDB ownership, persistence, and quota checks.
- `pnpm build` and `pnpm test:pages:artifact` passed.
- `pnpm test:browser` passed the workspace browser suite.
- `git diff --check` passed.
