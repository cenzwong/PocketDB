# PocketDB specifications

These documents condense the required behavior in the [engineering handoff](../handoff.md). They describe planned capabilities. Where the handoff leaves formats, limits or supported environments open, the specs refer to the [decision summary](../decisions/).

| Spec | Covers |
| --- | --- |
| [Hosted runtime and web experience](hosted-runtime.md) | Host and client workflows, engines, worker lifecycle, persistence, diagnostics, deployment and acceptance |
| [Remote access and protocol](remote-access.md) | Invitation handling, identity and authorization, operation outcomes, SDK and networking |
| [Browser protocol v1](protocol-v1.md) | Versioned JSON envelopes, correlated messages, typed binary and SQL values, limits and fixtures |
| [Later releases](later-releases.md) | Node.js, CLI and native bridges, CRDT replication, additional engines and agent access |

The [project scope](../../project/PRODUCT_SCOPE.md) sets release boundaries. The [milestone gates](../../project/MILESTONES.md) and [release plan](../../project/RELEASE_PLAN.md) define how each milestone is verified.
