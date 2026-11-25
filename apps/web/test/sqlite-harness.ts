import {
  WorkerEngineAdapter,
  type EngineInstance,
  type WorkerLike,
} from "@pocketdb/runtime";

declare global {
  interface Window {
    __sqliteResult?: Record<string, unknown>;
  }
}

const capabilities = {
  operations: ["query"],
  readOnlyOperations: ["query"],
  features: {
    persistentDataDir: true,
    portableSnapshots: true,
    nativeFileImportExport: true,
  },
};

async function run(): Promise<void> {
  const seed = crypto.randomUUID().replaceAll("-", "");
  const dataDir = `opfs://sqlite-contract-${seed}`;
  const source = createInstance(`source-${seed}`, dataDir);
  const sourceSession = await open(source, `source-session-${seed}`);
  await query(
    source,
    sourceSession,
    "CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT)",
  );
  await query(
    source,
    sourceSession,
    "INSERT INTO probe (id, value) VALUES (?, ?)",
    [1, "bound"],
  );
  await query(source, sourceSession, "BEGIN");
  await query(
    source,
    sourceSession,
    "INSERT INTO probe (id, value) VALUES (?, ?)",
    [2, "rolled-back"],
  );
  await query(source, sourceSession, "ROLLBACK");
  await query(source, sourceSession, "BEGIN");
  await query(
    source,
    sourceSession,
    "INSERT INTO probe (id, value) VALUES (?, ?)",
    [3, "committed"],
  );
  await query(source, sourceSession, "COMMIT");
  const rows = await query(
    source,
    sourceSession,
    "SELECT id, value FROM probe WHERE id = ? ORDER BY id",
    [1],
  );
  const nativeFile = await (
    source as EngineInstance & { exportNativeFile(): Promise<Uint8Array> }
  ).exportNativeFile();
  const pocketSnapshot = await (
    source as EngineInstance & { exportSnapshot(): Promise<Uint8Array> }
  ).exportSnapshot();
  const competingOwner = createInstance(`competing-${seed}`, dataDir);
  let competingOwnerCode = "opened";
  try {
    await competingOwner.start();
    competingOwnerCode = "unexpectedly-opened";
  } catch (error) {
    competingOwnerCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : String(error);
  }
  await competingOwner.stop().catch(() => undefined);
  await source.stop();

  const reopened = createInstance(`reopened-${seed}`, dataDir);
  const reopenedSession = await open(reopened, `reopened-session-${seed}`);
  const persisted = await query(
    reopened,
    reopenedSession,
    "SELECT id, value FROM probe ORDER BY id",
  );
  await reopened.stop();

  const imported = createInstance(
    `imported-${seed}`,
    `opfs://sqlite-import-${seed}`,
    undefined,
    nativeFile,
  );
  const importedSession = await open(imported, `imported-session-${seed}`);
  const nativeImport = await query(
    imported,
    importedSession,
    "SELECT id, value FROM probe ORDER BY id",
  );
  await imported.stop();

  const memoryImported = createInstance(
    `memory-imported-${seed}`,
    "memory://",
    undefined,
    nativeFile,
  );
  const memoryImportedSession = await open(
    memoryImported,
    `memory-imported-session-${seed}`,
  );
  const nativeMemoryImport = await query(
    memoryImported,
    memoryImportedSession,
    "SELECT count(*) AS count FROM probe",
  );
  await memoryImported.stop();

  const snapshotRestored = createInstance(
    `snapshot-${seed}`,
    "memory://",
    pocketSnapshot,
  );
  const snapshotSession = await open(
    snapshotRestored,
    `snapshot-session-${seed}`,
  );
  const snapshotImport = await query(
    snapshotRestored,
    snapshotSession,
    "SELECT count(*) AS count FROM probe",
  );
  await snapshotRestored.stop();

  const ephemeral = createInstance(`ephemeral-${seed}`, "memory://");
  const ephemeralSession = await open(ephemeral, `ephemeral-session-${seed}`);
  const memoryFallback = await query(
    ephemeral,
    ephemeralSession,
    "SELECT ? AS mode",
    ["memory"],
  );
  await ephemeral.stop();

  window.__sqliteResult = {
    ok: true,
    userAgent: navigator.userAgent,
    browserCapabilities: {
      secureContext: isSecureContext,
      opfs: typeof navigator.storage?.getDirectory === "function",
      webLocks: typeof navigator.locks?.request === "function",
      crossOriginIsolated,
    },
    parameterizedSql: rows,
    transactions: {
      committedRows: persisted,
      rolledBackRowAbsent: !(persisted as { rows: unknown[] }).rows.some(
        (row) => JSON.stringify(row).includes("rolled-back"),
      ),
    },
    persistenceAfterWorkerRestart: persisted,
    competingOwnerCode,
    nativeFileBytes: nativeFile.byteLength,
    nativeFileImport: nativeImport,
    nativeMemoryImport,
    pocketSnapshotBytes: pocketSnapshot.byteLength,
    pocketSnapshotImport: snapshotImport,
    memoryFallback,
  };
  const resultElement = document.querySelector("#result");
  if (resultElement)
    resultElement.textContent = JSON.stringify(window.__sqliteResult, null, 2);
}

function createInstance(
  id: string,
  dataDir: string,
  snapshot?: Uint8Array,
  databaseFile?: Uint8Array,
): EngineInstance {
  const adapter = new WorkerEngineAdapter(
    "sqlite",
    capabilities,
    (() =>
      new Worker(new URL("./sqlite-worker-fixture.ts", import.meta.url), {
        type: "module",
      })) as () => WorkerLike,
    { maxPendingRequests: 8, requestTimeoutMs: 30_000 },
  );
  return adapter.createInstance(
    {
      dataDir,
      ...(snapshot ? { snapshot } : {}),
      ...(databaseFile ? { databaseFile } : {}),
    },
    id,
  );
}

async function open(instance: EngineInstance, sessionId: string) {
  await instance.start();
  return instance.openSession({
    instanceId: instance.id,
    sessionId,
    access: "owner",
  });
}

async function query(
  instance: EngineInstance,
  session: Awaited<ReturnType<typeof open>>,
  sql: string,
  params?: unknown[],
): Promise<unknown> {
  return (
    await instance.execute(session, {
      operation: "query",
      payload: { sql, ...(params ? { params } : {}) },
    })
  ).value;
}

void run().catch((error: unknown) => {
  window.__sqliteResult = {
    ok: false,
    error:
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
  };
  const resultElement = document.querySelector("#result");
  if (resultElement)
    resultElement.textContent = JSON.stringify(window.__sqliteResult, null, 2);
});
