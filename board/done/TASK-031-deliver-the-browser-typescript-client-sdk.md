---
id: TASK-031
title: Deliver the browser TypeScript client SDK
priority: high
created: 2026-11-24
depends_on: [TASK-027, TASK-030]
labels: [m2, epic-09, delivery]
---

# Goal

Deliver the browser TypeScript client SDK.

# Context

- **Milestone** M2 · Peer-to-peer database access
- **Parent epic** EPIC-09. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 16.
- **Decisions** ADR-007, ADR-008
- **Estimated effort** 4 engineer-days.

# Scope

Expose typed connection, capabilities, SQL, key-value and close APIs with timeouts and structured errors.

# Acceptance Criteria

- [x] An executable browser example uses both engine APIs with parameter or value fidelity and documented error outcomes.
- [x] SDK tests cover connect, close and timeout and verify that consumers can import it independently of the web app.

# Implementation Notes

Added the independent `@pocketdb/client` workspace package. `connect` parses and scopes invitation URIs, uses an injected already-authenticated peer connector, negotiates protocol v1, reads the invited engine capabilities and opens an engine session. The returned discriminated client exposes typed parameterized SQL or binary-safe key-value methods, request options, structured outcomes, and idempotent close. Added unit tests and a browser example that imports by package name and exercises the real KV and PGlite adapters. Updated remote-access documentation, ADR-007, package scripts and the lockfile. See [browser evidence](../../artifacts/task-031-client-sdk/README.md).

# Validation

Commands and outcomes:

- `pnpm install --frozen-lockfile` — passed; workspace dependencies linked from the locked store.
- `pnpm --filter @pocketdb/client typecheck` — passed, including source, tests and browser example.
- `pnpm --filter @pocketdb/client test` — passed, 5 tests.
- `pnpm --filter @pocketdb/client test:browser` — passed in Chrome Canary 160.0.8181.0 on macOS 27.0.1 arm64. Verified binary KV fidelity, parameterized SQL and binary-result fidelity, structured SQL failure, and close of both engine sessions.
- `pnpm check` — passed (format, lint and all package typechecks).
- `pnpm test` — passed, 104 tests across all packages.
- `pnpm build` — passed; Vite reported existing PGlite `node:module` externalization and direct `eval` warnings.

The browser example uses local in-process pairs and a preauthenticated fixture; it does not prove real signaling/authentication interoperability or cross-device transport. `connectPeer` must perform those steps before returning. Request timeout or cancellation after dispatch is reported as unknown and is not retried. SDK-level automatic reconnection remains separate work. See [recorded results](../../artifacts/task-031-client-sdk/results.json).
