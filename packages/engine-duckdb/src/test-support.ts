import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbMvpUrl from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import duckdbMvpWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";

/** Creates an in-memory Parquet file for the adapter's browser contract harness. */
export async function makeDuckDBParquetFixture(): Promise<Uint8Array> {
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: duckdbMvpUrl, mainWorker: duckdbMvpWorkerUrl },
  });
  if (!bundle.mainModule || !bundle.mainWorker) {
    throw new Error("DuckDB MVP fixture bundle could not be resolved.");
  }
  const worker = new Worker(bundle.mainWorker);
  const database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
    await database.open({
      accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      maximumThreads: 1,
    });
    const connection = await database.connect();
    try {
      await connection.query(
        "COPY (SELECT * FROM (VALUES ('hardware', 5), ('software', 8), ('hardware', 7)) AS t(department, quantity)) TO 'fixture.parquet' (FORMAT PARQUET)",
      );
    } finally {
      await connection.close();
    }
    return await database.copyFileToBuffer("fixture.parquet");
  } finally {
    await database.terminate();
  }
}
