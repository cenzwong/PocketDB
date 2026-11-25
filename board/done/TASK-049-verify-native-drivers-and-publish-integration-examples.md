---
id: TASK-049
title: Verify native drivers and publish integration examples
priority: high
created: 2026-11-24
depends_on: [TASK-048]
labels: [m4, epic-20, epic-21, delivery]
---

# Goal

Verify native drivers and publish integration examples.

# Context

- **Milestone** M4 · Native ecosystem integration
- **Parent epic** EPIC-20, EPIC-21. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 17, 30, 31.
- **Decisions** ADR-011, ADR-012, ADR-016
- **Estimated effort** 4 engineer-days.

# Scope

Produce executable Python PostgreSQL and Redis examples and versioned compatibility coverage for supported drivers and features.

# Acceptance Criteria

- [ ] Run at least one established PostgreSQL driver and one Redis client against the remote browser through the packaged CLI.
- [ ] Publish the driver matrix with parameter, transaction, command and lifecycle limits and reviewed M4 results.

# Implementation Notes

Added pinned, runnable Psycopg 3.3.9 and redis-py 8.2.0 examples in `examples/python/`, an M4 driver matrix at `docs/compatibility/native-drivers.md`, and browser integration coverage under `pnpm --filter @pocketdb/cli test:python:browser`. The Python Redis example selects RESP2 because redis-py 8 defaults to RESP3, which PocketDB does not implement. The PostgreSQL run exposed and fixed two interoperability defects: PostgreSQL `ParameterStatus` C strings now have the required separator, and `Describe Portal` no longer receives a `ParameterDescription` message. ADR-011 and ADR-012 now include the verified Python driver boundaries. The CLI remains private and unpublished under ADR-016.

# Validation

- `POCKETDB_PYTHON=/private/tmp/pocketdb-task049-venv/bin/python pnpm --filter @pocketdb/cli test:python:browser` — passed. Chrome 160.0.8181.0, Node v25.8.1, macOS arm64, Psycopg 3.3.9, redis-py 8.2.0, node-postgres 8.23.1 and Node Redis 6.4.0. Both Python flows passed through fresh invitation-bound CLI bridge processes; transaction/parameter behavior, binary values, unsupported Redis operation, connection close and listener release were verified. Results: `artifacts/task-049-python-drivers/results.json`.
- `pnpm check` — passed: formatting, lint and all workspace typechecks.
- `pnpm --filter @pocketdb/cli test` — passed: all 11 CLI unit and protocol-framing tests.
- `git diff --check` — passed.
