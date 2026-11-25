# PocketDB project context

## Objective

PocketDB is browser-native database infrastructure: users should be able to start a temporary database in a browser, share access, and let clients perform database operations without installing a database server or provisioning a hosted database.

## Scope

The product direction includes a static-first web app, browser-hosted engines, peer-to-peer connectivity, portable local data, client SDKs, and later native protocol bridges and distributed CRDT modes. The staged scope and requirements are defined in [the engineering handoff](docs/handoff.md).

## Constraints and non-goals

- Database execution and default storage belong on participating user devices, not a centrally managed database service.
- Keep transport and engine interfaces replaceable.
- State guarantees and connectivity limitations explicitly.
- Do not claim full PostgreSQL/Redis compatibility or production-grade availability without evidence.
- Do not build a backend, database, or orchestration service for project management; the repository and Markdown board are the control plane.
- Do not implement the full product before the plan and technical feasibility gates in the handoff are addressed.

## Architecture

The [target architecture](docs/architecture/) and [specifications](docs/specs/) distill the handoff. The [decision summary](docs/decisions/) links accepted choices and follow-up gates.

## Current phase

M0 feasibility passed conditionally through TASK-012. The project is entering M1 local runtime implementation under the decisions in [docs/decisions](docs/decisions/). Later release gates retain browser, network, security and physical-device evidence that remains outstanding.

## Definition of success

The first product proof is a reproducible end-to-end flow: open the website, start a database, share an invitation, connect from another device, execute an operation, and receive its result. Each milestone must have explicit acceptance evidence and documented limitations.
