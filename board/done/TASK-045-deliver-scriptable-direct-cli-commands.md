---
id: TASK-045
title: Deliver scriptable direct CLI commands
priority: high
created: 2026-11-24
depends_on: [TASK-044]
labels: [m4, epic-16, delivery]
---

# Goal

Deliver scriptable direct CLI commands.

# Context

- **Milestone** M4 · Native ecosystem integration
- **Parent epic** EPIC-16. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 18.
- **Decisions** ADR-008, ADR-016
- **Estimated effort** 3 engineer-days.

# Scope

Implement the approved direct command surface for connect, query, ping, inspect and authorized export.

# Acceptance Criteria

- [x] Test noninteractive JSON, exit codes, configurable timeouts, validation and credential redaction.
- [x] Document invocation and credential options and show an end-to-end run against a browser host.

# Implementation Notes

Added private workspace package `packages/cli` with the `pocketdb` binary and authenticated `connect`, `query`, `ping`, `inspect` and bounded SQL `export` commands. Added JSON/human output modes, stable exit classes, configurable connection/request timeouts, redacted errors, environment/stdin invitation sources, explicit read-only export, package documentation and a real browser-hosted subprocess harness. Added CLI typecheck/test/browser scripts to the package and root CI scripts, updated `pnpm-lock.yaml`, and retained the project Apache license in the package. SQL ping uses the authorized schema operation because the runtime's read-only PostgreSQL policy permits only a constrained SELECT grammar. Export requires a read-only invitation and explicit SELECT; KV export is unsupported because the client exposes no key enumeration. Each host invitation serves one peer, so the browser harness creates a fresh invitation for each CLI process. The package remains private in line with ADR-016; no registry publish is part of this task.

Changed files include `packages/cli/{package.json,LICENSE,README.md,vite.config.mjs,bin/pocketdb.mjs,src/cli.mjs,test/cli.test.mjs,test/browser.mjs}`, `package.json`, `pnpm-lock.yaml`, and `artifacts/task-045-cli/{README.md,results.json}`.

# Validation

Environment: macOS 27.0.1 arm64, Node.js v25.8.1, pnpm 11.25.0, Chrome 160.0.8181.0.

- `pnpm --filter @pocketdb/cli test` — passed, 7 unit tests, including JSON validation output, exit codes, request/connect timeout configuration, read-only bounded export and invitation redaction.
- `pnpm --filter @pocketdb/cli typecheck` — passed JavaScript syntax checks for CLI and test entry points.
- `pnpm --filter @pocketdb/cli test:browser` — passed. Real browser-hosted KV connect/PING/inspect and PostgreSQL create/insert/read-only ping/parameterized SELECT/schema inspect/export passed. Read-write export was rejected and invitation URIs did not appear in child-process stdout/stderr. Result: [browser evidence](../../artifacts/task-045-cli/results.json).
- `node packages/cli/bin/pocketdb.mjs --help` — passed, displayed executable usage.
- `pnpm check` — passed root formatting, lint and all workspace type checks, including CLI.
- `pnpm test` — passed all workspace tests, including CLI.
- `git diff --check` — passed.

Remaining limits: the CLI was integrated with a local browser host and signaling service only. Public deployment, separate-network/TURN behavior and other Node platforms remain outside this command-surface ticket and retain their existing release gates.
