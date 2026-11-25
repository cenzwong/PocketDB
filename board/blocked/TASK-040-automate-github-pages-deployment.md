---
id: TASK-040
title: Automate GitHub Pages deployment
priority: high
created: 2026-11-24
depends_on: [TASK-035, TASK-036, TASK-039]
labels: [m3, epic-12, delivery]
---

# Goal

Automate GitHub Pages deployment.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-12. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 29.
- **Decisions** ADR-001, ADR-014
- **Estimated effort** 3 engineer-days.

# Scope

Deploy the static build with reproducible CI, HTTPS, base paths, routing, cache versioning and correct WASM asset loading.

# Acceptance Criteria

- [ ] Smoke-test a real Pages deployment from its project path, including direct invitation links and both worker-hosted engines.
- [ ] Document static self-hosting and expose external networking requirements. Record deployed artifact and revision.

# Implementation Notes

Added a GitHub Actions Pages artifact/deploy workflow for pushes to `main`, the Pages artifact configuration, `.nojekyll`, static hosting and networking guidance in `docs/deployment.md`, and a local built-artifact browser probe. Invitation URLs opened at a project subpath now prefill client mode from the URL fragment while leaving the signaling endpoint blank; the capability remains in the tab URL and is not sent to the static host.

Changed `.github/workflows/ci.yml`, `apps/web/public/.nojekyll`, `apps/web/src/app.ts`, `apps/web/test/pages-artifact-browser.mjs`, `apps/web/package.json`, root `package.json`, `README.md` and `docs/deployment.md`.

# Validation

On macOS 27.0.1 arm64, Node 25.8.1, pnpm 11.25.0, Chrome 160.0.8181.0:

- `pnpm check` — passed formatting, lint and all workspace typechecks.
- `pnpm test` — passed all 113 tests across the workspace.
- `pnpm test:pages` — passed. Vite built the static artifact; Chrome served under `/PocketDB/`, ran SQL on the PostgreSQL worker, wrote/read a key-value value on its worker, and opened a generated invitation directly at `/PocketDB/` into client mode.
- `git diff --check` — passed.

Repeat local validation on macOS 27.0.1 arm64, Node 25.8.1, pnpm 11.25.0 and Chrome 160.0.8182.0:

- `pnpm check` — passed formatting, lint and all workspace typechecks.
- `pnpm test` — passed all workspace unit suites, including Node-client build/import and CLI tests.
- `pnpm test:browser` — passed the full browser integration matrix.
- `pnpm build` — passed. Vite emitted dependency externalization and direct-eval warnings from PGlite; the build completed.
- `pnpm test:pages:artifact` — passed at `/PocketDB/`; PostgreSQL and key-value workers ran, and a direct invitation opened at the project path.
- `git diff --check` — passed after the board evidence update.

The live Pages acceptance remains unverified. GitHub `main` still points to the initial handoff commit; the prepared source and workflow are in the local `codex/publish-pocketdb-deployment` branch, which has not been published. The published repository has no workflow runs, and no deployed artifact/revision is available to smoke-test. Unblock by publishing this branch for review, merging the prepared source to `main`, selecting GitHub Actions in repository Pages settings, then recording the deployed revision and repeating the browser flow at the published URL. The local project-path probe does not substitute for the hosted-site check.
