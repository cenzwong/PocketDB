# ADR-006: Signalling and NAT traversal

- Status: accepted as a replaceable pattern; provider selection deferred
- Date: 2026-11-24
- Reversibility: high behind a discovery/signalling interface.

## Context

TASK-003 passed manual offer/answer on a same-Wi-Fi physical pair. TASK-004 passed local HTTP room signalling with direct candidates and with a local authenticated UDP TURN relay. Relay-only without TURN timed out. Separate-network and public provider behavior were not tested.

## Decision

Keep manual signalling as a development and recovery baseline. Implement automatic signalling behind a replaceable HTTPS room interface with short-lived room state, authenticated peer binding, rate/input limits and secret redaction. Make STUN configurable and TURN optional with scoped expiring credentials and quotas. Do not select a public provider in M0.

## Alternatives considered

- Manual-only signaling avoids a service but is too cumbersome for the intended invitation flow.
- A fixed public provider adds terms, availability and privacy dependencies not evaluated by the loopback fixture.
- Direct-only ICE fails when relay connectivity is required; the forced relay test timed out without TURN.

## Consequences

Document that signalling sees addresses and SDP metadata and TURN sees traffic volume and timing. The replaceable HTTPS room adapter and configurable STUN/TURN path are implemented under TASK-026. Production provider selection, service authentication and abuse protection, cost, and separate-network behavior remain release gates in TASK-032 and TASK-041. Surface direct versus relayed state where available.

## Evidence

- [TASK-003 manual physical baseline](../../artifacts/task-003-webrtc/README.md)
- [TASK-004 discovery/NAT matrix](../../artifacts/task-004-discovery/README.md)
- [TASK-026 discovery integration and configuration](../../artifacts/task-026-discovery/README.md)
