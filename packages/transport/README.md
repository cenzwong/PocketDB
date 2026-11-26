# Transport contracts

`@pocketdb/transport` defines an engine-independent byte transport connection, a deterministic in-process pair, and a browser WebRTC data-channel adapter.

Each connection exposes its peer ID and lifecycle state, sends `Uint8Array` messages, reports incoming messages and state changes, and supports idempotent disconnect. Listeners return unsubscribe functions. The in-process adapter copies messages at both ends so tests do not accidentally rely on shared mutable buffers. `failNextSend` injects one transient send failure without disconnecting the pair.

`testing/transport-contract.ts` exports a reusable Vitest contract suite. It checks binary delivery, disconnect propagation, listener cleanup, injected send failure and sends after disconnect. It has no database-engine dependency.

## WebRTC data channels

`WebRTCDataChannelAdapter` wraps an already-negotiated `RTCPeerConnection` and its ordered, reliable `RTCDataChannel`. `WebRTCDiscoveryAdapter` gathers complete offer/answer descriptions through an injected `SignalingAdapter`, validates configurable STUN/TURN settings, then opens the byte transport. `HttpRoomSignalingAdapter` implements the replaceable HTTPS room endpoint contract; callers can supply another signaling adapter or a whole `DiscoveryAdapter`. It reports signaling failures separately from ICE candidate and connection diagnostics.

The HTTP provider expects `POST` and `GET` at `<endpoint>/signal/<roomId>/offer` and `.../answer`; pending descriptions return 404. Endpoints must use HTTPS, except loopback HTTP for development. It omits cookies, limits received descriptions and does not send invitation capabilities to the service. The repository does not select a public signaling/STUN/TURN endpoint. Production service authentication, abuse controls, short retention and log redaction are still required. See the [discovery integration evidence and configuration](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-026-discovery/README.md). The browser probe verifies two local peers; separate-network and public relay behavior remain release gates.

Each message is one data-channel message. The adapter accepts messages up to the lower of the negotiated SCTP `maxMessageSize` and a default 16 KiB PocketDB cap. It rejects larger outbound messages with `message-too-large` and closes the connection if a peer sends an oversized message. It does not fragment or reassemble messages. Outbound queued bytes and message count are bounded; a full queue rejects with `backpressure`. Native send exceptions reject with `send-failed`. Closing either peer disconnects the transport and later sends reject with `not-connected`.

Run `pnpm --filter @pocketdb/transport typecheck`, `pnpm --filter @pocketdb/transport test`, and `pnpm --filter @pocketdb/transport test:browser` from the repository root. The browser probes negotiate two local Chromium peers without external ICE services; they validate adapter behavior and direct-path diagnostics, not cross-device reachability.
