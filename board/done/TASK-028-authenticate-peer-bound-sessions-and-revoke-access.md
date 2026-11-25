---
id: TASK-028
title: Authenticate peer-bound sessions and revoke access
priority: critical
created: 2026-11-24
depends_on: [TASK-025, TASK-027]
labels: [m2, epic-05, delivery]
---

# Goal

Authenticate peer-bound sessions and revoke access.

# Context

- **Milestone** M2 · Peer-to-peer database access
- **Parent epic** EPIC-05. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 12, 13.
- **Decisions** ADR-005, ADR-008
- **Estimated effort** 4 engineer-days.

# Scope

Bind successful authentication to an expected peer, host, instance and role and enforce revocation at the session boundary.

# Acceptance Criteria

- [x] Integration tests verify valid joins, peer mismatch and invalid, expired and revoked invitations, including active-session behavior.
- [x] Unauthenticated or revoked sessions cannot reach authenticated handlers and rejection logs redact secrets.

# Implementation Notes

- Added peer identity helpers and `PeerSessionAuthority` in `packages/protocol/src/peer-authentication.ts`. Authentication uses a signed, single-use challenge, proves the invitation capability, snapshots invitation scope and expiry, and binds the session to the expected host, client, role, WebRTC connection and DTLS certificate fingerprints.
- Added versioned challenge and proof envelopes to `packages/protocol/src/protocol.ts`, exports and JSON fixtures. Authority checks expiry, revocation and handler authorization; bounds pending challenges and active sessions; rejection events contain only a stable code. `revoke()` returns affected active sessions so the caller can close their runtime sessions.
- Added unit and browser integration coverage in `packages/protocol/test/peer-authentication.test.ts` and `packages/protocol/test/peer-auth-browser.*`. The browser probe uses connected local WebRTC peers and DTLS fingerprints from `getStats()`; it verifies valid join, mismatch rejection, unauthenticated handler blocking, active revocation and redacted rejection events.
- Updated `packages/protocol/README.md`, `docs/specs/remote-access.md`, `docs/specs/protocol-v1.md` and ADR-008.
- Limitation: this task establishes and verifies the protocol session boundary with a test handler. Application remote-engine routing and automatic runtime-session closure are handled by dependent work; callers must close sessions returned by `revoke()`. Already-running asynchronous handlers are not cancelled.

# Validation

- Environment: macOS 27.0.1 arm64, Node v26.13.0, pnpm 11.25.0.
- `pnpm check` — passed (format, lint and all package typechecks).
- `pnpm test` — passed, 84 tests across the workspace.
- `pnpm build` — passed; existing PGlite bundler warnings note upstream `eval` usage and externalized `node:module`.
- `pnpm --filter @pocketdb/protocol test:browser` — passed on Chrome Canary 160.0.8181.0 and legacy Edge 116.0.1938.62. Both runs reported connected fingerprints, valid join, unauthenticated-handler blocking, mismatched-peer blocking, revoked-session blocking and redacted rejection events.
- `pnpm test:browser` — passed for the full workspace chain on Chrome Canary 160.0.8181.0, including protocol authentication, transport, browser persistence and local console probes.
- Browser coverage is local integration evidence, not two-physical-device acceptance. Stable Chromium reference coverage remains blocked separately in TASK-022; this does not leave a TASK-028 acceptance gap.
