# ADR-005: WebRTC data-channel transport

- Status: accepted as the initial browser transport
- Date: 2026-11-24
- Reversibility: high behind a byte-oriented transport interface.

## Context

TASK-003 passed a correlated write/read on two physical Macs over the same Wi-Fi, with a 262,144-byte negotiated maximum. TASK-004 passed direct and local TURN-relayed fixtures. TASK-007 passed Node/browser requests with both Werift and node-datachannel on one Mac.

## Decision

Use ordered, reliable WebRTC data channels for browser peer access behind a replaceable byte transport interface. Begin with one in-flight request and a provisional 16 KiB encoded application message cap, bounded by the negotiated channel maximum. Use an in-process transport for contract tests. Keep Werift as the first Node adapter candidate and node-datachannel as a fallback until platform and packaging checks pass.

## Alternatives considered

- WebSocket requires an application server endpoint and changes the static-first operating model.
- BroadcastChannel and MessagePort do not connect independent devices.
- node-datachannel passed but introduces native prebuilt package coverage risk; Werift passed on the measured host with a pure JavaScript dependency tree.

## Consequences

Implement bounded buffering, disconnect settlement and explicit unknown mutation outcomes. Do not claim WAN or relay reachability from a local relay fixture; TASK-026 and TASK-032 own service/network validation. Revisit limits when representative payload and concurrency measurements exist.

## Evidence

- [TASK-024 transport contract and in-process adapter](../../packages/transport/README.md)
- The WebRTC adapter's local Chromium integration passed ordered delivery at 0-, 1- and 16,384-byte message boundaries, rejected oversized outbound messages, and reported peer disconnects. This same-machine probe establishes adapter behavior only; it does not select or certify a direct versus relayed path.
- [WebRTC adapter limits and direct/relay behavior](../../packages/transport/README.md#webrtc-data-channels)
- [TASK-003 browser peers](../../artifacts/task-003-webrtc/README.md)
- [TASK-004 discovery and NAT](../../artifacts/task-004-discovery/README.md)
- [TASK-007 Node transport](../../artifacts/task-007-node-webrtc/README.md)
