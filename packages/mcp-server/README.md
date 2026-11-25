# PocketDB MCP server

`@pocketdb/mcp-server` provides a local Model Context Protocol server over stdio. It connects to a browser-hosted PocketDB instance through the Node SDK and forwards operations under the access granted by the host-issued invitation.

## Run

Build the repository, then configure your MCP client to launch `pocketdb-mcp` (or `node /absolute/path/to/packages/mcp-server/dist/stdio.js`) from this checkout. The process uses stdio for MCP messages; stdout is reserved for the protocol and diagnostics go to stderr.

Start a PocketDB engine in the web app first. Create an invitation with the intended access level and provide its invitation URI plus the signaling endpoint to `pocketdb_connect`. The MCP process does not provision engines, issue invitations, or host a signaling service.

## Tools

- `pocketdb_connect`: accept a host-issued invitation and return an opaque process-local connection ID, engine, access level and negotiated capability manifest.
- `pocketdb_connections`: list active connection metadata.
- `pocketdb_inspect`: return capabilities and, for SQL engines, authorized schema information.
- `pocketdb_query`: send a SQL query through the SDK. Bigint results use decimal strings in both structured and text output.
- `pocketdb_key_value`: issue PING, GET, SET or DEL through the SDK. Binary GET results are base64 encoded.
- `pocketdb_export_query_csv`: export at most 10,000 rows from a single SELECT, with a read-only invitation and a bounded row count.
- `pocketdb_disconnect`: close one connection.

The SDK authenticates the invitation and enforces its negotiated operation capabilities. Tool errors return structured `{ ok: false, error: { code, message } }` results; successful calls return `{ ok: true, data }`. A server-side denial remains an error result and does not grant an operation.

## Credential handling and boundaries

Invitation URIs and signaling endpoints are tool inputs. The server does not return them, include them in connection listings, or print them to stdout. Error messages redact PocketDB invitation URIs and HTTP(S) URLs. MCP clients and their own logs still receive tool arguments, so treat the invitation as a bearer credential and configure the MCP client accordingly.

The stdio process has the same local-user trust boundary as its MCP host. This package does not provide an HTTP MCP endpoint or cross-user authorization. A connection exists only in process memory and ends when disconnected or when the process exits.

See [the MCP guide](../../docs/guides/mcp.md) for setup and limitations.

An executable agent client example is in [`examples/agent.mjs`](examples/agent.mjs).
