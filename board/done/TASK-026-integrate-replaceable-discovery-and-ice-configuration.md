---
id: TASK-026
title: Integrate replaceable discovery and ICE configuration
priority: high
created: 2026-11-24
depends_on: [TASK-025]
labels: [m2, epic-04, delivery]
---

# Goal

Integrate replaceable discovery and ICE configuration.

# Context

- **Milestone** M2 · Peer-to-peer database access
- **Parent epic** EPIC-04. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 10, 25.
- **Decisions** ADR-005, ADR-006
- **Estimated effort** 3 engineer-days.

# Scope

Implement the selected discovery provider and configurable STUN/TURN through the transport boundary.

# Acceptance Criteria

- [x] Two supported browser peers discover one another, with success and unavailable-signalling diagnostics recorded.
- [x] Document external endpoints and configuration. A deterministic test can substitute another discovery adapter.

# Implementation Notes

Implemented `SignalingAdapter` and `DiscoveryAdapter` boundaries, `HttpRoomSignalingAdapter`, configurable STUN/TURN validation and ICE diagnostics in `packages/transport`. Added an in-process signaling substitute, unit coverage for successful exchange and unavailable/missing-peer errors, and a two-peer browser probe. Updated the transport and architecture docs and ADR-006. The HTTP room contract is documented, but no public signaling or ICE provider is selected; production service security and cross-network acceptance remain later release gates.

# Validation

Commands and outcomes:

- `pnpm --filter @pocketdb/transport typecheck` — passed.
- `pnpm --filter @pocketdb/transport test` — passed, 14 tests.
- `pnpm --filter @pocketdb/transport test:browser` — passed in Chrome Canary 160.0.8181.0 on macOS 27.0.1 arm64. Two local `RTCPeerConnection` peers connected through `InProcessSignalingAdapter`; selected host/host UDP pair and data round-trip passed.
- `pnpm check` — passed (format, lint and all package typechecks).
- `pnpm test` — passed (94 tests across all packages).
- `pnpm build` — passed. Vite reported existing PGlite dependency `node:module` externalization and direct `eval` warnings.

The browser probe uses two peer connections on one Mac with no external ICE service. It does not prove cross-device signaling, public endpoint reachability, separate-network NAT traversal, relay behavior, firewall restrictions or stable-browser support. Details and machine-readable output are in [the discovery evidence](../../artifacts/task-026-discovery/README.md). The Apple Container host-lifecycle run is Linux guest evidence and does not substitute for the physical macOS sleep/wake gate.
