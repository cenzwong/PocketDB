---
id: TASK-046
title: Deliver the PostgreSQL localhost bridge
priority: high
created: 2026-11-24
depends_on: [TASK-044]
labels: [m4, epic-14, delivery]
---

# Goal

Deliver the PostgreSQL localhost bridge.

# Context

- **Milestone** M4 · Native ecosystem integration
- **Parent epic** EPIC-14. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 17.
- **Decisions** ADR-011, ADR-016
- **Estimated effort** 6 engineer-days.

# Scope

Resolve ADR-011 and implement the approved startup, query and session protocol subset through the shared client path.

# Acceptance Criteria

- [x] A named standard PostgreSQL driver performs parameterized queries and a transaction against the remote browser; independent local connections remain isolated.
- [x] Verify default loopback binding, explicit non-local configuration, disconnect cleanup and documented unsupported features.

# Implementation Notes

Implemented `pocketdb connect --port N` as a PostgreSQL v3 subset backed by the shared authenticated `@pocketdb/node-client`. Added startup and simple/extended text-query handling, parameter and row descriptions, transaction status, SQLSTATE error responses, single-driver enforcement, disconnect rollback, default loopback binding, and explicit `--host ... --allow-remote-bind` configuration. Added `pg@8.23.1` as a CLI development dependency for the named-driver acceptance.

Resolved ADR-011 in [ADR-011](../../docs/decisions/ADR-011-postgresql-localhost-bridge.md). Updated [the decision index](../../docs/decisions/README.md), [ADR backlog](../../project/ADR_BACKLOG.md), and [CLI documentation](../../packages/cli/README.md). Added browser acceptance and unit coverage in `packages/cli/test/browser.mjs` and `packages/cli/test/cli.test.mjs`. Evidence: [report](../../artifacts/task-046-postgres-bridge/README.md) and [results](../../artifacts/task-046-postgres-bridge/results.json).

Scope limitation: each invitation supports one local driver socket; separate sessions use separate invitations and bridge processes. The host currently serializes active PGlite transactions across sessions and responds with PostgreSQL `55006` to another session until the transaction finishes. No authentication or TLS is provided locally; remote binding exposes invitation authority to reachable clients. Unsupported PostgreSQL features are documented in ADR-011 and the CLI README.

# Validation

Passed on macOS arm64 with Node v25.8.1, Chrome 160.0.8181.0, and `node-postgres` 8.23.1:

- `pnpm check` — passed Biome format, lint, and repository typechecks.
- `pnpm --filter @pocketdb/cli test` — passed all 8 unit tests.
- `pnpm --filter @pocketdb/cli test:browser` — passed browser-backed CLI tests and PostgreSQL bridge acceptance. Two separate invitation-bound bridge processes completed parameterized queries and transactions. The second session received `55006` while the first held an active transaction, then observed the committed row. Closing the first driver socket rolled back its uncommitted row. Actual listener metadata confirmed the default `127.0.0.1` bind; unit checks cover explicit non-loopback opt-in and reject missing `--allow-remote-bind`.
- `git diff --check` — passed.

Remaining compatibility gaps are deliberate and listed in ADR-011. This ticket does not claim full PostgreSQL compatibility, local password authentication, TLS, or automatic socket teardown when the browser host disappears.
