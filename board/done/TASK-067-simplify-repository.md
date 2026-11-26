---
id: TASK-067
title: Simplify the PocketDB repository
priority: medium
created: 2026-11-25
depends_on: []
labels: [maintenance]
---

# Goal

Keep PocketDB's product checkout focused on production code, tests, reproducible experiments, and current documentation.

# Context

See [project context](../../PROJECT.md) and the [repository layout decision](../../docs/decisions/ADR-020-repository-layout-and-archives.md).

# Scope

Archive historical evidence, completed work and the reusable scaffold. Consolidate project documentation, update verification and CI, and preserve package boundaries and release gates.

# Acceptance Criteria

- [x] The reviewed tree has approximately 270–300 tracked files and retains all product and test entry points.
- [x] Clean install, static checks, unit and browser integration tests, production build, and local Pages artifact verification pass.
- [x] Active task dependencies and documentation references resolve, and generated reports are excluded from Git.
- [x] Update the existing pull request and record the archive and directory breakdown.

# Implementation Notes

Moved shared browser support and reusable checks into `tests/`, retained three
standalone experiments, and consolidated current project context in
[PROJECT.md](../../PROJECT.md). The [archive inventory](../../docs/archive.md)
accounts for all 151 former artifact files. The archive preserves 64 completed
task records, their dependency edges, and the reusable project scaffold. CI
uploads generated evidence separately from the Pages deployment artifact.
The [decision record](../../docs/decisions/ADR-020-repository-layout-and-archives.md)
documents the package consolidation review and archive design.

| Directory | Before | After |
| --- | ---: | ---: |
| Root files | 10 | 10 |
| `.github/` | 1 | 1 |
| `apps/` | 43 | 43 |
| `artifacts/` | 151 | 0 |
| `board/` | 70 | 9 |
| `docs/` | 52 | 54 |
| `examples/` | 4 | 4 |
| `experiments/` | 0 | 15 |
| `packages/` | 150 | 150 |
| `project/` | 11 | 0 |
| `templates/` | 20 | 2 |
| `tests/` | 0 | 9 |
| **Total** | **512** | **297** |

# Validation

Clean directory on macOS arm64 with Node 26.13.0, pnpm 11.25.0, and Chromium
160.0.8182.0. The test checkout used the cleanup tree with the eight unrelated
working-tree edits excluded.

- `CI=true pnpm install --frozen-lockfile` passed from an empty `node_modules`.
  pnpm warned about Apache Arrow's absent optional `arrow2csv` command.
- `pnpm check` passed formatting, lint, all 14 workspace type-check entry
  points, and validation of 67 task IDs and dependency graphs.
- `pnpm test` passed 155 unit cases and the Node-client package import smoke.
- `pnpm test:browser` passed the same 13 workspace browser entry points.
- `pnpm build` passed with dependency externalization and direct-eval warnings.
- `pnpm test:pages:artifact` passed under `/PocketDB/`, including both P0
  workers and opening a direct invitation in client mode.
- `bash tests/package-release/run.sh` passed the packed protocol consumer smoke.
- `POCKETDB_PYTHON=/tmp/pocketdb-task049-venv/bin/python pnpm --filter @pocketdb/cli test:python:browser` passed the PostgreSQL and Redis driver checks and wrote a fresh report.
- `node tests/performance/measure-startup.mjs` produced cold and warm samples
  for both P0 engines.
- The three retained experiments replayed successfully. The SQLite/DuckDB
  experiment used its documented local HTTPS and browser procedure.
- Validated 324 local or pinned Markdown targets, compared all 64 index entries
  to the archived task files, and compared the extracted 18-file scaffold byte
  for byte to the archive. `git check-ignore` confirmed representative output
  paths, `git diff --check` passed, and the root lockfile matched the baseline.

The update targets [PR #1](https://github.com/cenzwong/PocketDB/pull/1).
Live Pages, the physical two-laptop release run, and host sleep/wake remain
owned by TASK-040 and TASK-043.
