# Browser TypeScript client reference

`@pocketdb/client` is the typed browser client package. It is currently a
workspace package and is not published to a package registry. The caller
provides the authenticated peer connector; the SDK does not choose a signaling
provider or authenticate a peer on its own.

## Connect and operate

```ts
import { connect } from "@pocketdb/client";

const db = await connect(invitationUri, {
  connectPeer: authenticatedConnector,
  connectTimeoutMs: 15_000,
  requestTimeoutMs: 30_000,
});

if (db.engineId === "postgresql") {
  const result = await db.query(
    "SELECT id, name FROM users WHERE id = $1",
    [42],
  );
  console.log(result.rows);
} else {
  await db.kv.set("name", "Alice");
  const value = await db.kv.get("name");
  console.log(value && new TextDecoder().decode(value));
}

await db.close();
```

Use `db.engineId` to narrow the API. PostgreSQL exposes `query`; key-value
clients expose `kv`. Values returned by key-value reads are `Uint8Array` or
`null`. SQL parameters support the protocol's typed values, including binary
data. Inspect `db.capabilities` after connection for the authenticated engine,
permission scope, allowed operations, per-operation JSON Schemas and feature
flags. The capability manifest has its own version; reject an unsupported
manifest version.

PostgreSQL clients also expose structured schema discovery:

```ts
const columns = await db.schema({ schema: "public", table: "users" });
const shape = await db.describeQuery(
  "SELECT id, name FROM users WHERE id = $1",
);
```

`schema()` reports column names, PostgreSQL type names, nullability and
defaults. `describeQuery()` returns parameter and result-field PostgreSQL type
OIDs. OIDs are not a complete cross-version type registry.

## Connection contract

`connect(uri, options)` validates the invitation, invokes `connectPeer` to
establish a transport and complete peer authentication, negotiates protocol v1,
opens a scoped session, and returns a connected client. `connectPeer` must
return only after transport and authentication succeed. Relevant options:

- `connectTimeoutMs`: total setup deadline; default is 15 seconds.
- `requestTimeoutMs`: default request deadline; default is 30 seconds.
- `connectRetry.maxAttempts`: setup attempts; default is three with bounded
  backoff. Set it to one to disable retry.
- Request options can override `timeoutMs` or supply an `AbortSignal`. An abort
  stops waiting but does not guarantee cancellation after host dispatch.
- `onStateChange(listener)`: observe connection-state changes; returns an
  unsubscribe function.
- `close()`: close the session and transport; safe to call repeatedly.

The client does not automatically retry mutations. A timeout after dispatch
can have outcome `unknown`. A disconnected established session is terminal;
ask the host for a fresh invitation and authenticate again.

## Errors and operation outcomes

`PocketDBClientError` exposes a stable `code`, `retryable`, and `outcome`:

| Outcome | Meaning |
| --- | --- |
| --- | --- |
| `not-started` | Local validation, permission, unsupported operation, or rejection before engine dispatch. |
| `failed` | The host completed the operation and returned an engine failure. |
| `unknown` | The request may have been applied, but the reply was lost, timed out, or could not be encoded. Do not retry a mutation blindly. |

## Executable examples and implementation details

The package's complete example is [`packages/client/example/main.ts`](../../packages/client/example/main.ts).
It exercises both engines, binary round-trips, SQL parameter fidelity,
structured SQL errors and client close. CI runs it through
`pnpm --filter @pocketdb/client test:browser` with an in-process authenticated
fixture. That test verifies SDK behavior; it does not prove signaling-provider
interoperability or physical-device connectivity.

The implementation and all exported option and result types are in
[`packages/client/src/client.ts`](../../packages/client/src/client.ts). The
[browser protocol specification](../specs/protocol-v1.md),
[remote access specification](../specs/remote-access.md),
[machine-readable capability schema and examples](../capabilities/README.md),
[ADR-007](../decisions/ADR-007-protocol-encoding.md) and
[ADR-008](../decisions/ADR-008-capability-authentication.md) define the wire,
authentication and access boundaries.
