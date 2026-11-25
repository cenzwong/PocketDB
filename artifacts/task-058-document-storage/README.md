# TASK-058: Hosted document storage prototype

## Decision

For the initial document use case, use the existing hosted PostgreSQL/PGlite
engine and store each document body as `jsonb`. The concrete case is a hosted
project record with nested owner metadata, tags, and ordered workflow steps.
Keep the current SQL engine interface. This reuses an existing hosted engine
and does not add a document API or change the architecture, so no ADR is needed.

Do not select a distributed CRDT for implementation from this prototype. TASK-054
is still in `backlog/` and requires multi-peer evidence. TASK-050's one-process
convergence result does not cover authorization, transport, persistence,
revocation, or operational scale.

## Candidate comparison

- **PGlite/PostgreSQL `jsonb` (selected for the hosted prototype):** fits the
  existing hosted PostgreSQL adapter; nested JSON values can be queried with
  containment and JSONPath operators, with GIN indexes for document predicates.
  A B-tree expression index can serve a frequently queried scalar path. The
  prototype uses portable JSONL records for interchange. See the [PostgreSQL
  JSON type and indexing documentation](https://www.postgresql.org/docs/17/datatype-json.html).
- **SQLite JSON functions (viable embedded alternative):** JSON extraction and
  traversal are available through JSON functions, and expression indexes can
  support selected paths. This fits the existing embedded SQLite engine and
  portable database-file use cases, but is a separate embedded product choice.
  See [SQLite JSON functions](https://www.sqlite.org/json1.html).
- **Yjs shared types (not selected for this hosted case):** nested maps and
  arrays suit collaborative multi-writer documents, but carry CRDT merge and
  synchronization semantics rather than authoritative hosted JSON CRUD. Wait
  for TASK-054's distributed evidence before selecting it for implementation.
  See [Yjs `Y.Map`](https://docs.yjs.dev/api/shared-types/y.map).

## Reproduction

From the repository root, run:

```sh
pnpm --filter @pocketdb/engine-pglite exec vitest run test/document-storage-prototype.test.ts
```

The test creates a table with a JSONB body, seeds 512 nested documents, performs
CRUD, checks a JSONB containment query and its GIN index path, then exports 511
documents as JSONL and imports them into a fresh PGlite database. The test sets
`enable_seqscan = off` around the plan assertion because this small fixture is
estimated cheaper to scan sequentially; the assertion demonstrates index
eligibility only, not planner choice or query speed at production scale.

JSONL portability here means document records can be re-imported into another
fresh database after recreating the schema. It does not prove cross-engine SQL
compatibility, schema migration, native PostgreSQL binary compatibility, or
application-level export UX. Existing TASK-022 evidence covers persistence and
reload of the hosted engine separately.

## Scope and follow-up

The selected hosted case is supported by the existing PostgreSQL adapter; no
new adapter, document-specific protocol, or additional task is needed for this
prototype. Embedded SQLite remains a viable alternative when a selected use
case requires an embedded portable database file. Distributed documents remain
unselected pending TASK-054.
