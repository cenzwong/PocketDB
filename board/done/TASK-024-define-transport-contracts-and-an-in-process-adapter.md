---
id: TASK-024
title: Define transport contracts and an in-process adapter
priority: high
created: 2026-11-24
depends_on: [TASK-013]
labels: [m2, epic-04, delivery]
---

# Goal

Define transport contracts and an in-process adapter.

# Context

- **Milestone** M2 · Peer-to-peer database access
- **Parent epic** EPIC-04. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 10, 24.
- **Decisions** ADR-005
- **Estimated effort** 3 engineer-days.

# Scope

Create the byte transport boundary, connection lifecycle events and deterministic test transport.

# Acceptance Criteria

- [x] Contract tests exercise send, disconnect, cleanup, state events and failure injection.
- [x] An engine-independent test fixture exchanges binary messages through the adapter.

# Implementation Notes

Added the engine-independent `@pocketdb/transport` package. It defines a generic `TransportAdapter` and per-peer `TransportConnection` contracts for byte messages, connection state, disconnect and listener cleanup. Added a deterministic in-process pair that clones message bytes, disconnects both peers, and can inject a one-shot send failure. Added a reusable contract suite and exercised binary data, state events, unsubscribing, send failure recovery, and post-disconnect errors. Updated the architecture overview and ADR-005 evidence. WebRTC connectivity and discovery remain separate tasks.

# Validation

On macOS arm64 with Node 26.13.0 and pnpm 11.25.0:

- `pnpm install --lockfile-only --offline` — passed and added the transport workspace importer. The subsequent offline installation found the Biome package absent from the local store; `pnpm install --frozen-lockfile` restored the existing locked dependencies from the configured pnpm store without changing resolutions.
- `pnpm format` — passed.
- `pnpm check` — passed formatting, lint, and typechecks for all workspace packages including transport.
- `pnpm test` — passed, 51 unit tests across runtime (9), protocol (18), transport (5), engine-kv (10), engine-pglite (8), and web (1).
- `pnpm build` — passed Vite production build.
- `git diff --check` — passed.

These checks validate the in-process byte transport contract only. WebRTC establishment, discovery, relay use, and physical-device networking are not implemented or claimed by TASK-024.
