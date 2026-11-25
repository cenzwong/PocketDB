---
id: TASK-027
title: Implement secure invitations and URI parsing
priority: critical
created: 2026-11-24
depends_on: [TASK-023]
labels: [m2, epic-05, delivery]
---

# Goal

Implement secure invitations and URI parsing.

# Context

- **Milestone** M2 · Peer-to-peer database access
- **Parent epic** EPIC-05. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 12, 13.
- **Decisions** ADR-007, ADR-008
- **Estimated effort** 3 engineer-days.

# Scope

Implement versioned invitation creation and parsing with secure capabilities, scoped access, expected host identity and optional expiry.

# Acceptance Criteria

- [x] Round-trip supported URI and fragment forms and reject malformed, wrong-target and expired invitations.
- [x] Verify secrets stay out of URL query strings and logs, and expose a warning when copying privileged invitations.

# Implementation Notes

Added invitation v1 to `@pocketdb/protocol`: Web Crypto generates a 256-bit bearer capability; payloads include room, instance, engine, expected host key digest, access scope and optional Unix-millisecond expiry. Builders produce `pocketdb://<room>/<engine>#invite=...` and HTTPS browser fragment links; PostgreSQL uses the existing `postgres` URI alias and `postgresql` protocol engine ID. The parser rejects query parameters, unsupported/malformed payloads, mismatched custom URI routes, expired scopes and caller-specified wrong targets. Browser links remove existing query data, and read-write links return a warning for the caller to show before copying. The log helper removes query and fragment data.

Added eight unit tests plus a Chromium browser probe for secure-context capability generation, fragment round-trip, empty query strings, privileged warnings and redaction. Updated the remote-access and protocol specifications and ADR-008 evidence.

Parsing proves only payload format and target consistency; it does not authenticate the peer, prove key possession, revoke a capability, or enforce the access scope. Host-side identity and authorization remain required by TASK-028/029.

# Validation

Environment: macOS 27.0 arm64, Node v26.13.0, pnpm 11.25.0, Chrome Canary 160.0.8181.0.

- `pnpm format` — passed.
- `pnpm check` — passed (Biome format and lint plus all workspace TypeScript checks).
- `pnpm test` — passed; 65 tests across runtime, protocol, transport, key-value engine, PGlite and web.
- `pnpm build` — passed; Vite production build completed.
- `pnpm --filter @pocketdb/protocol test:browser` — passed in a secure localhost Chrome context; capability length was 32 bytes, fragment round-trip and redaction passed, query was empty and write access returned a warning.
- `pnpm test:browser` — passed runtime, invitation, transport and PGlite browser integrations in Chrome Canary 160.0.8181.0.
- `git diff --check` — passed; no trailing whitespace found in new invitation sources, tests, specifications or ticket notes.

No physical-device or authenticated remote-session claim is made by this invitation-format ticket.
