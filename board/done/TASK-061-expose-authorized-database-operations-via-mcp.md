---
id: TASK-061
title: Expose authorized database operations via MCP
priority: medium
created: 2026-11-24
depends_on: [TASK-044, TASK-060]
labels: [m7, epic-19, delivery]
---

# Goal

Expose authorized database operations via MCP.

# Context

- **Milestone** M7 · AI-native infrastructure
- **Parent epic** EPIC-19. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 19, 31.
- **Decisions** ADR-008, ADR-016
- **Estimated effort** 4 engineer-days.

# Scope

Reuse the SDK for connection, capability and schema discovery, supported reads and writes, export and disconnect.

# Acceptance Criteria

- [x] An MCP client connects to a test browser-hosted instance and executes only invitation-authorized operations with structured results.
- [x] Document tool scope, credential redaction, errors and provisioning expectations. Verify unauthorized operations are denied.

# Implementation Notes

Added the `@pocketdb/mcp-server` package with stdio startup, structured tools for connection lifecycle, capability/schema inspection, SQL queries, KV operations, and bounded read-only CSV export. All database work delegates to the PocketDB Node SDK. Invitations and signaling URLs are not returned or logged; returned errors redact URL credentials. The package documents its local stdio boundary and requires users to provision the host and invitation in the web app.

Added unit coverage for structured responses, denied SDK operations, and credential redaction. Added a browser integration that connects to a real local PocketDB KV web host through local room signaling using a read-only invitation.

Documentation: `packages/mcp-server/README.md`, `docs/guides/mcp.md`, and `docs/guides/README.md`. Browser evidence: [`artifacts/task-061-mcp-operations/results.json`](../../artifacts/task-061-mcp-operations/results.json).

# Validation

Passed on Node v25.8.1, macOS arm64, Chrome/160.0.8181.0:

- `pnpm check` — passed formatting, lint, and workspace typechecks.
- `pnpm test` — passed all workspace test suites, including the MCP server test.
- `pnpm --filter @pocketdb/mcp-server build` — passed TypeScript build.
- `pnpm --filter @pocketdb/mcp-server test:browser` — passed; the real browser-hosted KV instance allowed PING and inspection, denied SET under a read-only invitation, and disconnected cleanly. Requires localhost listen permission.
- `git diff --check` — passed.

Limitations: the browser run uses a local signaling server and one browser-hosted instance. It does not verify internet ICE traversal, TURN, production deployment, or a supported browser matrix. Database provisioning and invitation creation remain a user action in the web app.
