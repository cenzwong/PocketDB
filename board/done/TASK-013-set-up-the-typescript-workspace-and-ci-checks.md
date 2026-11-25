---
id: TASK-013
title: Set up the TypeScript workspace and CI checks
priority: high
created: 2026-11-24
depends_on: [TASK-012]
labels: [m1, epic-01, delivery]
---

# Goal

Set up the TypeScript workspace and CI checks.

# Context

- **Milestone** M1 · Local database runtime
- **Parent epic** EPIC-01. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 22, 23, 24, 36.
- **Decisions** ADR-001, ADR-003, ADR-017
- **Estimated effort** 3 engineer-days.

# Scope

Create the minimal workspace, static app entry point, formatter, lint, type checking, tests and CI entry points. Apply the licensing decision.

# Acceptance Criteria

- [x] Document and run a clean install, check, test and build workflow with pinned tools and a lockfile.
- [x] CI runs the same checks, the agreed license is recorded and packages are introduced as needed.

# Implementation Notes

Added a pnpm 11 workspace with the Vite static web entry point in `apps/web`, Node.js 26.13.0 and pnpm 11.25.0 pins, TypeScript 6.0.3, Vitest 4.0.16 and Biome 2.6.7. Added the exact dependency lockfile, GitHub Actions workflow, local development guide, Apache-2.0 license and generated third-party dependency license inventory. The workspace explicitly permits only esbuild's install script, disables the global virtual store and errors on stale dependencies before scripts run. No runtime package dependencies or speculative package shells were added.

The app uses relative built asset paths for project-subpath hosting and shows a minimal accessible setup status. The root README links the development workflow and license inventory. Dependency metadata lists 53 package/version pairs and no missing license fields; exact notice and copyright-holder verification remain release prerequisites per ADR-017.

# Validation

macOS arm64, using a temporary Node.js 26.13.0 binary verified against the official Node SHASUMS256 manifest and pnpm 11.25.0:

- `CI=true pnpm install --frozen-lockfile` — passed from a clean workspace `node_modules` directory; lockfile and package policy verified, and the approved esbuild install script ran.
- `pnpm check` — passed formatting, lint and strict TypeScript checks.
- `pnpm test` — passed, 1 test file and 1 test.
- `pnpm build` — passed; Vite emitted relative `./assets/...` paths for static subpath hosting.
- Dependency metadata scan — 53 package/version pairs, every package declares license metadata.

The GitHub Actions workflow runs the same frozen install, check, test and build commands. It has not yet run on GitHub because this task does not publish or push a branch. No native browser UI or deployment check is implied by the production build.
