# Architecture decision summary

The [engineering handoff](../handoff.md) sets the product constraints. PocketDB must distribute a static site, execute hosted operations on the host device, keep default storage local, support replaceable engines and transports, and document availability and compatibility limits. Hosted Mode ships first. Distributed Mode has explicit replication semantics.

The initial M0 decisions below are recorded as individual ADRs. Their evidence and limits define a conditional path to the first Hosted Mode release. The original proposed decision sequence is preserved in the [ADR backlog](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/project/ADR_BACKLOG.md).

| ADR | Decision | Record |
| --- | --- | --- |
| ADR-001 — Static deployment | GitHub Pages target; static assets, project paths and single-threaded WASM baseline | [Accepted](ADR-001-static-first-deployment.md); real deployment remains a release check |
| ADR-002 — Operating modes | Hosted Mode first; replication remains a separate later mode | [Accepted](ADR-002-hosted-and-distributed-modes.md) |
| ADR-003 — Package boundaries | TypeScript monorepo, pnpm workspaces and Vite | [Accepted](ADR-003-typescript-monorepo.md); TASK-013 verifies tooling |
| ADR-004 — Engine adapter | Small capability and lifecycle contract with separate P0 adapters | [Accepted](ADR-004-engine-adapter-contract.md) |
| ADR-005 — Transport | Ordered reliable WebRTC, in-process test adapter, bounded JSON messages | [Accepted](ADR-005-webrtc-transport.md); network support remains gated |
| ADR-006 — Discovery and NAT | Replaceable HTTPS room signalling, configurable STUN and optional TURN | [Accepted as a pattern](ADR-006-signalling-and-nat.md); public provider deferred |
| ADR-007 — Protocol | Versioned JSON request/response for the browser SDK | [Accepted](ADR-007-protocol-encoding.md); native wire bridges remain separate |
| ADR-008 — Access | Scoped capabilities, pinned host key, proof of possession and connection-bound session | [Accepted as design](ADR-008-capability-authentication.md); browser binding remains gated |
| ADR-009 — Persistence | IndexedDB candidate, Web Lock ownership, ephemeral memory and export recovery | [Accepted](ADR-009-browser-persistence.md) |
| ADR-010 — Workers | Dedicated workers, explicit availability warnings and bounded recovery | [Accepted](ADR-010-worker-execution.md); physical sleep/wake is in TASK-043 |
| ADR-011 — PostgreSQL bridge | PostgreSQL v3 localhost bridge subset | [Accepted](ADR-011-postgresql-localhost-bridge.md); verified subset and security boundaries |
| ADR-012 — RESP bridge | RESP2 localhost bridge subset | [Accepted](ADR-012-resp-localhost-bridge.md); verified command, session and host-loss behavior |
| ADR-013 — CRDT synchronization | Yjs typed replicas, membership, revocation and update limits | [Accepted for M5 implementation](ADR-013-crdt-synchronization.md); network enforcement/persistence remain in TASK-052/053 |
| ADR-014 — Browser support | Chromium desktop first; publish only evidence-backed versions and capabilities | [Accepted as staged policy](ADR-014-browser-support.md); TASK-041 owns exact matrix |
| ADR-015 — Snapshots | Versioned portable formats and safe restore | [Accepted](ADR-015-snapshot-formats-and-restore.md); PGlite 0.6.0 format and fresh-target behavior |
| ADR-016 — Distribution | Independent SemVer packages, prerelease tags and approval-gated npm publication | [Accepted](ADR-016-package-distribution-and-versioning.md); first SDK package release remains gated |
| ADR-017 — Licensing | Apache-2.0 selected; ownership and dependency audit before publication | [Accepted with release prerequisites](ADR-017-open-source-license.md) |
| ADR-018 — Python SDK scope | Defer a direct SDK until a named consumer need exceeds verified driver, CLI and MCP paths | [Accepted](ADR-018-defer-direct-python-sdk.md); revisit on unmet workflow evidence |
| ADR-019 — Infrastructure service scope | Keep existing narrow engine, transport, discovery and replica boundaries; defer a generalized service contract | [Accepted](ADR-019-defer-general-infrastructure-service-contracts.md); revisit with multi-service ownership evidence |
| ADR-020 — Repository layout | Separate product, tests, experiments and archived evidence | [Accepted](ADR-020-repository-layout-and-archives.md) |

TASK-012 accepted ADR-001 through ADR-010, ADR-014 and ADR-017 on 2026-11-24. This is a conditional feasibility pass for the static Hosted Mode path. Snapshot, native bridge, replication and package distribution ADRs are resolved in their later owning tickets. Native feasibility informs the initial shared contracts without making those bridges P0. See the [technical spike catalog](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/project/TECHNICAL_SPIKES.md) and [handoff sections 22–26](../handoff.md).
