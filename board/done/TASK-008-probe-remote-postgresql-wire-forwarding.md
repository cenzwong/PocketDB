---
id: TASK-008
title: Probe remote PostgreSQL wire forwarding
priority: high
created: 2026-11-24
depends_on: [TASK-005, TASK-007]
labels: [m0, epic-00, spike]
---

# Goal

Probe remote PostgreSQL wire forwarding.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 17, 25.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 3 engineer-days.

# Scope

Run SP-07 using a driver and a browser-owned PGlite instance. Compare boundary options for startup and query forwarding. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Record startup, a parameterized query and transaction behavior, confirming data executes in the browser.
- [x] Record compatibility gaps, cancellation and lifecycle findings, and the native scope impact.

# Implementation Notes

Probed split startup and bounded PostgreSQL wire forwarding with a browser-owned worker, and compared the candidate boundary with gateway startup and semantic translation. [Source, commands and results](../../artifacts/task-008-postgres-wire/README.md).

# Validation

Ran `node artifacts/task-008-postgres-wire/verify.mjs` on macOS arm64 with Node v25.8.1, node-postgres 8.23.1 and Chrome Canary 160.0.8180.0. Startup, extended-query parameter binding, commit, rollback and disconnect cleanup passed. Browser inspection saw only the committed row. CancelRequest was closed locally, and the next query succeeded. In-flight cancellation, real auth, multi-client isolation and driver coverage remain open.
