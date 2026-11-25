---
id: TASK-009
title: Probe remote RESP compatibility
priority: medium
created: 2026-11-24
depends_on: [TASK-007]
labels: [m0, epic-00, spike]
---

# Goal

Probe remote RESP compatibility.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 17, 25.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 2 engineer-days.

# Scope

Run SP-08 with a minimal RESP adapter and a browser-owned key-value probe. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Show a named Redis client writing and reading a browser-owned key, including an unsupported-command response, or record a reproducible blocker.
- [x] Record parser and handshake constraints, supported terms and a recommendation.

# Implementation Notes

Added a bounded RESP2 parser and loopback adapter for a browser-owned key-value Map. Recommend a published, versioned RESP2 subset with explicit unsupported-command errors. [Source, commands and results](../../artifacts/task-009-resp/README.md).

# Validation

Ran `node artifacts/task-009-resp/verify.mjs` on macOS arm64 with Node v25.8.1, Node Redis 6.4.0 and Chrome Canary 160.0.8180.0. Handshake, binary SET/GET, missing GET, browser ownership and unsupported INCR passed. Parser checks covered fragmented and coalesced frames and invalid length or terminator. Wider Redis driver and command coverage remains open.
