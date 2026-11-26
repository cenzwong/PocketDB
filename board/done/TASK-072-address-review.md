---
id: TASK-072
title: Address replication and lifecycle review
priority: high
created: 2026-11-26
depends_on: [TASK-071]
labels: [review]
---

# Goal

Resolve five review findings on PR 1.

# Scope

Replication, PostgreSQL bridge counts, host cleanup, MCP inspection and SQLite storage identity.

# Acceptance Criteria

- [x] Address each finding and verify relevant behavior.

# Implementation Notes

- Replication uses a session-specific update origin, enabling forwarding to other connected peers.
- PostgreSQL UPDATE and DELETE tags include zero counts.
- Pending peers and authentication listeners are closed when invitations are revoked.
- MCP inspection requests schema only when negotiated.
- SQLite persistent names are restricted to letters, digits, underscores and hyphens to avoid aliases. Existing names outside this set require migration.

# Validation

Node 26.13.0, pnpm 11.25.0 and Chrome 160.0.8184.1.

- `pnpm check` passed formatting, lint, type checks and board validation.
- `pnpm test` passed workspace unit tests. Focused Yjs and host-lifecycle tests also passed.
- `pnpm test:browser`, `pnpm build` and `pnpm test:pages:artifact` passed.
- `git diff --check` passed.
