# Shared and cross-workspace verification

The automated unit and browser suites live alongside the package or app they
exercise. `pnpm test` and `pnpm test:browser` run them from the repository
root. `pnpm check:board` validates active and archived IDs and dependencies.
The browser suites share [the Chromium launcher](support/chromium.mjs).

Run these on-demand checks from the repository root after installing the workspace.

| Command                                                                                           | Purpose                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash tests/two-container-peers/run.sh`                                                           | Run the two-browser Hosted Mode check in separate Docker containers. Requires Docker with Linux amd64 support and OpenSSL. The isolated HTTPS signaling fixture uses a disposable certificate. Writes KV and PostgreSQL reports to `test-results/task-032-two-container-peers/`. |
| `mkdir -p test-results && node tests/performance/measure-startup.mjs > test-results/startup.json` | Measure cold and warm startup for the key-value and PostgreSQL worker engines.                                                                                                                                                                          |
| `bash tests/package-release/run.sh`                                                               | Pack the private protocol package, install it in a clean npm consumer, and build and run the consumer. Writes the archive and logs to `test-results/task-065-package-release/`.                                                                         |

The [historical archive](../docs/archive.md) preserves prior measurements,
container runs, the physical sleep/wake runbook, and the package smoke result.
