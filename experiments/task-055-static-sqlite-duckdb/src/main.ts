import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbMvpUrl from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import duckdbMvpWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";

declare global {
  interface Window {
    __probeResult?: Record<string, unknown>;
  }
}

const startedAt = performance.now();
const pageCapabilities = {
  secureContext: isSecureContext,
  crossOriginIsolated,
  sharedArrayBuffer: typeof SharedArrayBuffer === "function",
  opfs: typeof navigator.storage?.getDirectory === "function",
};

void run();

async function run(): Promise<void> {
  const started = performance.now();
  const profile = location.pathname.includes("/isolated/")
    ? "isolated"
    : "baseline";
  const sqliteWorker = new Worker(
    new URL("./sqlite-worker.ts", import.meta.url),
    { type: "module" },
  );
  const sqlite = await runWorker(sqliteWorker, profile);
  const duck = await runDuckDB(profile);
  window.__probeResult = {
    ok: sqlite.ok && duck.ok,
    pageCapabilities,
    initializationMs: round(performance.now() - started),
    totalMs: round(performance.now() - startedAt),
    sqlite,
    duckdb: duck,
  };
  document.querySelector("#result")!.textContent = JSON.stringify(
    window.__probeResult,
    null,
    2,
  );
}

function runWorker(
  worker: Worker,
  profile: string,
): Promise<Record<string, unknown> & { ok: boolean }> {
  const id = 1;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: "SQLite worker timed out after 90 seconds." });
    }, 90_000);
    worker.addEventListener("message", (event: MessageEvent) => {
      if (event.data.id !== id) return;
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    });
    worker.addEventListener("error", (event) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ ok: false, error: `SQLite worker error: ${event.message}` });
    });
    worker.postMessage({ id, profile });
  });
}

async function runDuckDB(
  profile: string,
): Promise<Record<string, unknown> & { ok: boolean }> {
  const workerStarted = performance.now();
  let db: duckdb.AsyncDuckDB | undefined;
  try {
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: duckdbMvpUrl, mainWorker: duckdbMvpWorkerUrl },
    });
    const worker = new Worker(bundle.mainWorker!);
    db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const version = await db.getVersion();
    await db.open({
      path: `opfs://pocketdb-task-055-${profile}.duckdb`,
      accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
    });
    let connection = await db.connect();
    await connection.query("CREATE TABLE probe (id INTEGER, value VARCHAR)");
    await connection.query(
      "INSERT INTO probe VALUES (9, 'duckdb-file-round-trip')",
    );
    const table = await connection.query(
      "SELECT id, value FROM probe WHERE id = 9",
    );
    const row = table.toArray().map((value) => value.toJSON())[0];
    if (row?.id !== 9 || row.value !== "duckdb-file-round-trip") {
      throw new Error("DuckDB representative query returned an unexpected row.");
    }
    await connection.query("CHECKPOINT");
    await connection.close();
    await db.terminate();
    db = undefined;

    const reopenedWorker = new Worker(bundle.mainWorker!);
    db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), reopenedWorker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    await db.open({
      path: `opfs://pocketdb-task-055-${profile}.duckdb`,
      accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
    });
    connection = await db.connect();
    const restoredTable = await connection.query(
      "SELECT id, value FROM probe WHERE id = 9",
    );
    const restored = restoredTable.toArray().map((value) => value.toJSON())[0];
    if (
      restored?.id !== 9 ||
      restored.value !== "duckdb-file-round-trip"
    ) {
      throw new Error("DuckDB OPFS reopen returned an unexpected row.");
    }
    const checkpoint = await connection.query("CHECKPOINT");
    await connection.close();
    await db.terminate();
    db = undefined;
    return {
      ok: true,
      version,
      bundle: "mvp single-threaded",
      storage: "opfs://",
      query: row,
      reopen: restored,
      fileRoundTrip: "checkpoint, close, fresh-worker reopen, query",
      elapsedMs: round(performance.now() - workerStarted),
      checkpointRows: checkpoint.numRows,
    };
  } catch (error) {
    await db?.terminate().catch(() => undefined);
    return {
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      elapsedMs: round(performance.now() - workerStarted),
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
