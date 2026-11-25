# ADR-019: Defer generalized infrastructure service contracts

- Status: accepted for the current release scope; revisit on concrete multi-service ownership needs
- Date: 2026-11-25
- Reversibility: high; current narrow engine, transport, discovery and replica boundaries remain in place

## Context

The handoff describes a future browser-native infrastructure platform, but TASK-063 evaluates whether that vision justifies a common service abstraction now. The delivered system has an authoritative browser-hosted database, a later typed CRDT replica mode, engine-specific adapters, and optional discovery/networking. TASK-054 and TASK-060 provide a CRDT console and machine-readable capabilities, while TASK-058/059 prototype document and vector engines. No independently owned service adapter or deployment requiring a shared service lifecycle contract has been demonstrated.

The handoff also excludes managed database backups, enterprise identity federation, public anonymous database hosting, guaranteed zero external network dependencies, permanent mobile background execution, and a full replacement for managed cloud infrastructure. A broad service contract would risk obscuring these ownership and availability limits.

## Decision

Do not add a generalized `InfrastructureService` contract, plugin registry, service marketplace, or service extension implementation task now. Continue using the narrow interfaces already required by evidence:

- `EngineAdapter` owns engine-specific lifecycle, capabilities, sessions, execution, health and optional snapshot export. Browser users own the engine process and local persistence.
- `TransportAdapter` owns message delivery and connection lifecycle. The client supplies a transport connector.
- `DiscoveryAdapter` and ICE configuration supply replaceable room signaling and STUN/TURN settings. These services assist peer connection only; they do not own database execution, persistence or authorization. PocketDB does not currently operate a signaling or relay service.
- `@pocketdb/engine-yjs` owns typed replica behavior and explicit membership/synchronization rules; it does not redefine Hosted Mode engine semantics.
- MCP and CLI are client surfaces that reuse authenticated SDK capability checks, not infrastructure-service providers.

Reopen the decision when at least one concrete service has a validated user, named operational owner, independent lifecycle or deployment requirements, and contract needs that cannot be represented by the existing engine, transport, discovery or replica interfaces. Add a focused service contract only after comparing those needs across at least two real service implementations.

## Candidate use cases, owner and boundary

| Candidate | Evidence and user | Operational owner | Appropriate current boundary | Contract decision |
| --- | --- | --- | --- | --- |
| Browser-hosted SQL and key-value engines | Hosted Mode and verified P0 adapters | Participating host user owns runtime and browser-local data | `EngineAdapter` plus engine-specific capabilities | Keep separate engine adapters; no common service plugin API |
| Signaling, STUN and TURN | Needed to establish some peer connections; production provider and cross-network coverage remain release gates | Application operator or chosen third party | `DiscoveryAdapter`, endpoint configuration and WebRTC ICE config | Keep replaceable network adapters; do not fold into database service lifecycle |
| Distributed shared state | TASK-050 through TASK-054 select typed Yjs operations, membership, revocation and replica persistence | Each authorized participant owns its local replica; host/members control admission | Yjs adapter, member roster, authenticated transport | Keep as a distinct mode; no generic shared-memory service contract |
| Document storage and vector search | TASK-058/059 are prototypes, not validated general-purpose service demand | Host user if a future engine is selected | Candidate engine adapter and its own capability schema | Select each on workload evidence; do not introduce a universal abstraction |
| Queue, pub/sub, object storage, workflow execution, agent memory | Listed as future directions in the handoff; no release acceptance or owner is evidenced | Undecided | None yet | Defer; first identify user, data owner, durability, lifecycle and authorization semantics |

## Alternatives considered

- Add the handoff's generic `InfrastructureService` interface now: rejected because proposed `start/execute/stop` calls do not specify ownership, durability, security, schema evolution, or capability differences across the listed services.
- Keep each service behind its current narrow engine, transport, discovery or replica interface: chosen; it preserves extension points without committing to a universal model.
- Build hosted signaling, backup, identity or orchestration services to complete the platform story: rejected for current scope because those introduce operators and availability responsibilities excluded by the product constraints.

## Consequences

- Do not add an implementation ticket for generalized service contracts from this review.
- Keep product claims explicit about browser ownership, local data, optional networking services, host availability and Distributed Mode semantics.
- Future engine candidates continue through workload-specific prototypes and the current capability/engine adapter interfaces.
- Any later service proposal must identify its user, data and operational owner, trust boundary, API, reliability responsibility and deployment cost before implementation.

## Evidence

- [Engineering handoff, future service direction and scope exclusions](../handoff.md)
- [Architecture boundaries](../architecture/README.md)
- [ADR-002: Hosted and distributed modes](ADR-002-hosted-and-distributed-modes.md)
- [ADR-004: Engine adapter contract](ADR-004-engine-adapter-contract.md)
- [ADR-006: Signaling and NAT](ADR-006-signalling-and-nat.md)
- [ADR-013: Yjs replication and membership](ADR-013-crdt-synchronization.md)
- [TASK-054: CRDT console](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/board/done/TASK-054-provide-the-crdt-console-and-release-demonstration.md)
- [TASK-060: machine-readable capabilities](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/board/done/TASK-060-publish-machine-readable-client-capabilities.md)
- [TASK-058: document storage prototype](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/board/done/TASK-058-select-and-prototype-document-storage.md)
- [TASK-059: vector search prototype](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/board/done/TASK-059-select-and-prototype-vector-search.md)
