---
id: TASK-071
title: Resolve PostgreSQL wire review findings
priority: medium
created: 2026-11-25
depends_on: [TASK-070]
labels: [review, verification]
---

# Goal

Resolve the two attached inline findings on [PR #1](https://github.com/cenzwong/PocketDB/pull/1).

# Scope

PostgreSQL array result encoding and recovery of backend SQLSTATE codes.

# Acceptance Criteria

- [x] Verify the two fixes with a native PostgreSQL driver over TCP.
- [x] Pass workspace checks and update the existing PR.

# Implementation Notes

- The bridge emits PostgreSQL array text with nested dimensions, escaped elements, and distinct SQL NULL values. Column OIDs distinguish scalar JSON, JSON array elements, and the box array delimiter.
- Backend codes such as `postgres-sql-42p01` surface as uppercase SQLSTATEs, with existing bridge error mappings preserved.
- Decoded JSON arrays inside `json[]` or `jsonb[]` are treated as JSON elements because decoded JavaScript values carry no dimension metadata for that distinction.

# Validation

On Node 26.13.0 and pnpm 11.25.0:

- `node --test --test-name-pattern 'PostgreSQL array results|backend SQLSTATE' packages/cli/test/cli.test.mjs` passed two TCP driver regressions, covering simple and extended queries.
- `pnpm check` passed formatting, lint, type checks, and board validation.
- `pnpm test` passed the workspace unit suite.
- `pnpm --filter @pocketdb/cli test:browser` passed the CLI integration suite with Chromium 160.0.8182.0.
- `git diff --check` passed.
