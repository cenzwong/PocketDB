---
id: TASK-030
title: Route authenticated remote requests to engine sessions
priority: critical
created: 2026-11-24
depends_on: [TASK-015, TASK-028, TASK-029]
labels: [m2, epic-03, delivery]
---

# Goal

Route authenticated remote requests to engine sessions.

# Context

- **Milestone** M2 · Peer-to-peer database access
- **Parent epic** EPIC-03. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 9, 11, 13.
- **Decisions** ADR-004, ADR-007, ADR-008
- **Estimated effort** 4 engineer-days.

# Scope

Connect protocol messages to hosted engine sessions with correlation, timeouts, request deduplication and explicit execution outcomes.

# Acceptance Criteria

- [x] In-process integrations exercise session open and close, capabilities, ping, requests, responses and structured failures.
- [x] Disconnect and timeout tests distinguish rejected, completed, failed and unknown execution; mutations with unknown outcomes are never replayed automatically.

# Implementation Notes

- Added `@pocketdb/remote-access` with `RemoteSessionHost`, which joins an already authenticated peer connection to `DatabaseRuntime` without coupling protocol, transport or runtime packages to one another.
- The host negotiates protocol v1, exposes only the invited engine's capabilities, revalidates connection-bound authorization before handling messages, binds opened sessions to the authenticated instance/engine/access scope, routes correlated requests and closes sessions on disconnect.
- Added bounded request/session limits, exact-content request deduplication, conflicting-ID rejection, structured outcomes, heartbeat echo and timeout handling. A dispatched timeout returns `unknown`, aborts where supported, and does not replay the mutation. Errors preserve stable engine/runtime codes and omit nested causes and details.
- Added four in-process integration tests for capability negotiation, heartbeat, open/close, KV write/read, successful duplicate suppression, request-ID conflict, structured engine failure, access escalation, cross-session routing, disconnect cleanup and timeout no-replay.
- Added `packages/remote-access/README.md`; updated the protocol spec, target architecture and ADR-008 evidence links.
- Limitation: the package starts after authentication; signaling, ICE setup and the challenge/proof exchange remain owned by the existing transport and protocol integration work. Client SDK retries remain prohibited for unknown mutation outcomes.

# Validation

- Environment: macOS 27.0.1 arm64, Node v26.13.0, pnpm 11.25.0.
- `pnpm check` — passed (format, lint and typecheck across all workspace packages).
- `pnpm test` — passed, 91 tests across the workspace, including all four remote-access in-process integration tests.
- `pnpm build` — passed; existing PGlite bundler warnings note upstream `eval` usage and externalized `node:module`.
- `pnpm install --frozen-lockfile` — passed after updating the lockfile for the new workspace package.
- Browser transport and physical-device results are tracked separately; this task's acceptance integration is in-process and does not claim two-device access.
