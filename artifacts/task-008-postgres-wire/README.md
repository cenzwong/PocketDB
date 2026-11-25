# Remote PostgreSQL wire forwarding spike

A node-postgres client opens a TCP connection to a loopback bridge. The bridge handles version 3 startup locally, splits frontend frames and forwards them in order over a WebRTC data channel. A dedicated browser worker owns PGlite and runs the bounded frames via `execProtocolRaw`. The bridge returns the raw backend replies. Independent inspection through the browser worker confirms the transaction outcomes.

## Reproduce

From this directory, with Node and Chrome Canary installed:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs
```

Set `POCKETDB_CHROMIUM` to use a different Chromium executable. The driver uses a temporary browser profile, static preview and ephemeral loopback ports.

## Results

On macOS arm64 with Node v25.8.1, node-postgres 8.23.1, Chrome Canary 160.0.8180.0 and PGlite 0.6.0:

- The driver completed protocol v3 startup. The bridge generated AuthenticationOk, a UTF-8 ParameterStatus and ReadyForQuery for this trusted fixture.
- A parameter containing an apostrophe survived Parse, Bind, Describe, Execute and Sync and returned intact.
- The browser worker retained the committed row and omitted the explicitly rolled-back row and the uncommitted row left by client termination. The bridge issued a cleanup rollback after the driver disconnected.
- The bridge closed a separate CancelRequest connection without forwarding it. The primary connection still executed a subsequent query. Cancellation of an executing query remains unsupported by this fixture.

See the [raw trace](results.json).

## Boundaries and next scope

| Boundary | Evidence and consequence |
| --- | --- |
| Local startup with remote wire frames | Measured. Keeps TCP framing and startup negotiation on the local side, and preserves driver parameter encoding on the wire. The browser Worker owns the database. |
| Forward startup to a browser gateway | Candidate. Would centralize authentication parameters and per-client session semantics, but needs a gateway that handles startup and isolation. The raw PGlite API consumes wire messages and bypasses its higher-level protocol wrappers. End-to-end gateway startup was outside the measured fixture. |
| Translate driver traffic into high-level remote SQL | Candidate. Easier to authorize individual operations, but must reproduce Parse, Bind, portal and error behavior. That path was not measured. |

Only one driver connection, one local user, small frames and a basic query/transaction subset were exercised. The fixture deliberately accepts trusted loopback startup without SQL authentication. It does not supply TLS, multiple client sessions, COPY, notifications, binary result coverage, pooling, actual cancellation or immediate idle-socket teardown on remote peer loss. The next request after remote loss fails. The bridge avoids sending Terminate into the shared engine so it can explicitly roll back the released session.

Advance the split boundary into ADR-007 and ADR-011 review with one driver per verified session, local-only binding and explicit remote authentication. Keep cancellation and broader driver compatibility outside the demonstrated native scope. Supported native packages and production lifecycle need separate acceptance. See [PostgreSQL protocol flow](https://www.postgresql.org/docs/current/protocol-flow.html), [PGlite raw protocol notes](https://pglite.dev/docs/api) and the [PGlite Socket design](https://pglite.dev/docs/pglite-socket).
