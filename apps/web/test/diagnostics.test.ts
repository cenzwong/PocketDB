import { describe, expect, it } from "vitest";
import { LocalObservability, MAX_DIAGNOSTIC_EVENTS } from "../src/diagnostics";

describe("local diagnostics", () => {
  it("bounds events and exports only allow-listed, redacted fields", () => {
    const diagnostics = new LocalObservability();
    const malicious = {
      level: "error",
      category: "signaling",
      event: "signaling-failed",
      code: "https://signal.example/api?token=secret",
      invitation: "pdb://invite?capability=secret",
      query: "SELECT 'secret-value'",
      message: "secret-value",
    } as const;
    diagnostics.record(
      malicious as unknown as Parameters<typeof diagnostics.record>[0],
    );
    for (let index = 0; index < MAX_DIAGNOSTIC_EVENTS + 5; index += 1) {
      diagnostics.record({
        level: "info",
        category: "runtime",
        event: "worker-heartbeat",
      });
    }

    const exported = diagnostics.export({
      status: "running",
      engine: "kv",
      activePeers: 0,
      network: [],
    });
    const json = JSON.stringify(exported);

    expect(exported.telemetry).toBe("disabled");
    expect(exported.events).toHaveLength(MAX_DIAGNOSTIC_EVENTS);
    expect(exported.events[0]?.code).toBeUndefined();
    expect(json).not.toContain("secret");
    expect(json).not.toContain("signal.example");
    expect(json).not.toContain("SELECT");
    expect(json).not.toContain("invitation");
  });

  it("aggregates remote request outcomes and byte counts without operation data", () => {
    const diagnostics = new LocalObservability();
    diagnostics.recordRequest({
      outcome: "success",
      durationMs: 12.4,
      executionDurationMs: 8.6,
      requestBytes: 56,
      responseBytes: 42,
      activeRequests: 0,
      operation: "query",
    });
    diagnostics.recordRequest({
      outcome: "unknown",
      durationMs: 90,
      executionDurationMs: 42,
      requestBytes: 100,
      responseBytes: 24,
      activeRequests: 1,
      operation: "SET",
      code: "request-timeout",
    });

    const exported = diagnostics.export({
      status: "running",
      engine: "postgresql",
      activePeers: 1,
      network: [],
    });

    expect(exported.runtime).toMatchObject({
      requestsReceived: 2,
      successfulRequests: 1,
      failedRequests: 0,
      unknownOutcomes: 1,
      averageRequestDurationMs: 51,
      averageExecutionDurationMs: 26,
      requestBytes: 156,
      responseBytes: 66,
      activeRequests: 1,
    });
    expect(JSON.stringify(exported)).not.toContain("operation");
    expect(JSON.stringify(exported)).not.toContain("SET");
  });
});
