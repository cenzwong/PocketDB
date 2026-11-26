---
id: TASK-079
title: Preserve Arrow struct field types
priority: high
created: 2026-11-26
depends_on: [TASK-078]
labels: [review]
---

# Goal

Preserve nested DuckDB struct values during Arrow normalization.

# Acceptance Criteria

- [x] Decimal struct fields retain their scale, including nested containers, with browser regression coverage.

# Implementation Notes

- Propagate Arrow child field types through object normalization and retain vector element types for nested containers.

# Validation

Node 26.13.0, pnpm 11.25.0 and Chrome 160.0.8184.1.

- `pnpm check`, `pnpm build`, and `pnpm --filter @pocketdb/engine-duckdb test` passed.
- `pnpm --filter @pocketdb/engine-duckdb test:browser` passed with scaled decimals in structs, nested structs, lists in structs, and lists of structs.
- `pnpm check:board` and `git diff --check` passed.

