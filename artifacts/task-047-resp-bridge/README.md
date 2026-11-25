# TASK-047: RESP2 localhost bridge

## Outcome

Resolved ADR-012 and added `pocketdb connect --protocol resp --port N`. The private CLI runs a bounded RESP2 adapter backed by the existing authenticated `@pocketdb/node-client` key-value methods. It supports `PING` (including an optional local echo), `GET`, `SET`, `DEL`, `QUIT`, and Node Redis's measured `CLIENT SETINFO LIB-NAME` / `LIB-VER` startup acknowledgements. Unsupported commands return a RESP2 `ERR` response.

The bridge defaults to `127.0.0.1`. Each invitation-bound process accepts one local Redis socket; separate sessions require separate invitations and processes. The authenticated sessions share the browser instance's key-value data. When the remote client fails or closes, the bridge returns an unavailable error, closes its local socket and stops accepting connections. The bridge never prints the invitation.

Keys must be valid UTF-8 strings to match the shared KV contract. Values remain binary-safe. RESP2 frames are limited to 8 bulk-string elements, 4 KiB per element and 8 KiB per frame/receive buffer. Non-loopback binds require both `--host` and `--allow-remote-bind`. The bridge has no local AUTH or TLS, so any reachable client on a non-loopback listener gets the invitation's full authority.

## Validation

- `pnpm --filter @pocketdb/cli test` — passed 10 tests, including fragmented/coalesced RESP framing and malformed/oversized input.
- `pnpm --filter @pocketdb/cli typecheck` — passed Node syntax checks.
- `pnpm --filter @pocketdb/cli test:browser` — passed on macOS arm64, Node v25.8.1, Chrome 160.0.8181.0 and Node Redis 6.4.0 in RESP2 mode.
- The browser run used three independent invitations and bridge processes. It passed PING, binary SET/GET, missing-key null, unsupported INCR error, invitation redaction, and closed all local Redis sockets after stopping the browser host.
- `pnpm check` — passed repository formatting, lint and typechecks after the bridge changes.
- `git diff --check` — passed.

See `results.json` for the machine-readable driver evidence. Run commands from the repository root.

## Unsupported behavior

RESP3/HELLO, AUTH, SELECT, Redis transactions, subscriptions, scripting, expiry options, cluster redirection and broad CLIENT commands are unsupported. Redis clients other than Node Redis 6.4.0 are not validated. This is not a full Redis-compatible server.
