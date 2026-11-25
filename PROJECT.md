# PocketDB project

This is the reference for current project scope and where to find release state,
requirements, and decisions. The [README](README.md) is the product entry point.

## Scope

PocketDB lets a user start a database in a browser, share access, and execute
operations without provisioning a database server. Hosted Mode leaves the host
in control of execution and storage. Distributed Mode defines its own replica
and membership semantics. Static hosting serves the application assets.
Signaling and optional relay services are explicit integration dependencies.

Keep engines and transports replaceable. Document measured compatibility,
reachability, storage limits, and host availability. The [original engineering
handoff](docs/handoff.md) preserves requirements and initial planning context.
The [specifications](docs/specs/README.md) describe technical contracts and the
[decision records](docs/decisions/README.md) explain accepted choices.

## Delivery and release gates

| Delivery area | Scope and evidence |
| --- | --- |
| Feasibility and local runtime | Static workers, P0 engines, and local persistence. TASK-012 and TASK-022 record the conditional feasibility and local runtime results. |
| Peer access | Authenticated remote key-value and PostgreSQL requests. TASK-032 records the two-container proof and its physical-device limits. |
| Hosted release | Live Pages deployment and two-physical-laptop acceptance. Follow [TASK-040](board/blocked/TASK-040-automate-github-pages-deployment.md) and [TASK-043](board/backlog/TASK-043-certify-the-hackathon-ready-release.md) for blockers and required evidence. |
| Native clients and bridges | CLI, Node transport, and driver compatibility evidence. Package publication has its own approval, build, dependency and verification gates. [Distribution decision](docs/decisions/ADR-016-package-distribution-and-versioning.md) |
| Distributed, additional engines, and agent integration | Yjs, SQLite, DuckDB and MCP have implementation and verification records. [Later-release specifications](docs/specs/later-releases.md), [capabilities](docs/capabilities/README.md) |

The [board](board/) is authoritative for task state and dependencies. The
[completion index](board/archive/completed.json) resolves archived IDs. Work
follows the [agent workflow](docs/agent-workflow.md). The [historical
archive](docs/archive.md) preserves detailed initial estimates, risks, roadmap,
and execution evidence. Record new requirements in specifications, decisions
in ADRs, and actionable work on the board.
