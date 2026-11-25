# Native driver compatibility

## Verified matrix

| Surface | Exact client version | Mode and verified operations | Transaction / parameter coverage | Connection and lifecycle limits |
| --- | --- | --- | --- | --- |
| PostgreSQL bridge | `pg` 8.23.1 (Node.js) | PostgreSQL v3 subset; startup, text results, `CREATE`, `SELECT`, `INSERT` | `$1` parameters; `BEGIN`, `COMMIT`; separate invitation receives SQLSTATE `55006` during another session's active transaction; disconnect rolls back | One local connection per invitation-bound bridge; use a fresh invitation/process per session; loopback default; host tab must stay open; no TLS/auth/pooling/binary formats/COPY/notifications/cancellation/cursors |
| PostgreSQL bridge | `psycopg[binary]` 3.3.9 (Python) | PostgreSQL v3 subset; parameterized `INSERT` and `SELECT` | `%s` parameters; explicit `Connection.transaction()` commit and read-back | One local connection per bridge; context closes the driver connection; no pooling or binary formats; same PostgreSQL limits above |
| RESP bridge | `redis` (Node Redis) 6.4.0 | RESP2; `PING`, `GET`, `SET`, `DEL`, `QUIT`, startup `CLIENT SETINFO`; binary values | Not applicable; `INCR` gets an unsupported-command error | One local socket per invitation-bound process; fresh invitation/process per session; loopback default; no TLS/auth; host loss closes sockets |
| RESP bridge | `redis` (redis-py) 8.2.0 | RESP2 explicitly selected with `protocol=2`; `PING`, `GET`, `SET`, `DEL`; binary values | Not applicable; `INCR` gets an unsupported-command error | One local socket per bridge; client `close()` releases the socket; default RESP3 must be disabled; same RESP limits above |

Versions are pinned by the examples or the private CLI workspace manifest. These
checks demonstrate the named versions and operations only. They do not imply
general PostgreSQL or Redis compatibility. The RESP parser accepts at most
eight bulk-string fields, 4 KiB per field, 8 KiB per frame and 8 KiB buffered
input. It does not implement RESP3, `HELLO`, AUTH, SELECT, transactions,
subscriptions, scripts, expiry options, cluster behavior or general `CLIENT`
commands. The PostgreSQL bridge does not implement server-side cursors, binary
formats, COPY, TLS, local authentication, connection pooling, notifications or
cancellation. See [ADR-011](../decisions/ADR-011-postgresql-localhost-bridge.md)
and [ADR-012](../decisions/ADR-012-resp-localhost-bridge.md).

## M4 integration results

The real browser integration exercises the built workspace CLI against the
browser-owned engine in Chrome. It checks parameterized SQL, commit visibility,
disconnect rollback, Redis binary round-trip, an unsupported command response,
one-connection-per-invitation behavior, credential redaction and host-loss
cleanup. Node evidence is recorded in the TASK-046, TASK-047 and TASK-048
artifacts. Python evidence is generated at
`test-results/task-049-python-drivers/results.json` by:

```sh
POCKETDB_PYTHON=/path/to/python-with-pinned-drivers \
  pnpm --filter @pocketdb/cli test:python:browser
```

The CLI package is private and unpublished under ADR-016; no public package
release or hosted production deployment is claimed.
