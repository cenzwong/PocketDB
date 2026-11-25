# ADR-012: RESP2 localhost bridge subset

- Status: accepted
- Date: 2026-11-24

## Context

TASK-009 measured a bounded RESP2 adapter with Node Redis against a browser-owned fixture. TASK-047 needs the same behavior against the real key-value engine through the shared authenticated client, with explicit session, credential and host-loss boundaries.

## Decision

Implement a small RESP2 parser and translator in the private CLI. Route supported operations through `@pocketdb/node-client`'s key-value methods; do not add a second transport or access the host engine directly. Accept one local Redis socket per invitation-bound bridge process. Separate sessions use separate invitations and bridge processes. Bind to `127.0.0.1` by default; non-loopback hosts require explicit `--allow-remote-bind`.

Support `PING` (and its optional echo value), `GET`, `SET`, `DEL`, `QUIT`, and the measured `CLIENT SETINFO LIB-NAME` / `LIB-VER` startup acknowledgements. Return RESP2 errors for unsupported commands and invalid arity. Keys are valid UTF-8 strings to match the shared KV contract; values remain binary-safe. Close the local socket and stop accepting connections when the remote client fails or closes.

The invitation, not Redis AUTH, authorizes the remote session. The bridge has no local password authentication or TLS. Non-loopback binding exposes that invitation's full authority to every reachable client and is trusted-network-only.

## Supported subset and boundaries

Verified with Node Redis 6.4.0 in RESP2 mode against Chrome 160: CLIENT SETINFO startup, PING, binary-valued SET/GET, missing-key null, unsupported INCR error, separate invitation-bound sessions, invitation redaction, and local socket closure after browser-host loss. redis-py 8.2.0 is also verified against Chrome 160 when explicitly configured with `protocol=2`, including PING, binary-valued SET/GET, DEL, unsupported INCR, and client socket cleanup. Parser checks cover fragmented/coalesced commands, invalid terminators and configured frame limits.

The parser limits a command to eight bulk-string fields, 4 KiB per field, 8 KiB per frame and 8 KiB buffered input. RESP3/HELLO, AUTH, SELECT, Redis transactions, subscriptions, scripting, key expiry options, cursor operations, cluster redirection, broad CLIENT commands, ioredis and redis-cli are not verified or claimed. There is no multi-client multiplexing within a bridge process.

## Alternatives considered

- Forward raw RESP through the browser worker: it would bypass the public authenticated KV client and couple the host app to Redis framing.
- Implement the full Redis protocol: it expands command semantics, persistence and compatibility beyond the verified integration target.
- Add server-side Redis credentials: this duplicates the invitation authorization mechanism and would not protect a non-loopback bridge without TLS.

## Consequences

- The bridge inherits the shared client's invitation authorization, remote failure state, engine validation and binary value contract.
- Separate local driver sessions require separate invitations and CLI processes. They share browser-hosted key-value data through the engine instance.
- The implementation remains a private CLI capability under ADR-016; wider client support needs its own driver matrix and evidence.

## Validation evidence

- `pnpm --filter @pocketdb/cli test` — passed RESP framing and CLI lifecycle tests.
- `pnpm --filter @pocketdb/cli test:browser` — passed with Node Redis 6.4.0 and Chrome 160; see [TASK-047 results](../../artifacts/task-047-resp-bridge/results.json).
- `POCKETDB_PYTHON=/path/to/pinned/python pnpm --filter @pocketdb/cli test:python:browser` — passed with redis-py 8.2.0 in RESP2 mode and Chrome 160; see [TASK-049 results](../../artifacts/task-049-python-drivers/results.json).

## Reversibility

The RESP adapter is contained in the CLI package and does not change the KV SDK. Its command subset can be expanded or replaced without changing the browser SDK contract. Changing invitation authorization or allowing shared local sockets requires a new security and session review.
