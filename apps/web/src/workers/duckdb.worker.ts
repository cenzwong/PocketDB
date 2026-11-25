import { installEngineWorker, type EngineWorkerScope } from "@pocketdb/runtime";
import { DuckDBEngineAdapter } from "@pocketdb/engine-duckdb";

installEngineWorker(
  globalThis as unknown as EngineWorkerScope,
  new DuckDBEngineAdapter(),
);
