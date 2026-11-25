---
id: TASK-032
title: Prove remote database access on two devices
priority: critical
created: 2026-11-24
depends_on: [TASK-022, TASK-026, TASK-031]
labels: [m2, epic-21, delivery]
---

# Goal

Prove remote database access on two devices.

# Context

- **Milestone** M2 · Peer-to-peer database access
- **Parent epic** EPIC-21. See the [epic catalog](../../project/epics/README.md).
- **Source** [Engineering handoff](../../docs/handoff.md), sections 27, 31.
- **Decisions** ADR-014
- **Estimated effort** 3 engineer-days.

# Scope

Connect a minimal static host and SDK client harness for the first remote end-to-end proof.

# Acceptance Criteria

- [x] Two isolated Chromium peer containers open the static app, exchange an invitation through the local test signaling fixture, authenticate and execute a remote key-value write/read. Record actual environment and signaling fixture. This is the interim container proof requested by the user; physical two-laptop validation remains a TASK-043 release gate.
- [x] Record a remote PostgreSQL parameterized query and a rejected unauthorized request and publish reproducible steps.

# Implementation Notes

Added [the two-container peer harness and runbook](../../artifacts/task-032-two-container-peers/README.md) with a reproducible Dockerfile, isolated host/client containers, local HTTPS room-signaling fixture, automation, and saved JSON outcomes. The real-browser run exposed that the default `fetch` reference in `HttpRoomSignalingAdapter` was called without its browser-global receiver; bound the default to `globalThis` so browser signaling requests succeed. The physical two-laptop proof is explicitly deferred to TASK-043, per the user's final-product test plan.

# Validation

Environment: macOS 27.0.1 arm64 host, OrbStack, two Linux x86_64 peer containers under emulation, Chrome 158.0.8127.88. Both peers opened the static Vite app on their own loopback origins and exchanged SDP through the disposable local HTTPS room fixture over a Docker bridge.

- `TASK032_SKIP_BUILD=1 DOCKER_CONFIG=/private/tmp/pdb-docker-config DOCKER_HOST=unix:///Users/cenzwong/.orbstack/run/docker.sock bash artifacts/task-032-two-container-peers/run.sh` — passed. The image had been built from the task Dockerfile. Remote key-value `SET`/`GET` passed; a read-only PostgreSQL invitation completed a parameterized `SELECT` and rejected `CREATE TABLE` with `permission-denied`. Exact outcomes are in `result-kv.json` and `result-postgresql.json`.
- `pnpm check` — passed (format, lint and all workspace typechecks).
- `pnpm test` — passed (all workspace unit suites).
- `node --check artifacts/task-032-two-container-peers/peer.mjs`, `bash -n artifacts/task-032-two-container-peers/run.sh`, and `git diff --check` — passed.

Limitations: this does not establish physical-device, separate-network, NAT traversal, production signaling-provider, or deployed-site behavior. The latest Apple Container installer package failed `pkgutil --check-signature`, so it was not installed; OrbStack was used for the user-authorized local container proof. Physical two-laptop and sleep/wake evidence remains at TASK-043.
