---
id: TASK-005
title: Evaluate PGlite and browser persistence
priority: critical
created: 2026-11-24
depends_on: [TASK-002]
labels: [m0, epic-00, spike]
---

# Goal

Evaluate PGlite and browser persistence.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 14, 15, 25.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 3 engineer-days.

# Scope

Run SP-04. Exercise PGlite in a worker and test candidate storage for PGlite and the key-value engine on the intended static origin. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Demonstrate parameterized SQL, reload recovery and export/restore for PGlite and a reload round trip for key-value data.
- [x] Record quota and private browsing behavior, cross-tab ownership constraints, extensions and fallback choices.

# Implementation Notes

Added the [PGlite worker and key-value persistence spike](../../artifacts/task-005-persistence/README.md). Recommend IndexedDB and one cooperative owner per SQL instance, with an explicit memory fallback. The ADR review owns final engine storage, worker and snapshot choices.

# Validation

Ran the documented `node verify.mjs <cert> <key>` against PGlite 0.6.0 and Chrome Canary 160.0.8180.0 on macOS arm64. On a header-constrained HTTPS project-path preview, parameterized SQL, citext, reload recovery, archive restore and key-value reload passed in regular and private contexts. A second writer was refused until the lock was released. A new private context could not read the previous context's key. A 64 KiB quota override produced `QuotaExceededError` for an oversized write while the estimate remained 10 GiB. The deployed origin, browser matrix and other extensions remain unverified.
