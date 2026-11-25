# ADR-011: PostgreSQL localhost bridge subset

- Status: accepted
- Date: 2026-11-24

## Context

TASK-008 proved that `node-postgres` can speak PostgreSQL v3 to a raw wire relay, but that relay bypassed the shared authenticated SDK by forwarding PostgreSQL frames to PGlite's internal protocol API. TASK-046 requires SQL to use the existing invitation-bound `@pocketdb/node-client` path. The bridge therefore has to translate a bounded PostgreSQL frontend subset into shared-client `describeQuery` and `query` operations.

## Decision

Keep PostgreSQL startup and TCP framing in the local CLI. After startup, translate simple Query messages and text-format extended Parse, Bind, Describe, Execute, Sync, Close, Flush and Terminate messages into SDK operations. Use the client's query description and result metadata for PostgreSQL parameter and row descriptions. Preserve the client's SQL authorization and invitation scope; do not open a second remote transport or use PGlite's raw protocol API.

One `pocketdb connect --port N` process owns one invitation-bound remote client and accepts one local PostgreSQL driver connection. A second local socket is rejected. Independent database sessions use separate invitations and bridge processes. The default bind is `127.0.0.1`; a non-loopback host requires both `--host` and `--allow-remote-bind`.

Driver startup username/database fields are informational and are not credentials. No local password authentication or TLS is provided. A non-loopback bind exposes the full invitation capability to any network client that can reach the port, so it must only be used on a deliberately trusted network.

## Supported subset and boundaries

Verified with `node-postgres` 8.23.1 and Psycopg 3.3.9 against a Chrome 160 browser host: protocol v3 startup; text-format parameterized SQL; result rows; transaction commands; ReadyForQuery transaction state; a second invitation receiving `55006` while another session owns a transaction; and rollback after the driver socket closes with an open transaction. The Psycopg run also verifies `%s` parameters, explicit transaction commit and connection-context cleanup.

SSL negotiation is declined. Binary parameters/results, COPY, notifications, cancellation, server-side cursors/portal row limits, authentication, TLS, multi-driver pooling, and exact emulation of PostgreSQL server metadata are unsupported. Read-only invitations remain restricted by the engine's safe SELECT policy. Host-loss cleanup closes the local socket and bridge listener with CLI exit code 4.

## Alternatives considered

- Forward PostgreSQL frames to PGlite raw protocol: already demonstrated in TASK-008, but bypasses the shared client path and its capability authorization.
- Implement a complete PostgreSQL server: substantially larger compatibility and security scope than the accepted native integration.
- Use a different wire protocol: would not let standard PostgreSQL drivers connect directly.

## Consequences

- The bridge inherits SDK authentication, invitation revocation, query permissions, and transport behavior.
- Each bridge uses a separate remote session; PGlite currently serializes active transactions across sessions and reports `55006` to another session until the transaction finishes.
- The bridge remains a private CLI feature under ADR-016. Package publication and broader protocol compatibility require separate release evidence.

## Validation evidence

- `pnpm --filter @pocketdb/cli test` — passed unit and lifecycle checks.
- `pnpm --filter @pocketdb/cli test:browser` — passed with Chrome 160 and `node-postgres` 8.23.1; see [TASK-046 results](../../artifacts/task-046-postgres-bridge/results.json).
- `POCKETDB_PYTHON=/path/to/pinned/python pnpm --filter @pocketdb/cli test:python:browser` — passed with Psycopg 3.3.9 and Chrome 160; see [TASK-049 results](../../artifacts/task-049-python-drivers/results.json).

## Reversibility

The feature is isolated in the CLI package. Its local protocol subset can be extended or replaced without changing the shared SDK contract. Changing the authentication or session boundary requires a new security and compatibility review.
