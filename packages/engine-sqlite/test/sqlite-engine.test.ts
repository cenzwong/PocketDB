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
});
