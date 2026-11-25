# PocketDB DuckDB-Wasm adapter

`@pocketdb/engine-duckdb` is the optional analytical SQL engine. The web app loads it only after the user selects DuckDB. It uses DuckDB-Wasm 1.32.0 and the single-threaded MVP bundle. It does not require cross-origin isolation in the measured configuration.

## Supported contract

- Import local `.csv`, `.json` and `.parquet` files as tables. File names are normalized to SQL table identifiers. Imports are local owner actions and limited to 32 MiB per file.
- Execute SQL queries with scalar bound parameters (`null`, boolean, number, string, bigint and `Uint8Array`). Read-only sessions accept one `SELECT` statement.
- Return Arrow query results normalized to JSON-compatible rows, column names, row count and a truncation flag. Results are limited to 10,000 rows or 8 MiB of encoded row values, whichever comes first. Large integers become decimal strings to preserve precision; dates become ISO strings and nested values are normalized recursively.
- Use the single-threaded WASM bundle. Bound dataset imports to 32 MiB, query results to 10,000 rows and 8 MiB of encoded row values, and imports are buffered in browser memory. DuckDB-Wasm and the browser enforce their own memory ceilings; the adapter does not promise a fixed total-process memory limit.
- Run in session memory. This adapter does not advertise persistent storage because its fresh-worker OPFS reopen check failed in the current Chrome Canary harness. TASK-055 showed the underlying DuckDB-Wasm OPFS path can checkpoint and reopen in a direct probe, but that is not adapter evidence. A later persistence task must retest this lifecycle before enabling it.

The generated read-only and read-write capability documents are in [`docs/capabilities/v1`](../../docs/capabilities/README.md). The browser contract harness imports all three formats, checks aggregates, row limits, competing ownership and persistence after a fresh worker.

## Browser loading evidence

The TASK-055 static-hosting probe measured DuckDB-Wasm 1.32.0 in Chrome Canary 160.0.8181.0 on macOS 27.0.1 arm64. The MVP worker and WASM loaded under a project subpath without cross-origin isolation, and an OPFS database survived checkpoint, close and worker reopen. The built WASM was 39.4 MB raw / 8.8 MB gzip. DuckDB remains optional and lazy-loaded for this reason.

TASK-057's import and query contract is exercised in memory mode by `pnpm --filter @pocketdb/engine-duckdb test:browser`; its captured result is in [`artifacts/task-057-duckdb-adapter`](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-057-duckdb-adapter/README.md). This is one local Chromium build on one Mac. Stable Chrome/Edge, Firefox, Safari, mobile, persistent storage and threaded DuckDB are not certified.

## References

- [DuckDB-Wasm data ingestion](https://duckdb.org/docs/clients/wasm/data_ingestion)
- [DuckDB-Wasm querying and Arrow results](https://duckdb.org/docs/current/clients/wasm/query)
- [DuckDB-Wasm OPFS instantiation and checkpointing](https://duckdb.org/docs/api/wasm/instantiation)
- [TASK-055 SQLite and DuckDB static-hosting probe](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-055-static-sqlite-duckdb/README.md)
