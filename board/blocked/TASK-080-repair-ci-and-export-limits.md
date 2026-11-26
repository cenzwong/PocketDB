---
id: TASK-080
title: Repair CI authentication and export limits
priority: high
created: 2026-11-26
depends_on: [TASK-079]
labels: [review, ci]
---

# Goal

Resolve the reported browser integration failure and bound exports with trailing SQL comments.

# Acceptance Criteria

- [ ] Diagnose and address the CI failure using evidence.
- [x] Verify both export paths preserve their limits after SQL comments.

# Implementation Notes

- CLI and MCP exports put generated LIMIT clauses on a new line, ending any trailing SQL line comment.
- CI run 45843300491 failed host administration browser authentication because signature verification reported a different peer binding. The same commit had a separate passing run, and local runs passed; the available logs do not identify the divergent signed input. The failing original and rerun used Chrome 158, while the passing run used Chrome 157; local Chrome 160 passed. The browser test records only differing signed-field indices on future failures. No authentication changes were made without evidence.

# Validation

Node 26.13.0 and pnpm 11.25.0.

- `node --test packages/cli/test/cli.test.mjs` and `pnpm --filter @pocketdb/mcp-server test` passed, including real SQLite bounded-query regressions.
- `pnpm check`, `pnpm check:board`, and `git diff --check` passed.
- `node apps/web/test/host-administration-browser.mjs` passed six local runs. GitHub Actions run 45843300491 was rerun to check the intermittent CI failure.

# Blocker

Both original CI attempt and rerun report failed challenge verification; a recurrence with the added failure-only transcript diagnostics or another reproducible cause is needed to identify a safe authentication fix.

