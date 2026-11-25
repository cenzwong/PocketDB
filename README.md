# PocketDB

PocketDB is browser-native database infrastructure. Its product direction and engineering requirements are in [the engineering handoff](docs/handoff.md); the current project phase is summarized in [PROJECT.md](PROJECT.md).

## Engineering documentation

- [Target architecture](docs/architecture/)
- [Architecture decisions](docs/decisions/)
- [Product and protocol specifications](docs/specs/)
- [Hosted Mode guides](docs/guides/)
- [Development setup](docs/development.md)
- [Static hosting and deployment](docs/deployment.md)
- [Third-party development dependency inventory](docs/third-party-dependencies.md)

## Project workflow

- Read [AGENTS.md](AGENTS.md) and [PROJECT.md](PROJECT.md) before taking project work.
- Follow [docs/agent-workflow.md](docs/agent-workflow.md) to select and update tasks in `board/`.
- New repositories can adopt the reusable scaffold in [`templates/agent-native-project/`](templates/agent-native-project/).

## Application status

M0 feasibility passed conditionally. The local browser console can start PostgreSQL and key-value engines in dedicated workers and display local results; M1 milestone verification remains in TASK-022. Remote access, release browser support and physical-device certification remain later gates. The [delivery plan](project/PROJECT_PLAN.md) maps the handoff to milestones and the [board](board/) tracks implementation and release evidence.
