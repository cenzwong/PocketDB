---
id: TASK-004
title: Evaluate discovery and NAT traversal
priority: high
created: 2026-11-24
depends_on: [TASK-003]
labels: [m0, epic-00, spike]
---

# Goal

Evaluate discovery and NAT traversal.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 10, 25.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 3 engineer-days.

# Scope

Run SP-02 and SP-03 using the data-channel probe. Compare an automatic discovery candidate to the manual baseline and test STUN and optional TURN. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Record outcomes for LAN, separate networks and a restrictive or relayed case, including any unavailable test conditions.
- [x] Identify external services, privacy exposure, configuration, operating cost assumptions and actionable failure signals.

# Implementation Notes

Added the [manual and HTTP room comparison](../../artifacts/task-004-discovery/README.md), scoped STUN/TURN fixture and privacy and operating assumptions. Recommend preserving manual negotiation and advancing configurable signalling, STUN and optional TURN to ADR-006 review.

# Validation

Ran `node artifacts/task-004-discovery/verify.mjs` on macOS arm64 with Node v25.8.1 and Chrome Canary 160.0.8180.0. Manual and automatic local write/read passed, STUN exposed server-reflexive candidates, relay-only without TURN timed out, and relay-only with TURN passed with both ICE pairs using UDP relay candidates. The physical LAN manual baseline is from TASK-003. Separate networks, automatic exchange between physical LAN peers and firewall cases remain unmeasured. The linked report records the setup needed to run those cases.
