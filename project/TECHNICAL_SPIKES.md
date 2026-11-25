# Technical spikes

Every experiment records source, steps, named environment and versions, measured outcomes, limitations, recommendation, affected ADRs and scope/estimate impact. A documented negative outcome is evidence for the decision gate. Resolve any blocker to a release criterion through a verified fallback or a revised scope decision.

| Handoff spike | Ticket | Exit evidence | Design consequence |
| --- | --- | --- | --- |
| M0 static compatibility | [TASK-002](../artifacts/task-002-static-worker/README.md) | HTTPS project-path and browser worker/WASM/header matrix | Select viable static build and supported browsers |
| SP-01 P2P request delivery | [TASK-003](../artifacts/task-003-webrtc/README.md) | Correlated remote KV write/read on two physical devices | Choose WebRTC baseline and bounds |
| SP-02 discovery and SP-03 NAT | [TASK-004](../artifacts/task-004-discovery/README.md) | LAN, cross-network and restrictive/relay results where testable | Select discovery and STUN/TURN configuration |
| SP-04 PGlite and storage | [TASK-005](../artifacts/task-005-persistence/README.md) | SQL, persistent reload and export/restore evidence | Select engine/storage candidates and fallback |
| SP-05 SQL isolation | [TASK-006](../artifacts/task-006-sql-sessions/README.md) | Independent transactions and read-only control evidence | Gate safe remote PostgreSQL exposure |
| SP-06 Node transport | [TASK-007](../artifacts/task-007-node-webrtc/README.md) | Node/browser request with platform and dependency results | Choose feasible native transport |
| SP-07 PostgreSQL bridge | [TASK-008](../artifacts/task-008-postgres-wire/README.md) | Startup, bound parameters and transactions through browser-owned PGlite | Establish feasible PostgreSQL bridge subset |
| SP-08 RESP bridge | [TASK-009](../artifacts/task-009-resp/README.md) | Existing client round-trip and unsupported command result, or reproduced blocker | Establish feasible Redis client subset |
| SP-11 lifecycle | [TASK-010](../artifacts/task-010-host-lifecycle/README.md) | Background, sleep, reload and close matrix | Set recovery behavior and warnings |
| SP-12 peer identity | [TASK-011](../artifacts/task-011-peer-identity/README.md) | Authenticated join and identity, expiry and revocation rejection evidence | Select invitation and session binding |
| SP-09 CRDT convergence | [TASK-050](../artifacts/task-050-yjs-probe/README.md) | Three-peer offline, duplicate/reordered updates and state-vector reconnect probe | Gate replicated semantics and membership design; network/security limits remain open |
| SP-10 SQLite/DuckDB WASM | TASK-055 | Representative query and file round-trip on the intended static build | Gate expansion selection and fallback |

TASK-002 and TASK-003 are the first probes. TASK-012 reviews all M0 results. SP-09 and SP-10 inform later product tracks.
