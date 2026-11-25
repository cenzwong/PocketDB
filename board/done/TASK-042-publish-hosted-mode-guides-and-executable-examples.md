---
id: TASK-042
title: Publish hosted-mode guides and executable examples
priority: high
created: 2026-11-24
depends_on: [TASK-033, TASK-035, TASK-039]
labels: [m3, epic-20, delivery]
---

# Goal

Publish hosted-mode guides and executable examples.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-20. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 30.
- **Decisions** ADR-004, ADR-007, ADR-008, ADR-009, ADR-015
- **Estimated effort** 3 engineer-days.

# Scope

Write user quick start, KV and SQL browser demos, SDK reference, backup/restore and troubleshooting guides. Document architecture, engine/transport extension, persistence and security.

# Acceptance Criteria

- [x] Exercise examples in CI where practical and reproduce the hosted-mode guide from a clean checkout.
- [x] Record browser and networking limits, supported operations and relevant protocol and ADR links.

# Implementation Notes

Added a user guide index, Hosted Mode quick start with SQL/key-value walkthroughs, browser SDK reference, snapshot backup/restore guide and troubleshooting guide. The guides point to the architecture, protocol, remote-access, persistence, security and ADR records and state browser, network, capability and durability limits. Existing browser examples are now included in the CI workflow; the project-path artifact probe runs after the production build.

Changed `.github/workflows/ci.yml`, root `package.json`, `apps/web/package.json`, `README.md`, and `docs/guides/{README.md,hosted-mode.md,client-sdk.md,backup-restore.md,troubleshooting.md}`.

# Validation

On macOS 27.0.1 arm64, Node 25.8.1, pnpm 11.25.0, Chrome 160.0.8181.0:

- `pnpm check` — passed formatting, lint and all workspace typechecks.
- `pnpm test` — passed all 113 workspace tests.
- `pnpm test:browser` — passed all runtime, protocol, transport, SDK, engine and web browser probes. This included both engine workers, authenticated SDK example flows, persistent data, snapshots, remote host/client UI and diagnostics.
- `pnpm test:pages:artifact` — passed on the built artifact at `/PocketDB/`; both engines ran and a direct invitation URL opened into client mode.
- `git diff --check` — passed.
- Isolated clean-copy `pnpm install --frozen-lockfile` originally failed when registry DNS returned `ENOTFOUND`; this environmental blocker was resolved and the clean-copy retry passed (details below).

The registry blocker was resolved for this run. In an isolated source copy without workspace `node_modules`, `pnpm install --frozen-lockfile` passed using pnpm 11.25.0 and the repository lockfile. From that copy, `pnpm check`, `pnpm test`, `pnpm build`, `pnpm test:pages:artifact`, and `pnpm test:browser` all passed on Node v25.8.1, macOS arm64 and Chrome/160.0.8181.0. The Pages artifact smoke passed both worker engines and direct project-path invitation routing at `/PocketDB/`; the full browser suite included the agent MCP stdio path, CRDT, native bridge and SDK flows. Build output retains existing upstream PGlite direct-eval warnings and pnpm emitted the existing missing `arrow2csv.cjs` bin-link warning; neither caused a failure.

GitHub Actions was not triggered for this local source snapshot; the full CI command set was exercised from the clean copy instead. No changes were pushed or published during this ticket.
