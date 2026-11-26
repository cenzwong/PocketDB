import { describe, expect, it } from "vitest";
import { defineEngineAdapterContract } from "../../runtime/testing/engine-contract";
import { SqliteEngineAdapter } from "../src";

defineEngineAdapterContract("SQLite", () => ({
  adapter: new SqliteEngineAdapter(),
  config: { dataDir: "memory://" },
  instanceId: "sqlite-contract-instance",
  request: {
    operation: "query",
    payload: { sql: "SELECT ? AS value", params: ["contract"] },
  },
  expectedResponse: {
    value: { rows: [{ value: "contract" }], columns: ["value"] },
  },
  sessionContext: {
    sessionId: "sqlite-contract-session",
    instanceId: "sqlite-contract-instance",
    access: "owner",
  },
}));

describe("SQLite engine adapter", () => {
  it("publishes query, storage and file capabilities", () => {
    const adapter = new SqliteEngineAdapter();
    expect(adapter.id).toBe("sqlite");
    expect(adapter.capabilities()).toMatchObject({
      operations: ["query"],
      readOnlyOperations: ["query"],
      features: {
        parameterizedQueries: true,
        transactions: true,
        persistentDataDir: true,
        portableSnapshots: true,
        nativeFileImportExport: true,
        maxConcurrentOwners: 1,
      },
    });
  });

  it("rejects non-byte snapshot and database file inputs", () => {
    const adapter = new SqliteEngineAdapter();
    expect(() =>
      adapter.createInstance({ snapshot: "not-bytes" }, "bad-snapshot"),
    ).toThrow("SQLite snapshot must be a Uint8Array.");
    expect(() =>
      adapter.createInstance({ databaseFile: "not-bytes" }, "bad-file"),
    ).toThrow("SQLite database file must be a Uint8Array.");
  });

  it("rejects persistent names that could alias another directory", () => {
    const adapter = new SqliteEngineAdapter();
    expect(() =>
      adapter.createInstance({ dataDir: "opfs://sales.2026" }, "a"),
    ).toThrow(/letters, digits/);
    expect(() =>
      adapter.createInstance({ dataDir: "opfs://sales-2026" }, "b"),
    ).not.toThrow();
    expect(() => adapter.createInstance({ dataDir: "opfs://" }, "c")).toThrow(
      /letters, digits/,
    );
  });

  it("serializes transaction ownership and keeps it after rollback to savepoint", async () => {
    const instance = new SqliteEngineAdapter().createInstance(
      { dataDir: "memory://" },
      "transaction-ownership",
    );
    await instance.start();
    const first = await instance.openSession({
      sessionId: "first",
      instanceId: "transaction-ownership",
      access: "owner",
    });
    const second = await instance.openSession({
      sessionId: "second",
      instanceId: "transaction-ownership",
      access: "owner",
    });
    const query = (session: typeof first, sql: string) =>
      instance.execute(session, { operation: "query", payload: { sql } });

    await query(first, "CREATE TABLE entries (value TEXT)");
    const begin = query(first, "-- annotated\nBEGIN");
    await expect(
      query(second, "INSERT INTO entries VALUES ('other')"),
    ).rejects.toMatchObject({ code: "sqlite-session-busy" });
    await begin;

    await query(first, "INSERT INTO entries VALUES ('pending')");
    await query(first, "SAVEPOINT nested");
    await query(first, "INSERT INTO entries VALUES ('discarded')");
    await query(first, "ROLLBACK TRANSACTION /* keep outer */ TO nested");
    await expect(query(second, "COMMIT")).rejects.toMatchObject({
      code: "sqlite-session-busy",
    });
    await query(first, "ROLLBACK");

    await query(first, "SAVEPOINT outermost");
    await query(first, "INSERT INTO entries VALUES ('pending')");
    await expect(query(second, "SELECT * FROM entries")).rejects.toMatchObject({
      code: "sqlite-session-busy",
    });
    await instance.closeSession(first);
    await expect(query(second, "SELECT * FROM entries")).resolves.toEqual({
      value: { rows: [], columns: ["value"] },
    });
    await instance.closeSession(second);
    await instance.stop();
  });
});
