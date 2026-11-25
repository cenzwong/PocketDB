# `@pocketdb/engine-sqlite`

`SqliteEngineAdapter` runs SQLite WASM 3.54.1 in a dedicated module worker. SQL uses SQLite syntax and positional parameters (`?` or `?NNN`) with `{ sql, params, rowMode }`. Transactions are serialized per database; while a session holds a transaction, other sessions wait by receiving `sqlite-session-busy`.

## Storage and recovery

`memory://` is the explicit ephemeral fallback and needs no browser storage. `opfs://<name>` uses SQLite's OPFS SAH-pool VFS with Web Lock ownership. The tested build works without cross-origin isolation headers, but OPFS persistence requires a secure context, OPFS and Web Locks. Only one tab or worker can own a database at once. Browser eviction, private-context behavior, Firefox, Safari, mobile and stable-version support are not certified.

The host offers two separate exports, both available in memory and persistent mode:

- **Export snapshot** writes the versioned PocketDB `.pdb` envelope (`sqlite-database-file-v1`, SQLite version pinned in the header).
- **Export SQLite file** writes the native SQLite `.sqlite` bytes. Import validates and deserializes the file through SQLite WASM before switching the active database.

Imports create a fresh database and switch the host only after opening succeeds. Export and import are limited to 256 MiB. Native files and snapshots are unencrypted.

## Capability and fallback matrix

| Environment                                    | WASM query                | OPFS persistence                         | Cross-origin isolation              | Fallback                                                                         |
| ---------------------------------------------- | ------------------------- | ---------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| Chrome Canary 160.0.8181.0, macOS 27.0.1 arm64 | Measured: pass            | Measured: pass, including worker restart | Not enabled; pass                   | `memory://` query pass                                                           |
| Stable Chromium, Edge, Firefox, Safari, mobile | Not certified by TASK-056 | Not certified                            | Not required by tested SAH-pool VFS | Choose Memory when OPFS or Web Locks is absent; TASK-041 owns the version matrix |

Run `pnpm --filter @pocketdb/engine-sqlite typecheck`, `pnpm --filter @pocketdb/engine-sqlite test`, and `pnpm --filter @pocketdb/engine-sqlite test:browser` from the repository root. The browser runner uses the browser selected by `tests/support/chromium.mjs` and binds a loopback Vite server.
