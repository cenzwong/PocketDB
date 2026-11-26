import { WorkerEngineAdapter, type WorkerLike } from "@pocketdb/runtime";

declare global {
  interface Window {
    __pgliteResult?: { ok: boolean; checks: string[]; error?: string };
    __pgliteProgress?: string;
  }
}

const adapter = new WorkerEngineAdapter(
  "postgresql",
  {
    operations: ["query", "schema", "describe-query"],
    features: { parameterizedQueries: true, transactions: true },
  },
  (() =>
    new Worker(new URL("./pglite-worker-fixture.ts", import.meta.url), {
      type: "module",
    })) as () => WorkerLike,
  { maxPendingRequests: 8, requestTimeoutMs: 20_000 },
);
const checks: string[] = [];
const status = document.querySelector<HTMLElement>("#status");

function setStatus(message: string): void {
  if (status) status.textContent = message;
}

async function run(): Promise<void> {
  window.__pgliteProgress = "starting worker";
  setStatus("Starting PGlite worker.");
  const instance = adapter.createInstance({}, "pglite-browser");
  await instance.start();
  window.__pgliteProgress = "opening sessions";
  setStatus("Opening SQL sessions.");
  const first = await instance.openSession({
    sessionId: "pg-client-a",
    instanceId: instance.id,
    access: "owner",
  });
  const second = await instance.openSession({
    sessionId: "pg-client-b",
    instanceId: instance.id,
    access: "owner",
  });
  window.__pgliteProgress = "running parameterized queries";
  setStatus("Running parameterized SQL.");
  const query = (session: typeof first, sql: string, params?: unknown[]) =>
    instance.execute(session, {
      operation: "query",
      payload: { sql, ...(params ? { params } : {}) },
    });

  await query(
    first,
    "CREATE TABLE browser_people (id integer primary key, name text)",
  );
  await query(first, "INSERT INTO browser_people VALUES ($1, $2)", [
    1,
    "O'Reilly",
  ]);
  const selected = (
    await query(
      second,
      "SELECT id, name FROM browser_people WHERE id = $1",
      [1],
    )
  ).value as {
    rows: { id: number; name: string }[];
    command: string;
  };
  if (selected.rows[0]?.name !== "O'Reilly" || selected.command !== "SELECT") {
    throw new Error("Parameterized browser query returned unexpected results.");
  }
  checks.push("browser DDL, DML and bound parameters");

  const schema = (
    await instance.execute(second, {
      operation: "schema",
      payload: { table: "browser_people" },
    })
  ).value as {
    rows: { column_name: string }[];
  };
  if (
    schema.rows.map(({ column_name }) => column_name).join(",") !== "id,name"
  ) {
    throw new Error("Schema inspection returned unexpected columns.");
  }
  const description = (
    await instance.execute(second, {
      operation: "describe-query",
      payload: { sql: "SELECT id FROM browser_people WHERE id = $1" },
    })
  ).value as { parameters: unknown[]; fields: { name: string }[] };
  if (
    description.parameters.length !== 1 ||
    description.fields[0]?.name !== "id"
  ) {
    throw new Error("Query description returned unexpected metadata.");
  }
  checks.push("schema and parameter/result-field inspection");

  await query(first, "CREATE TABLE browser_tx (id integer primary key)");
  window.__pgliteProgress = "begin transaction";
  setStatus("Checking transaction isolation.");
  await query(first, "BEGIN");
  window.__pgliteProgress = "insert in transaction";
  await query(first, "INSERT INTO browser_tx VALUES (1)");
  window.__pgliteProgress = "checking transaction isolation";
  const blockedRead = await query(second, "SELECT id FROM browser_tx").then(
    () => undefined,
    (error: { code?: string }) => error,
  );
  if (blockedRead?.code !== "postgres-session-busy") {
    throw new Error("A second session entered an active transaction.");
  }
  window.__pgliteProgress = "committing transaction";
  await query(first, "COMMIT");
  window.__pgliteProgress = "reading committed transaction";
  const committed = (await query(second, "SELECT id FROM browser_tx"))
    .value as { rows: { id: number }[] };
  if (committed.rows[0]?.id !== 1)
    throw new Error(
      "Committed transaction was not visible to the second session.",
    );

  window.__pgliteProgress = "begin rollback transaction";
  await query(first, "BEGIN");
  window.__pgliteProgress = "insert rollback row";
  await query(first, "INSERT INTO browser_tx VALUES (2)");
  window.__pgliteProgress = "rolling back transaction";
  await query(first, "ROLLBACK");
  window.__pgliteProgress = "reading rolled back transaction";
  const rolledBack = (
    await query(second, "SELECT id FROM browser_tx ORDER BY id")
  ).value as {
    rows: { id: number }[];
  };
  if (rolledBack.rows.length !== 1 || rolledBack.rows[0]?.id !== 1) {
    throw new Error("Rolled back row was visible to the second session.");
  }
  checks.push("serialized session transactions with commit and rollback");

  const sqlError = await query(
    second,
    "SELECT * FROM missing_browser_relation",
  ).then(
    () => undefined,
    (error: { code?: string; details?: { sqlState?: string } }) => error,
  );
  if (
    sqlError?.code !== "postgres-sql-42p01" ||
    sqlError.details?.sqlState !== "42P01"
  ) {
    throw new Error("Worker SQL error did not preserve PostgreSQL SQLSTATE.");
  }
  checks.push("structured PostgreSQL errors over worker RPC");

  await instance.stop();
  window.__pgliteResult = { ok: true, checks };
  setStatus("PGlite worker checks passed.");
}

void run().catch((error: unknown) => {
  window.__pgliteResult = {
    ok: false,
    checks,
    error:
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
  };
  setStatus("PGlite worker checks failed.");
});
