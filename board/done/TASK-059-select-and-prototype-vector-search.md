---
id: TASK-059
title: Select and prototype vector search
priority: low
created: 2026-11-24
depends_on: [TASK-022]
labels: [m6, epic-18, delivery]
---

# Goal

Select and prototype vector search.

# Context

- **Milestone** M6 · Engine expansion
- **Parent epic** EPIC-18. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 7, 31.
- **Decisions** ADR-004, ADR-010
- **Estimated effort** 3 engineer-days.

# Scope

Validate use cases and compare JS and WASM indexing options on representative datasets.

# Acceptance Criteria

- [x] Record query quality, startup, memory and indexing/search timing and define a bounded acceptance dataset.
- [x] Record a release scope recommendation and follow-up work for the selected adapter.

# Implementation Notes

Added the dependency-free deterministic probe `artifacts/task-059-vector-search/probe.mjs` and its report/results. It compares exact JavaScript and WebAssembly flat scans on 1,000, 10,000 and 50,000 synthetic 128-dimensional vectors, measuring exact Recall@10, compile/instance/index-copy/search times and accounted index/scratch bytes. Both candidates returned identical results. Selected JavaScript exact scan for a bounded first release, behind an implementation-independent index contract; the 10,000-vector tier is a benchmark tier only, not a browser capacity guarantee. Follow-up work: implement the selected bounded exact adapter, validate it in the static browser worker, define the supported cap from browser measurements, and revisit WASM/HNSW only with real embedding quality, persistence and memory evidence. No application architecture changed and no ADR is needed.

# Validation

Environment: macOS 27.0.1 arm64, Node.js v25.8.1. Package registry DNS was unavailable and Apple Clang could not link WASM; the probe therefore uses a generated 171-byte scalar WebAssembly module and adds no dependency.

- `node artifacts/task-059-vector-search/probe.mjs` — passed twice; wrote the reproducible results in `artifacts/task-059-vector-search/results.json`. Each tier ran 16 fixed queries, 31 iterations per query with four warmups discarded. WASM Recall@10 against JavaScript exact was 1.0 at all tiers. In the latest run, median search including top-10 selection was JS/WASM: 0.146/0.097 ms (1k), 1.200/0.962 ms (10k), and 6.078/4.816 ms (50k). Accounted index/scratch memory was 0.52/0.52 MB, 5.20/5.24 MB, and 26.00/26.02 MB respectively. The report separates module compile, per-size instantiation/memory, and vector-copy times.
- `node --check artifacts/task-059-vector-search/probe.mjs` — passed.
- `git diff --check` — passed.

Remaining evidence boundary: Node synthetic-vector results do not establish browser-worker timings, static asset delivery, real semantic relevance, persistence, multi-client behavior, or an approximate-index recall trade-off. Follow-up work is recorded in the prototype report; these checks must define any actual supported dataset limit.
