---
id: TASK-056
title: Add the selected SQLite adapter
priority: medium
created: 2026-11-24
depends_on: [TASK-022, TASK-055]
labels: [m6, epic-18, delivery]
---

# Goal

Add the selected SQLite adapter.

# Context

- **Milestone** M6 · Engine expansion
- **Parent epic** EPIC-18. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 31.
- **Decisions** ADR-004, ADR-009, ADR-010, ADR-014, ADR-015
- **Estimated effort** 5 engineer-days.

# Scope

After use-case prioritization and static evidence review, integrate SQLite WASM with browser storage and portable database files.

# Acceptance Criteria

- [x] Contract and browser tests exercise parameterized SQL, transactions, persistence and native file import/export.
- [x] Publish capability and fallback behavior by supported browser.

# Implementation Notes

Added `@pocketdb/engine-sqlite` with worker-owned SQLite WASM 3.54.1, parameterized SQL, serialized transaction ownership, OPFS SAH-pool persistence guarded by an exclusive Web Lock, and explicit memory fallback. Added SQLite engine selection and native `.sqlite` import/export in the browser app. Both native SQLite files and the existing versioned `.pdb` envelope support fresh-destination restore in persistent or memory mode, with a 256 MiB limit. Added SQLite invitation/client routing and read/write capability manifests. Updated ADR-014, ADR-015 and [capability docs](../../docs/capabilities/README.md). Reproduction and browser results: [adapter test artifact](../../artifacts/task-056-sqlite-adapter/README.md).

The tested matrix is Chrome Canary 160.0.8181.0 on macOS 27.0.1 arm64 with a secure context, OPFS and Web Locks, without cross-origin isolation. Stable browser versions, Firefox, Safari and mobile remain uncertified; unsupported OPFS persistence reports an actionable error and `memory://` remains the explicit fallback. Browser/hosting certification remains with TASK-041/TASK-040.

# Validation

Environment: macOS 27.0.1 arm64, Node 25.8.1, pnpm 11.25.0, headless Chrome Canary 160.0.8181.0.

- `pnpm check` — passed (format, lint, and typecheck for all workspace packages).
- `pnpm test` — passed (all workspace unit suites, including SQLite capability and invitation checks).
- `pnpm build` — passed; build emitted existing upstream PGlite `node:module`/direct-eval compatibility warnings.
- `pnpm --filter @pocketdb/engine-sqlite test:browser` — passed parameter binding, commit/rollback, single-owner locking, persistence after worker restart, native OPFS import/export, native file import into memory, versioned snapshot restore, and memory fallback. Browser feature result: `secureContext=true`, `opfs=true`, `webLocks=true`, `crossOriginIsolated=false`. See raw [results](../../artifacts/task-056-sqlite-adapter/results.json).
- `git diff --check` — passed.

Limitations: browser results are one headless Canary version on one Mac, using a local loopback Vite server. No stable cross-browser, mobile, live Pages CDN, quota/eviction, private-browsing, or physical-device certification is claimed.
