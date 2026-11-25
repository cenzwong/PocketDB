# Replaceable discovery and ICE integration

## Run

From the repository root:

```sh
pnpm --filter @pocketdb/transport typecheck
pnpm --filter @pocketdb/transport test
pnpm --filter @pocketdb/transport test:browser
```

The browser command needs a temporary loopback Vite server. It opens two `RTCPeerConnection` peers in Chrome Canary, exchanges complete offer/answer descriptions through `InProcessSignalingAdapter`, opens the reliable WebRTC transport and verifies a message round trip. The [recorded result](results.json) shows both peers connected and a selected host/host UDP pair.

The HTTP provider unit tests verify a successful room exchange, unreachable endpoint diagnostics, a missing-peer timeout, and invalid configuration. They use an injected fetch function so service behavior is deterministic and does not require a public signaling provider.

## Configuration and service contract

Create `HttpRoomSignalingAdapter` with the base HTTPS endpoint, then pass it to `WebRTCDiscoveryAdapter`. The endpoint implements:

- `POST <endpoint>/signal/<roomId>/offer` with `{"type":"offer","sdp":"..."}`
- `GET <endpoint>/signal/<roomId>/answer` until the peer answer is available
- `POST <endpoint>/signal/<roomId>/answer` with the answer description
- `GET <endpoint>/signal/<roomId>/offer` until the peer offer is available

Pending descriptions return HTTP 404; published descriptions return JSON and successful POSTs return any 2xx status. HTTP is allowed only for loopback development. The provider omits cookies and credentials, caps received descriptions at 64 KiB by default, polls for up to 15 seconds and returns distinct `signaling-unavailable`, `signaling-http-error`, `signaling-room-not-found` and `signaling-peer-timeout` codes. Room state and invitation secrets are not sent to ICE servers.

Configure STUN or TURN through `iceServers`. TURN entries require a scoped username and credential. `iceTransportPolicy: "relay"` forces relay candidates for diagnosis. Discovery results expose candidate types, ICE error codes, connection state and the selected candidate pair when the browser reports it.

Example:

```ts
const signaling = new HttpRoomSignalingAdapter({
  endpoint: "https://signal.example.test",
});
const discovery = new WebRTCDiscoveryAdapter(signaling);
const peer = await discovery.connect({
  roomId: invitation.roomId,
  peerId: expectedPeerId,
  role: "offerer",
  iceServers: [
    { urls: "stun:stun.example.test:3478" },
    {
      urls: "turn:turn.example.test:3478?transport=udp",
      username: expiringUsername,
      credential: expiringCredential,
    },
  ],
});
```

The repository selects no public signaling, STUN or TURN service. A production signaling service still needs authenticated peer binding, short retention, rate and body limits, abuse controls and redacted logs. STUN observes source addresses and timing; TURN also relays encrypted traffic and may incur per-byte ingress and egress charges. Credentials must be short-lived and scoped.

## Limits

This browser run is two local peers on one Mac with in-process signaling and no external ICE servers. It proves the adapter's integration path and direct candidate diagnostics only. It does not prove cross-device room signaling, public endpoint reachability, separate-network NAT traversal, relay-provider behavior, firewall restrictions or current stable-browser support. TASK-032 and TASK-041 retain those checks.
