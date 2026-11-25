# Browser TypeScript client SDK

`@pocketdb/client` parses a PocketDB invitation, negotiates protocol v1, checks the invited engine's advertised capabilities, opens one scoped session, and exposes a typed engine-specific API. It imports only the protocol and transport packages; it does not import the web application.

The caller injects `connectPeer`. That function must establish the configured transport and complete peer authentication before returning it. This keeps signaling provider selection and authentication transport details replaceable. The SDK rejects malformed, expired or mismatched invitations before connecting. It does not treat a room ID or invitation URL alone as proof that the peer is authenticated.

```ts
import { connect } from "@pocketdb/client";
import { createWebRTCConnector } from "your-pocketdb-connection-provider";

const db = await connect(invitationUri, {
  connectPeer: createWebRTCConnector({ signalingEndpoint }),
  connectTimeoutMs: 15_000,
  requestTimeoutMs: 30_000,
});

if (db.engineId === "postgresql") {
  const result = await db.query(
    "SELECT id, name FROM users WHERE id = $1",
    [42],
  );
  console.log(result);
} else {
  await db.kv.set("name", "Alice");
  const name = await db.kv.get("name");
  console.log(name && new TextDecoder().decode(name));
}

await db.close();
```

SQL parameter values use the protocol's typed value set, including binary values. The key-value API stores strings or binary values and returns `Uint8Array` data without text conversion. Use `capabilities` to inspect the negotiated operations and engine features. The returned client is discriminated by `engineId`; PostgreSQL clients expose `query`, while key-value clients expose `kv` commands.

The capability manifest is versioned and scoped to the authenticated engine and invitation access. It includes JSON Schemas for allowed operations. PostgreSQL clients also expose `schema()` and `describeQuery()` for structured column, parameter and result-field metadata. See the [client reference](../../docs/guides/client-sdk.md), [manifest schema and examples](../../docs/capabilities/README.md), and [protocol specification](../../docs/specs/protocol-v1.md).

`PocketDBClientError` carries a stable `code`, `retryable` flag and execution `outcome` where available. A local validation or unsupported-operation error is `not-started`. A remote engine error is `failed`. A timeout after a request has been sent is `unknown`; the client never automatically retries an operation. Initial transport setup defaults to three attempts with bounded exponential delay, inside the overall `connectTimeoutMs` deadline. Set `connectRetry.maxAttempts` to one to disable retries. Each attempt calls the injected connector again, so signaling and peer authentication run afresh; non-transient authentication failures are not retried.

The client exposes state changes through optional `onStateChange`. If an established transport drops, the client enters `failed`, rejects in-flight operations with unknown outcomes, and marks later operations `not-started`. It does not silently restore that session. The host revokes the one-peer invitation when the connection ends; ask the host for a fresh invitation and call `connect()` again to authenticate a new session. `connectTimeoutMs` bounds transport setup and protocol/session negotiation. Per-request `timeoutMs` overrides `requestTimeoutMs`; an `AbortSignal` can stop waiting, but does not promise cancellation of work already dispatched to the host. `close()` closes the engine session, sends a disconnect notice and releases the transport; repeated close calls are safe.

The executable [browser example](example/) runs both the real key-value and PGlite engine APIs, checks binary and parameter fidelity, verifies a structured SQL failure, and closes both clients. Its connector uses an in-process pair and a test-only preauthenticated host fixture; it validates SDK and engine integration, not WebRTC signaling or peer-authentication interoperability. See the [recorded browser result](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-031-client-sdk/README.md). Physical-device acceptance remains a release gate.

Run `pnpm --filter @pocketdb/client typecheck`, `pnpm --filter @pocketdb/client test`, and `pnpm --filter @pocketdb/client test:browser` from the repository root. The browser example launches Chrome Canary.
