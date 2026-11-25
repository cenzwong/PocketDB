# TASK-057 DuckDB adapter browser contract

The browser harness at [`apps/web/test/duckdb-harness.ts`](../../apps/web/test/duckdb-harness.ts) runs the DuckDB-Wasm adapter in Chromium. A separate browser run creates a small Parquet fixture; the adapter then imports CSV, JSON and Parquet datasets and checks representative aggregates and the 10,000-row cap. The contract test uses session memory.

## Run

From the repository root:

```sh
pnpm --filter @pocketdb/engine-duckdb test:browser
```

This starts a local Vite server and uses the configured Chromium executable from `artifacts/spike-support/chromium.mjs`. The raw browser outcome is recorded in [`results.json`](results.json).

## Limits

The run proves the checked behavior in the named browser and environment only. It does not establish stable-browser coverage, mobile behavior, persistence, threaded WASM support, a total process memory ceiling, or live Pages CDN behavior. An adapter OPFS fresh-worker reopen attempt failed with `_setThrew is not defined`; DuckDB persistence is therefore disabled in the app capability manifest. The independent TASK-055 loading probe recorded a successful direct DuckDB-Wasm OPFS checkpoint/reopen and the WASM asset measurements, but that does not verify this adapter lifecycle.
