# Agent operating guide

## Read first

1. Read [PROJECT.md](PROJECT.md) for PocketDB's purpose and constraints.
2. Read [docs/agent-workflow.md](docs/agent-workflow.md) for board rules and task selection.
3. Inspect `board/ready/` and the task's referenced docs before starting work.

## Work rules

- Treat task file location as its state: `backlog/`, `ready/`, `in-progress/`, `blocked/`, or `done/`.
- Start only a ready task whose dependencies are all complete in `board/done/` or the archive index. Do not take work already in `in-progress/` without explicit direction.
- Claim with a non-overwriting move, then verify the file is in `in-progress/`.
- Keep changes within task scope. Do not invent product requirements or expand the architecture.
- Follow existing code conventions. Run relevant checks stated by the task and repository; record exact commands and outcomes.
- Update implementation notes and validation evidence before moving a task to `done/`. If blocked, document the missing information and unblock action, then move it to `blocked/`.
- Record durable architectural choices in `docs/decisions/` using the ADR template. Update relevant docs when behavior or setup changes.

## Done criteria

A task is done only when its acceptance criteria are met, required checks have passed, documentation is current, and the task file records evidence. A build or test result proves only the checks it actually ran.

## Repository Minimalism and Garbage Collection

- Keep tracked files necessary to run, test, use, or maintain PocketDB. Reuse existing entry points and update the canonical source before creating a new document or script.
- Keep tests with their owning package and shared checks in `tests/`. Keep experiments in `experiments/` with source, pinned dependencies where applicable, and reproduction steps.
- Write generated test results, build products, package archives, logs, and temporary files to ignored paths. Use CI artifacts for routine evidence. Document the reason and provenance for any versioned generated fixture or published capability document.
- During release and cleanup reviews, remove superseded plans, stale probes, and obsolete outputs from the live tree after confirming that test entry points, active dependencies and documentation links still resolve.
- Archive completed tasks with their ID, dependency edges and exact evidence location, following the [archive procedure](docs/agent-workflow.md#archiving-completed-work). Keep unresolved work on the live board and retain durable architectural decisions in ADRs.
