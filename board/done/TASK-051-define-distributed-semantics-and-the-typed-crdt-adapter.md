---
id: TASK-051
title: Define distributed semantics and the typed CRDT adapter
priority: high
created: 2026-11-24
depends_on: [TASK-050]
labels: [m5, epic-17, delivery]
---

# Goal

Define distributed semantics and the typed CRDT adapter.

# Context

- **Milestone** M5 · Distributed database mode
- **Parent epic** EPIC-17. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 6, 7, 16, 26.
- **Decisions** ADR-002, ADR-008, ADR-013
- **Estimated effort** 4 engineer-days.

# Scope

Resolve ADR-013 and implement typed maps, arrays, text, structured documents and binary update interfaces.

# Acceptance Criteria

- [x] Tests demonstrate local mutation, read and offline editing across the supported structures.
- [x] Record membership and revocation boundaries and declare convergence and data-retention guarantees.

# Implementation Notes

Added the private `@pocketdb/engine-yjs` package with typed map, array, text and structured-document roots; copied JSON ingress/egress; local read-only write guards; bounded binary Yjs update/state-vector APIs; lifecycle and input errors. Added ADR-013 selecting Yjs 13.6.33, a closed invitation-authorized membership model, capability-gated remote update acceptance and prospective revocation limits. TASK-052 implements a 16 KiB replication-frame cap; its 4-byte header leaves 16,380 bytes for the Yjs update payload. Updated package scripts/lockfile, architecture and later-release documentation. TASK-052 owns authenticated peer synchronization and capability enforcement; TASK-053 owns persistence and snapshot behavior; TASK-054 owns the distributed UI/release demonstration.

# Validation

- `pnpm install --frozen-lockfile` (with `CI=true` for noninteractive generated `node_modules` rebuild) — passed; Yjs 13.6.33 installed and supply-chain policy verified against the lockfile.
- `pnpm --filter @pocketdb/engine-yjs typecheck` — passed.
- `pnpm --filter @pocketdb/engine-yjs test` — passed, 5 tests covering independent offline writes across maps/arrays/text/structured docs, duplicate/out-of-order convergence, same-key convergence, read-only behavior, update bounds, malformed inputs, JSON value copies and lifecycle.
- `pnpm check` — passed formatting, lint and all workspace typechecks.
- `pnpm test` — passed all workspace unit suites, including the 5 new Yjs adapter tests.
- `git diff --check` — passed.

Environment: macOS 27.0.1 arm64, Node v25.8.1, pnpm 11.25.0. This ticket verifies local replica semantics only; it does not claim network, physical-device, persistence or revocation enforcement evidence.
