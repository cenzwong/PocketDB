# PocketDB delivery plan

The first proof is a static website that hosts a key-value database in one browser and lets a second device join by invitation, execute a remote write and read, and receive the result. PostgreSQL is also required for the initial release. Its static hosting, sessions and storage are investigated early and tested alongside the first proof.

## Planning artifacts

| Artifact | Decision or evidence it tracks |
| --- | --- |
| [Product scope](PRODUCT_SCOPE.md) | Release boundaries, guarantees and explicit exclusions |
| [Roadmap](ROADMAP.md) | Delivery order and rollout beyond the first release |
| [Milestones](MILESTONES.md) | Gate owners, prerequisites and evidence |
| [Dependency graph](DEPENDENCY_GRAPH.md) | Hard dependencies, critical path and preferred ordering |
| [Timeline](TIMELINE.md) | Effort and capacity scenarios |
| [Risk register](RISK_REGISTER.md) | Triggers, mitigations, ownership and review status |
| [Release plan](RELEASE_PLAN.md) | Demonstrations, compatibility, tests and documentation |
| [Technical spikes](TECHNICAL_SPIKES.md) | Experiments, exit evidence and scope consequences |
| [ADR backlog](ADR_BACKLOG.md) | Evidence inputs and decision gates |
| [Epic catalog](epics/README.md) and [board](../board/) | Work breakdown and executable ticket files |

The [engineering handoff](../docs/handoff.md) defines the product requirements. The [target architecture](../docs/architecture/), [decision summary](../docs/decisions/) and [specifications](../docs/specs/) provide implementer references. The live [board](../board/) supplies ticket status and hard dependency edges. The planning documents use ticket IDs that remain stable when files move between board states. The repository's [workflow](../docs/agent-workflow.md) defines which work can be claimed. The handoff's proposed project backlog corresponds to the existing board.

Start with TASK-002 (static hosting) and TASK-003 (browser-to-browser data). Review experiments, decisions, risks, estimates and release criteria at TASK-012 before product implementation. Use the [ADR template](../templates/adr.md) to record validated choices.
