import { describe, expect, it } from "vitest";
import { DuckDBEngineAdapter } from "../src/duckdb-engine";

describe("DuckDBEngineAdapter", () => {
  it("publishes bounded local analytical capabilities", () => {
    const adapter = new DuckDBEngineAdapter();
    const capabilities = adapter.capabilities();

    expect(adapter.id).toBe("duckdb");
    expect(capabilities.operations).toEqual(["query"]);
    expect(capabilities.readOnlyOperations).toEqual(["query"]);
    expect(capabilities.features).toMatchObject({
      analyticalSql: true,
      localDatasetIngestion: true,
      supportedDatasetFormats: "csv,json,parquet",
      resultFormat: "arrow-to-json",
      maxDatasetBytes: 32 * 1024 * 1024,
      maxResultRows: 10_000,
      maxResultBytes: 8 * 1024 * 1024,
      maximumThreads: 1,
      persistentDataDir: false,
      persistence: "memory",
      wasmVariant: "mvp-single-threaded",
      browserLoading: "lazy",
    });
  });
});
