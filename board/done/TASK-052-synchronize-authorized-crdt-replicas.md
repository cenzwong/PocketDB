---
id: TASK-052
title: Synchronize authorized CRDT replicas
priority: high
created: 2026-11-24
depends_on: [TASK-051]
labels: [m5, epic-17, delivery]
---

# Goal

Synchronize authorized CRDT replicas.

# Context

- **Milestone** M5 · Distributed database mode
- **Parent epic** EPIC-17. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 6, 7, 10, 27.
- **Decisions** ADR-005, ADR-007, ADR-008, ADR-013
- **Estimated effort** 5 engineer-days.

# Scope

Implement authenticated state-vector exchange, incremental replication, reconnect and bounded update handling.

# Acceptance Criteria

- [x] Tests cover conflicting offline writes, duplicate/out-of-order delivery and reconnect convergence.
- [x] Reject unauthorized replicas and oversized updates and record verification of membership and revocation behavior.

# Implementation Notes

Implemented `ReplicaSyncSession` in `packages/engine-yjs/src/replication.ts` with versioned binary state-vector/update frames over an existing authenticated transport, identity and replica checks, host membership revalidation for each incoming message, read-only enforcement, duplicate-safe incremental updates, start-order handling, reconnect through a newly authenticated session, and a 16 KiB framed-message cap (16,380-byte payload). Remote updates carry a Yjs origin marker to prevent echo. Invalid vectors, malformed/oversized frames, wrong membership and revoked writers fail and disconnect the session. Added six authenticated synchronization tests in `packages/engine-yjs/test/replication.test.ts` for offline concurrent writes, duplicate/out-of-order updates, live edits, reconnect convergence, read-only and revoked writers, oversized updates, malformed vectors and wrong member identity. Added `crdt` to invitation engine validation and covered invitation URI roundtrip in `packages/protocol`. Updated the engine README, ADR-013 and TASK-051's size-bound note. The session is tested over the in-process transport with real `PeerSessionAuthority` authentication; browser/WebRTC, cross-device, and physical sleep/wake evidence remain separate release gates (TASK-054/TASK-043).

# Validation

- `pnpm --filter @pocketdb/engine-yjs typecheck` — passed.
- `pnpm --filter @pocketdb/engine-yjs test` — passed, 11 tests across local replica and authenticated replication suites.
- `pnpm test` — passed all workspace suites, including protocol invitation/authentication and six replica synchronization tests.
- `pnpm check` — passed formatting, lint and all workspace typechecks with no warnings.
- `git diff --check` — passed.
- Browser/WebRTC, Apple Container, physical-device and sleep/wake runs were not performed for this task; the tested synchronization path uses the in-process transport adapter. These are not claimed as cross-device evidence.
