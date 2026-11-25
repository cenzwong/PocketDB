---
id: TASK-038
title: Recover browser clients from disconnects
priority: high
created: 2026-11-24
depends_on: [TASK-026, TASK-031]
labels: [m3, epic-09, delivery]
---

# Goal

Recover browser clients from disconnects.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-09. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 10, 11, 15, 16.
- **Decisions** ADR-005, ADR-006, ADR-007, ADR-008
- **Estimated effort** 4 engineer-days.

# Scope

Implement SDK and host lifecycle transitions, bounded reconnection and re-authentication.

# Acceptance Criteria

- [x] Test signaling interruption, sleep or suspension recovery and host disappearance; surface user actions and retry state.
- [x] No unknown-outcome mutation is replayed automatically and no ended or revoked session is silently restored.

# Implementation Notes

Implemented bounded initial connection retries in the SDK (three attempts by default with exponential delay inside the existing connection deadline). Retry attempts call the injected connector again, repeating signaling and authentication; authentication/revocation failures are not retried. Once an established transport is lost, pending requests settle as `unknown`, later requests fail as `not-started`, and the client enters terminal `failed` state. No operation or session is replayed. The browser console hides operations and asks the user to obtain a fresh invitation; a new invitation creates a new authenticated session. Host invitation status explains how to reconnect.

Changed SDK lifecycle and retry handling in `packages/client/src/client.ts`; WebRTC discovery cleanup in `apps/web/src/client-connection.ts`; client recovery controls in `apps/web/src/app.ts`; SDK and browser probes in `packages/client/test/client.test.ts`, `apps/web/test/client-console-probe.ts`, `apps/web/test/host-administration-probe.ts`, `apps/web/test/host-administration-browser.mjs`, and `apps/web/test/console-browser.mjs`; lifecycle contract in `packages/client/README.md` and `docs/specs/remote-access.md`.

The host-suspension measurement recorded under TASK-010 shows a brief Chromium process suspension and successful post-resume read in two Linux guests. This is Linux browser-process suspension evidence, not physical macOS sleep/wake. For any suspension that drops the established transport, TASK-038's tested recovery path is explicit fresh-invitation reauthentication.

# Validation

Validation on macOS arm64, Node 25.8.1, pnpm 11.25.0:

- `pnpm check` — passed formatting, lint and all package typechecks.
- `pnpm test` — passed all package tests, including six client SDK tests.
- `pnpm --filter @pocketdb/web test:browser` — passed console, host administration, and data management probes in Chrome 160.0.8181.0. The lifecycle probe verified transient signaling failures succeed on attempt three, host disconnect fails the old client, subsequent operations are `connection-lost:not-started`, the invitation is revoked, and a fresh invitation creates a different session that reads existing host data. The console probe verified retry guidance, hidden operations, editable invitation fields, and reconnect control state. Browser output included known macOS headless `CVDisplayLinkCreateWithCGDisplay` diagnostics; probes exited successfully.
- `pnpm build` — passed. Vite emitted the existing PGlite `node:module` externalization and direct `eval` warnings.
- `git diff --check` — passed.

Physical Mac sleep/wake was not rerun. The existing TASK-010 Linux guest suspension result is not presented as Mac sleep evidence. A current Apple Container rerun is unavailable because the downloaded official package failed local signature validation; installation was not bypassed. The browser and SDK evidence above validates the explicit recovery behavior when an established host connection ends.
