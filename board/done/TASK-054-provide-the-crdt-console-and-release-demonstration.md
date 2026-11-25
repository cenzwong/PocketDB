---
id: TASK-054
title: Provide the CRDT console and release demonstration
priority: medium
created: 2026-11-24
depends_on: [TASK-052, TASK-053]
labels: [m5, epic-10, epic-17, delivery]
---

# Goal

Provide the CRDT console and release demonstration.

# Context

- **Milestone** M5 · Distributed database mode
- **Parent epic** EPIC-10, EPIC-17. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 5, 20, 30.
- **Decisions** ADR-013, ADR-014
- **Estimated effort** 4 engineer-days.

# Scope

Add distributed mode controls, membership and sync status, document inspection and executable examples.

# Acceptance Criteria

- [x] Independent authorized replicas make offline edits and converge after reconnection with visible state transitions.
- [x] Publish M5 evidence, documented offline and membership behavior and a recorded supported compatibility matrix.

# Implementation Notes

Added `/distributed.html`, linked from the Hosted Mode console, with separate host/client controls for CRDT invitations, access scope, manual SDP offer/answer exchange, authenticated WebRTC membership, sync status, local document inspection, offline edits, reconnect and host revocation. Uses the TASK-052 authorization and synchronization layers and Yjs replicas; read-only invitations disable client writes. Added a two-tab Chrome browser test that exercises initial synchronization, offline host/client edits, a new peer connection, convergence and membership revocation. Added `docs/guides/distributed-mode.md` with executable steps, offline/revocation/retention behavior and a compatibility evidence table. Updated the later-release guide and ADR-013/014 evidence. The console uses manual copy/paste SDP and browser memory for this demo; it does not provide hosted signaling, TURN relay or persistent wiring.

# Validation

- `node apps/web/test/crdt-console-browser.mjs` — passed in Chrome 160.0.8181.0 on macOS 27.0.1. Two independent tabs authenticated a read-write invitation, converged on initial state, retained separate offline edits and converged after reconnect; host membership and revocation states were visible.
- `pnpm check` — passed formatting, lint and all workspace typechecks.
- `pnpm test` — passed all workspace unit suites.
- `pnpm --filter @pocketdb/web build` — passed; Vite emitted `/distributed.html` and bundled app assets. Existing PGlite `node:module` externalization and direct-eval warnings remain in the hosted-engine build.
- `git diff --check` — passed.
- Compatibility table records Chrome Canary local-tab development evidence only. Safari, Firefox, stable browser ranges, mobile, cross-network ICE/TURN and physical devices are not verified. The two-physical-device check remains at the product-end release gate as requested.
