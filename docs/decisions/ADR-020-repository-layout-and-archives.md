# ADR-020: Repository layout and historical archives

- Status: accepted
- Date: 2026-11-25

## Context

The initial product tree tracked generated evidence alongside production
code, reusable probes, completed work, and overlapping planning documents.
Several active browser suites imported a helper from the evidence directory
or wrote reports back into it.

## Decision

Keep product code in `apps/` and `packages/`, package-owned tests beside
their packages, and shared and cross-workspace verification in `tests/`.
Keep the reproducible static SQLite/DuckDB, Yjs and vector search probes
isolated in `experiments/` with their source and installation instructions.
Send current verification reports to ignored `test-results/` and attach
them to the corresponding GitHub Actions run. The Pages deployment uses
its own build artifact.

The [historical archive](../archive.md) pins the last original tree. It
preserves the exact evidence, completed task notes, original plans, and the
standalone agent-native scaffold. The board keeps a local completion index
for archived IDs and dependency edges. [PROJECT.md](../../PROJECT.md) is the
entry point for current project scope and release state. The root lockfile
and isolated experiment lockfiles preserve reproducibility.

Use pnpm recursive workspace scripts for type checks, unit tests and browser
tests. Keep browser runs serialized because the Node client, CLI and MCP
checks can build the same Node-client output.

## Alternatives considered

- A checked-in archive directory would preserve convenient browsing while
  keeping every old file in each application checkout. A commit-pinned
  snapshot plus completion index retains traceability with fewer files.
- Combining client, Node client and transport could reduce manifests but
  would couple browser and Node dependencies and entry points. Keeping the
  core client and protocol shared allows both environments to evolve.
- Combining CLI and MCP would group two Node entry points that have distinct
  consumers, dependencies, and release boundaries. Combining engines would
  group optional WASM, CRDT and persistence dependencies and complicate
  independent loading and testing. The runtime and remote-access packages
  also serve different roles, with authorization and routing owned by
  remote access. All current package boundaries are retained.

## Consequences

Historical records are read at their original Git revision with their
original paths. Full-history checkouts can inspect them directly. A
repository tag retains the archive even if the cleanup PR is squash merged.
The reusable starter can be extracted into a separate repository when needed.
Routine CI output expires after 30 days. Preserve exceptional release evidence
in a durable release attachment or commit-pinned record and cite it from the
owning task.
