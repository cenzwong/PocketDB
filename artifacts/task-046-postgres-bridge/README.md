# TASK-046: PostgreSQL localhost bridge

## Outcome

Resolved ADR-011 and added a private `pocketdb connect --port N` bridge that translates a bounded PostgreSQL v3 subset into the existing authenticated `@pocketdb/node-client` query and query-description operations. The bridge supports the standard `node-postgres` driver, parameterized text-format queries, result rows, and transaction commands. Its default listener is `127.0.0.1`.

One invitation owns one CLI process, one remote client session, and one local PostgreSQL connection. A second local socket on that bridge is rejected. Separate driver sessions use separate invitations and bridge processes. The host engine serializes active PostgreSQL transactions across sessions; a second invitation receives PostgreSQL error `55006` until the owner finishes its transaction.

`--host` can select a non-loopback interface only with `--allow-remote-bind`. The bridge has no local PostgreSQL password authentication or TLS, so a non-loopback listener grants each reachable client the invitation's full authority. Treat this as trusted-network-only and use a dedicated invitation.

## Validation

- `pnpm --filter @pocketdb/cli test` — passed 8 unit tests, including parsing, default loopback, remote-bind gating, and bridge lifecycle cleanup.
- `pnpm --filter @pocketdb/cli test:browser` — passed on macOS arm64, Node v25.8.1, Chrome 160.0.8181.0, and `node-postgres` 8.23.1.
- Browser acceptance opened two independently invited bridge processes and PostgreSQL clients. Parameterized insert and select passed; a second invitation received `55006` during another session's active transaction, then read the committed row; abruptly closing the first driver rolled its uncommitted insert back.
- The test also retained the existing KV and CLI SQL/export browser checks.

See `results.json` for machine-readable evidence. Run commands from the repository root.

## Unsupported behavior

SSL/TLS, PostgreSQL client authentication, binary parameters/results, COPY, notifications, cancellation, portal suspension/row limits, pooling, exact PostgreSQL server metadata, automatic socket teardown on remote-host loss, and broad PostgreSQL compatibility are not implemented. Read-only invitations remain limited by the host engine's safe SELECT policy. This is not a PostgreSQL server replacement.
