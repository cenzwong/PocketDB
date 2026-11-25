# Browser TypeScript client SDK evidence

## Reproduce

From the repository root:

```sh
pnpm --filter @pocketdb/client typecheck
pnpm --filter @pocketdb/client test
pnpm --filter @pocketdb/client test:browser
```

The unit suite covers invitation/target validation, connection and protocol negotiation deadlines, late transport cleanup, typed key-value values, close behavior and request timeout outcomes. The browser example imports `@pocketdb/client` by its workspace package name, connects to both engine APIs, checks SQL parameter and binary-value fidelity, checks structured SQL errors, and closes both clients.

## Browser result

The recorded Chrome Canary run on macOS 27.0.1 arm64 passed all four browser checks; machine-readable details are in [results.json](results.json). The executable example uses two in-process host/client transport pairs and a test-only preauthenticated host fixture. PGlite and the key-value engine are real. This proves package integration and value/error behavior without importing the web application. It does not verify production connector authentication, WebRTC discovery, cross-device networking, separate-network NAT traversal, or physical-device behavior.

The public signaling provider is still unselected. `connectPeer` is an injection seam and its implementation must authenticate the peer before returning the transport. Physical two-device acceptance stays at TASK-043 as requested.
