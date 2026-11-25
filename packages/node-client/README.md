# Node.js WebRTC client

`@pocketdb/node-client` adapts the existing TypeScript client to Node.js with the pure-JavaScript Werift WebRTC implementation. It receives the browser host's completed offer through the configured PocketDB room-signaling endpoint, answers it, authenticates with the invitation's scoped capability and pinned host identity, and returns the shared engine-specific SDK.

This package is private and experimental. Build it before importing its `dist` entry point. Its Vite build bundles PocketDB's TypeScript workspace modules and leaves Werift as the runtime dependency. Registry publication is not configured or approved.

## Runtime and platform evidence

The workspace declares Node `>=24 <27`. TASK-044 validates package build/import on the current macOS arm64 host. Werift is JavaScript and does not require a platform-specific native WebRTC add-on. The earlier TASK-007 probe passed on macOS arm64 with Werift 0.28.0; it did not cover Windows, Linux, Intel macOS or Node 24/26. Those environments remain unverified and are not release support claims.

## Example

The [`remote.mjs` example](examples/remote.mjs) accepts one KV invitation and one PostgreSQL invitation. Each connection uses WebRTC and the configured signaling service; the SQL client then runs a parameterized query. It also demonstrates how to observe host loss and how request timeout errors expose an unknown outcome when an operation has already been sent.

```sh
POCKETDB_SIGNALING_ENDPOINT=https://signal.example/api \
POCKETDB_KV_INVITATION='pocketdb://...' \
POCKETDB_SQL_INVITATION='pocketdb://...' \
node packages/node-client/examples/remote.mjs
```

Set `POCKETDB_ICE_STUN_HOST` and `POCKETDB_ICE_STUN_PORT` to provide a STUN server when the network needs it. Configure TURN separately through Werift's `iceConfig` where relay access is required. The project has not validated a public signaling, STUN or TURN provider or separate-network connectivity; see [ADR-006](../../docs/decisions/ADR-006-signalling-and-nat.md).

The client does not silently reconnect after the browser host disappears. It fails in-flight operations with an unknown outcome, marks later operations as not started, and requires a new invitation and authenticated connection. The remote browser host must remain open. The example's timeout and host-loss behavior is not a delivery or availability guarantee.

Run `pnpm --filter @pocketdb/node-client build`, `pnpm --filter @pocketdb/node-client typecheck`, `pnpm --filter @pocketdb/node-client test` and `pnpm --filter @pocketdb/node-client test:browser` from the repository root. The browser integration starts the actual web app and a disposable loopback signaling server, then connects Werift from Node to the browser's hosted KV and PostgreSQL instances.
