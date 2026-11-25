import {
  WorkerEngineAdapter,
  type EngineSession,
  type EngineInstance,
  type WorkerLike,
} from "@pocketdb/runtime";
import { encodeSnapshot } from "@pocketdb/runtime";

declare global {
  interface Window {
    __keyValuePersistenceProbe?: {
      start: (dataDir: string) => Promise<void>;
      execute: (operation: string, payload?: unknown) => Promise<unknown>;
      exportSnapshot: () => Promise<number[]>;
      runRollbackProbe: () => Promise<unknown>;
      stop: () => Promise<void>;
      tryStart: (
        dataDir: string,
        snapshot?: Uint8Array | number[],
      ) => Promise<unknown>;
    };
  }
}

let active: EngineInstance | undefined;
let session: EngineSession | undefined;

function createInstance(
  instanceId: string,
  dataDir: string,
  snapshot?: Uint8Array,
): EngineInstance {
  const capabilities = {
    operations: [],
    readOnlyOperations: [
      "PING",
      "GET",
      "EXISTS",
      "MGET",
      "TTL",
      "SCAN",
      "DBSIZE",
    ],
    features: {
      persistence: true,
      persistentDataDir: true,
      portableSnapshots: true,
    },
  };
  const adapter = new WorkerEngineAdapter(
    "kv",
    capabilities,
    (() =>
      new Worker(new URL("./persistence-worker.ts", import.meta.url), {
        type: "module",
      })) as () => WorkerLike,
    { maxPendingRequests: 8, requestTimeoutMs: 30_000 },
  );
  return adapter.createInstance(
    { dataDir, ...(snapshot ? { snapshot } : {}) },
    instanceId,
  );
}

async function start(dataDir: string): Promise<void> {
  if (active) throw new Error("A key-value instance is already active.");
  const instanceId = crypto.randomUUID();
  active = createInstance(instanceId, dataDir);
  try {
    await active.start();
    session = await active.openSession({
      sessionId: crypto.randomUUID(),
      instanceId,
      access: "owner",
    });
  } catch (error) {
    await active.stop().catch(() => undefined);
    active = undefined;
    session = undefined;
    throw error;
  }
}

async function execute(operation: string, payload?: unknown): Promise<unknown> {
  if (!active || !session) throw new Error("No key-value instance is active.");
  const result = await active.execute(session, { operation, payload });
  return result.value instanceof Uint8Array
    ? new TextDecoder().decode(result.value)
    : result.value;
}

async function exportSnapshot(): Promise<number[]> {
  if (!active) throw new Error("No key-value instance is active.");
  const exporter = active as EngineInstance & {
    exportSnapshot(): Promise<Uint8Array>;
  };
  return Array.from(await exporter.exportSnapshot());
}

async function stop(): Promise<void> {
  const instance = active;
  active = undefined;
  session = undefined;
  await instance?.stop();
}

async function tryStart(
  dataDir: string,
  bytes?: Uint8Array | number[],
): Promise<unknown> {
  const instanceId = crypto.randomUUID();
  let contender: EngineInstance | undefined;
  try {
    contender = createInstance(
      instanceId,
      dataDir,
      bytes
        ? bytes instanceof Uint8Array
          ? bytes
          : new Uint8Array(bytes)
        : undefined,
    );
    await contender.start();
    await contender.stop();
    return { ok: true };
  } catch (error) {
    await contender?.stop().catch(() => undefined);
    return {
      ok: false,
      code:
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "unknown-error",
    };
  }
}

async function runRollbackProbe(): Promise<unknown> {
  const seed = crypto.randomUUID().replaceAll("-", "");
  const dataDir = `idb://pocketdb-kv-snapshot-rollback-${seed}`;
  await start(dataDir);
  await execute("SET", ["preserved", "before-import"]);
  await stop();

  const malformedResult = await tryStart(dataDir, new Uint8Array([1, 2]));
  const incompatibleSnapshot = encodeSnapshot(
    "postgresql",
    "pglite-data-dir-gzip-v1",
    new Uint8Array(),
  );
  const incompatibleResult = await tryStart(dataDir, incompatibleSnapshot);

  const source = createInstance(`snapshot-source-${seed}`, "memory://");
  await source.start();
  const sourceSession = await source.openSession({
    sessionId: `snapshot-source-session-${seed}`,
    instanceId: source.id,
    access: "owner",
  });
  await source.execute(sourceSession, {
    operation: "SET",
    payload: ["large", makeQuotaProbeBytes(2_000_000)],
  });
  const snapshot = await (
    source as EngineInstance & {
      exportSnapshot(): Promise<Uint8Array>;
    }
  ).exportSnapshot();
  await source.stop();

  const importResult = await tryStart(dataDir, snapshot);
  await start(dataDir);
  const preserved = await execute("GET", ["preserved"]);
  await stop();

  const smallSource = createInstance(
    `small-snapshot-source-${seed}`,
    "memory://",
  );
  await smallSource.start();
  const smallSession = await smallSource.openSession({
    sessionId: `small-snapshot-session-${seed}`,
    instanceId: smallSource.id,
    access: "owner",
  });
  await smallSource.execute(smallSession, {
    operation: "SET",
    payload: ["portable", "fresh-idb"],
  });
  const smallSnapshot = await (
    smallSource as EngineInstance & {
      exportSnapshot(): Promise<Uint8Array>;
    }
  ).exportSnapshot();
  await smallSource.stop();
  const restoredDir = `idb://pocketdb-kv-snapshot-restored-${seed}`;
  const restored = createInstance(
    `snapshot-restored-${seed}`,
    restoredDir,
    smallSnapshot,
  );
  await restored.start();
  const restoredSession = await restored.openSession({
    sessionId: `snapshot-restored-session-${seed}`,
    instanceId: restored.id,
    access: "owner",
  });
  const restoredValue = await restored.execute(restoredSession, {
    operation: "GET",
    payload: ["portable"],
  });
  await restored.stop();
  return {
    dataDir,
    malformedResult,
    incompatibleResult,
    importResult,
    preserved,
    restoredValue:
      restoredValue.value instanceof Uint8Array
        ? new TextDecoder().decode(restoredValue.value)
        : restoredValue.value,
  };
}

function makeQuotaProbeBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 0x6d2b79f5;
  for (let index = 0; index < bytes.length; index += 1) {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    bytes[index] = (state ^ (state >>> 14)) & 0xff;
  }
  return bytes;
}

window.__keyValuePersistenceProbe = {
  start,
  execute,
  exportSnapshot,
  runRollbackProbe,
  stop,
  tryStart,
};
const resultElement = document.querySelector("#result");
if (resultElement) resultElement.textContent = "ready";
