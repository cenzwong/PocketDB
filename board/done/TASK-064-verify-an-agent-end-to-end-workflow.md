---
id: TASK-064
title: Verify an agent end-to-end workflow
priority: medium
created: 2026-11-24
depends_on: [TASK-061]
labels: [m7, epic-20, epic-22, delivery]
---

# Goal

Verify an agent end-to-end workflow.

# Context

- **Milestone** M7 · AI-native infrastructure
- **Parent epic** EPIC-20, EPIC-22. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 19, 30, 31.
- **Decisions** ADR-008, ADR-016
- **Estimated effort** 3 engineer-days.

# Scope

Publish executable agent examples using the supported SDK, CLI or MCP surface and document secure setup.

# Acceptance Criteria

- [x] An authorized agent connects to a browser-hosted database, discovers capabilities, performs scoped operations and receives structured results.
- [x] Record M7 release evidence and the chosen provisioning path, compatibility limits and known errors.

# Implementation Notes

Added [`packages/mcp-server/examples/agent.mjs`](../../packages/mcp-server/examples/agent.mjs), an executable MCP client flow that launches the stdio server, connects from a supplied invitation, inspects negotiated capabilities, runs PING or a read-only SQL query based on engine type, prints structured results without credentials, and disconnects. Updated the MCP guide with launch and credential guidance, manual host/invitation provisioning, Node/browser compatibility limits, common tool errors, and the publication boundary. The browser acceptance harness now launches the actual stdio server subprocess.

Evidence is in [`artifacts/task-061-mcp-operations/results.json`](../../artifacts/task-061-mcp-operations/results.json).

# Validation

Passed on Node v25.8.1, macOS arm64, Chrome/160.0.8181.0:

- `pnpm check` — passed repository formatting, lint and typechecks.
- `pnpm --filter @pocketdb/mcp-server test` — passed MCP unit tests.
- `pnpm --filter @pocketdb/mcp-server build` — passed server build.
- `pnpm --filter @pocketdb/mcp-server test:browser` — passed using the MCP Client SDK over stdio to the real local browser-hosted KV host; capabilities were inspected, PING succeeded, read-only SET was denied, and disconnect succeeded. Requires localhost listen permission.
- `git diff --check` — passed.

Provisioning remains manual in the web app. The package is private and this workflow does not prove package publication, internet ICE/TURN, production provisioning, or a stable browser support matrix. The agent example requires a supported engine operation; it does not grant access beyond the invitation.
