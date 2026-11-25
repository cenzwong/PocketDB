# Agent operating guide

## Read first

1. Read [PROJECT.md](PROJECT.md) for stable project context.
2. Read [docs/agent-workflow.md](docs/agent-workflow.md) for task selection and state rules.
3. Inspect `board/ready/` and the selected task's referenced material.

## Work rules

- Folder location is task state; do not add a competing `status:` field.
- Start only ready tasks whose dependencies are all in `done/`.
- Do not take a task already in `in-progress/` without explicit coordination.
- Keep changes within task scope and follow repository conventions.
- Run relevant checks and record exact commands and outcomes in the task.
- Move completed tasks to `done/` only after acceptance criteria and required checks are satisfied. Record blockers and unblock actions before moving blocked work to `blocked/`.
- Record durable architecture knowledge in `docs/architecture/` and significant decisions as ADRs in `docs/decisions/`.
