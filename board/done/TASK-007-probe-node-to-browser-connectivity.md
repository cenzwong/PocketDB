---
id: TASK-007
title: Probe Node-to-browser connectivity
priority: high
created: 2026-11-24
depends_on: [TASK-003]
labels: [m0, epic-00, spike]
---

# Goal

Probe Node-to-browser connectivity.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 16, 25.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 2 engineer-days.

# Scope

Run SP-06 with candidate Node.js transports on reference platforms. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Exchange a correlated request and response with a browser from Node and record setup, platform, dependency and packaging constraints.
- [x] Record a recommendation or a documented native-path blocker.

# Implementation Notes

Added a native add-on and JavaScript transport comparison using the existing browser KV host. Recommend trying werift first for packaging simplicity and retaining node-datachannel as a fallback. [Experiment, commands and results](../../artifacts/task-007-node-webrtc/README.md).

# Validation

Ran `node verify.mjs node-datachannel` and `node verify.mjs werift` on macOS arm64 with Node v25.8.1 and Chrome Canary 160.0.8180.0. Both received the correlated SET acknowledgement and GET value. The native add-on loaded from the darwin-arm64 prebuild. Node LTS, additional platforms and WAN/relay remain unverified.
