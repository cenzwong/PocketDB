---
id: TASK-060
title: Publish machine-readable client capabilities
priority: medium
created: 2026-11-24
depends_on: [TASK-031]
labels: [m7, epic-19, delivery]
---

# Goal

Publish machine-readable client capabilities.

# Context

- **Milestone** M7 · AI-native infrastructure
- **Parent epic** EPIC-19. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 16, 19, 31.
- **Decisions** ADR-007, ADR-008
- **Estimated effort** 3 engineer-days.

# Scope

Extend SDK discovery with versioned, engine- and permission-scoped operation metadata and structured schema discovery.

# Acceptance Criteria

- [x] Tests verify capability decoding, unknown versions and permission-scoped operations and data types.
- [x] Publish machine-readable examples for the browser and supported programmatic clients.

# Implementation Notes

Added protocol-v1 capability manifests scoped to the authenticated engine and invitation access. The hello acknowledgement and session-open response now expose operation input/output JSON Schemas, allowed access, read-only operations and engine features. The TypeScript client validates manifest versions and expected engine/access, exposes decoded metadata, and adds typed PostgreSQL `schema()` and `describeQuery()` discovery calls.

Published read-only and read-write JSON examples for key-value and PostgreSQL clients under `docs/capabilities/v1/`, alongside the manifest JSON Schema and usage notes. Updated protocol and SDK documentation. PostgreSQL schema descriptions intentionally summarize row shapes to keep the full manifest within the protocol codec's maximum nesting depth; SDK discovery methods return the detailed typed column and field records.

# Validation

Validation on macOS 15, Node.js 25.8.1, pnpm 11.25.0:

- `pnpm --filter @pocketdb/protocol test` — passed, 45 tests.
- `pnpm check` — passed (Biome format/lint and all package typechecks).
- `pnpm test` — passed (all workspace unit tests, including protocol and browser app tests).
- `pnpm --filter @pocketdb/client test:browser` — passed in Chrome 160.0.8181.0; verified binary-safe KV values, typed PostgreSQL schema/query descriptions, SQL parameter and binary-result fidelity, structured SQL errors, and client session closure.
- `git diff --check` — passed.

No acceptance gaps remain for this task. Physical-device and published-host verification belong to separate tickets and are not claimed here.
