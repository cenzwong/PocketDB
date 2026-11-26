# ADR-007: Protocol encoding and versioning

- Status: accepted for initial browser protocol; bridge mapping remains scoped
- Date: 2026-11-24
- Reversibility: medium; include an explicit version and reject unsupported versions.

## Context

TASK-003 moved correlated JSON requests over an ordered channel. TASK-006 showed serialized PostgreSQL transaction semantics. TASK-008 forwarded PostgreSQL protocol-v3 frames through a local bridge and raw PGlite protocol. TASK-009 passed a bounded RESP2 subset. These are distinct driver protocols and do not justify exposing either as the browser SDK wire format.

## Decision

Use a versioned JSON request/response envelope for the browser SDK, with request and session identifiers, operation, typed payload, structured error and explicit size validation. Keep PostgreSQL wire forwarding and RESP2 translation in optional later native bridges, each behind its own verified compatibility subset. Mutation timeouts after dispatch have an unknown outcome unless the host can prove otherwise.

## Alternatives considered

- Sending raw PostgreSQL or RESP to every browser would couple the P0 app to driver wire details and authorization semantics.
- Binary encoding may reduce payload size but has no measured benefit for the bounded initial workload.
- Unversioned JSON is simple but cannot negotiate behavior safely as clients evolve.

## Consequences

TASK-023 defines the exact v1 envelope, version negotiation, typed payload representation, bounded decoding and fixtures. Host/client tickets own duplicate handling and retry behavior. TASK-031 implements the independent browser client package on this envelope, with an injected authenticated transport connector and typed SQL/key-value APIs. TASK-046 and TASK-047 remain responsible for native protocol boundaries. Streaming and subscriptions stay outside this version.

## Evidence

- [TASK-003 request delivery](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-003-webrtc/README.md)
- [TASK-006 transaction outcomes](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-006-sql-sessions/README.md)
- [TASK-008 PostgreSQL wire fixture](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-008-postgres-wire/README.md)
- [TASK-009 RESP2 fixture](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-009-resp/README.md)
- [Browser TypeScript client SDK](../../packages/client/README.md)
