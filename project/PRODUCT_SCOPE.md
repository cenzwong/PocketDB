# Product scope

| Stage | User outcome | Scope boundary |
| --- | --- | --- |
| Initial product proof (M2) | A user starts a database in a browser, shares an invitation and reads a value written from a second device. | Hosted Mode, key-value primary demonstration, PostgreSQL parameterized query and browser TypeScript SDK. The browser is the authoritative host. |
| Hackathon-ready (M3) | A team starts, shares, uses and recovers a key-value or PostgreSQL instance through the deployed site and SDK. | Accountless capability invitations, scoped sessions, connection management, local persistence, portable snapshots, diagnostics and documented limits. GitHub Pages is the deployment target. |
| Native ecosystem (M4) | An existing PostgreSQL or Redis driver reaches a browser-hosted database through a local bridge. | Node.js client, CLI and verified protocol subsets. Python driver examples use these bridges. |
| Distributed release (M5) | Authorized participants edit independent replicas offline and converge after reconnecting. | Typed CRDT operations, replicated persistence and mode-specific semantics, using the outcome of the Yjs spike. |
| Expansion and longer-term platform (M6–M7 and later) | Selected workloads gain additional adapters and authorized agents use structured capabilities. | SQLite, DuckDB, document storage and vector work are gated by use cases and runtime evidence. MCP reuses the SDK. A direct Python SDK and generalized infrastructure services require demonstrated need. Hybrid mode, broader Redis compatibility and alternative CRDT engines remain research. |

Computation and default data storage stay on user devices. Static hosting distributes application assets. Configured signalling and relay infrastructure can assist connectivity. A compatible modern browser is sufficient on the host. Hosted availability depends on the tab, browser and device remaining operational. Browser-local storage is subject to quota, eviction and user deletion. Hosted SQL uses the selected engine's transaction semantics. CRDT convergence applies only to the supported distributed operations and membership model.

Production high availability, perpetual background service, guaranteed network connectivity or storage retention, full PostgreSQL or Redis compatibility, distributed SQL and anonymous public hosting are outside the initial scope. See [handoff sections 3, 6, 7, 32 and 34](../docs/handoff.md).

The M0 feasibility gate selected a static GitHub Pages target, a TypeScript/pnpm/Vite workspace, dedicated workers, IndexedDB persistence candidates and ordered reliable WebRTC. Chromium desktop is the first implementation reference, but no stable browser version is declared supported until TASK-041 publishes measurements. Manual signalling is the baseline fallback; STUN is configurable and TURN is optional. Physical host sleep/wake remains required evidence for TASK-043.
