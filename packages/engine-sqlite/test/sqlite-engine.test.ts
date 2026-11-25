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
  expectedResponse: { value: { rows: [{ value: "contract" }] } },
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

    await Promise.all([
      query(first, "CREATE TABLE entries (value TEXT)"),
      query(first, "BEGIN"),
    ]);
    await expect(
      Promise.all([
        query(first, "SAVEPOINT nested"),
        query(first, "INSERT INTO entries VALUES ('pending')"),
        query(first, "ROLLBACK TO nested"),
      ]),
    ).resolves.toHaveLength(3);
    await expect(
      query(second, "INSERT INTO entries VALUES ('other')"),
    ).rejects.toMatchObject({ code: "sqlite-session-busy" });
    await query(first, "ROLLBACK");
    await expect(
      query(second, "INSERT INTO entries VALUES ('other')"),
    ).resolves.toMatchObject({ value: { rows: [] } });
    await instance.closeSession(first);
    await instance.closeSession(second);
    await instance.stop();
  });
});
