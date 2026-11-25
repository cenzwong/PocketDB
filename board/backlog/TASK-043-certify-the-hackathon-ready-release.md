---
id: TASK-043
title: Certify the hackathon-ready release
priority: critical
created: 2026-11-24
depends_on: [TASK-040, TASK-041, TASK-042]
labels: [m3, epic-22, delivery]
---

# Goal

Certify the hackathon-ready release.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-22. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 31, 32, 38.
- **Decisions** ADR-001, ADR-008, ADR-014, ADR-015
- **Estimated effort** 3 engineer-days.

# Scope

Run the full deployment demonstration and security review including invitation handling, session permissions, deployment and storage recovery.

# Acceptance Criteria

- [ ] Two laptops complete §32 against the deployed site, including remote reads and writes, SDK integration, activity inspection, persistent reload and export for both P0 engines. Complete the physical host sleep/wake procedure in [TASK-010's runbook](../../artifacts/task-010-host-lifecycle/README.md#measure-physical-host-sleep) and retain both peer journals and recovery timings.
- [ ] Publish release evidence, explicit limitations and any unresolved blockers. Release requires the full gate criteria.

# Implementation Notes

Pending. Record changed files, documentation updates and any decisions or limitations.

# Validation

Pending. Record exact commands, environments and outcomes, plus any remaining acceptance gaps.
