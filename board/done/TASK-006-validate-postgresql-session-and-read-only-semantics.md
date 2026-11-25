---
id: TASK-006
title: Validate PostgreSQL session and read-only semantics
priority: critical
created: 2026-11-24
depends_on: [TASK-005]
labels: [m0, epic-00, spike]
---

# Goal

Validate PostgreSQL session and read-only semantics.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 13, 25.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 3 engineer-days.

# Scope

Run SP-05 using separate logical clients. Evaluate session isolation, transactions, interrupted sessions and viable read-only controls. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Capture concurrent commit and rollback traces with per-client session identity and the outcome of client loss during a transaction.
- [x] Demonstrate the supported read-only enforcement with negative tests or document a fail-closed restriction for remote SQL.

# Implementation Notes

Measured transaction ownership and read-only behavior on the real PGlite engine. Recommend serialized logical transactions and fail-closed arbitrary read-only remote SQL. [Source, commands and results](../../artifacts/task-006-sql-sessions/README.md).

# Validation

Ran `node artifacts/task-006-sql-sessions/verify.mjs` with PGlite 0.6.0 on Node v25.8.1, macOS arm64. Four logical clients had one backend PID. Queued commit and rollback completed in order. Simulated client loss before commit rolled back, and the next client saw only committed data. Three engine writes failed with SQLSTATE 25006 and arbitrary read-only remote SQL was rejected before dispatch. Actual network loss was outside this fixture.
