# ADR-004: Engine adapter contract

- Status: accepted for M1
- Date: 2026-11-24
- Reversibility: medium; preserve a transport-independent contract and version behavior deliberately.

## Context

The P0 engines have different APIs and transaction semantics. TASK-005 measured worker PGlite persistence and a separate IndexedDB key-value store. TASK-006 found shared PGlite backend PID 42 and required serialized logical transactions. Neither spike establishes a broad uniform SQL/key-value abstraction.

## Decision

Define a small TypeScript engine contract for instance lifecycle, capabilities, session lifecycle, typed execution, structured errors, health and stop. Implement the P0 key-value engine and PGlite as separate adapters. Expose engine-specific operations through capability-scoped methods rather than flattening both into one universal query API. Keep adapters independent from UI and transport.

## Alternatives considered

- Directly coupling the SDK to each engine duplicates routing and lifecycle behavior.
- A universal SQL-like abstraction would erase meaningful differences and is unsupported by evidence.
- A broad plugin system now would introduce registration and compatibility needs before a second-party adapter exists.

## Consequences

TASK-014 owns reusable contract tests and instance isolation. PGlite transactions must be serialized per shared engine instance; session loss must roll back before releasing ownership. Do not enable arbitrary remote read-only SQL until authorization is separately proven. Revise the contract if measured engine behavior cannot satisfy it.

## Evidence

- [TASK-005 persistence and PGlite](../../artifacts/task-005-persistence/README.md)
- [TASK-006 transaction and read-only behavior](../../artifacts/task-006-sql-sessions/README.md)
- [Engineering handoff, engine contract](../handoff.md)
