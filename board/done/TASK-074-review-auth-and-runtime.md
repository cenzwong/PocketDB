---
id: TASK-074
title: Repair authentication and runtime review findings
priority: high
created: 2026-11-26
depends_on: [TASK-073]
labels: [review, security]
---

# Goal

Address seven attached review findings on PR 1.

# Scope

Authentication confidentiality and races, retained replica identity, CLI probes, result outcomes and PostgreSQL boolean output.

# Acceptance Criteria

- [x] Address and verify each attached finding.

# Implementation Notes

- SQL CLI probes use negotiated operations. Result serialization failures report unknown outcomes. PostgreSQL booleans use wire text values.
- Hosted and Distributed Mode install authentication listeners before waiting for peer bindings. Retained replicas are bound to the invited host identity.
- Browser, Node and Distributed Mode authentication send only non-secret invitation scope. The signed host challenge is verified before the HMAC capability proof.
- This handshake change requires updated hosts and clients together.

# Validation

Node 26.13.0, pnpm 11.25.0 and Chromium 160.0.8184.1.

- `pnpm check` and `pnpm test` passed, including CLI liveness, boolean wire encoding and invalid result outcome checks.
- `pnpm test:browser` passed on retry, including browser and Node hosted authentication and Distributed Mode. Earlier attempts encountered a host disconnect and a Distributed Mode synchronization timeout.
- `pnpm build` and `pnpm test:pages:artifact` passed.
- `git diff --check` passed.
