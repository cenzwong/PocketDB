---
id: TASK-078
title: Repair transaction cleanup and result uncertainty
priority: high
created: 2026-11-26
depends_on: [TASK-077]
labels: [review]
---

# Goal

Resolve the three PR findings on transaction ownership, uncertain worker outcomes and CLI export truncation.

# Acceptance Criteria

- [x] Verify all three fixes and preserve existing authorization and failure semantics.

# Implementation Notes

- DuckDB transaction tracking skips leading SQL line and nested block comments.
- The worker adapter marks only the active dispatched execution uncertain on worker failure; the runtime preserves that error and the remote protocol reports an unknown outcome. Queued requests and failed dispatches remain distinct.
- CLI JSONL export propagates the backend truncation flag.

# Validation

Node 26.13.0, pnpm 11.25.0 and Chrome 160.0.8184.1.

- `pnpm check` and `pnpm build` passed.
- `pnpm --filter @pocketdb/engine-duckdb test:browser` passed with commented transaction commands.
- `pnpm --filter @pocketdb/remote-access test` and `pnpm --filter @pocketdb/runtime test` passed, including worker crash, worker timeout and queued-call regressions.
- `node --test packages/cli/test/cli.test.mjs` passed, including truncated empty and nonempty exports.
- `pnpm check:board` and `git diff --check` passed.

