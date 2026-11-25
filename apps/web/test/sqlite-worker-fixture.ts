import { installEngineWorker, type EngineWorkerScope } from "@pocketdb/runtime";
import { SqliteEngineAdapter } from "@pocketdb/engine-sqlite";

installEngineWorker(
  globalThis as unknown as EngineWorkerScope,
  new SqliteEngineAdapter(),
);
