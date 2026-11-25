import { installEngineWorker, type EngineWorkerScope } from "@pocketdb/runtime";
import { PGliteEngineAdapter } from "@pocketdb/engine-pglite";

installEngineWorker(
  globalThis as unknown as EngineWorkerScope,
  new PGliteEngineAdapter(),
);
