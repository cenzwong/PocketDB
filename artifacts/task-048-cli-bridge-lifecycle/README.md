# TASK-048: Native bridge CLI lifecycle

## Outcome

The private `pocketdb` CLI starts PostgreSQL by default and RESP2 with `--protocol resp`. Both protocols share invitation loading, signaling configuration, loopback binding, explicit remote-bind opt-in, JSON startup output and redacted errors. Startup reports the selected protocol, host, port and engine without printing the invitation.

The bridge returns stable process outcomes: success and Ctrl-C use exit 0; an occupied port or bind permission failure uses exit 2; connection failure or remote browser-host loss uses exit 4. A host-loss event closes the local driver socket, stops the listener, closes the remote client and exits the bridge process. The lifecycle applies to both PostgreSQL and RESP bridges.

Usage examples for `node-postgres` and Node Redis 6.4.0 are in the CLI README. The Redis example explicitly configures RESP2. Non-loopback binding remains opt-in and does not add local password authentication or TLS; reachable clients receive the invitation's authority.

## Validation

- `pnpm --filter @pocketdb/cli test` — passed 11 unit tests, including stable conflict/remote-loss exit-code checks.
- `pnpm --filter @pocketdb/cli test:browser` — passed on macOS arm64, Node v25.8.1 and Chrome 160.0.8181.0.
- PostgreSQL: occupied port returned exit 2; SIGINT returned exit 0 and released the port; remote host loss closed the PostgreSQL socket, released the port and exited 4.
- RESP2: occupied port returned exit 2; SIGINT returned exit 0 and released the port; host loss closed three independent Redis sockets, released all ports and each process exited 4.
- Bridge child stdout/stderr were checked against each invitation; no invitation was exposed.
- `pnpm check` — passed repository format, lint and typechecks.
- `git diff --check` — passed.

See `results.json` for machine-readable lifecycle evidence.
