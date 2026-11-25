---
id: TASK-047
title: Deliver the Redis RESP localhost bridge
priority: high
created: 2026-11-24
depends_on: [TASK-044]
labels: [m4, epic-15, delivery]
---

# Goal

Deliver the Redis RESP localhost bridge.

# Context

- **Milestone** M4 · Native ecosystem integration
- **Parent epic** EPIC-15. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 17.
- **Decisions** ADR-012, ADR-016
- **Estimated effort** 4 engineer-days.

# Scope

Resolve ADR-012 and implement the approved RESP command and error subset backed by remote key-value operations.

# Acceptance Criteria

- [x] A named Redis client writes and reads a browser-hosted key and receives correct errors for unsupported commands.
- [x] Verify loopback defaults, separate client sessions, credential redaction and connection cleanup after host loss.

# Implementation Notes

Implemented `pocketdb connect --protocol resp --port N` as a bounded RESP2 bridge through the shared authenticated key-value client. Added parser bounds, fragmented/coalesced frame handling, PING, GET, SET, DEL, QUIT, measured CLIENT SETINFO acknowledgements, unsupported-command errors, one local socket per invitation and remote-host-loss cleanup. Added `redis@6.4.0` as a CLI development dependency for the integration driver.

Resolved ADR-012 in [ADR-012](../../docs/decisions/ADR-012-resp-localhost-bridge.md). Updated [decision index](../../docs/decisions/README.md), [ADR backlog](../../project/ADR_BACKLOG.md) and [CLI docs](../../packages/cli/README.md). Added RESP unit tests and browser acceptance. Evidence: [report](../../artifacts/task-047-resp-bridge/README.md) and [results](../../artifacts/task-047-resp-bridge/results.json).

Session boundary: each bridge process accepts one local Redis socket. Separate sessions use separate invitations and processes, sharing the hosted KV instance. Keys follow the SDK's valid UTF-8 string contract; values are binary-safe. The listener has no AUTH or TLS. Non-loopback binds expose the invitation authority to reachable clients and require explicit opt-in.

# Validation

Passed on macOS arm64 with Node v25.8.1, Chrome 160.0.8181.0 and Node Redis 6.4.0:

- `pnpm check` — passed repository Biome format/lint and all package typechecks.
- `pnpm --filter @pocketdb/cli test` — passed all 10 unit tests, including RESP framing, fragmentation, coalescing, length and terminator validation.
- `pnpm --filter @pocketdb/cli typecheck` — passed Node syntax checks.
- `pnpm --filter @pocketdb/cli test:browser` — passed RESP2 PING, binary SET/GET, missing-key null, unsupported INCR error, three separate invitations, invitation redaction and local socket closure after browser-host failure. Default listener metadata confirmed `127.0.0.1`.
- `git diff --check` — passed.

Compatibility remains bounded to the commands and client version documented in ADR-012; no full Redis compatibility or RESP3 claim is made.
