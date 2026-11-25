# Filesystem project workflow

The repository holds current project state. Git records its history. A task is one Markdown file named `TASK-<number>-<slug>.md`, using the metadata schema in `templates/task.md`: `id`, `title`, `priority`, `created`, `depends_on`, and `labels`.

## State folders

- `board/backlog/`: identified, not ready.
- `board/ready/`: scoped and eligible if dependencies are complete.
- `board/in-progress/`: actively being worked on.
- `board/blocked/`: waiting on a stated blocker.
- `board/done/`: acceptance criteria are supported by evidence.

Folder location is authoritative; do not add `status:` metadata. IDs must be unique. A dependency must exist exactly once and is complete only when its file is in `done/`. Do not start work with missing, duplicate, cyclic, or incomplete dependencies.

## Working a task

1. Read `AGENTS.md`, `PROJECT.md`, this guide, and the task.
2. Check all board folders and verify dependencies.
3. Select suitable ready work. Respect priority and avoid tasks already in progress.
4. Claim the task with a non-overwriting move, such as `mv -n board/ready/TASK-012-example.md board/in-progress/TASK-012-example.md`, and verify it.
5. Implement within scope and run relevant repository checks.
6. Record implementation notes and exact validation outcomes. Move to `done/` only when acceptance criteria are met; otherwise document the blocker and move to `blocked/`.

## Adding tasks and knowledge

Copy `templates/task.md`, assign a unique ID, state verifiable acceptance criteria and dependencies, and place it in the correct board folder. Use `docs/specs/` for detailed requirements, `docs/architecture/` for durable system descriptions, and `templates/adr.md` for significant decisions stored in `docs/decisions/`.

`examples/board/` is illustrative starter material, not the live board. Remove it from a project copy if examples are not useful there.
