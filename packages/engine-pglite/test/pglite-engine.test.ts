import { afterEach, describe, expect, it, vi } from "vitest";
import { defineEngineAdapterContract } from "@pocketdb/runtime/testing";
import { EngineOperationError } from "@pocketdb/runtime";
import { PGliteEngineAdapter } from "../src";

afterEach(() => vi.unstubAllGlobals());

defineEngineAdapterContract("PGlite SQL adapter", () => ({
  adapter: new PGliteEngineAdapter(),
  config: {},
  instanceId: "contract-pg-instance",
  request: { operation: "query", payload: { sql: "SELECT 1 AS value" } },
  expectedResponse: {
    value: {
      rows: [{ value: 1 }],
      affectedRows: 0,
      command: "SELECT",
      rowCount: 1,
      fields: [{ name: "value", dataTypeID: 23 }],
    },
  },
  sessionContext: {
    sessionId: "contract-pg-session",
    instanceId: "contract-pg-instance",
    access: "owner",
  },
}));

async function createDatabase() {
  const adapter = new PGliteEngineAdapter();
  const instance = adapter.createInstance({}, "pg-instance");
  await instance.start();
  const first = await instance.openSession({
    sessionId: "pg-first",
    instanceId: "pg-instance",
    access: "owner",
  });
  const second = await instance.openSession({
    sessionId: "pg-second",
    instanceId: "pg-instance",
    access: "owner",
  });
  const query = (session: typeof first, sql: string, params?: unknown[]) =>
    instance.execute(session, {
      operation: "query",
      payload: { sql, ...(params ? { params } : {}) },
    });
  return { instance, first, second, query };
}

describe("PGlite engine adapter", () => {
  it("round-trips a whole database snapshot into a fresh PGlite instance", async () => {
    const source = new PGliteEngineAdapter().createInstance(
      {},
      "snapshot-pg-source",
    );
    await source.start();
    const sourceSession = await source.openSession({
      sessionId: "snapshot-pg-source-session",
      instanceId: source.id,
      access: "owner",
    });
    await source.execute(sourceSession, {
      operation: "query",
      payload: { sql: "CREATE TABLE snapshot_rows (id integer, value text)" },
    });
    await source.execute(sourceSession, {
      operation: "query",
      payload: {
        sql: "INSERT INTO snapshot_rows VALUES ($1, $2)",
        params: [7, "portable"],
      },
    });
    const snapshot = await (
      source as typeof source & {
        exportSnapshot(): Promise<Uint8Array>;
      }
    ).exportSnapshot();

    const restored = new PGliteEngineAdapter().createInstance(
      { snapshot },
      "snapshot-pg-restored",
    );
    await restored.start();
    const restoredSession = await restored.openSession({
      sessionId: "snapshot-pg-restored-session",
      instanceId: restored.id,
      access: "owner",
    });
    await expect(
      restored.execute(restoredSession, {
        operation: "query",
        payload: { sql: "SELECT id, value FROM snapshot_rows" },
      }),
    ).resolves.toMatchObject({
      value: { rows: [{ id: 7, value: "portable" }] },
    });
    await Promise.all([source.stop(), restored.stop()]);
  });

  it("rejects invalid PostgreSQL snapshots without opening a database", async () => {
    const instance = new PGliteEngineAdapter().createInstance(
      { snapshot: new Uint8Array([1, 2, 3]) },
      "invalid-snapshot",
    );
    await expect(instance.start()).rejects.toMatchObject({
      name: "EngineOperationError",
      code: "snapshot-invalid",
    });
    await instance.stop();
  });

  it("allows a bounded parameterized read and rejects SQL writes for read-only sessions", async () => {
    const adapter = new PGliteEngineAdapter();
    const instance = adapter.createInstance({}, "readonly-pg-instance");
    await instance.start();
    const owner = await instance.openSession({
      sessionId: "readonly-pg-owner",
      instanceId: "readonly-pg-instance",
      access: "owner",
    });
    const readOnly = await instance.openSession({
      sessionId: "readonly-pg-reader",
      instanceId: "readonly-pg-instance",
      access: "read-only",
    });
    await instance.execute(owner, {
      operation: "query",
      payload: {
        sql: "CREATE TABLE permission_probe (id integer, value text)",
      },
    });
    await instance.execute(owner, {
      operation: "query",
      payload: {
        sql: "INSERT INTO permission_probe VALUES ($1, $2)",
        params: [1, "visible"],
      },
    });
    await expect(
      instance.execute(readOnly, {
        operation: "query",
        payload: {
          sql: "SELECT value FROM permission_probe WHERE id = $1",
          params: [1],
        },
      }),
    ).resolves.toMatchObject({
      value: { rows: [{ value: "visible" }] },
    });
    for (const sql of [
      "INSERT INTO permission_probe VALUES ($1, $2)",
      "WITH change AS (DELETE FROM permission_probe RETURNING *) SELECT * FROM change",
      "CREATE TABLE forbidden_table (id integer)",
      "SELECT nextval('permission_probe_id_seq') FROM permission_probe",
      "SELECT id FROM permission_probe; DELETE FROM permission_probe",
    ]) {
      await expect(
        instance.execute(readOnly, {
          operation: "query",
          payload: { sql, params: [2, "blocked"] },
        }),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
    await instance.stop();
  });

  it("runs DDL, parameterized DML, typed results and schema inspection", async () => {
    const { instance, first, query } = await createDatabase();
    await query(
      first,
      "CREATE TABLE people (id integer primary key, name text, photo bytea)",
    );
    await query(first, "INSERT INTO people VALUES ($1, $2, $3)", [
      7,
      "O'Reilly",
      new Uint8Array([0, 255]),
    ]);

    const result = (
      await query(
        first,
        "SELECT id, name, photo FROM people WHERE id = $1",
        [7],
      )
    ).value as {
      rows: { id: number; name: string; photo: Uint8Array }[];
      fields: { name: string; dataTypeID: number }[];
      command: string;
    };
    expect(result.rows).toEqual([
      { id: 7, name: "O'Reilly", photo: new Uint8Array([0, 255]) },
    ]);
    expect(result.fields.map(({ name }) => name)).toEqual([
      "id",
      "name",
      "photo",
    ]);
    expect(result.command).toBe("SELECT");

    const schema = (
      await instance.execute(first, {
        operation: "schema",
        payload: { table: "people" },
      })
    ).value as {
      rows: { column_name: string; data_type: string; is_nullable: string }[];
    };
    expect(schema.rows.map(({ column_name }) => column_name)).toEqual([
      "id",
      "name",
      "photo",
    ]);
    expect(schema.rows[0]).toMatchObject({
      data_type: "integer",
      is_nullable: "NO",
    });

    const description = (
      await instance.execute(first, {
        operation: "describe-query",
        payload: { sql: "SELECT id, name FROM people WHERE id = $1" },
      })
    ).value as {
      parameters: { dataTypeID: number }[];
      fields: { name: string; dataTypeID: number }[];
    };
    expect(description.parameters).toHaveLength(1);
    expect(description.fields.map(({ name }) => name)).toEqual(["id", "name"]);
    await instance.stop();
  });

  it("isolates transactions across logical sessions", async () => {
    const { instance, first, second, query } = await createDatabase();
    await query(first, "CREATE TABLE tx_rows (id integer primary key)");

    await query(first, "BEGIN");
    await query(first, "INSERT INTO tx_rows VALUES (1)");
    await expect(
      query(second, "SELECT id FROM tx_rows ORDER BY id"),
    ).rejects.toMatchObject({ code: "postgres-session-busy" });
    await query(first, "COMMIT");
    expect(
      (await query(second, "SELECT id FROM tx_rows ORDER BY id")).value,
    ).toMatchObject({ rows: [{ id: 1 }] });

    await query(first, "BEGIN");
    await query(first, "INSERT INTO tx_rows VALUES (2)");
    await query(first, "ROLLBACK");
    expect(
      (await query(second, "SELECT id FROM tx_rows ORDER BY id")).value,
    ).toMatchObject({ rows: [{ id: 1 }] });
    await instance.stop();
  });

  it("rolls back a session transaction when the session closes", async () => {
    const { instance, first, second, query } = await createDatabase();
    await query(first, "CREATE TABLE close_rows (id integer primary key)");
    await query(first, "BEGIN");
    await query(first, "INSERT INTO close_rows VALUES (1)");
    await instance.closeSession(first);
    expect(
      (await query(second, "SELECT id FROM close_rows")).value,
    ).toMatchObject({ rows: [] });
    await instance.stop();
  });

  it("preserves SQLSTATE and structured PostgreSQL error details", async () => {
    const { instance, first, query } = await createDatabase();
    await expect(
      query(first, "SELECT * FROM absent_relation"),
    ).rejects.toMatchObject({
      name: "EngineOperationError",
      code: "postgres-sql-42p01",
      details: { sqlState: "42P01" },
    });
    await expect(
      query(first, "SELECT * FROM absent_relation"),
    ).rejects.toBeInstanceOf(EngineOperationError);
    await instance.stop();
  });

  it("rejects malformed requests before passing them to PGlite", async () => {
    const { instance, first } = await createDatabase();
    await expect(
      instance.execute(first, { operation: "query", payload: { sql: "  " } }),
    ).rejects.toMatchObject({
      code: "postgres-invalid-request",
    });
    await expect(
      instance.execute(first, {
        operation: "query",
        payload: { sql: "SELECT 1", params: "wrong" },
      }),
    ).rejects.toMatchObject({
      code: "postgres-invalid-request",
    });
    await expect(
      instance.execute(first, {
        operation: "query",
        payload: { sql: "SELECT 1", rowMode: "bad" },
      }),
    ).rejects.toMatchObject({
      code: "postgres-invalid-request",
    });
    await instance.stop();
  });

  it("fails closed when persistent browser storage or Web Locks are unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("navigator", {});
    const instance = new PGliteEngineAdapter().createInstance(
      { dataDir: "idb://unavailable-storage-test" },
      "unavailable-storage",
    );
    await expect(instance.start()).rejects.toMatchObject({
      name: "EngineOperationError",
      code: "postgres-storage-unavailable",
    });
    await instance.stop();
  });
});
