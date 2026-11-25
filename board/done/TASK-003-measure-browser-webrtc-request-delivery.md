---
id: TASK-003
title: Measure browser WebRTC request delivery
priority: critical
created: 2026-11-24
depends_on: [TASK-001]
labels: [m0, epic-00, spike]
---

# Goal

Measure browser WebRTC request delivery.

# Context

- **Milestone** M0 · Technical feasibility
- **Parent epic** EPIC-00. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 25.
- **Decisions** Identified during feasibility; see the decision backlog.
- **Estimated effort** 2 engineer-days.

# Scope

Build a minimal two-browser probe that executes an in-memory key-value write and correlated read over a data channel. Use manual negotiation for the baseline. Deliver experiment source, reproducible steps, measured results, limitations, a recommendation, affected decisions and scope or estimate impact.

# Acceptance Criteria

- [x] Reproduce the write and read on two physical devices and record per-device browser versions and timings.
- [x] Record disconnect behavior and a bounded large-message experiment, with a recommendation for transport limits.

# Implementation Notes

Added the [manual WebRTC probe, runbook and evidence](../../artifacts/task-003-webrtc/README.md). Recommend a provisional 16 KiB encoded message cap, bounded by the negotiated SCTP maximum, and validation of backpressure before increasing concurrency. ADR-002, ADR-004, ADR-005 and ADR-007 remain for TASK-012 review.

# Validation

- Started `python3 -m http.server --bind 127.0.0.1 --directory artifacts/task-003-webrtc/site 9444` and ran the documented Node CDP driver. Chrome Canary 160.0.8180.0 and Edge 116.0.1938.62 on one Mac completed SET, GET, the 16/64/256 KiB echo checks and orderly channel close. See the [raw report](../../artifacts/task-003-webrtc/same-device.json).
- `node --check artifacts/task-003-webrtc/site/probe.js` and `node --check artifacts/task-003-webrtc/verify-same-device.mjs` passed.
- Later runs of `node artifacts/task-003-webrtc/verify-same-device.mjs` against `http://localhost:9444/` and `http://127.0.0.1:9450/` timed out during page navigation before signaling. The first run is the recorded passing sample.
- The user confirmed two physical macOS devices on the same Wi-Fi. The [host report](../../artifacts/task-003-webrtc/physical-host.json) identifies Chrome 160.0.0.0 and a 31,633 ms channel-open interval, including answer transfer and client processing. The [client report](../../artifacts/task-003-webrtc/physical-client.json) identifies Chrome 159.0.0.0 and a 31 ms channel-open interval. The client passed SET at 9.2 ms, GET at 9.3 ms and 16, 64 and 256 KiB echoes.
- The physical host reported channel closure 78 ms after requesting it. The same-Mac baseline separately captures client-side disconnect. Chrome versions are recorded as reported by the user agents. Exact browser builds and OS builds were unavailable.
