---
id: TASK-029
title: Enforce engine permissions before execution
priority: critical
created: 2026-11-24
depends_on: [TASK-018, TASK-028]
labels: [m2, epic-05, delivery]
---

# Goal

Enforce engine permissions before execution.

# Context

- **Milestone** M2 · Peer-to-peer database access
- **Parent epic** EPIC-05. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 13.
- **Decisions** ADR-004, ADR-008
- **Estimated effort** 4 engineer-days.

# Scope

Enforce owner, read-write and read-only access in the dispatcher and adapters using the approved SQL restrictions.

# Acceptance Criteria

- [x] Automated tests verify read-only key-value and SQL reads and block writes, including SQL cases identified by the session spike.
- [x] Require fail-closed behavior when engine controls are unavailable. Publish an enforced permission matrix.

# Implementation Notes

- Added required `SessionAccess` to runtime session contexts and immutable engine sessions. Runtime dispatch stores the access level independently, rejects missing or invalid scope, denies read-only operations before engine execution unless capabilities explicitly list them, and rejects adapters that fail to preserve the scope.
- Added `assertEngineOperationPermission` and read-only capability metadata. The key-value adapter enforces an explicit read-only command allowlist. PGlite permits read-only `query`, `schema` and `describe-query`, then restricts SQL reads to a single safe parameterized `SELECT` subset and runs them in a PostgreSQL read-only transaction. Arbitrary SQL, DML, DDL, CTEs, functions, comments, multiple statements and transaction control are denied.
- Added tests for required scope, `owner`/`read-write` execution, read-only KV reads and writes, missing adapter support, bounded PostgreSQL reads and the SQL cases from TASK-006.
- Local console and worker harnesses now explicitly open trusted sessions as `owner`.
- Published the permission matrix in `docs/specs/hosted-runtime.md`; updated `packages/runtime/README.md` and ADR-008.
- Limitation: `owner` is a trusted local scope. Remote invitation scopes remain `read-only` and `read-write`; authenticated remote request routing is TASK-030.

# Validation

- Environment: macOS 27.0.1 arm64, Node v26.13.0, pnpm 11.25.0.
- `pnpm check` — passed (format, lint and all workspace typechecks).
- `pnpm test` — passed, 87 tests across the workspace.
- `pnpm build` — passed; existing PGlite bundler warnings note upstream `eval` usage and externalized `node:module`.
- `pnpm test:browser` — passed on Chrome Canary 160.0.8181.0. Worker runtime, invitation/authentication, WebRTC transport, KV persistence, PostgreSQL execution and persistence, and local console probes passed. The command required local-listener access for 127.0.0.1.
- Browser checks are development-preview evidence; stable-browser support and physical two-device acceptance remain in their separate release tickets.
