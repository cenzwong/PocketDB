# ADR-008: Capability invitations and peer identity

- Status: accepted; initial browser transport binding verified, stable-browser support remains release-gated
- Date: 2026-11-24
- Reversibility: medium; invitation format and key rotation need versioning.

## Context

TASK-011's injected-context fixture accepted an authorized join and rejected replay, cross-connection reuse, channel substitution, host-key substitution, invalid signature, wrong capability, expiry and revocation. Browser extraction of channel fingerprints and wire serialization were not verified. TASK-006 also rejected broad arbitrary read-only SQL as unproven.

## Decision

Use accountless, high-entropy capabilities scoped to instance, role and expiry. Pin the expected host key in trusted invitation material. Require fresh proof of client key possession, bind proof to the live channel and instance, and support revocation. Keep secrets out of query strings, logs and persistent storage by default. Enforce authorization before engine execution and fail closed for unsupported permission controls.

## Alternatives considered

- Room IDs as credentials are predictable routing identifiers and provide no proof of authorization.
- A hosted account service conflicts with the no-required-backend direction.
- Bearer-only tokens are simpler but cannot prove client identity or prevent replay across connections.

## Consequences

TASK-028 validates the transcript on local browser WebRTC transports, URL handling, log redaction and bounded challenge state. TASK-029 enforces the authenticated access scope at dispatcher and adapter boundaries. Key-value read-only access is operation-listed; PostgreSQL read-only SQL is restricted to a parameterized SELECT subset inside a database read-only transaction. TASK-030 revalidates the bound peer session for routed messages and ties opened engine sessions to its invitation scope. Human identity is not implied by accountless key possession. The browser integration is preview evidence; stable browser support remains under TASK-041.

## Evidence

- [Invitation v1 encoding and validation](../../packages/protocol/README.md) implements capability generation, scoped URI and fragment parsing, expiry checks, expected-target checks and fragment redaction. It does not replace the peer authentication transcript or host-side authorization checks.
- [TASK-011 identity fixture and threat model](../../artifacts/task-011-peer-identity/README.md)
- [TASK-028 browser authentication and revocation evidence](../../board/done/TASK-028-authenticate-peer-bound-sessions-and-revoke-access.md)
- [TASK-029 permission matrix and enforcement evidence](../../board/done/TASK-029-enforce-engine-permissions-before-execution.md)
- [TASK-030 authenticated request routing evidence](../../board/done/TASK-030-route-authenticated-remote-requests-to-engine-sessions.md)
- [TASK-006 read-only control](../../artifacts/task-006-sql-sessions/README.md)
- [Engineering handoff, security requirements](../handoff.md)
