---
id: TASK-002
title: Measure static hosting and worker compatibility
priority: critical
created: 2026-11-24
depends_on: [TASK-001]
labels: [m0, epic-00, spike]
---

# Goal

Measure static hosting and worker compatibility.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 25, 31.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 2 engineer-days.

# Scope

Build a small JS and WASM worker experiment for a GitHub Pages project path. Own the static deployment and supported browser recommendations. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Record asset and worker loading over HTTPS on a Pages deployment or equivalent header-constrained preview; distinguish the two environments.
- [x] Record COOP/COEP, SharedArrayBuffer and OPFS observations by browser and identify a compatible fallback or a release blocker.

# Implementation Notes

Added a standalone [static worker probe and results](../../artifacts/task-002-static-worker/README.md). The header-constrained HTTPS preview exercises a Pages-style project prefix and an isolated control. Recommend a single-threaded worker build for the initial Pages baseline and an explicit ephemeral fallback when persistent storage is unavailable. ADR-001, ADR-009, ADR-010 and ADR-014 remain for TASK-012 review.

# Validation

- Ran the Python 3.13 TLS preview, the documented `node verify-chromium.mjs` command for Chrome Canary and Edge, and the documented certificate-verified `curl` loop. See the [exact commands and matrix](../../artifacts/task-002-static-worker/README.md).
- Both browsers loaded the project-relative worker and WASM, returned 42 and passed an OPFS synchronous write/read in both configurations. The baseline omitted COOP and COEP and exposed no SharedArrayBuffer. The isolated control exposed SharedArrayBuffer and passed the shared-buffer mutation. HTTP evidence confirms the headers, MIME types and root asset 404.
- `node --check` passed for `site/probe.js` and `site/worker.js`. Python AST parsing passed for `preview.py`. Pages deployment and broader browser validation remain release work.
