# ADR-018: Defer a direct Python SDK until demand is demonstrated

- Status: accepted for the current release scope; revisit when a documented consumer need is unmet
- Date: 2026-11-25
- Reversibility: high; no Python client API or wire contract is being published

## Context

The handoff places Python support after native bridges and says to add a Python SDK only where justified. TASK-049 verified the two main Python application workflows using established drivers: Psycopg for parameterized SQL and transactions, and redis-py in RESP2 mode for key-value commands. Both reach the browser-hosted engine through a local CLI bridge. TASK-061 adds a private stdio MCP server for agent workflows, and TASK-064 verifies an agent client against it. No consumer request or unserved production workflow requiring a direct Python transport was recorded in these tickets.

## Decision

Defer a direct Python SDK. Continue to support Python applications through the verified PostgreSQL and RESP driver subsets and their local CLI bridges. For agent workflows, use the MCP server or CLI from the agent host. Keep these surfaces private until package-release gates are met.

Reconsider this decision only when a named use case cannot reasonably use the driver bridges, CLI, or MCP surface. Examples of evidence that could justify reopening it include a supported Python runtime that cannot launch the Node bridge, a required browser/WebRTC connection from Python, or a required PocketDB engine/operation outside the verified native-driver subsets.

## Supported and missing workflows

| Workflow | Current support | Missing or bounded behavior |
| --- | --- | --- |
| Python PostgreSQL application | Psycopg 3.3.9 against the CLI localhost bridge; parameterized INSERT/SELECT and explicit transaction commit verified | PostgreSQL bridge subset only; no pooling, TLS, binary formats, COPY, cursors, notifications, or cancellation |
| Python key-value application | redis-py 8.2.0 in RESP2 mode against the CLI localhost bridge; PING, binary GET/SET, DEL verified | RESP2 only; no RESP3, AUTH, SELECT, transactions, scripts, subscriptions, expiry options, or general CLIENT commands |
| Python direct peer connection | Not supported | No Python invitation parser, capability model, protocol client, peer authentication, WebRTC transport, signaling adapter, reconnect policy, or browser-runtime integration |
| Python agent tools | Not a native Python package | Agent workflows are available through the private MCP stdio server and command-line client; invitations and the host are provisioned in the web app |

## Alternatives considered

- Implement a direct synchronous/asynchronous Python client now: rejected because no unmet consumer need is evidenced and it would reproduce security-sensitive protocol, invitation, peer-authentication, transport, retry and compatibility work in a second language.
- Continue with standard native drivers and verified bridge subsets: chosen; it reuses mature application APIs and the existing authenticated PocketDB client behind the bridge, at the cost of requiring Node.js and a local process.
- Add Python wrappers over the Node CLI or MCP tools: not a separate SDK; callers can orchestrate existing process/protocol surfaces when needed without promising another public client API.

## Consequences

- Do not create a Python package, Python wire protocol, or SDK-specific compatibility promise from this decision.
- Keep exact Python driver versions and their tested subsets in the [native-driver matrix](../compatibility/native-drivers.md).
- Reopen the decision through a new scoped task that names the consumer, required environments, operations missing from current surfaces, security boundary and maintenance owner. If selected, define an idiomatic sync/async API and Python/Node/browser compatibility before implementation.
- This is a scope decision, not a claim that current Python bridges or MCP package are publicly released. The current packaging and approval boundary is recorded in [ADR-016](ADR-016-package-distribution-and-versioning.md).

## Evidence

- [TASK-049 Python driver verification](../../board/done/TASK-049-verify-native-drivers-and-publish-integration-examples.md)
- [Python driver examples](../../examples/python/README.md)
- [Native driver matrix](../compatibility/native-drivers.md)
- [TASK-061 MCP tools](../../board/done/TASK-061-expose-authorized-database-operations-via-mcp.md)
- [TASK-064 agent workflow](../../board/done/TASK-064-verify-an-agent-end-to-end-workflow.md)
- [Engineering handoff, staged compatibility and agent integration](../handoff.md)
