---
id: TASK-048
title: Expose native bridges through the CLI
priority: medium
created: 2026-11-24
depends_on: [TASK-045, TASK-046, TASK-047]
labels: [m4, epic-16, delivery]
---

# Goal

Expose native bridges through the CLI.

# Context

- **Milestone** M4 · Native ecosystem integration
- **Parent epic** EPIC-16. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 17, 18.
- **Decisions** ADR-011, ADR-012, ADR-016
- **Estimated effort** 3 engineer-days.

# Scope

Implement the agreed CLI bridge lifecycle, connect/bridge behavior, port selection and secure output.

# Acceptance Criteria

- [x] Start each bridge from the CLI; verify startup, port conflict, Ctrl-C and remote disconnect produce stable exit codes and cleanup.
- [x] Publish package invocation examples and ensure process logs retain redaction.

# Implementation Notes

Unified both native bridge protocols behind `pocketdb connect --port N` with `--protocol resp` selecting RESP2. Added stable port-conflict/bind and remote-disconnect exit codes; SIGINT/SIGTERM perform clean shutdown. Both PostgreSQL and RESP listeners close local driver sockets and stop listening on remote client failure. Startup JSON includes protocol/host/port/engine only; invitation values stay out of output.

Published Node Redis and PostgreSQL package examples and documented exit codes in [the CLI README](../../packages/cli/README.md). Added unit lifecycle checks and a browser lifecycle matrix. Evidence: [report](../../artifacts/task-048-cli-bridge-lifecycle/README.md) and [results](../../artifacts/task-048-cli-bridge-lifecycle/results.json).

Lifecycle outcomes: success or Ctrl-C exits `0`; port conflict or bind failure exits `2`; remote host disconnect exits `4`. Each bridge still uses one invitation-bound local driver session. Non-loopback binds remain opt-in and do not provide local password authentication or TLS.

# Validation

Passed on macOS arm64, Node v25.8.1, Chrome 160.0.8181.0, node-postgres 8.23.1 and Node Redis 6.4.0:

- `pnpm check` — passed repository format/lint and all package typechecks.
- `pnpm --filter @pocketdb/cli test` — passed all 11 unit tests.
- `pnpm --filter @pocketdb/cli test:browser` — passed PostgreSQL and RESP startup plus occupied-port exit `2`, SIGINT exit `0`, remote-host-loss exit `4`, local socket closure, and listener port release for both bridges. Three separate RESP invitations each exited `4` after host loss.
- Invitations were checked against child process stdout/stderr; no token was emitted.
- `git diff --check` — passed.

The bridge protocol subsets and single-session process model remain bounded as documented in ADR-011 and ADR-012.
