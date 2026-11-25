---
id: TASK-034
title: Build host and invitation administration
priority: high
created: 2026-11-24
depends_on: [TASK-021, TASK-027, TASK-028]
labels: [m3, epic-10, delivery]
---

# Goal

Build host and invitation administration.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-10. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 5, 20.
- **Decisions** ADR-008, ADR-014
- **Estimated effort** 4 engineer-days.

# Scope

Provide status, peers, access permissions, copy and revoke invitation, disconnect and hosted instance controls.

# Acceptance Criteria

- [x] A keyboard user can create, copy and revoke an invitation and inspect and disconnect a connected peer.
- [x] Render host lifecycle warnings and capability-driven actions without exposing credentials in status displays.

# Implementation Notes

Implemented host and invitation administration in the browser console. The host selects read-only or read-write access, supplies an HTTPS signaling endpoint (loopback HTTP for development), creates and copies a capability-scoped link, and can revoke it. Read-write links show the protocol warning before copying. Connected peers appear with their public-key fingerprint, granted access and connection time; the host can disconnect them. Invitation capabilities appear only in the shareable link and are removed from the UI after revocation.

The host uses the existing WebRTC discovery, peer-bound authentication and remote session host. Invitations and the host key live in page memory. Each invitation admits one peer; disconnect also revokes that invitation, so reconnect requires a new link. PocketDB does not provide a signaling service and the endpoint is not embedded in invitation links. The client must use the same provider. The lifecycle warning asks the host to keep the tab open and device awake. No physical-device or public-signaling-provider acceptance is claimed.

Changed `apps/web/src/app.ts`, `apps/web/src/host-administration.ts`, `apps/web/src/styles.css`, the web package manifest and lockfile, browser probes, and `docs/specs/remote-access.md`.

# Validation

Environment: macOS arm64, Node v25.8.1, pnpm 11.25.0, Chrome/HeadlessChrome 160.0.8181.0.

- `pnpm check` — passed formatting, lint and TypeScript checks across all workspaces.
- `pnpm test` — passed, 110 tests across all workspace packages.
- `pnpm --filter @pocketdb/web test:browser` — passed in Chrome/HeadlessChrome 160.0.8181.0. Keyboard-created and copied a read-write invitation after its warning, confirmed status text omits the capability, revoked it and confirmed the link disappeared. An in-process signaling browser probe established an authenticated WebRTC peer, recorded its access and fingerprint, disconnected it and verified the invitation was revoked.
- `pnpm build` — passed. Existing PGlite upstream `node:module` externalization and direct `eval` warnings remain.
- `git diff --check` and trailing-whitespace scan of changed implementation, browser probes and docs — passed.

Limitations: browser peer integration uses the in-process signaling test adapter. No public signaling service, deployed cross-device path or physical-device result is asserted. The separate two-device release checks remain in their own tickets.
