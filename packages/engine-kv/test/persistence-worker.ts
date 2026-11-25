import { installEngineWorker, type EngineWorkerScope } from "@pocketdb/runtime";
import { KeyValueEngineAdapter } from "../src";

installEngineWorker(
  globalThis as unknown as EngineWorkerScope,
  new KeyValueEngineAdapter(),
);
