# ADR-003: TypeScript workspace and package boundaries

- Status: accepted for M1; review dependencies before implementation
- Date: 2026-11-24
- Reversibility: high while the public API is internal; medium after package consumers depend on it.

## Context

The first product is a browser app with reusable client operations and future Node, bridge and MCP surfaces. The handoff names a modular TypeScript workspace and pnpm/Vite as candidates. Spike fixtures are isolated, use pinned lockfiles and do not compare workspace managers.

## Decision

Use one TypeScript monorepo with pnpm workspaces and Vite for the static app. Keep browser UI, engine adapters, transport/protocol, browser SDK and Node adapters in separate import boundaries. Add a package only when a ticket introduces a reusable boundary; do not create one package per feature in advance.

## Alternatives considered

- Separate repositories add version and integration work before the browser API stabilizes.
- npm workspaces are viable but do not improve on pnpm's workspace and lockfile model for this multi-package plan.
- A single application package is simpler initially but risks coupling transport and engine code to UI; the chosen boundaries remain logical until independently consumed.

## Consequences

TASK-013 pins Node and pnpm, commits the lockfile, and validates a clean install and CI parity. Keep packages private until their API and distribution decisions are complete. Reconsider the manager only if contributors or required tooling cannot use pnpm reliably.

## Evidence

- [Engineering handoff, workspace and build constraints](../handoff.md)
- [Delivery plan](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/project/PROJECT_PLAN.md)
