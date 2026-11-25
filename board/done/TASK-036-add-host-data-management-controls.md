---
id: TASK-036
title: Add host data management controls
priority: high
created: 2026-11-24
depends_on: [TASK-033, TASK-034]
labels: [m3, epic-10, delivery]
---

# Goal

Add host data management controls.

# Context

- **Milestone** M3 · Hackathon-ready release
- **Parent epic** EPIC-10. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 14, 20.
- **Decisions** ADR-015
- **Estimated effort** 2 engineer-days.

# Scope

Expose export, import, restore, reset and delete with clear destructive-action confirmation and storage status.

# Acceptance Criteria

- [x] Both engines export and restore through the UI and failed imports preserve the active instance.
- [x] Verify keyboard access, empty states and reload/storage warnings.

# Implementation Notes

- Added host-console controls for portable snapshot export, snapshot restore, reset and delete.
- Restore and reset start a new instance first. The console switches only after that instance starts successfully, then closes the previous worker and removes its IndexedDB database. A failed or incompatible import keeps the active instance and its data available.
- Export downloads an unencrypted `.pdb` file. The interface warns that memory data is temporary and that browser-managed IndexedDB may be cleared or evicted. Reset/delete use native destructive-action confirmation; import is keyboard-focusable and the key browser shows its empty state after reset.
- Documented storage and replacement behavior in `docs/specs/hosted-runtime.md`. No ADR change was needed; snapshot formats and fresh-destination behavior are already decided in ADR-015.
- Remaining limitation: snapshot files are unencrypted, and IndexedDB persistence remains subject to browser storage policy.

# Validation

- `pnpm check` — passed: Biome format/lint and all eight workspace TypeScript checks.
- `pnpm test` — passed: all 110 workspace tests.
- `pnpm --filter @pocketdb/web test:browser` — passed in Chrome Canary 160.0.8181.0. The suite covered PostgreSQL and key-value export, valid restore, failed-import preservation, reset and delete, plus keyboard focus, empty state, IndexedDB reload/storage warning and memory warning.
- `pnpm build` — passed. Vite reported the existing PGlite `node:module` externalization and direct `eval` warnings.
- `pnpm exec biome format --write apps/web/src/app.ts apps/web/src/styles.css apps/web/test/console-browser.mjs apps/web/test/data-management-browser.mjs apps/web/package.json` — completed with no further changes.
- `git diff --check` and trailing-whitespace scan of changed files — passed.
