---
id: TASK-068
title: Address PR 1 review findings
priority: high
created: 2026-11-25
depends_on: [TASK-067]
labels: [review, verification]
---

# Goal

Address the nine review findings on [PR #1](https://github.com/cenzwong/PocketDB/pull/1).

# Context

The PR head includes a partial repair in `b1dc161`.

# Scope

SQLite ownership, SCAN matching, Node signaling waits, remote session handling, PostgreSQL JSON wire output, and the Distributed Mode Pages artifact.

# Acceptance Criteria

- [x] Verify existing remedies and fix remaining review findings.
- [x] Run targeted regressions and workspace checks, then push to the PR branch.

# Implementation Notes

| Review | Resolution |
| --- | --- |
| 1. SQLite queued ownership | The existing fix checks ownership inside the queue. The regression now dispatches the two sessions concurrently and verifies that the second cannot write. |
| 2. SQLite savepoints | Read SQLite's autocommit state after each execution, including errors. This covers commented SQL, outermost savepoints, and rollback to a savepoint. |
| 3. Distributed Pages entry | Retained the existing second Vite entry. Made the hosted console link project-relative and exercised the mounted page in the Pages artifact probe. |
| 4. Node signaling waits | Wait for the offer before starting the channel deadline. Observe channel and negotiation failures together and cancel the remaining waits when either fails. |
| 5. Late remote opens | Retained cleanup of sessions that finish opening after close and added a delayed-open disconnect regression. |
| 6. SCAN glob matching | The bounded matcher was already committed in `b1dc161`. Its regression passed without changes to the matcher. |
| 7. Pending session limit | Reserve slots and IDs before calling the runtime and release reservations after the call settles. |
| 8. PostgreSQL JSON wire output | Encode JSON and JSONB using the field OID while preserving text and SQL NULL. |
| 9. Protocol error messages | Bound messages by the codec's limit and use a fallback for empty messages. Verify that a following request succeeds on the same connection. |

# Validation

On Node 26.13.0, pnpm 11.25.0, and Chromium 160.0.8182.0:

- `pnpm check` passed formatting, lint, type checks, and board validation.
- `pnpm test` passed the workspace unit suite, including the Node signaling and PostgreSQL driver regressions.
- `pnpm build` passed with the existing dependency warnings.
- `pnpm test:pages:artifact` passed. The Chromium probe launched Distributed Mode under `/PocketDB/`.
- `pnpm test:browser` passed on retry. The first run timed out waiting for Distributed Mode synchronization.
- `git diff --check` passed.
