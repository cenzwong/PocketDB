# Architecture decision backlog

ADR records in [docs/decisions](../docs/decisions/) are authoritative for context, alternatives, trade-offs, consequences, reversibility, evidence and status. When a ticket owns an ADR and also implements its outcome, record the decision before implementing the dependent code.

| ADR | Decision | Evidence inputs | Resolve in |
| --- | --- | --- | --- |
| ADR-001 | Static-first deployment | TASK-002, TASK-005 | TASK-012 |
| ADR-002 | Hosted vs distributed modes | TASK-003, TASK-005, TASK-006 | TASK-012 for initial boundary; TASK-051 for replication semantics via ADR-013 |
| ADR-003 | Monorepo and package boundaries | Build and dependency rules in handoff §§22–24 | TASK-012 |
| ADR-004 | Database engine adapter contract | TASK-003, TASK-005, TASK-006 | TASK-012 |
| ADR-005 | Peer-to-peer transport | TASK-003, TASK-004, TASK-007 | TASK-012 |
| ADR-006 | Signalling and NAT traversal | TASK-004, TASK-011 | TASK-012 |
| ADR-007 | Protocol encoding and versioning | TASK-003, TASK-006, TASK-008 | TASK-012 |
| ADR-008 | Capability authentication, invitation URI and peer identity | TASK-006, TASK-011 | TASK-012 |
| ADR-009 | Browser persistence | TASK-002, TASK-005 | TASK-012 |
| ADR-010 | Worker execution model | TASK-002, TASK-005, TASK-010 | TASK-012 |
| ADR-011 | PostgreSQL localhost bridge subset | TASK-006, TASK-007, TASK-008 | Resolved in [ADR-011](../docs/decisions/ADR-011-postgresql-localhost-bridge.md) by TASK-046 |
| ADR-012 | Redis RESP2 localhost bridge subset | TASK-007, TASK-009 | Resolved in [ADR-012](../docs/decisions/ADR-012-resp-localhost-bridge.md) by TASK-047 |
| ADR-013 | CRDT sync and membership | TASK-050 | Resolved in [ADR-013](../docs/decisions/ADR-013-crdt-synchronization.md) by TASK-051; remote enforcement is TASK-052 |
| ADR-014 | Browser compatibility strategy | TASK-002, TASK-004, TASK-005, TASK-010 | TASK-012 |
| ADR-015 | Snapshot and export formats | TASK-005, TASK-019, TASK-020 | Resolved in [ADR-015](../docs/decisions/ADR-015-snapshot-formats-and-restore.md) by TASK-033 |
| ADR-016 | Package distribution and versioning | TASK-007, TASK-013, TASK-031 | TASK-065 |
| ADR-017 | Open-source licensing | Candidate dependency licensing and project distribution constraints | TASK-012 |

Bridge decisions and release expectations remain conditional on their later evidence. TASK-012 records any native constraints that affect shared contracts before M1 starts.

## M0 outcome

TASK-012 accepted ADR-001 through ADR-010, ADR-014 and ADR-017 on 2026-11-24. This is a conditional feasibility pass for the static Hosted Mode path. P0 is the browser key-value engine and PGlite, a TypeScript browser SDK, accountless authenticated peer access, IndexedDB-backed persistence, and portable recovery. Native bridges, distributed replication, broader Redis compatibility and additional engines remain later tracks.

Required follow-ups remain explicit: TASK-013 records package license metadata, while the exact copyright holder and shipped-artifact notice review remain release prerequisites; TASK-026 selects and validates public signalling; TASK-028 validates capability proof on real browser transport; TASK-032 tests separate networks and physical-device authorization; TASK-041 establishes stable browser versions; TASK-043 exercises the deployed product and physical host sleep/wake recovery. Manual offer/answer and optional configured TURN are the connectivity fallbacks. If a P0 engine cannot work under the Pages baseline, use a compatible single-threaded build or revise the static-host decision before release.
