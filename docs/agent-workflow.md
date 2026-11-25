# Filesystem project workflow

The repository is the persistent project workspace. Markdown and directory locations hold current state; Git records its history. No external task service or mutable status field is required.

## Task states

Each task is one Markdown file named `TASK-<number>-<slug>.md` with YAML front matter containing exactly these initial metadata fields: `id`, `title`, `priority`, `created`, `depends_on`, and `labels`.

The containing folder is authoritative:

- `board/backlog/`: identified, but not ready to start.
- `board/ready/`: scoped and eligible when dependencies are complete.
- `board/in-progress/`: actively being worked on; do not claim it without explicit coordination.
- `board/blocked/`: cannot proceed until a stated blocker is resolved.
- `board/done/`: acceptance criteria have evidence and required checks passed.

Do not add `status:` front matter. Keep IDs unique. A dependency must name exactly one existing task and is complete only when that task is in `done/`. Do not start tasks with missing, duplicate, cyclic, or incomplete dependencies.

## Starting and completing work

1. Read `AGENTS.md`, `PROJECT.md`, this guide, and the candidate task.
2. Inspect all board folders and check that dependencies are in `done/`.
3. Choose a suitable task from `ready/`, considering priority (`critical`, `high`, `medium`, `low`) and scope. Ask for direction if priorities do not make the choice clear.
4. Claim it with a non-overwriting move, for example `mv -n board/ready/TASK-001-example.md board/in-progress/TASK-001-example.md`, then confirm the destination exists.
5. Implement only the task scope. Run checks required by the task and repository; do not infer that unrun checks passed.
6. Record implementation notes and exact validation evidence in the task file. Move it to `done/` only when its acceptance criteria are satisfied. Otherwise record the blocker and move it to `blocked/`.

## Creating work

Copy `templates/task.md`, assign the next unique task ID, fill its acceptance criteria and dependencies, then place it in the appropriate state folder. Keep tasks independently reviewable. Keep detailed durable requirements in `docs/specs/` and architecture knowledge in `docs/architecture/`; capture significant choices with `templates/adr.md` in `docs/decisions/`.

## Reusable scaffold

`templates/agent-native-project/` is a copyable starter, separate from PocketDB's live board. Its `examples/board/` contains one completed prerequisite and one dependent ready task to show how folder state and dependencies work. The examples are not live PocketDB tasks.
