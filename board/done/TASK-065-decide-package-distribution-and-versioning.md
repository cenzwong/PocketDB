---
id: TASK-065
title: Decide package distribution and versioning
priority: high
created: 2026-11-24
depends_on: [TASK-032]
labels: [m4, epic-01, epic-22, decision]
---

# Goal

Decide package distribution and versioning.

# Context

- **Milestone** M4 · Native ecosystem integration
- **Parent epic** EPIC-01, EPIC-22. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 16, 23, 26, 29.
- **Decisions** ADR-003, ADR-017
- **Estimated effort** 3 engineer-days.

# Scope

Resolve ADR-016 for the SDK, CLI, bridge and future packages. Define package public boundaries and prerelease workflow.

# Acceptance Criteria

- [x] Document versioning, compatibility, release approvals and a repeatable installable artifact workflow with publication gated by release approval.
- [x] Verify a dry-run package build and test installation from the packaged artifact.

# Implementation Notes

Added ADR-016 and a local pack/install smoke for the dependency-free `@pocketdb/protocol` package. Its `0.1.0` version enables a reproducible local tarball; it remains private and is not approved for publication. The public SDK boundary is `@pocketdb/client`; built JS/declarations and released internal dependency versions are required before that package is released. Package evidence and the tested tarball are in [artifacts/task-065-package-release](../../artifacts/task-065-package-release/README.md).

# Validation

Commands and outcomes (macOS `27.0.1`, Node `v25.8.1`, pnpm `11.25.0`):

- `bash artifacts/task-065-package-release/run.sh` — passed. `pnpm pack --dry-run --json` recorded the package manifest and files; `pnpm pack` created `@pocketdb/protocol@0.1.0`; npm installed that tarball in a clean temporary consumer; Vite 8.0.0 bundled imports from the installed artifact; Node executed the bundle and the invitation round-trip passed. Tarball SHA-512 is recorded in the artifact folder.
- `pnpm check` — passed (Biome formatting/lint and TypeScript checks for all packages).
- `git diff --check` — passed.
- `bash -n artifacts/task-065-package-release/run.sh` — passed.

Limit: this proves the artifact workflow using the private protocol package's current TypeScript source export. It does not prove that `@pocketdb/client` is release-ready; public SDK packaging still requires executable JS/declarations, external dependency versions, release compatibility checks, licensing review and explicit approval. No registry publication was attempted.
