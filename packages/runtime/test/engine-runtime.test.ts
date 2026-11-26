import { describe, expect, it } from "vitest";
import { EngineRuntimeError } from "../src/contracts";
import { DatabaseRuntime } from "../src/database-runtime";
import { defineEngineAdapterContract } from "../testing/engine-contract";
import { MemoryTestAdapter, MemoryTestInstance } from "./memory-test-adapter";

defineEngineAdapterContract("memory test adapter", () => ({
  adapter: new MemoryTestAdapter(),
  config: {},
  instanceId: "contract-instance",
  request: { operation: "set", payload: { key: "hello", value: "world" } },
  expectedResponse: { value: "OK" },
  sessionContext: {
    sessionId: "contract-session",
    instanceId: "contract-instance",
    access: "owner",
  },
}));

function createRuntime(options: Record<string, boolean> = {}) {
  const runtime = new DatabaseRuntime();
  const adapter = new MemoryTestAdapter();
  runtime.registerAdapter(adapter);
  return { runtime, adapter, options };
}

describe("DatabaseRuntime", () => {
  it("routes advertised snapshot exports and rejects unsupported engines", async () => {
    const runtime = new DatabaseRuntime();
    runtime.registerAdapter({
      id: "snapshot-test",
      capabilities: () => ({
        operations: [],
        features: { portableSnapshots: true },
      }),
      createInstance: (_config, id) =>
        Object.assign(new MemoryTestInstance(id, "snapshot-test"), {
          exportSnapshot: async () => new Uint8Array([7, 8, 9]),
        }),
    });
    await runtime.startInstance("snapshot-test", "snapshot-instance");
    await expect(runtime.exportSnapshot("snapshot-instance")).resolves.toEqual(
      new Uint8Array([7, 8, 9]),
    );
    await runtime.stopInstance("snapshot-instance");

    const { runtime: unsupported, adapter } = createRuntime();
    await unsupported.startInstance(adapter.id, "no-snapshot");
    await expect(
      unsupported.exportSnapshot("no-snapshot"),
    ).rejects.toMatchObject({
      code: "snapshot-unsupported",
    });
    await unsupported.stopInstance("no-snapshot");
  });

  it("routes instances independently and preserves per-instance data isolation", async () => {
    const { runtime, adapter } = createRuntime();
    await runtime.startInstance(adapter.id, "instance-a");
    await runtime.startInstance(adapter.id, "instance-b");
    const sessionA = await runtime.openSession("instance-a", {
      sessionId: "session-a",
      instanceId: "instance-a",
      access: "owner",
    });
    const sessionB = await runtime.openSession("instance-b", {
      sessionId: "session-b",
      instanceId: "instance-b",
      access: "owner",
    });

    await runtime.execute(sessionA.id, {
      operation: "set",
      payload: { key: "key", value: "only-a" },
    });

    await expect(
      runtime.execute(sessionB.id, {
        operation: "get",
        payload: { key: "key" },
      }),
    ).resolves.toEqual({ value: null });
    expect(adapter.createdInstances.get("instance-a")?.values.get("key")).toBe(
      "only-a",
    );
    expect(adapter.createdInstances.get("instance-b")?.values.has("key")).toBe(
      false,
    );

    await runtime.stopInstance("instance-a");
    await runtime.stopInstance("instance-b");
  });

  it("enforces read-only permissions in the dispatcher and fails closed without an operation allowlist", async () => {
    const { runtime, adapter } = createRuntime();
    await runtime.startInstance(adapter.id, "instance");
    await expect(
      runtime.openSession("instance", {
        sessionId: "missing-scope",
        instanceId: "instance",
        access: undefined as never,
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    const readOnly = await runtime.openSession("instance", {
      sessionId: "read-only",
      instanceId: "instance",
      access: "read-only",
    });
    expect(Reflect.set(readOnly, "access", "owner")).toBe(false);
    await expect(
      runtime.execute(readOnly.id, {
        operation: "set",
        payload: { key: "key", value: "blocked" },
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      runtime.execute(readOnly.id, {
        operation: "get",
        payload: { key: "key" },
      }),
    ).resolves.toEqual({ value: null });

    const readWrite = await runtime.openSession("instance", {
      sessionId: "read-write",
      instanceId: "instance",
      access: "read-write",
    });
    await expect(
      runtime.execute(readWrite.id, {
        operation: "set",
        payload: { key: "key", value: "allowed" },
      }),
    ).resolves.toEqual({ value: "OK" });

    const failClosedRuntime = new DatabaseRuntime();
    failClosedRuntime.registerAdapter({
      id: "no-read-only",
      capabilities: () => ({ operations: ["get"], features: {} }),
      createInstance: (_config, id) =>
        new MemoryTestInstance(id, "no-read-only"),
    });
    await failClosedRuntime.startInstance("no-read-only", "closed-instance");
    const closedSession = await failClosedRuntime.openSession(
      "closed-instance",
      {
        sessionId: "closed-read-only",
        instanceId: "closed-instance",
        access: "read-only",
      },
    );
    await expect(
      failClosedRuntime.execute(closedSession.id, { operation: "get" }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await runtime.stopInstance("instance");
    await failClosedRuntime.stopInstance("closed-instance");
  });

  it("rejects unregistered adapters, duplicate instances and mismatched sessions", async () => {
    const { runtime, adapter } = createRuntime();

    await expect(
      runtime.startInstance("missing", "instance"),
    ).rejects.toMatchObject({
      code: "adapter-not-registered",
    });
    await runtime.startInstance(adapter.id, "instance");
    await expect(
      runtime.startInstance(adapter.id, "instance"),
    ).rejects.toMatchObject({
      code: "instance-already-exists",
    });
    await expect(
      runtime.openSession("instance", {
        sessionId: "wrong",
        instanceId: "other",
        access: "owner",
      }),
    ).rejects.toMatchObject({ code: "session-instance-mismatch" });
    await runtime.stopInstance("instance");
  });

  it("preserves structured engine operation failures", async () => {
    const { runtime, adapter } = createRuntime();
    await runtime.startInstance(adapter.id, "instance");
    const session = await runtime.openSession("instance", {
      sessionId: "session",
      instanceId: "instance",
      access: "owner",
    });

    await expect(
      runtime.execute(session.id, { operation: "structured-error" }),
    ).rejects.toMatchObject({
      code: "test-invalid-operation",
      name: "EngineOperationError",
    });
    await runtime.stopInstance("instance");
  });

  it("settles sessions when stopping an instance and rejects later requests", async () => {
    const { runtime, adapter } = createRuntime();
    await runtime.startInstance(adapter.id, "instance");
    const session = await runtime.openSession("instance", {
      sessionId: "session",
      instanceId: "instance",
      access: "owner",
    });

    await runtime.stopInstance("instance");
    await expect(
      runtime.execute(session.id, {
        operation: "get",
        payload: { key: "key" },
      }),
    ).rejects.toMatchObject({ code: "session-not-found" });
    await expect(runtime.health("instance")).rejects.toMatchObject({
      code: "instance-not-found",
    });
  });

  it("cleans up an instance whose start fails", async () => {
    const runtime = new DatabaseRuntime();
    const adapter = new MemoryTestAdapter();
    runtime.registerAdapter(adapter);

    await expect(
      runtime.startInstance(adapter.id, "broken", { failStart: true }),
    ).rejects.toBeInstanceOf(EngineRuntimeError);
    await expect(runtime.health("broken")).rejects.toMatchObject({
      code: "instance-not-found",
    });
    expect(adapter.createdInstances.get("broken")?.stopped).toBe(true);
  });

  it("continues instance cleanup when a session close fails", async () => {
    const { runtime, adapter } = createRuntime();
    await runtime.startInstance(adapter.id, "instance", {
      failCloseSession: true,
    });
    const session = await runtime.openSession("instance", {
      sessionId: "session",
      instanceId: "instance",
      access: "owner",
    });

    await expect(runtime.stopInstance("instance")).rejects.toMatchObject({
      code: "instance-stop-failed",
    });
    expect(adapter.createdInstances.get("instance")?.stopped).toBe(true);
    await expect(
      runtime.execute(session.id, {
        operation: "get",
        payload: { key: "key" },
      }),
    ).rejects.toMatchObject({ code: "session-not-found" });
  });
});
