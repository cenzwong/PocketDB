# Development

## Requirements

- Node.js 26.13.0 (see [.node-version](../.node-version))
- pnpm 11.25.0

The workspace pins these tool versions and all direct development dependencies. `pnpm-lock.yaml` records the resolved dependency tree.

## Install and verify

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:browser
pnpm build
pnpm test:pages:artifact
```

`pnpm check` runs formatting, lint, TypeScript and board checks. `pnpm test:browser` launches the worker contract harness in Chrome Canary; set `POCKETDB_CHROMIUM` to use another Chromium executable. CI runs these checks on pushes and pull requests. The workflow attaches logs and generated browser JSON from `test-results/` as `pocketdb-test-results` for 30 days. See the [manual verification scripts](../tests/README.md) and [historical archive](archive.md).

## Start the web entry point

```sh
pnpm --filter @pocketdb/web dev
```

The build uses relative asset paths, so it can be hosted at the site root or a project subpath.

The local console supports PostgreSQL and key-value engines. Select an engine, choose an instance name and storage mode where available, then start the database. PostgreSQL uses a SQL editor; run with **⌘+Enter** or **Ctrl+Enter**. The key-value console accepts a capability-listed command and a JSON array of arguments, for example `SET` with `["greeting", "hello"]`; it uses the same keyboard shortcut. Each engine runs in a dedicated worker. Both engines use memory by default and offer optional IndexedDB storage scoped to the instance name. Key-value TTL timestamps persist across reload; browser eviction and deletion remain possible. Results and structured errors appear in the page.

## Workspace boundaries

The workspace starts with the static web app. Add a package when a ticket introduces a reusable runtime, engine, protocol, transport or SDK boundary. Keep engine packages independent from the UI and transport.

## License

PocketDB is licensed under Apache-2.0. See [LICENSE](../LICENSE), the [license decision](decisions/ADR-017-open-source-license.md) and the [development dependency inventory](third-party-dependencies.md). Verify notices and source obligations for shipped dependencies and assets before release.
