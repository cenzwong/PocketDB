---
id: TASK-012
title: Ratify initial architecture and feasibility exit
priority: critical
created: 2026-11-24
depends_on: [TASK-004, TASK-006, TASK-008, TASK-009, TASK-010, TASK-011]
labels: [m0, epic-00, decision]
---

# Goal

Ratify initial architecture and feasibility exit.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 26, 31.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 3 engineer-days.

# Scope

Review the feasibility evidence and resolve the initial ADRs listed for this gate in ADR_BACKLOG.md. Confirm the P0 scope, supported browsers, fallback decisions and release plan.

# Acceptance Criteria

- [x] Publish ADRs with alternatives, evidence, reversibility and decision status. Keep failed assumptions explicit with a fallback or follow-up dependency.
- [x] Record the M0 gate decision and revise scope and estimates. Gate passage requires a defensible path for the first release.

# Implementation Notes

Published ADR-001 through ADR-010, ADR-014 and ADR-017 in [docs/decisions](../../docs/decisions/). Updated the decision index, [ADR backlog](../../project/ADR_BACKLOG.md), [milestone gates](../../project/MILESTONES.md), [product scope](../../project/PRODUCT_SCOPE.md), [timeline](../../project/TIMELINE.md) and [project phase](../../PROJECT.md).

M0 passed conditionally for the static Hosted Mode path. P0 remains browser key-value and PGlite with a TypeScript SDK, authenticated WebRTC, worker execution and browser-local persistence. Manual signalling, configurable STUN and optional TURN form the connectivity fallback. The native PostgreSQL/RESP bridges, CRDT replication and additional engines remain later release tracks. The 28 engineer-day M0 baseline is unchanged because the measured probes did not require more implementation scope; release validation and device access remain explicit gates. TASK-043 now owns physical Mac sleep/wake validation requested by the user.

Open assumptions and follow-ups are captured in the ADRs: real Pages deployment, browser channel identity binding, public signalling selection, cross-network connectivity, stable-browser versions, dependency license audit and copyright ownership confirmation. The release cannot claim broad browser support, guaranteed reachability or background availability before those gates pass.

# Validation

Documentation checks on macOS 27.0.1, arm64:

- `git diff --check` — passed.
- Python 3.13 relative Markdown target scan — passed across repository Markdown; all linked local files exist.
- Ruby YAML board metadata/dependency validation — passed for 66 unique task IDs; all referenced dependencies exist, and every TASK-012 prerequisite is in `board/done/`.
- ADR coverage review — passed; each initial ADR has status, context, decision, alternatives, consequences, reversibility and evidence.

No application tests or builds were run; this ticket changes planning and decision records only. Remaining limitations and release prerequisites are listed above and in the owning ADRs.
