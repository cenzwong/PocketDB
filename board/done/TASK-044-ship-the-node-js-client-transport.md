---
id: TASK-044
title: Ship the Node.js client transport
priority: high
created: 2026-11-24
depends_on: [TASK-032, TASK-065]
labels: [m4, epic-13, delivery]
---

# Goal

Ship the Node.js client transport.

# Context

- **Milestone** M4 · Native ecosystem integration
- **Parent epic** EPIC-13. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 16, 17.
- **Decisions** ADR-005, ADR-006, ADR-007, ADR-016
- **Estimated effort** 5 engineer-days.

# Scope

Integrate the validated Node transport with the shared SDK while isolating platform dependencies.

# Acceptance Criteria

- [x] A documented Node example performs remote browser-hosted KV and SQL operations and distinguishes timeouts and loss of host.
- [x] Test package imports and supported Node/platform versions and record native dependency and fallback requirements.

# Implementation Notes

Added the private `@pocketdb/node-client` package. It bundles the shared client, protocol and transport TypeScript sources for Node use and injects Werift 0.28.0 as the WebRTC adapter. The connector consumes a completed room-signaling offer, answers with Werift, verifies the DTLS certificate binding and completes the existing capability authentication before returning the shared SDK client. Its send path enforces the shared 16 KiB message cap and a bounded 64 KiB buffer/16-message queue.

Added the runnable [Node KV and SQL example](../../packages/node-client/examples/remote.mjs), package README and [TASK-044 verification artifacts](../../artifacts/task-044-node-client/README.md). The example distinguishes request timeouts with unknown outcomes from host-loss events and later not-started operations. The package remains private; no registry publication was attempted.

# Validation

Environment: macOS `27.0.1` arm64, Node `v25.8.1`, pnpm `11.25.0`, Chrome Canary `160.0.8181.0`.

- `pnpm --filter @pocketdb/node-client typecheck` — passed, including package declaration imports and JavaScript syntax checks.
- `pnpm --filter @pocketdb/node-client test` — passed; Vite built the package and Node imported `connectNode` from its package entry.
- `pnpm --filter @pocketdb/node-client test:browser` — passed against the actual local PocketDB web app and a disposable loopback signaling service. Node authenticated to a browser-hosted KV instance and passed `SET`/`GET`; it authenticated to browser-hosted PGlite and passed a parameterized SQL query; the timed-out query reported `request-timeout` with `outcome: unknown`; stopping the host moved the client to `failed` and later operations returned `not-started`. Full result: [results.json](../../artifacts/task-044-node-client/results.json).
- Package import smoke — Node `v24.22.3` and `v26.13.1` Linux arm64 containers passed; Node `v25.8.1` macOS arm64 passed in the authenticated integration. Exact matrix: [runtime-imports.json](../../artifacts/task-044-node-client/runtime-imports.json). Container checks prove package loading only.
- `pnpm test` — passed, all 120 repository tests including the new Node package import smoke.
- `pnpm check` — passed formatting, lint and all package type checks.
- `git diff --check` — passed.

Limitations: full authenticated WebRTC integration was exercised only on macOS arm64 with the recorded browser version. Node 24/26 container checks did not run WebRTC; Windows, Intel macOS, other Linux architectures, separate-network/TURN connectivity and public signaling remain unverified. Werift avoids a native binary/compiler requirement; node-datachannel remains the fallback candidate from TASK-007 and has platform-specific prebuilt-binary coverage requirements. The package is private and experimental under ADR-016; its `>=24 <27` engine range is provisional until the full integration runs on each claimed release platform.
