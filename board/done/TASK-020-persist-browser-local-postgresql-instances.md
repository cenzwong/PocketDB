---
id: TASK-020
title: Persist browser-local PostgreSQL instances
priority: high
created: 2026-11-24
depends_on: [TASK-015, TASK-018]
labels: [m1, epic-08, delivery]
---

# Goal

Persist browser-local PostgreSQL instances.

# Context

- **Milestone** M1 · Local database runtime
- **Parent epic** EPIC-08. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 14, 15.
- **Decisions** ADR-009, ADR-010
- **Estimated effort** 4 engineer-days.

# Scope

Integrate the validated PGlite persistence mechanism with worker lifecycle and per-instance storage ownership.

# Acceptance Criteria

- [x] Test persistent reopen, ephemeral termination and instance separation on the selected browsers.
- [x] Verify quota or unavailable-storage errors and prevent unsafe concurrent tab ownership.

# Implementation Notes

Implemented IndexedDB-backed PGlite startup for explicit `idb://<name>` directories. The worker holds an exclusive Web Lock for the database lifetime, refuses another cooperative worker or tab with `postgres-storage-already-owned`, and releases ownership after clean database close. Storage failures are surfaced as `postgres-storage-unavailable` or `postgres-storage-quota-exceeded` through worker startup and operation boundaries. The default remains ephemeral `memory://`; separate directories isolate instances. Updated the [PGlite adapter guide](../../packages/engine-pglite/README.md), [hosted runtime spec](../../docs/specs/hosted-runtime.md), and [ADR-009](../../docs/decisions/ADR-009-browser-persistence.md). Browser persistence remains subject to eviction and user clearing; Web Lock ownership is cooperative and does not protect against another writer that bypasses this adapter.

# Validation

Environment: macOS 27.0 arm64, Node.js 25.8.1, pnpm 11.25.0.

- `pnpm check` — passed (Biome format/lint and all workspace TypeScript checks).
- `pnpm test` — passed (71 tests across runtime, protocol, transport, key-value, PGlite and web packages).
- `pnpm build` — passed (Vite production bundle).
- `pnpm test:browser` — passed the complete runtime, invitations, WebRTC transport and PGlite browser chain in Chrome Canary 160.0.8181.0. The PGlite matrix verified cross-tab lock rejection and release, persistent close/reopen, separate IndexedDB directory isolation, memory-mode reset after termination, and quota error mapping under a 65,536-byte origin quota.
- `pnpm --filter @pocketdb/engine-pglite test:browser` — passed in Chrome Canary 160.0.8181.0 and Edge 116.0.1938.62. Both runs covered the PGlite worker contract, cross-tab ownership, persistence, ephemeral reset, instance separation and 65,536-byte quota error mapping. Edge 116 is legacy feasibility evidence and does not establish current-version support.

The unit suite also verifies unavailable IndexedDB/Web Locks returns `postgres-storage-unavailable`. Browser persistence was not tested in Safari, Firefox, mobile browsers, private contexts or a current stable Edge release. Browser eviction and non-cooperating storage writers remain outside this validation.
