# ADR-014: Browser support strategy

- Status: accepted as a staged support policy; exact stable versions await release matrix
- Date: 2026-11-24
- Reversibility: high; publish explicit per-feature capability results.

## Context

TASK-002 passed worker/WASM/OPFS fixtures in Chrome Canary 160 and Edge 116 on one Mac; TASK-005 measured PGlite persistence only in Chrome Canary. TASK-010 measured lifecycle in Canary and Edge. TASK-055 passed SQLite and DuckDB-Wasm query and file round-trip probes in Chrome Canary 160 on one Mac, including a non-isolated Pages-style preview. No Safari, Firefox, mobile, current stable cross-version or real Pages CDN result exists.

## Decision

Use current stable Chromium-based desktop browsers as the first reference target, while treating the measured Canary/Edge results as feasibility evidence rather than stable-version support claims. Make support capability-based for workers, WASM, storage and transport. Add Firefox, Safari, mobile and exact supported version ranges only after TASK-041 completes its matrix.

## Alternatives considered

- Claiming broad modern-browser support exceeds the tested matrix.
- Canary-only support would leave the release target tied to preview builds.
- Excluding all but one vendor would unnecessarily narrow a static browser app before release measurements.

## Consequences

TASK-041 must test supported stable versions and feature combinations, including storage and lifecycle behavior. Show a clear unsupported-capability error and documented fallback. If a P0 engine fails on the reference matrix, select a compatible build or revise release scope before certification.

## Evidence

- [TASK-002 browser matrix](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-002-static-worker/README.md)
- [TASK-005 PGlite matrix](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-005-persistence/README.md)
- [TASK-010 lifecycle matrix](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-010-host-lifecycle/README.md)
- [TASK-055 SQLite and DuckDB-Wasm matrix](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-055-static-sqlite-duckdb/README.md)
- [TASK-056 SQLite adapter and fallback matrix](../../packages/engine-sqlite/README.md)
- [TASK-057 DuckDB-Wasm adapter and browser contract](../../packages/engine-duckdb/README.md)
- [Distributed Mode console and compatibility evidence](../guides/distributed-mode.md): Chrome Canary 160.0.8181.0 on macOS 27.0.1, two same-machine tabs; development evidence only, not a stable-version support claim.
