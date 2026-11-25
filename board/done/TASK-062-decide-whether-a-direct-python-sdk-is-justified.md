---
id: TASK-062
title: Decide whether a direct Python SDK is justified
priority: low
created: 2026-11-24
depends_on: [TASK-049]
labels: [m7, epic-19, decision]
---

# Goal

Decide whether a direct Python SDK is justified.

# Context

- **Milestone** M7 · AI-native infrastructure
- **Parent epic** EPIC-19. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 16, 19, 31.
- **Decisions** ADR-007, ADR-016
- **Estimated effort** 2 engineer-days.

# Scope

Compare Python access through native drivers with demand for a direct SDK using use cases and transport evidence.

# Acceptance Criteria

- [x] Record supported and missing workflows, maintenance costs and a decision to defer or authorize specific SDK work.
- [x] If selected, define a minimal public API, compatibility and follow-up tasks.

# Implementation Notes

Recorded ADR-018: defer a direct Python SDK until a named consumer need exceeds the verified driver, CLI and MCP paths. The decision compares current Python workflows, missing direct-peer workflows, maintenance cost, alternatives, and evidence that would reopen the decision. Linked it from the decision index. Since implementation was deferred, there is no SDK API or compatibility contract to define.

# Validation

The decision is grounded in the exact Psycopg 3.3.9 and redis-py 8.2.0 workflows and limitations recorded in TASK-049 and `docs/compatibility/native-drivers.md`, plus TASK-061/TASK-064 MCP delivery evidence.

- Markdown link targets referenced by ADR-018 resolve to files in this checkout.
- `git diff --check` — passed.
- No implementation tests were run; this ticket changes decision documentation only.
