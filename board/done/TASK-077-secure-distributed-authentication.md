---
id: TASK-077
title: Verify host before distributed replica synchronization
priority: critical
created: 2026-11-26
depends_on: [TASK-076]
labels: [review, security]
---

# Goal

Prevent an unauthenticated peer from starting distributed replica synchronization.

# Acceptance Criteria

- [x] Reject out-of-order authentication and mismatched session identities before starting synchronization.
- [x] Verify the attack regression and legitimate distributed connections.

# Implementation Notes

- The client enforces handshake order and only accepts confirmation after verifying the pinned host challenge. It validates session scope, local identity, expiry and host identity before creating a transport or syncing. Invalid or out-of-order authentication closes the peer.

# Validation

Node 26.13.0, pnpm 11.25.0 and Chrome 160.0.8184.1.

- `pnpm check`, `pnpm --filter @pocketdb/web test` and `pnpm build` passed.
- `node apps/web/test/crdt-console-browser.mjs` passed with a substituted SDP attacker, a mismatched confirmed host identity following a valid challenge, and a successful legitimate reconnect. An earlier test run failed due to an incorrect test assertion, which was corrected.
- `pnpm check:board` and `git diff --check` passed.

