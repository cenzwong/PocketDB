# Discovery and NAT traversal spike

The browser probe uses the TASK-003 pattern of a correlated write and read on an ordered data channel. The manual baseline passes the offer and answer out of band. The automatic candidate publishes each description to a random room on a loopback HTTP service and polls for its peer's description. The service relays signalling only. The data channel goes through the ICE-selected path and the report records candidate types and ICE error codes without network addresses or SDP.

## Reproduce

From this directory, use Node and Chrome Canary. Set `POCKETDB_CHROMIUM` to another Chromium executable or `POCKETDB_TURN_PORT` to an available loopback UDP port if needed. The fixture uses local relay ports 55000–55100.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs
```

The driver launches a temporary signalling service, loopback STUN/TURN listener and clean headless Chromium profile. It generates a short-lived credential for each run. The HTTP room fixture has no production authentication or abuse controls and is bound to loopback.

## Evidence

The [TASK-003 physical run](../task-003-webrtc/README.md) previously established a manual write/read between two Macs on one Wi-Fi. The new [results](results.json) compare manual and HTTP room exchange in Chrome Canary 160.0.8180.0 on one Mac. Both delivered the write and read directly. The local STUN server received a Binding request and the browser exposed `srflx` candidates. Forcing relay use without TURN left both peers without candidates and timed out. Configuring TURN restored connectivity with relay candidates selected on both endpoints.

| Condition | Environment and outcome |
| --- | --- |
| LAN | Manual exchange passed on two physical Macs in TASK-003. Automatic room exchange passed on the same development Mac. Automatic across physical LAN devices remains unverified. |
| Separate networks | Unavailable in this run. It needs two peers on independent networks and a reachable approved signalling and ICE setup. Local STUN proves candidate gathering in the fixture. |
| Restrictive or relayed | Relay-only with no TURN timed out after the bounded wait. Relay-only with local authenticated TURN passed the correlated write/read, with both selected pairs using UDP relay candidates. UDP-blocked firewall and TURN/TCP or TURN/TLS paths remain unverified. |

Elapsed times include signalling, gather and test driver polling. They are single observations and support no performance comparison between signalling methods. No public discovery, STUN or TURN provider was configured. See [ICE candidate rules](https://datatracker.ietf.org/doc/rfc8445/), [relay behavior](https://datatracker.ietf.org/doc/html/rfc8656) and the [local TURN fixture dependency](https://github.com/Atlantis-Software/node-turn).

## Service, privacy and operating assumptions

| Service | Configuration and visibility | Cost or failure signal |
| --- | --- | --- |
| Manual signalling | Transfer offer and answer using a trusted channel. Recipients and any transfer service can see the SDP metadata. | No dedicated service. Distinguish missing offer/answer, failed candidate gathering and channel-open timeout. |
| Automatic room signalling | Configure a replaceable HTTPS endpoint. Room messages need short retention, input and rate limits, authenticated binding to the expected peer, and log redaction. The service sees source addresses, room identifiers and SDP metadata. Keep invitation secrets out of signalling. | Budget for requests, short-lived state and availability. Distinguish endpoint unreachable, HTTP error, wrong or expired room, and missing peer response. |
| STUN | Configure an approved URL separately from signalling. The service learns source address and request timing. | Budget for binding traffic and availability. Surface ICE error codes, no server-reflexive candidate and selected direct path where available. An absent candidate alone can also be benign on some networks. |
| TURN | Make relay opt-in with scoped, expiring credentials and quotas. A relay sees addresses, timing and traffic volume. WebRTC application payloads remain encrypted in transit. | Budget according to actual relay usage. A 100 GB payload workload relayed in full represents roughly 100 GB egress and 100 GB ingress before overhead, with charges depending on the provider. Surface unreachable relay, authentication or allocation failure, relay selected and relay-only with no candidate. |

## Recommendation and impact

Keep manual signalling as the no-service baseline. Take the automatic HTTPS room provider pattern into ADR-006 as a replaceable candidate, with configurable STUN and optional TURN. The loopback service demonstrates the exchange pattern. Production provider selection, terms, reliability, abuse handling and deployment remain open. Use the physical separate-network and restricted-network follow-up before committing to reachability targets. This evidence informs ADR-005, ADR-006 and ADR-014. No estimate change follows from the local fixture.
