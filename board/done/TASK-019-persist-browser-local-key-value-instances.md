---
id: TASK-019
title: Persist browser-local key-value instances
priority: high
created: 2026-11-24
depends_on: [TASK-015, TASK-017]
labels: [m1, epic-08, delivery]
---

# Goal

Persist browser-local key-value instances.

# Context

- **Milestone** M1 · Local database runtime
- **Parent epic** EPIC-08. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 14, 15.
- **Decisions** ADR-009, ADR-010
- **Estimated effort** 4 engineer-days.

# Scope

Add ephemeral and browser-persistent key-value storage and enforce persistent instance ownership.

# Acceptance Criteria

- [x] Browser tests demonstrate reload recovery only for persistent instances and preserve expiry semantics.
- [x] Verify quota errors and prevent unsafe simultaneous access to the same storage from multiple tabs.

# Implementation Notes

Implemented optional IndexedDB-backed key-value instances. `memory://` remains the default; `idb://<name>` opens a per-instance IndexedDB store, holds an exclusive Web Lock, reloads values and absolute expiry timestamps, and commits changed records transactionally before acknowledging commands. Expired records are removed lazily and remain expired while the instance is stopped. Ownership, unavailable-storage and quota failures use structured `key-value-storage-*` errors. Persistent data is browser-managed and may still be evicted or cleared.

Updated the local console to expose the capability-backed persistence selector for key-value, use separate PostgreSQL and key-value storage namespaces, and show storage-specific recovery guidance. Added worker-backed browser coverage and documented the persistence contract in `packages/engine-kv/README.md`, `docs/specs/hosted-runtime.md` and `docs/development.md`. Updated the root browser chain to include the key-value persistence suite.

# Validation

Environment: macOS 27.0.1 arm64, Node v26.13.0, pnpm 11.25.0, Chrome/HeadlessChrome 160.0.8181.0. Commands were run with `/tmp/pocketdb-task013-toolchain/node-v26.13.0-darwin-arm64/bin` prepended to `PATH`.

- `pnpm check` — passed cleanly (format, lint and all workspace typechecks).
- `pnpm test` — passed, 72 tests across runtime, protocol, transport, key-value, PGlite and web packages.
- `pnpm build` — passed. The production key-value worker is emitted separately; existing upstream PGlite `eval` and `node:module` externalization warnings remain.
- `pnpm --filter @pocketdb/engine-kv test:browser` — passed in Chrome Canary 160.0.8181.0. Verified actual page reload recovery, TTL timestamp preservation, expiration while stopped, same-origin owner rejection and release, separate-directory key isolation, and ephemeral reset after termination. A 65,536-byte quota produced `key-value-storage-quota-exceeded` when writing a 1,000,000-byte value.
- `pnpm --filter @pocketdb/web test:browser` — passed; the console exposed key-value IndexedDB controls, wrote and read a key after stop/reopen, and kept the existing keyboard and structured-error flows working.
- `pnpm test:browser` — passed the complete runtime, invitation, WebRTC, key-value persistence, PGlite persistence, and local console browser chain in Chrome/HeadlessChrome 160.0.8181.0.
- `git diff --check` — passed.

Remaining limitation: browser storage eviction, user clearing, and persistence behavior outside the tested Chromium/macOS environment are not covered by this ticket.
