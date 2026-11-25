import { describe, expect, it } from "vitest";
import keyValueReadOnly from "../../../docs/capabilities/v1/key-value-read-only.json";
import keyValueReadWrite from "../../../docs/capabilities/v1/key-value-read-write.json";
import postgresqlReadOnly from "../../../docs/capabilities/v1/postgresql-read-only.json";
import postgresqlReadWrite from "../../../docs/capabilities/v1/postgresql-read-write.json";
import sqliteReadOnly from "../../../docs/capabilities/v1/sqlite-read-only.json";
import sqliteReadWrite from "../../../docs/capabilities/v1/sqlite-read-write.json";
import duckdbReadOnly from "../../../docs/capabilities/v1/duckdb-read-only.json";
import duckdbReadWrite from "../../../docs/capabilities/v1/duckdb-read-write.json";
import {
  createCapabilityManifest,
  decodeCapabilityManifest,
  encodeEnvelope,
  type ProtocolValue,
} from "@pocketdb/protocol";

const keyValueCapabilities = {
  operations: [
    "PING",
    "GET",
    "SET",
    "DEL",
    "EXISTS",
    "MGET",
    "MSET",
    "INCR",
    "DECR",
    "EXPIRE",
    "TTL",
    "PERSIST",
    "SCAN",
    "DBSIZE",
  ],
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
    binarySafeValues: true,
    persistentDataDir: true,
    memoryBudgetBytes: 67_108_864,
  },
};

describe("versioned capability manifests", () => {
  it("publishes a typed SQLite query operation", () => {
    const manifest = createCapabilityManifest("sqlite", "read-write", {
      operations: ["query"],
      readOnlyOperations: ["query"],
      features: { parameterizedQueries: true },
    });
    expect(manifest.operationMetadata[0]).toMatchObject({
      name: "query",
      inputSchema: { type: "object", required: ["sql"] },
      outputSchema: { type: "object", required: ["rows"] },
    });
  });
  it("publishes bounded DuckDB JSON query results", () => {
    const manifest = createCapabilityManifest("duckdb", "read-write", {
      operations: ["query"],
      readOnlyOperations: ["query"],
      features: { resultFormat: "arrow-to-json", maxResultRows: 10_000 },
    });
    expect(manifest.operationMetadata[0]).toMatchObject({
      name: "query",
      outputSchema: {
        required: ["rows", "columns", "format", "truncated", "rowCount"],
      },
    });
  });

  it("keeps the key-value capability handshake within the 16 KiB WebRTC message cap", () => {
    const capabilities = createCapabilityManifest(
      "kv",
      "read-write",
      keyValueCapabilities,
    );
    const message = encodeEnvelope({
      version: 1,
      type: "hello-ack",
      id: "capabilities",
      selectedVersion: 1,
      engines: [
        { id: "kv", capabilities: capabilities as unknown as ProtocolValue },
      ],
    });

    expect(new TextEncoder().encode(message).byteLength).toBeLessThanOrEqual(
      16 * 1024,
    );
  });

  it("encodes PostgreSQL schema and query metadata into a protocol handshake", () => {
    const capabilities = createCapabilityManifest("postgresql", "read-write", {
      operations: ["query", "schema", "describe-query"],
      readOnlyOperations: ["query", "schema", "describe-query"],
      features: { parameterizedQueries: true, schemaInspection: true },
    });

    expect(() =>
      encodeEnvelope({
        version: 1,
        type: "hello-ack",
        id: "capabilities",
        selectedVersion: 1,
        engines: [
          {
            id: "postgresql",
            capabilities: capabilities as unknown as ProtocolValue,
          },
        ],
      }),
    ).not.toThrow();
  });

  it("decodes the published browser and SDK examples", () => {
    for (const example of [
      keyValueReadOnly,
      keyValueReadWrite,
      postgresqlReadOnly,
      postgresqlReadWrite,
      sqliteReadOnly,
      sqliteReadWrite,
      duckdbReadOnly,
      duckdbReadWrite,
    ]) {
      expect(decodeCapabilityManifest(example).version).toBe(1);
    }
    expect(keyValueReadOnly.operations).not.toContain("SET");
    expect(keyValueReadWrite.operations).toContain("SET");
    expect(postgresqlReadOnly.operations).toEqual([
      "query",
      "schema",
      "describe-query",
    ]);
    expect(postgresqlReadWrite.operations).toEqual([
      "query",
      "schema",
      "describe-query",
    ]);
    expect(sqliteReadOnly.engineId).toBe("sqlite");
    expect(sqliteReadWrite.operations).toEqual(["query"]);
    expect(duckdbReadOnly.engineId).toBe("duckdb");
    expect(duckdbReadWrite.features.maxResultRows).toBe(10_000);
  });

  it("decodes operation and data-type metadata scoped to a read-only invitation", () => {
    const manifest = createCapabilityManifest(
      "kv",
      "read-only",
      keyValueCapabilities,
    );
    const decoded = decodeCapabilityManifest(
      JSON.parse(JSON.stringify(manifest)),
      {
        engineId: "kv",
        access: "read-only",
      },
    );

    expect(decoded.version).toBe(1);
    expect(decoded.operations).toEqual(keyValueCapabilities.readOnlyOperations);
    expect(decoded.operations).not.toContain("SET");
    expect(
      decoded.operationMetadata.find(({ name }) => name === "GET"),
    ).toMatchObject({
      name: "GET",
      allowedAccess: ["read-only", "read-write"],
      inputSchema: { type: "array" },
      outputSchema: { oneOf: expect.arrayContaining([{ type: "null" }]) },
    });
  });

  it("includes writable operations only for read-write invitations", () => {
    const manifest = decodeCapabilityManifest(
      createCapabilityManifest("kv", "read-write", keyValueCapabilities),
      { engineId: "kv", access: "read-write" },
    );

    expect(manifest.operations).toContain("SET");
    expect(
      manifest.operationMetadata.find(({ name }) => name === "SET")
        ?.allowedAccess,
    ).toEqual(["read-write"]);
  });

  it("rejects unknown manifest versions and scope mismatches", () => {
    const manifest = createCapabilityManifest(
      "kv",
      "read-only",
      keyValueCapabilities,
    );

    expect(() => decodeCapabilityManifest({ ...manifest, version: 2 })).toThrow(
      expect.objectContaining({ code: "unsupported-capability-version" }),
    );
    expect(() =>
      decodeCapabilityManifest(manifest, { access: "read-write" }),
    ).toThrow(expect.objectContaining({ code: "invalid-capabilities" }));
  });

  it("publishes structured SQL schema and query-description types", () => {
    const manifest = decodeCapabilityManifest(
      createCapabilityManifest("postgresql", "read-only", {
        operations: ["query", "schema", "describe-query"],
        readOnlyOperations: ["query", "schema", "describe-query"],
        features: { parameterizedQueries: true, schemaInspection: true },
      }),
    );
    const schemaOperation = manifest.operationMetadata.find(
      ({ name }) => name === "schema",
    );
    const describeOperation = manifest.operationMetadata.find(
      ({ name }) => name === "describe-query",
    );

    expect(manifest.engineId).toBe("postgresql");
    expect(schemaOperation?.outputSchema).toMatchObject({
      type: "object",
      properties: {
        rows: {
          type: "array",
          description: "Rows of SqlSchemaColumn values.",
        },
      },
    });
    expect(describeOperation?.outputSchema).toMatchObject({
      type: "object",
      properties: { parameters: { type: "array" }, fields: { type: "array" } },
    });
  });
});
