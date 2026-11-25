---
id: TASK-010
title: Measure host tab and worker lifecycle
priority: high
created: 2026-11-24
depends_on: [TASK-003, TASK-005]
labels: [m0, epic-00, spike]
---

# Goal

Measure host tab and worker lifecycle.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 15, 25.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 2 engineer-days.

# Scope

Run SP-11 for visibility changes, suspension, sleep, reload and close with peers connected. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Publish a browser and two-container peer matrix with observed peer and worker outcomes and a recovery timeline.
- [x] Translate outcomes into warning copy, reconnect expectations and unsupported availability claims.

# Implementation Notes

Added the [connected peer lifecycle probe and matrix](../../artifacts/task-010-host-lifecycle/README.md). Proposed host warning copy, bounded reconnect and outcome handling for ADR-010 and ADR-014 review. Per the user's plan, physical macOS sleep/wake validation will run as part of final deployed product certification in TASK-043.

# Validation

Ran `POCKETDB_HEADFUL=1 node artifacts/task-010-host-lifecycle/verify.mjs` with Chrome Canary 160.0.8180.0 and Edge 116.0.1938.62 on macOS 27.0.1 arm64. Hidden tabs served a read. DevTools freeze stalled replies and resume restored the original session. Reload and close ended useful requests on the old connection and persisted data recovered with a new worker and session. The staged manual page also passed offer, answer, marker write and read in two Chrome tabs.

The [Apple Container result](../../artifacts/task-010-host-lifecycle/container/results.json) adds two distinct Linux arm64 Chromium guests on this Mac. The client timed out while the host Chromium processes were stopped, recovered on the same worker after SIGCONT in 282 ms, and recovered the saved marker on a new worker after a full host guest restart in 3,162 ms. Rebuilt and reproduced with the checked-in commands in the probe README.

`container build -f artifacts/task-010-host-lifecycle/container/Dockerfile -t pocketdb-lifecycle-local:1 artifacts` and `python3 artifacts/task-010-host-lifecycle/container/verify-containers.py` passed twice on Apple Container 1.7.1 on macOS arm64. See the [recorded two-guest result](../../artifacts/task-010-host-lifecycle/container/results.json) and [reproduction instructions](../../artifacts/task-010-host-lifecycle/README.md#two-apple-container-peers). The container guest process suspension and restart measure browser and host-process loss, not physical macOS sleep. The user will run the [physical two-Mac sleep/wake procedure](../../artifacts/task-010-host-lifecycle/README.md#measure-physical-host-sleep) against the deployed product during TASK-043; that release evidence remains required before release certification.
