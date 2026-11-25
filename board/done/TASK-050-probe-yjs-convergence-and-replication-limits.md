---
id: TASK-050
title: Probe Yjs convergence and replication limits
priority: high
created: 2026-11-24
depends_on: [TASK-032]
labels: [m5, epic-17, spike]
---

# Goal

Probe Yjs convergence and replication limits.

# Context

- **Milestone** M5 · Distributed database mode
- **Parent epic** EPIC-17. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 25.
- **Decisions** ADR-002, ADR-005, ADR-008
- **Estimated effort** 3 engineer-days.

# Scope

Run SP-09 with multiple peers, offline changes, duplicate and reordered updates, reconnect and state vectors. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Reproduce convergence and record state growth, failure conditions and trade-offs between candidate sync and membership models.
- [x] Recommend a semantics and capability policy with evidence for ADR-013.

# Implementation Notes

Added [a reproducible Yjs probe](../../artifacts/task-050-yjs-probe/README.md), pinned to Yjs 13.6.33 in an isolated pnpm workspace. Three offline replicas converged after reordered and duplicate update application; a lagging replica was detected by its state vector and converged after reconnect; a fourth peer joined after an offline edit. Results and a recommendation for TASK-051/ADR-013 are recorded. No ADR-013 was created because TASK-051 owns the final semantics. Network transport, authentication enforcement, revocation, persistence, larger datasets and performance remain unmeasured.

# Validation

Commands and outcomes (macOS `27.0.1`, `darwin arm64`, Node `v25.8.1`, pnpm `11.25.0`):

- `pnpm --dir artifacts/task-050-yjs-probe install --ignore-workspace --frozen-lockfile` — passed; resolved pinned Yjs 13.6.33 and its two transitive packages.
- `pnpm --dir artifacts/task-050-yjs-probe probe` — passed twice. Three replicas converged after reordered and duplicate updates; an isolated replica was detected behind, then converged through state-vector synchronization; a fourth peer converged after an offline edit. Latest run recorded 2,240 bytes over two reconnect passes and 3,076 bytes for the fourth-peer exchange. Per-run byte totals vary slightly with Yjs-generated client identifiers. See [results.json](../../artifacts/task-050-yjs-probe/results.json).
- `pnpm check` — passed (formatting, lint and TypeScript checks).
- `git diff --check` — passed.

Limits: all replicas ran in one process; no real network, WebRTC, authorization enforcement, revocation, persistence, cross-platform Node matrix, large dataset, long-lived history or performance target was tested. The recommendation is input to TASK-051; ADR-013 remains deferred.
