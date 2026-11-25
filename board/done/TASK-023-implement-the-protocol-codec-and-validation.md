---
id: TASK-023
title: Implement the protocol codec and validation
priority: critical
created: 2026-11-24
depends_on: [TASK-012, TASK-013]
labels: [m2, epic-03, delivery]
---

# Goal

Implement the protocol codec and validation.

# Context

- **Milestone** M2 · Peer-to-peer database access
- **Parent epic** EPIC-03. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 11, 24.
- **Decisions** ADR-007
- **Estimated effort** 4 engineer-days.

# Scope

Implement versioned envelopes and engine-aware payload encoding with bounded decoding and structured errors.

# Acceptance Criteria

- [x] Codec tests cover malformed or unsupported versions, size boundaries and lossless supported binary and SQL value types.
- [x] Publish protocol fixtures and specification for negotiation, message types and correlation.

# Implementation Notes

Added the standalone `@pocketdb/protocol` package with strict v1 message schemas, correlated request IDs, version negotiation, tagged values for binary, bigint, finite numbers, arrays and objects, and bounded UTF-8 JSON encoding/decoding. Added fixtures for every message family and the [protocol v1 specification](../../docs/specs/protocol-v1.md). Updated the remote-access spec, ADR-007, architecture and development docs, plus root typecheck/test scripts. Engine adapters retain operation-specific SQL and key-value semantics. Decimal, date and timestamp values use strings where exact engine representation matters; typed-array views decode as `Uint8Array`.

# Validation

Environment: macOS arm64, Node.js 26.13.0, pnpm 11.25.0.

- `CI=true pnpm install --frozen-lockfile` — passed for all four workspace projects.
- `pnpm check` — passed (Biome format/lint and runtime, protocol and web TypeScript checks).
- `pnpm test` — passed (3 files, 27 tests; 18 protocol tests include fixture round-trips and malformed, unsupported-version, size, depth, node-count, binary, bigint and SQL value cases).
- `pnpm build` — passed; Vite production build succeeded.
- `git diff --check`, board dependency validation (66 tasks), Markdown local-link scan and protocol/docs whitespace scan — passed.

Protocol v1 is a schema and codec only. Authentication enforcement, authorization, duplicate suppression, retries, transport integration and physical-device WebRTC execution remain in their own tickets.
