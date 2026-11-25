# Milestones and evidence gates

| Gate | Evidence owner | Exit criterion |
| --- | --- | --- |
| M0 feasibility | TASK-012 | Reproducible key-value/WebRTC and PGlite tests, browser-local storage and static hosting evidence, native bridge feasibility results, signed-off initial ADRs and confirmed MVP scope. Record blockers and fallback decisions. |
| M1 local runtime | TASK-022 | Both engines start and execute operations in browser workers; persistent instances recover after normal reload. |
| M2 peer access | TASK-032 | Two physical devices show authenticated remote key-value write/read, a PostgreSQL parameterized query and denied unauthorized access. No PocketDB-owned application backend is required. |
| M3 hackathon release | TASK-043 | Deployed site passes the full two-laptop walkthrough, SDK integration, access checks, storage recovery and export, with published support and limitations. |
| M4 native integration | TASK-049 | A standard PostgreSQL driver and a Redis client execute supported operations through packaged localhost bridges to browser-owned databases. |
| M5 distributed mode | TASK-054 | Independent authorized replicas make offline edits and converge on reconnection; persistence and membership semantics are documented. |
| M6 selected adapters | TASK-055 through TASK-059, as selected | Each selected adapter has static hosting evidence, engine contract coverage, reproducible browser examples and documented supported capabilities. Prototypes require a product decision and scoped implementation tickets before counting as shipped adapters. |
| M7 agent access | TASK-064 | An authorized agent connects or provisions through the approved surface, discovers capabilities and performs supported operations with structured results and errors. |

M0 passed conditionally in TASK-012 on 2026-11-24. The selected path is the browser-hosted P0 key-value and PGlite engines on a static site with authenticated WebRTC access and browser-local persistence. The exact browser support matrix, public signalling provider, separate-network reachability, license audit and real Pages deployment remain owned by later gates. TASK-043 includes the user's physical two-Mac host sleep/wake verification before release certification.

Check the [release plan](RELEASE_PLAN.md) for demonstrations, environments and publication requirements. Live ticket state comes from the [filesystem board](../board/).
