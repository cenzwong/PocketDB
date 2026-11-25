---
id: TASK-063
title: Evaluate infrastructure service extension boundaries
priority: low
created: 2026-11-24
depends_on: [TASK-054, TASK-060]
labels: [m7, epic-19, decision]
---

# Goal

Evaluate infrastructure service extension boundaries.

# Context

- **Milestone** M7 · AI-native infrastructure
- **Parent epic** EPIC-19. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 31, 35.
- **Decisions** ADR-002, ADR-004, ADR-013
- **Estimated effort** 3 engineer-days.

# Scope

Use lessons from hosted and distributed runtime contracts to evaluate the need for broader services.

# Acceptance Criteria

- [x] Record concrete candidate use cases, ownership and API boundaries and a recommendation with reversible alternatives.
- [x] Add extension-contract implementation to the board only if the review confirms a justified design.

# Implementation Notes

Recorded ADR-019 and linked it from the architecture decision summary. It evaluates browser-hosted engines, signaling/STUN/TURN, Yjs shared state, document/vector prototypes, and proposed queue/pub-sub/object/workflow/agent-memory services. It names present or missing owners and maps existing evidence to engine, transport, discovery, replica and MCP boundaries. Recommendation: retain those narrow boundaries and do not create a generalized service contract or implementation ticket until concrete multi-service ownership needs exist.

# Validation

Evidence reviewed: ADR-002, ADR-004, ADR-006, ADR-013; TASK-054, TASK-058, TASK-059 and TASK-060; current architecture overview and handoff scope exclusions.

- ADR-019 relative link targets resolved in the repository.
- `git diff --check` — passed.
- No implementation tests were run; this ticket changes decision documentation only.
