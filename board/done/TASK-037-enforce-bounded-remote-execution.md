---
id: TASK-037
title: Enforce bounded remote execution
priority: critical
created: 2026-11-24
depends_on: [TASK-030]
labels: [m3, epic-22, delivery]
---

# Goal

Enforce bounded remote execution.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-22. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 13, 15, 27.
- **Decisions** ADR-007, ADR-008, ADR-010
- **Estimated effort** 4 engineer-days.

# Scope

Enforce query/result size, connection/rate/queue limits and execution deadlines where supported.

# Acceptance Criteria

- [x] Test bounded consumption and predictable errors at each limit, with worker cleanup and execution outcome preserved.
- [x] Record supported cancellation, transaction cleanup and any limits the engine cannot enforce directly.

# Implementation Notes

Added transport-aware request and result byte caps, a fixed-window per-connection request rate cap, explicit request/session/active-work limits, and structured errors for oversized input/output. The effective message size is clamped to the transport's advertised limit and protocol v1 ceiling. Added bounded-worker timeout cleanup coverage and a routed integration test proving the remote outcome stays `unknown` and duplicate delivery does not re-execute a timed-out mutation. Documented adapter cancellation and transaction-cleanup limits in the runtime and remote-access references.

# Validation

Commands and outcomes:

- `pnpm --filter @pocketdb/runtime typecheck` — passed.
- `pnpm --filter @pocketdb/runtime test` — passed, 11 tests, including worker watchdog termination and settlement.
- `pnpm --filter @pocketdb/remote-access typecheck` — passed.
- `pnpm --filter @pocketdb/remote-access test` — passed, 8 tests. Covers request and result size caps, session count, active request count, rate limit, deduplicated replay, deadline outcome, and worker termination after a hung operation.
- `pnpm --filter @pocketdb/runtime test:browser` — passed in Chrome Canary 160.0.8181.0. Verified bounded worker queue, cancellation recovery, pending-call settlement on worker termination, and page responsiveness.
- `pnpm check` — passed (format, lint and all package typechecks).
- `pnpm test` — passed, 99 tests across all packages.
- `pnpm build` — passed; Vite reported existing PGlite `node:module` externalization and direct `eval` warnings.

Limits and cleanup: the `PeerSessionAuthority` default cap is 1,000 active peer sessions per authority; each `RemoteSessionHost` caps open engine sessions at 16, active requests at 64, new requests at 120 per fixed 60-second window, and retained completed results at 256. Worker pending calls default to 32. Request/result caps default to the protocol's 256 KiB but are clamped by the transport; the default WebRTC transport caps messages at 16 KiB. The KV adapter checks cancellation before applying an operation. PGlite checks before serialized work but cannot cancel an in-flight query. Orderly session close and instance stop roll back PGlite transactions; rollback after forced worker termination is not verified. A post-dispatch timeout or result too large to deliver reports `outcome: unknown`; retries are deduplicated while their completed record is retained and are never automatically replayed. Physical-device acceptance remains at the product-end release gate as requested.
