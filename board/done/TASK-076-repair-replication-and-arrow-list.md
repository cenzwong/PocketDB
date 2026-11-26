---
id: TASK-076
title: Repair read-only replication and Arrow list results
priority: high
created: 2026-11-26
depends_on: [TASK-075]
labels: [review]
---

# Goal

Address both attached PR review findings with regression coverage.

# Acceptance Criteria

- [x] Read-only replicas reconnect with retained deletes and receive host updates while unauthorized publication remains rejected.
- [x] DuckDB list values normalize into logical arrays with nested values.

# Implementation Notes

- Read-only clients suppress state-vector update replies while completing the vector exchange; the host still rejects incoming unauthorized updates.
- DuckDB normalizes Arrow vectors recursively, preserving nested lists, nulls, and decimal scale.

# Validation

Node 26.13.0, pnpm 11.25.0 and Chrome 160.0.8184.1.

- `pnpm check` passed.
- `pnpm --filter @pocketdb/engine-yjs test` passed, including read-only reconnection and host authorization tests.
- `pnpm --filter @pocketdb/engine-duckdb test:browser` passed with real list, nested list, null and decimal values.
- `pnpm build` and `git diff --check` passed.

