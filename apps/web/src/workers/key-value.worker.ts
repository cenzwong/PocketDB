import { installEngineWorker, type EngineWorkerScope } from "@pocketdb/runtime";
import { KeyValueEngineAdapter } from "@pocketdb/engine-kv";

installEngineWorker(
  globalThis as unknown as EngineWorkerScope,
  new KeyValueEngineAdapter(),
);
