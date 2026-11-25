---
id: TASK-035
title: Build the browser client console
priority: high
created: 2026-11-24
depends_on: [TASK-031]
labels: [m3, epic-10, delivery]
---

# Goal

Build the browser client console.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-10. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 5, 20.
- **Decisions** ADR-008, ADR-014
- **Estimated effort** 3 engineer-days.

# Scope

Support opening an invitation, connecting and performing engine-specific operations with typed results and errors.

# Acceptance Criteria

- [x] Browser tests cover opening invitations, authentication failures, KV commands and SQL result rendering.
- [x] Verify keyboard navigation and a clear distinction between client and host flows.

# Implementation Notes

Added a distinct Client mode beside Host mode. Clients paste an invitation and the same HTTPS/loopback signaling endpoint used by the host. The browser connector performs WebRTC answer negotiation, DTLS-bound challenge/proof authentication and host confirmation before handing the transport to `@pocketdb/client`. The client panel displays only operations allowed by invitation access and negotiated capabilities, provides parameterized SQL and typed key-value `PING`, `GET`, `SET` and `DEL` controls, renders structured results, and offers an explicit disconnect action. Authentication and operation errors keep the SDK's codes and outcomes.

The invitation remains in the input field and is not repeated in status text. Host and client surfaces have separate mode buttons and labels. Updated the remote-access spec and added browser integration coverage for authenticated remote key-value operations, rejected altered capability, client SQL result rendering, keyboard query execution and disconnect cleanup.

Changed web app markup/logic/styles, added `apps/web/src/client-connection.ts`, added browser probes, and added the `@pocketdb/client` workspace dependency.

Limitations: PocketDB does not operate a signaling service; both peers must configure the same external provider. The browser probe uses in-process signaling and does not claim public-network or physical-device validation.

# Validation

Environment: macOS 27.0.1 arm64, Node v25.8.1, pnpm 11.25.0, Chrome/HeadlessChrome 160.0.8181.0.

- `pnpm check` — passed formatting, lint and TypeScript checks across all workspaces.
- `pnpm test` — passed, 110 tests across all workspace packages.
- `pnpm --filter @pocketdb/web test:browser` — passed in Chrome/HeadlessChrome 160.0.8181.0. The real WebRTC/in-process-signaling probe authenticated a client, ran remote KV SET/GET, verified a peer fingerprint and access, rejected an altered invitation capability, and confirmed disconnect/revocation. The client UI probe checked host/client separation, access-filtered capabilities, Ctrl+Enter SQL submission, structured SQL rows and SDK close.
- `pnpm build` — passed. Existing PGlite upstream `node:module` externalization and direct `eval` warnings remain.
- `git diff --check` and trailing-whitespace scan of changed implementation, browser probes and docs — passed.
