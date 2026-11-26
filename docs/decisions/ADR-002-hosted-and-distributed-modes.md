# ADR-002: Hosted and distributed modes

- Status: accepted for initial release boundary
- Date: 2026-11-24
- Reversibility: high before replication ships; medium after users depend on mode-specific data semantics.

## Context

The handoff distinguishes one authoritative hosted database from independently editable replicas. TASK-003 and TASK-005 support a browser-hosted first proof; TASK-006 found one PGlite backend process and serialized transaction ownership in the fixture.

## Decision

Ship Hosted Mode first. The host browser owns the authoritative P0 key-value or PostgreSQL instance, and remote clients operate through scoped sessions. Keep Distributed Mode as a separate later product stage with explicit replicated data types and convergence semantics. Do not imply that hosted SQL or key-value instances are replicated.

## Alternatives considered

- Shipping both modes together would couple the first proof to membership, merge and offline semantics not yet measured.
- Treating hosted clients as replicas would misstate the observed ownership and transaction model.
- Omitting the later mode would conflict with the longer-term handoff; it remains gated by TASK-050 through TASK-054.

## Consequences

Hosted Mode limits availability to the host browser and device. TASK-050 must provide convergence evidence before Distributed Mode contracts are selected. Revisit shared abstractions if replication requires different consistency or persistence guarantees.

## Evidence

- [TASK-003 WebRTC probe](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-003-webrtc/README.md)
- [TASK-005 persistence probe](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-005-persistence/README.md)
- [TASK-006 SQL isolation probe](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-006-sql-sessions/README.md)
- [Product scope](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/project/PRODUCT_SCOPE.md)
