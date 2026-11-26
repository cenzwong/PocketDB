---
id: TASK-073
title: Fix CLI and discovery review findings
priority: high
created: 2026-11-26
depends_on: [TASK-072]
labels: [review]
---

# Goal

Resolve three PR 1 findings in CLI output, discovery cancellation and bridge compatibility.

# Scope

Lossless bigint formatting, bounded data-channel discovery and PostgreSQL bridge engine validation.

# Acceptance Criteria

- [x] Fix and verify all three findings.

# Implementation Notes

- CLI output and JSONL export convert bigint values to decimal strings.
- Answerer discovery bounds and cancels the data-channel wait and closes the peer on failure.
- PostgreSQL bridges reject engines that lack PostgreSQL result metadata.

# Validation

Node 26.13.0, pnpm 11.25.0 and Chrome 160.0.8184.1.

- `pnpm check` and `pnpm test` passed.
- Focused transport and CLI tests passed, including timeout, abort, connection failure, bigint output and engine rejection.
- `pnpm test:browser` passed on retry. Its first run timed out in Distributed Mode synchronization.
- `pnpm build` and `pnpm test:pages:artifact` passed.
- `git diff --check` passed.
