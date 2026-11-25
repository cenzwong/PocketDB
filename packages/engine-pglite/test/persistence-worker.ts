import { installEngineWorker, type EngineWorkerScope } from "@pocketdb/runtime";
import { PGliteEngineAdapter } from "../src";

installEngineWorker(
  globalThis as unknown as EngineWorkerScope,
  new PGliteEngineAdapter(),
);
