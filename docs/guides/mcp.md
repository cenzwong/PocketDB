# PocketDB through MCP

PocketDB's MCP server exposes an already-running, invitation-authorized database to a local MCP client. It is a protocol adapter over the PocketDB Node SDK; it does not create or host a database.

## Setup

1. Start a database engine in the PocketDB web app.
2. Set the signaling endpoint and create an invitation with the required access. Prefer read-only access for inspection and query-only workflows.
3. Build this checkout with `pnpm --filter @pocketdb/mcp-server build`.
4. Configure the MCP client to launch `node /absolute/path/to/PocketDB/packages/mcp-server/dist/stdio.js` from a trusted local environment.
5. Call `pocketdb_connect` with the invitation URI and signaling endpoint. Use the returned connection ID for subsequent tool calls.

The executable [agent example](../../packages/mcp-server/examples/agent.mjs) connects over stdio, inspects the returned capabilities, runs KV PING or SQL `SELECT 1` according to the engine, prints only the structured result, and disconnects. After building, run it with credentials supplied through the environment:

```sh
POCKETDB_INVITATION='pocketdb://…' \
POCKETDB_SIGNALING_ENDPOINT='https://your-signaling-service.example/api' \
node packages/mcp-server/examples/agent.mjs
```

The MCP server process is launched by the example. The browser host and signaling service must already be running. Use a least-privilege invitation; the SQL example only runs a read query, while KV PING requires the host to allow PING.

The MCP transport uses stdio. The MCP client should launch one server process for the intended user/session; connection IDs are process-local and not persistent.

## Available operations

The server offers connection listing, capability/schema inspection, SQL queries, key-value PING/GET/SET/DEL, bounded CSV export, and disconnect. The engine type determines which operation family applies. CSV export accepts one SELECT statement without a caller-supplied LIMIT and requires a read-only invitation; it applies its own maximum row count (10,000).

Every database request is delegated to the existing SDK. The invitation's authenticated capability manifest and the SDK's operation checks decide whether a read or write is allowed. The MCP adapter does not elevate an invitation. An unsupported operation or authorization error is returned as a structured MCP tool error.

## Credentials, errors, and provisioning

The invitation URI is a bearer credential and is passed to the MCP tool as an input. The server does not return it or write it to stdout; diagnostics use stderr. Error formatting redacts PocketDB invitation URIs and HTTP(S) URLs. MCP hosts may log tool arguments independently, so follow the host's credential-storage and logging controls.

Create and revoke invitations in the PocketDB host UI. Start and keep the engine and signaling endpoint available while connected. The MCP package has no provisioning API, signaling service, durable connection store, or remote HTTP MCP transport. Disconnecting closes the peer; stopping the host also ends availability.

The example runs from this private workspace checkout; no package release is configured. The repository Node support range is `>=24 <27`. Browser evidence is limited to the tested Chrome 160.0.8181.0 development environment, not a stable browser support claim. Common structured errors include invalid or expired invitations, connection timeouts, disconnected hosts, unsupported engine operations, permission denials, and invalid export queries; callers should inspect the error code and avoid retrying authorization failures unchanged.

## Validation boundary

The browser-backed integration test exercises a real local PocketDB web host and signaling endpoint through the MCP client/server pair. It proves the tested browser and engine path only; it does not establish internet ICE traversal, TURN availability, production deployment, or a supported browser matrix.
