---
id: TASK-039
title: Expose local metrics and network diagnostics
priority: high
created: 2026-11-24
depends_on: [TASK-034, TASK-035, TASK-038]
labels: [m3, epic-11, delivery]
---

# Goal

Expose local metrics and network diagnostics.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-11. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 20, 21.
- **Decisions** ADR-006, ADR-008
- **Estimated effort** 3 engineer-days.

# Scope

Show connection and signalling state, direct or relay where available, activity and resource metrics. Add sanitized diagnostic export.

# Acceptance Criteria

- [x] Simulate network failure and verify actionable diagnostics and bounded logs, including absent transport information.
- [x] Verify exported logs exclude invitation secrets and query parameters by default and no external telemetry is required.

# Implementation Notes

Added a host-side Local diagnostics panel with uptime, active peer count, remote request success/failure/unknown outcomes, request and engine execution timings, operation byte counts, active requests, origin-wide browser storage estimates, signaling/ICE states, direct-versus-relay path, RTT, data-channel byte counts and buffered bytes when the browser exposes them. Missing peer statistics render as unavailable with a network/endpoint recovery action.

Remote request instrumentation reports counts and timings without retaining request bodies. The in-memory event journal is capped at 100 entries. Export uses an allow-list and excludes invitation links/capabilities, signaling URLs and their query strings, peer/session IDs, SQL text, key/value arguments and arbitrary error messages. No remote telemetry is sent. Signaling failures now show generic actionable guidance rather than raw provider error text.

Changed `packages/remote-access/src/remote-session-host.ts`, `packages/transport/src/discovery.ts`, `apps/web/src/host-administration.ts`, `apps/web/src/app.ts`, `apps/web/src/diagnostics.ts`, UI styles and browser/unit probes. Updated `docs/specs/hosted-runtime.md` with the supported metrics and their limits.

# Validation

Validation on macOS 27.0.1 arm64, Node 25.8.1, pnpm 11.25.0, Chrome 160.0.8181.0:

- `pnpm check` — passed formatting, lint and all workspace typechecks.
- `pnpm test` — passed 113 tests across all workspace packages.
- `pnpm --filter @pocketdb/web test:browser` — passed console, host administration and data-management probes. A local HTTPS signaling endpoint on a closed port simulated connection refusal; the UI showed endpoint/network recovery guidance and a missing-transport fallback. The export capture verified its JSON omitted the endpoint/query, invitation capability and SQL error text and contained at most 100 events. A local WebRTC peer reported transport diagnostics and a direct selected path; remote request counters were populated.
- `pnpm build` — passed. Vite emitted existing PGlite `node:module` externalization and direct `eval` warnings.
- `git diff --check` — passed.

Limits: browser storage usage/quota are origin-wide estimates, not database-specific accounting. Browser WebRTC stats may omit RTT, byte counters or selected candidate details; those fields remain optional and are shown as unavailable. The engine worker's internal queue depth is not currently exposed. No external telemetry or diagnostics upload is implemented.
