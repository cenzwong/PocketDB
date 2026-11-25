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

Do not add `status:` front matter. Keep IDs unique. A dependency must name exactly one task across the live board and the [completion index](../board/archive/completed.json). A task is complete when it is in `done/` or the completion index. Do not start tasks with missing, duplicate, cyclic, or incomplete dependencies.

## Starting and completing work

1. Read `AGENTS.md`, `PROJECT.md`, this guide, and the candidate task.
2. Inspect the board and completion index. Run `pnpm check:board` and confirm the candidate’s dependencies are complete.
3. Choose a suitable task from `ready/`, considering priority (`critical`, `high`, `medium`, `low`) and scope. Ask for direction if priorities do not make the choice clear.
4. Claim it with a non-overwriting move, for example `mv -n board/ready/TASK-001-example.md board/in-progress/TASK-001-example.md`, then confirm the destination exists.
5. Implement only the task scope. Run checks required by the task and repository; do not infer that unrun checks passed.
6. Record implementation notes and exact validation evidence in the task file. Move it to `done/` only when its acceptance criteria are satisfied. Otherwise record the blocker and move it to `blocked/`.

## Creating work

Copy `templates/task.md`, assign the next unique task ID across the board and archive, fill its acceptance criteria and dependencies, then place it in the appropriate state folder. Keep tasks independently reviewable. Keep detailed durable requirements in `docs/specs/` and architecture knowledge in `docs/architecture/`; capture significant choices with `templates/adr.md` in `docs/decisions/`.

## Archiving completed work

1. Commit completed task records and evidence links in `board/done/`.
2. Preserve the revision containing those records with an archive ref. The current
   [archive](archive.md) covers the original 64 completed tasks.
3. Add the exact filenames and dependency edges to the completion index and remove
   their live copies in the same change. Add one batch for each distinct archive
   revision.
4. Run `pnpm check:board` and verify changed links resolve to the original records.

The [standalone scaffold](archive.md#extract-the-reusable-project-scaffold) includes
its own examples and can be extracted into a separate repository.
