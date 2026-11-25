---
id: TASK-011
title: Validate peer identity and capability design
priority: critical
created: 2026-11-24
depends_on: [TASK-003]
labels: [m0, epic-00, spike]
---

# Goal

Validate peer identity and capability design.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 12, 13, 25.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 3 engineer-days.

# Scope

Run SP-12. Threat-model signalling, invitation leakage and impersonation and validate a candidate peer identity and session binding. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Record a reproducible authorized join and rejection cases for invalid identity and wrong, expired or revoked capability.
- [x] Document trust assumptions, credential handling and unresolved identity risks with a recommendation for the ADR.

# Implementation Notes

Added a WebCrypto candidate and threat model for ADR-008. The fixture binds scoped capability proof to a connection challenge and checks host pinning, client proof and revocation. [Experiment, commands and results](../../artifacts/task-011-peer-identity/README.md).

# Validation

Ran `node artifacts/task-011-peer-identity/verify.mjs` on Node v25.8.1, macOS arm64. Authorized join passed. Replay, wrong connection, changed channel binding, substituted host key, invalid identity, wrong capability, expiry and revocation all rejected. Fingerprint inputs were supplied by the fixture. Browser extraction and real transport binding remain implementation work.
