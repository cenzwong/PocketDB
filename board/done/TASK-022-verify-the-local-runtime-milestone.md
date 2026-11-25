---
id: TASK-022
title: Verify the local runtime milestone
priority: high
created: 2026-11-24
depends_on: [TASK-019, TASK-020, TASK-021]
labels: [m1, epic-21, delivery]
---

# Goal

Verify the local runtime milestone.

# Context

- **Milestone** M1 · Local database runtime
- **Parent epic** EPIC-21. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 27, 31.
- **Decisions** ADR-014
- **Estimated effort** 2 engineer-days.

# Scope

Document and test both hosted engines using the local interface and persistent reload flows.

# Acceptance Criteria

- [x] Run the current stable Chromium browser matrix for start, execute, error, stop and reload for both adapters.
- [x] Publish exact commands, browser versions, outcomes and limitations as M1 evidence.

# Implementation Notes

Updated [M1 local runtime browser evidence](../../artifacts/task-022-local-runtime/README.md) with stable Chrome and Edge results from Linux containers on OrbStack. Changed the KV quota snapshot fixture to deterministic pseudorandom bytes so the configured quota is exercised consistently across Chromium implementations. Browser suites exercise both engines in the local console, including full page reload recovery, execution errors, and clean stop.

# Validation

Environment: macOS 27.0.1 arm64 host; OrbStack Linux x86_64 containers under emulation; Node v24.22.3; pnpm 11.25.0; Chrome 158.0.8127.88; Edge 158.0.4370.33.

- `pnpm --filter @pocketdb/web test:browser` — passed in Chrome 158.0.8127.88 and Edge 158.0.4370.33. Both engines started in dedicated workers, executed success and error paths, stopped cleanly, and recovered IndexedDB data after full page reload through the local UI.
- `pnpm --filter @pocketdb/engine-kv test:browser` — passed in Chrome 158.0.8127.88 and Edge 158.0.4370.33. Verified data reload, expiry timestamps, expiry while stopped, ownership exclusion, per-directory isolation, ephemeral reset, malformed/incompatible snapshot rejection, and quota rollback while preserving the previous database.
- `pnpm check` — passed (format, lint, and all package typechecks).
- `pnpm test` — passed (all workspace unit suites).

Limitation: stable browser runs were in Linux x86_64 containers under emulation, not native macOS browser processes. This ticket's stable Chromium matrix is complete; native macOS and physical-device validation remain later product gates.
