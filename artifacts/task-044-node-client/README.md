# TASK-044 Node client integration

`@pocketdb/node-client` is a private Node adapter around the shared PocketDB SDK. It uses Werift 0.28.0 instead of a native WebRTC binding, receives the host's offer through `HttpRoomSignalingAdapter`, exchanges a completed SDP answer, validates the DTLS peer binding and completes the same capability-authentication handshake used by the browser SDK before returning the shared client.

## Local browser-hosted verification

Run from the repository root with Chrome Canary available (or set `POCKETDB_CHROMIUM` to another Chromium executable):

```sh
pnpm --filter @pocketdb/node-client test:browser
```

The harness starts the real web application, a disposable HTTP room-signaling endpoint on loopback, and a browser host. The Node peer connects first to a browser-hosted KV engine and then to a browser-hosted PGlite engine, performs `SET`/`GET` and a parameterized SQL query, forces a request timeout, and verifies host-loss state and follow-up operation errors. It writes [results.json](results.json).

## Compatibility and native dependency boundary

The package declares Node `>=24 <27`, matching the workspace's engine range. Imports passed on Node 25.8.1/macOS arm64, Node 24.22.3/Linux arm64 and Node 26.13.1/Linux arm64 containers. The cross-version container checks cover package loading only; they do not prove full WebRTC connectivity on those OS/runtime combinations. The authenticated browser-hosted integration runs only on the local macOS arm64 host and browser. See the [runtime import matrix](runtime-imports.json) and [browser integration results](results.json).

Werift is a JavaScript dependency; it avoids a platform-specific native add-on and compiler/prebuilt-binary requirement. node-datachannel 0.33.6 remains the evidence-backed fallback candidate from TASK-007, with a native prebuilt binary and a separate platform compatibility requirement. Use a different injected peer connection implementation only after matching the SDP, reliable ordered data channel, DTLS fingerprint and message-size contracts.

No public signaling provider, STUN/TURN service, WAN connectivity, Windows/Intel Mac, persistent session, package publication or public support promise is established here. The supported Node range remains provisional until the authenticated integration matrix runs on each claimed platform and release environment.
