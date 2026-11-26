import { DuckDBEngineAdapter } from "@pocketdb/engine-duckdb";
import type { EngineInstance } from "@pocketdb/runtime";

declare global {
  interface Window {
    __duckdbResult?: Record<string, unknown>;
  }
}

async function run(): Promise<void> {
  let stage = "setup";
  try {
    const seed = crypto.randomUUID().replaceAll("-", "");
    const dataDir = "memory://";
    const instance = createInstance(`source-${seed}`, dataDir);
    stage = "instance start";
    await instance.start();

    const csv = new TextEncoder().encode(
      "category,amount\nbooks,12.5\nbooks,7.5\ngames,20\n",
    );
    const json = new TextEncoder().encode(
      '[{"region":"north","units":2},{"region":"north","units":3},{"region":"south","units":4}]',
    );
    const parquetBase64 = new URLSearchParams(location.search).get("parquet");
    if (!parquetBase64)
      throw new Error("The Parquet fixture was not provided.");
    const parquet = Uint8Array.from(atob(parquetBase64), (character) =>
      character.charCodeAt(0),
    );
    stage = "CSV import";
    const csvImport = await instance.importDataset("sales.csv", csv);
    stage = "JSON import";
    const jsonImport = await instance.importDataset("shipments.json", json);
    stage = "Parquet import";
    const parquetImport = await instance.importDataset(
      "inventory.parquet",
      parquet,
    );
    const session = await instance.openSession({
      instanceId: instance.id,
      sessionId: `session-${seed}`,
      access: "owner",
    });
    stage = "CSV aggregate";
    const csvAggregate = await query(
      instance,
      session,
      "SELECT category, SUM(amount) AS total FROM sales GROUP BY category ORDER BY category",
    );
    stage = "JSON aggregate";
    const jsonAggregate = await query(
      instance,
      session,
      "SELECT region, SUM(units) AS total FROM shipments GROUP BY region ORDER BY region",
    );
    stage = "Parquet aggregate";
    const parquetAggregate = await query(
      instance,
      session,
      "SELECT department, SUM(quantity) AS total FROM inventory GROUP BY department ORDER BY department",
    );
    stage = "bounded query";
    const bounded = await query(
      instance,
      session,
      "SELECT i FROM range(10001) AS values(i)",
    );

    stage = "decimal and empty result metadata";
    const decimals = await query(
      instance,
      session,
      "SELECT 123.45::DECIMAL(10,2) AS positive, -0.09::DECIMAL(10,2) AS negative, 12::DECIMAL(10,0) AS whole",
    );
    assertImport(
      JSON.stringify(resultRows(decimals)) ===
        JSON.stringify([
          { positive: "123.45", negative: "-0.09", whole: "12" },
        ]),
      "Decimal values lost their scale.",
    );
    const empty = await query(
      instance,
      session,
      "SELECT 1 AS empty_column WHERE false",
    );
    assertImport(
      JSON.stringify(resultObject(empty).columns) ===
        JSON.stringify(["empty_column"]),
      "Empty result lost its column metadata.",
    );

    stage = "list values";
    const lists = await query(
      instance,
      session,
      "SELECT [1, NULL, 2] AS items, [[1, 2], [], [3]] AS nested, [123.45::DECIMAL(10,2), -0.09::DECIMAL(10,2), NULL] AS decimals, ['a', NULL, 'b'] AS labels",
    );
    assertImport(
      JSON.stringify(resultRows(lists)) ===
        JSON.stringify([
          {
            items: [1, null, 2],
            nested: [[1, 2], [], [3]],
            decimals: ["123.45", "-0.09", null],
            labels: ["a", null, "b"],
          },
        ]),
      `List normalization failed: ${JSON.stringify(lists)}`,
    );

    stage = "read-only transaction";
    const reader = await instance.openSession({
      instanceId: instance.id,
      sessionId: `reader-${seed}`,
      access: "read-only",
    });
    await query(instance, session, "CREATE SEQUENCE protected_ids START 42");
    await query(instance, reader, "SELECT count(*) AS total FROM sales");
    try {
      await query(instance, reader, "SELECT nextval('protected_ids')");
      throw new Error("The read-only query unexpectedly succeeded.");
    } catch (cause) {
      assertImport(
        cause instanceof Error &&
          "code" in cause &&
          cause.code === "duckdb-query-failed",
        `Expected DuckDB to enforce read-only access: ${String(cause)}`,
      );
    }
    const ids = await query(
      instance,
      session,
      "SELECT nextval('protected_ids') AS id",
    );
    assertImport(
      JSON.stringify(resultRows(ids)) === JSON.stringify([{ id: "42" }]),
      "The read-only request advanced the sequence.",
    );
    await query(instance, reader, "SELECT count(*) AS total FROM sales");
    await instance.closeSession(reader);

    assertImport(csvImport.rowCount === 3, "CSV ingestion row count differs.");
    assertImport(
      jsonImport.rowCount === 3,
      "JSON ingestion row count differs.",
    );
    assertImport(
      parquetImport.rowCount === 3,
      "Parquet ingestion row count differs.",
    );
    assertImport(
      JSON.stringify(resultRows(csvAggregate)) ===
        JSON.stringify([
          { category: "books", total: 20 },
          { category: "games", total: 20 },
        ]),
      "CSV aggregate differs from expected rows.",
    );
    assertImport(
      JSON.stringify(resultRows(jsonAggregate)) ===
        JSON.stringify([
          { region: "north", total: "5" },
          { region: "south", total: "4" },
        ]),
      "JSON aggregate differs from expected rows.",
    );
    assertImport(
      JSON.stringify(resultRows(parquetAggregate)) ===
        JSON.stringify([
          { department: "hardware", total: "12" },
          { department: "software", total: "8" },
        ]),
      "Parquet aggregate differs from expected rows.",
    );
    assertImport(
      resultRows(bounded).length === 10_000,
      "The row limit was not applied.",
    );
    assertImport(
      resultObject(bounded).truncated === true,
      "The row limit did not report truncation.",
    );
    stage = "source session close";
    await instance.closeSession(session);
    stage = "source stop";
    await instance.stop();

    window.__duckdbResult = {
      ok: true,
      userAgent: navigator.userAgent,
      browserCapabilities: {
        secureContext: isSecureContext,
        opfs: typeof navigator.storage?.getDirectory === "function",
        webLocks: typeof navigator.locks?.request === "function",
        crossOriginIsolated,
      },
      bundle: "mvp-single-threaded",
      storageMode: "memory",
      readOnlyTransaction: true,
      limits: {
        maxDatasetBytes: 33_554_432,
        maxRows: 10_000,
        maxResultBytes: 8_388_608,
        threads: 1,
      },
      imports: { csv: csvImport, json: jsonImport, parquet: parquetImport },
      aggregates: {
        csv: csvAggregate,
        json: jsonAggregate,
        parquet: parquetAggregate,
      },
      boundedResult: bounded,
    };
    render();
  } catch (error) {
    window.__duckdbResult = {
      ok: false,
      stage,
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
    };
    render();
  }
}

function resultObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null)
    throw new Error("DuckDB returned an invalid result.");
  return value as Record<string, unknown>;
}

function resultRows(value: unknown): unknown[] {
  const rows = resultObject(value).rows;
  if (!Array.isArray(rows)) throw new Error("DuckDB result rows are missing.");
  return rows;
}

function assertImport(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function createInstance(
  id: string,
  dataDir: string,
): EngineInstance & {
  importDataset(
    fileName: string,
    bytes: Uint8Array,
  ): Promise<{
    tableName: string;
    format: string;
    rowCount: number;
  }>;
} {
  const adapter = new DuckDBEngineAdapter();
  return adapter.createInstance({ dataDir }, id) as EngineInstance & {
    importDataset(
      fileName: string,
      bytes: Uint8Array,
    ): Promise<{
      tableName: string;
      format: string;
      rowCount: number;
    }>;
  };
}

async function query(
  instance: EngineInstance,
  session: Awaited<ReturnType<EngineInstance["openSession"]>>,
  sql: string,
): Promise<unknown> {
  return (
    await instance.execute(session, { operation: "query", payload: { sql } })
  ).value;
}

function render(): void {
  const resultElement = document.querySelector("#result");
  if (resultElement)
    resultElement.textContent = JSON.stringify(window.__duckdbResult, null, 2);
}

void run();
