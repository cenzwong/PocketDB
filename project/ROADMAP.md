# Roadmap

1. **M0 — Technical feasibility.** Parallel static hosting and browser data-channel probes lead to evidence on persistence, security, lifecycle and native interoperability. Confirm P0 scope and initial ADRs before the workspace implementation.
2. **M1 — Local runtime.** Introduce the workspace and runtime contracts, then prove worker execution and local persistence for both engines through a browser console.
3. **M2 — Peer access.** Build the authenticated request lifecycle and SDK. Make remote key-value read/write the primary proof on two devices, with a PostgreSQL query as separate evidence.
4. **M3 — Hackathon-ready.** Ship host/client consoles, reconnect and recovery, diagnostics, limits, portability, documentation and deployment. Run the full two-laptop release demonstration.
5. **M4 — Native ecosystem.** Ship Node.js, CLI and localhost bridges after the hosted protocol is stable. Prove the supported driver subsets and publish examples.
6. **M5 — Distributed mode.** Validate and ship a typed CRDT mode with offline edits, synchronization, local replica state and tested convergence.
7. **M6 — Engine expansion.** Select and validate adapters through demonstrated use cases. The handoff prioritizes SQLite above the other expansion candidates.
8. **M7 — Agent access.** Publish capability discovery and MCP integration with an executable authorized-agent scenario. Decide separately whether Python SDK or infrastructure extension work has a justified use case.

The [milestones](MILESTONES.md) give evidence gates, the [timeline](TIMELINE.md) gives ranges and the [epic catalog](epics/README.md) maps delivery work to the live board.
