# Agent operating guide

## Read first

1. Read [PROJECT.md](PROJECT.md) for PocketDB's purpose and constraints.
2. Read [docs/agent-workflow.md](docs/agent-workflow.md) for board rules and task selection.
3. Inspect `board/ready/` and the task's referenced docs before starting work.

## Work rules

- Treat task file location as its state: `backlog/`, `ready/`, `in-progress/`, `blocked/`, or `done/`.
- Start only a ready task whose dependencies are all in `done/`. Do not take work already in `in-progress/` without explicit direction.
- Claim with a non-overwriting move, then verify the file is in `in-progress/`.
- Keep changes within task scope. Do not invent product requirements or expand the architecture.
- Follow existing code conventions. Run relevant checks stated by the task and repository; record exact commands and outcomes.
- Update implementation notes and validation evidence before moving a task to `done/`. If blocked, document the missing information and unblock action, then move it to `blocked/`.
- Record durable architectural choices in `docs/decisions/` using the ADR template. Update relevant docs when behavior or setup changes.

## Done criteria

A task is done only when its acceptance criteria are met, required checks have passed, documentation is current, and the task file records evidence. A build or test result proves only the checks it actually ran.
