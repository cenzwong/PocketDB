# ADR-010: Worker execution and host lifecycle

- Status: accepted for M1–M3
- Date: 2026-11-24
- Reversibility: medium; worker ownership and persistence adapters remain behind runtime interfaces.

## Context

TASK-002 loaded a module worker and WASM without cross-origin isolation. TASK-005 ran PGlite in a worker. TASK-010 measured hidden-tab reads, DevTools freeze/resume, reload and close in Chrome/Edge, and host browser suspension/restart across two Apple Container Linux peers. Full guest restart recovered a saved marker after fresh negotiation in 3,162 ms. The container does not measure physical Mac sleep.

## Decision

Run database execution in dedicated workers and keep the page responsive. Warn hosts to keep the tab open and device awake. After a bounded health check, reconnect and reauthenticate; reload or close requires a new worker/session. Treat mutation timeout after dispatch as unknown. Persistent data may recover subject to browser storage and ownership. Physical host sleep/wake remains a required release certification check in TASK-043.

## Alternatives considered

- Main-thread execution avoids worker messaging but risks blocking the UI during database work.
- SharedArrayBuffer/threaded WASM could add performance, but requires isolation headers not present in the static baseline.
- An always-on server host changes the data ownership and availability model.

## Consequences

Worker termination must settle pending requests, release ownership after rollback, and report uncertain mutation outcomes. The observed Linux container process suspension/restart is development lifecycle evidence only. Do not claim uptime or background availability. Safari, mobile and forced OS discard remain unverified.

## Evidence

- [TASK-002 static worker matrix](../../artifacts/task-002-static-worker/README.md)
- [TASK-005 PGlite worker/persistence](../../artifacts/task-005-persistence/README.md)
- [TASK-010 lifecycle and container matrix](../../artifacts/task-010-host-lifecycle/README.md)
