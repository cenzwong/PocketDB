# ADR-001: Static-first deployment

- Status: accepted for M1–M3
- Date: 2026-11-24
- Reversibility: high; deployment target can change without changing the browser runtime contract.

## Context

The product must not require a PocketDB-owned application backend. TASK-002 loaded a worker, WASM and OPFS under a project path on a local HTTPS preview in Chrome Canary and Edge. The fixture worked without cross-origin isolation headers; threaded WASM and the live Pages CDN were not tested.

## Decision

Build a static-first TypeScript web app and target GitHub Pages for M1–M3. Keep all database execution and default data on participant devices. Use project-relative asset paths, dedicated workers and single-threaded WASM builds. A compatible static host may distribute assets; signalling and optional TURN are separate configured services.

## Alternatives considered

- A PocketDB application backend would add hosted execution and operational ownership, contrary to the handoff.
- A header-capable static host could enable cross-origin isolated builds, but introduces deployment and browser constraints without current need.
- GitHub Pages is the stated release target and matches the measured path fixture; production CDN behavior remains to be verified.

## Consequences

TASK-040 and TASK-043 must verify the real project path, HTTPS, workers, WASM assets, cache behavior and full release flow. If a P0 engine requires SharedArrayBuffer or headers, use a compatible single-threaded build or obtain a separately accepted static-host change before release. This decision does not promise Pages availability or prove its CDN behavior.

## Evidence

- [TASK-002 probe](../../artifacts/task-002-static-worker/README.md)
- [TASK-055 SQLite and DuckDB header-constrained probe](../../artifacts/task-055-static-sqlite-duckdb/README.md)
- [Handoff deployment constraints](../handoff.md)
