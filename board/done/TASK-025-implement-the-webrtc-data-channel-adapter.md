---
id: TASK-025
title: Implement the WebRTC data-channel adapter
priority: critical
created: 2026-11-24
depends_on: [TASK-024]
labels: [m2, epic-04, delivery]
---

# Goal

Implement the WebRTC data-channel adapter.

# Context

- **Milestone** M2 · Peer-to-peer database access
- **Parent epic** EPIC-04. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 10, 25.
- **Decisions** ADR-005, ADR-006, ADR-014
- **Estimated effort** 4 engineer-days.

# Scope

Implement the browser adapter with connection events, bounded backpressure and message sizing or fragmentation decisions.

# Acceptance Criteria

- [x] Shared transport tests and browser integration cover framing boundaries, message ordering, send failure and peer disconnect.
- [x] Document supported direct and relay behavior, including how oversized traffic is rejected.

# Implementation Notes

Added `WebRTCDataChannelAdapter` for already-negotiated, ordered and reliable channels, with a 16 KiB application message cap bounded by SCTP negotiation, bounded outbound queueing, serialized sends, buffer-low handling, disconnect/error propagation and explicit oversized-message errors.

Added fake-channel tests for queue bounds, send exceptions, ordering, message copies, binary validation, state changes and send-after-close behavior. Added a Chromium integration that negotiates two local peers and exercises message boundaries, ordering, oversize rejection and peer disconnect.

Documented that signaling and ICE setup remain outside the adapter. It uses the candidate path selected by its `RTCPeerConnection`; this local browser probe does not certify direct or relayed reachability. TASK-004 remains the evidence for local direct and TURN-relayed fixtures. Oversized messages are rejected; fragmentation is not implemented.

Updated the root browser-test script to include the transport integration and linked its limits from ADR-005.

# Validation

Environment: macOS 27.0 arm64, Node v26.13.0, pnpm 11.25.0, Chrome Canary 160.0.8181.0.

- `pnpm format` — passed.
- `pnpm check` — passed (Biome format and lint plus all workspace TypeScript checks).
- `pnpm test` — passed; 57 tests across runtime, protocol, transport, key-value engine, PGlite and web.
- `pnpm build` — passed; Vite production build completed.
- `pnpm --filter @pocketdb/transport test:browser` — passed. Two local Chrome `RTCPeerConnection` peers exchanged 0-, 1- and 16,384-byte messages in order; the negotiated limit was 16,384 bytes; oversized send rejected with `message-too-large`; host disconnect reached the client and later send rejected with `not-connected`.
- `pnpm test:browser` — passed runtime, transport and PGlite browser integrations in Chrome Canary 160.0.8181.0.
- `git diff --check` — pending final review.

Limitations: the adapter integration is a local direct-candidate same-machine browser probe. TURN behavior is not exercised through this adapter test, and separate-network/public-relay or physical-device reachability remains outside this ticket.
