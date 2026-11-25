# TASK-056 SQLite adapter verification

This artifact records TASK-056's adapter-level browser contract on the tested macOS Chromium environment. The test opens a worker-owned OPFS database, executes bound SQL, exercises commit and rollback, proves a competing owner fails, stops and reopens the database from another worker, exports and imports a native SQLite file, restores a PocketDB `.pdb` snapshot and runs the explicit in-memory fallback.

Reproduce from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @pocketdb/engine-sqlite typecheck
pnpm --filter @pocketdb/engine-sqlite test
pnpm --filter @pocketdb/engine-sqlite test:browser
```

The browser runner starts a loopback Vite server and uses `artifacts/spike-support/chromium.mjs`. Its recorded result is [results.json](results.json). Loopback access is required. This is not a stable-browser certification or a test of the live Pages CDN. Version scope and fallback behavior are in [the engine README](../../packages/engine-sqlite/README.md).
