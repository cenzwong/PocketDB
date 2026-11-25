import { describe, expect, it } from "vitest";
import { defineEngineAdapterContract } from "@pocketdb/runtime/testing";
import { encodeSnapshot } from "@pocketdb/runtime";
import {
  DEFAULT_KEY_VALUE_MEMORY_BYTES,
  KeyValueCommandError,
  KeyValueEngineAdapter,
  KeyValueEngineInstance,
  type KeyValueEngineOptions,
} from "../src";

defineEngineAdapterContract("in-memory key-value adapter", () => ({
  adapter: new KeyValueEngineAdapter(),
  config: {},
  instanceId: "contract-kv-instance",
  request: { operation: "GET", payload: ["missing"] },
  expectedResponse: { value: null },
  sessionContext: {
    sessionId: "contract-kv-session",
    instanceId: "contract-kv-instance",
    access: "owner",
  },
}));

async function createEngine(options: KeyValueEngineOptions = {}) {
  const instance = new KeyValueEngineInstance("kv-instance", "kv", options);
  await instance.start();
  const session = await instance.openSession({
    sessionId: "kv-session",
    instanceId: "kv-instance",
    access: "owner",
  });
  return {
    instance,
    session,
    execute: (operation: string, payload?: unknown) =>
      instance.execute(session, { operation, payload }),
  };
}

describe("in-memory key-value commands", () => {
  it("enforces read-only permissions at the adapter boundary", async () => {
    const instance = new KeyValueEngineInstance("readonly-kv");
    await instance.start();
    const session = await instance.openSession({
      sessionId: "readonly-kv-session",
      instanceId: "readonly-kv",
      access: "read-only",
    });
    await expect(
      instance.execute(session, {
        operation: "SET",
        payload: ["key", "value"],
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      instance.execute(session, { operation: "GET", payload: ["key"] }),
    ).resolves.toEqual({ value: null });
    await instance.stop();
  });

  it("advertises bounded expiry and scan operations", () => {
    const capabilities = new KeyValueEngineAdapter().capabilities();
    expect(capabilities.operations).toEqual(
      expect.arrayContaining(["EXPIRE", "TTL", "PERSIST", "SCAN", "DBSIZE"]),
    );
    expect(capabilities.features).toMatchObject({
      commandSetVersion: 2,
      memoryBudgetBytes: DEFAULT_KEY_VALUE_MEMORY_BYTES,
      persistence: true,
      persistentDataDir: true,
    });
    expect(() =>
      new KeyValueEngineAdapter().createInstance(
        { maxMemoryBytes: DEFAULT_KEY_VALUE_MEMORY_BYTES + 1 },
        "invalid-budget",
      ),
    ).toThrow(/maxMemoryBytes/);
  });

  it("fails closed when browser persistence APIs are unavailable", async () => {
    const instance = new KeyValueEngineAdapter().createInstance(
      { dataDir: "idb://unavailable-storage-test" },
      "unavailable-storage-test",
    );
    await expect(instance.start()).rejects.toMatchObject({
      code: "key-value-storage-unavailable",
    });
    await instance.stop();
  });

  it("implements PING, SET, GET, DEL and EXISTS with missing-key behavior", async () => {
    const { execute, instance } = await createEngine();
    await expect(execute("PING")).resolves.toEqual({ value: "PONG" });
    await expect(execute("ping", ["hello"])).resolves.toEqual({
      value: "hello",
    });
    await expect(execute("GET", ["missing"])).resolves.toEqual({ value: null });
    await expect(execute("SET", ["greeting", "hello"])).resolves.toEqual({
      value: "OK",
    });
    await expect(execute("GET", ["greeting"])).resolves.toEqual({
      value: new TextEncoder().encode("hello"),
    });
    await expect(
      execute("EXISTS", ["greeting", "missing", "greeting"]),
    ).resolves.toEqual({ value: 2 });
    await expect(
      execute("DEL", ["greeting", "greeting", "missing"]),
    ).resolves.toEqual({ value: 1 });
    await expect(execute("EXISTS", ["greeting"])).resolves.toEqual({
      value: 0,
    });
    await instance.stop();
  });

  it("keeps stored values binary-safe and returns defensive copies", async () => {
    const { execute, instance } = await createEngine();
    const source = new Uint8Array([0, 255, 65]);
    await execute("SET", ["binary", source]);
    source[0] = 42;
    const firstRead = (await execute("GET", ["binary"])).value as Uint8Array;
    expect(firstRead).toEqual(new Uint8Array([0, 255, 65]));
    firstRead[1] = 0;
    expect((await execute("GET", ["binary"])).value).toEqual(
      new Uint8Array([0, 255, 65]),
    );
    await instance.stop();
  });

  it("preserves MGET order and makes MSET validation atomic", async () => {
    const { execute, instance } = await createEngine();
    await expect(
      execute("MSET", ["a", "one", "b", new Uint8Array([0, 255]), "a", "last"]),
    ).resolves.toEqual({ value: "OK" });
    await expect(execute("MGET", ["b", "missing", "a"])).resolves.toEqual({
      value: [new Uint8Array([0, 255]), null, new TextEncoder().encode("last")],
    });
    await expect(
      execute("MSET", ["new-key", "value", "bad-value", 42]),
    ).rejects.toMatchObject({
      code: "key-value-invalid-value",
      name: "KeyValueCommandError",
    });
    await expect(execute("GET", ["new-key"])).resolves.toEqual({ value: null });
    await instance.stop();
  });

  it("increments and decrements atomically within the signed 64-bit range", async () => {
    const { execute, instance } = await createEngine();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => execute("INCR", ["counter"])),
    );
    expect(results.at(-1)).toEqual({ value: 100n });
    await expect(execute("DECR", ["counter"])).resolves.toEqual({ value: 99n });
    await expect(execute("GET", ["counter"])).resolves.toEqual({
      value: new TextEncoder().encode("99"),
    });

    await execute("SET", ["counter", "9223372036854775807"]);
    await expect(execute("INCR", ["counter"])).rejects.toMatchObject({
      code: "key-value-integer-overflow",
    });
    await expect(execute("GET", ["counter"])).resolves.toEqual({
      value: new TextEncoder().encode("9223372036854775807"),
    });

    await execute("SET", ["counter", "-9223372036854775808"]);
    await expect(execute("DECR", ["counter"])).rejects.toMatchObject({
      code: "key-value-integer-overflow",
    });
    await instance.stop();
  });

  it("rejects invalid integer contents without changing the value", async () => {
    const { execute, instance } = await createEngine();
    await execute("SET", ["counter", "1.5"]);
    await expect(execute("INCR", ["counter"])).rejects.toMatchObject({
      code: "key-value-not-integer-or-out-of-range",
    });
    await expect(execute("GET", ["counter"])).resolves.toEqual({
      value: new TextEncoder().encode("1.5"),
    });
    await execute("SET", ["counter", new Uint8Array([0xff])]);
    await expect(execute("DECR", ["counter"])).rejects.toBeInstanceOf(
      KeyValueCommandError,
    );
    await instance.stop();
  });

  it("validates arity, command arguments and unknown operations", async () => {
    const { execute, instance } = await createEngine();
    await expect(execute("GET")).rejects.toMatchObject({
      code: "key-value-wrong-number-of-arguments",
    });
    await expect(execute("MGET", [])).rejects.toMatchObject({
      code: "key-value-wrong-number-of-arguments",
    });
    await expect(
      execute("MSET", ["key", "value", "trailing"]),
    ).rejects.toMatchObject({ code: "key-value-wrong-number-of-arguments" });
    await expect(execute("SET", ["key", null])).rejects.toMatchObject({
      code: "key-value-invalid-value",
    });
    await expect(execute("GET", [42])).rejects.toMatchObject({
      code: "key-value-invalid-key",
    });
    await expect(execute("FLUSHALL")).rejects.toMatchObject({
      code: "key-value-unknown-command",
    });
    await expect(execute("PING", ["a", "b"])).rejects.toMatchObject({
      code: "key-value-wrong-number-of-arguments",
    });
    await instance.stop();
  });

  it("shares data across sessions while isolating database instances", async () => {
    const adapter = new KeyValueEngineAdapter();
    const first = adapter.createInstance({}, "first");
    const second = adapter.createInstance({}, "second");
    await Promise.all([first.start(), second.start()]);
    const firstSession = await first.openSession({
      sessionId: "first-session",
      instanceId: "first",
      access: "owner",
    });
    const secondSession = await first.openSession({
      sessionId: "second-session",
      instanceId: "first",
      access: "owner",
    });
    const otherInstanceSession = await second.openSession({
      sessionId: "other-session",
      instanceId: "second",
      access: "owner",
    });
    await first.execute(firstSession, {
      operation: "SET",
      payload: ["shared", "value"],
    });
    await expect(
      first.execute(secondSession, { operation: "GET", payload: ["shared"] }),
    ).resolves.toEqual({
      value: new TextEncoder().encode("value"),
    });
    await expect(
      second.execute(otherInstanceSession, {
        operation: "GET",
        payload: ["shared"],
      }),
    ).resolves.toEqual({ value: null });
    await Promise.all([first.stop(), second.stop()]);
  });

  it("uses the injected clock for expiry, TTL, persistence and counter updates", async () => {
    let now = 1_000;
    const { execute, instance } = await createEngine({ now: () => now });
    await execute("SET", ["counter", "1"]);
    await expect(execute("TTL", ["counter"])).resolves.toEqual({ value: -1 });
    await expect(execute("EXPIRE", ["counter", "5"])).resolves.toEqual({
      value: 1,
    });
    await expect(execute("TTL", ["counter"])).resolves.toEqual({ value: 5 });
    await expect(execute("INCR", ["counter"])).resolves.toEqual({ value: 2n });
    await expect(execute("TTL", ["counter"])).resolves.toEqual({ value: 5 });

    await execute("SET", ["counter", "3"]);
    await expect(execute("TTL", ["counter"])).resolves.toEqual({ value: -1 });
    await execute("EXPIRE", ["counter", 2]);
    await expect(execute("PERSIST", ["counter"])).resolves.toEqual({
      value: 1,
    });
    await expect(execute("TTL", ["counter"])).resolves.toEqual({ value: -1 });

    await execute("SET", ["batch", "before"]);
    await execute("EXPIRE", ["batch", 5]);
    await execute("MSET", ["batch", "after"]);
    await expect(execute("TTL", ["batch"])).resolves.toEqual({ value: -1 });

    now += 3_000;
    await expect(execute("GET", ["counter"])).resolves.toEqual({
      value: new TextEncoder().encode("3"),
    });

    await execute("SET", ["temporary", "x"]);
    await execute("EXPIRE", ["temporary", 1]);
    now += 999;
    await expect(execute("TTL", ["temporary"])).resolves.toEqual({ value: 0 });
    await expect(execute("GET", ["temporary"])).resolves.toEqual({
      value: new TextEncoder().encode("x"),
    });
    now += 1;
    await expect(execute("TTL", ["temporary"])).resolves.toEqual({ value: -2 });
    await expect(execute("DBSIZE")).resolves.toEqual({ value: 2 });
    await expect(execute("PERSIST", ["temporary"])).resolves.toEqual({
      value: 0,
    });
    await expect(execute("EXPIRE", ["missing", 1])).resolves.toEqual({
      value: 0,
    });
    await expect(execute("EXPIRE", ["counter", -1])).resolves.toEqual({
      value: 1,
    });
    await expect(execute("GET", ["counter"])).resolves.toEqual({ value: null });
    await expect(
      execute("EXPIRE", ["temporary", "not-seconds"]),
    ).rejects.toMatchObject({
      code: "key-value-invalid-integer",
    });
    await instance.stop();
  });

  it("scans the live filtered key view in bounded cursor batches", async () => {
    let now = 9_000;
    const { execute, instance } = await createEngine({ now: () => now });
    await execute("MSET", ["alpha", "1", "alpine", "2", "beta", "3"]);
    await execute("SET", ["expired", "x"]);
    await execute("EXPIRE", ["expired", 1]);
    now += 1_000;
    await expect(execute("DBSIZE")).resolves.toEqual({ value: 3 });
    await expect(
      execute("SCAN", ["0", "MATCH", "al*", "COUNT", "1"]),
    ).resolves.toEqual({
      value: ["1", ["alpha"]],
    });
    await expect(
      execute("SCAN", ["1", "MATCH", "al*", "COUNT", 1]),
    ).resolves.toEqual({
      value: ["0", ["alpine"]],
    });
    await expect(execute("SCAN", ["0", "MATCH", "b?t*"])).resolves.toEqual({
      value: ["0", ["beta"]],
    });
    await expect(execute("SCAN", ["0", "COUNT", 1_001])).rejects.toMatchObject({
      code: "key-value-invalid-scan-count",
    });
    await instance.stop();
  });

  it("enforces the logical memory budget and keeps rejected MSET batches atomic", async () => {
    const { execute, instance } = await createEngine({ maxMemoryBytes: 260 });
    await execute("MSET", ["a", "x", "b", "y"]);
    await expect(execute("SET", ["c", "z"])).rejects.toMatchObject({
      code: "key-value-memory-limit",
    });
    await expect(execute("SET", ["a", "xx"])).rejects.toMatchObject({
      code: "key-value-memory-limit",
    });
    await expect(execute("MSET", ["a", "xx", "c", "z"])).rejects.toMatchObject({
      code: "key-value-memory-limit",
    });
    await expect(execute("GET", ["a"])).resolves.toEqual({
      value: new TextEncoder().encode("x"),
    });
    await expect(execute("GET", ["c"])).resolves.toEqual({ value: null });
    await expect(execute("DBSIZE")).resolves.toEqual({ value: 2 });
    await instance.stop();
  });

  it("reclaims expired bytes before admitting a bounded write", async () => {
    let now = 5_000;
    const { execute, instance } = await createEngine({
      maxMemoryBytes: 260,
      now: () => now,
    });
    await execute("MSET", ["a", "x", "b", "y"]);
    await execute("EXPIRE", ["a", 1]);
    now += 1_000;
    await expect(execute("SET", ["c", "z"])).resolves.toEqual({ value: "OK" });
    await expect(execute("DBSIZE")).resolves.toEqual({ value: 2 });
    await expect(execute("GET", ["a"])).resolves.toEqual({ value: null });
    await instance.stop();
  });

  it("round-trips binary values and absolute expiry in a versioned snapshot", async () => {
    let now = 10_000;
    const source = new KeyValueEngineInstance("snapshot-source", "kv", {
      now: () => now,
    });
    await source.start();
    const sourceSession = await source.openSession({
      sessionId: "snapshot-source-session",
      instanceId: source.id,
      access: "owner",
    });
    await source.execute(sourceSession, {
      operation: "SET",
      payload: ["binary", new Uint8Array([0, 255, 65])],
    });
    await source.execute(sourceSession, {
      operation: "EXPIRE",
      payload: ["binary", 60],
    });
    await source.execute(sourceSession, {
      operation: "SET",
      payload: ["surrogate-\ud800", "preserved-key"],
    });
    const snapshot = await (
      source as typeof source & {
        exportSnapshot(): Promise<Uint8Array>;
      }
    ).exportSnapshot();
    now += 1_000;

    const restored = new KeyValueEngineInstance("snapshot-restored", "kv", {
      now: () => now,
      snapshot,
    });
    await restored.start();
    const restoredSession = await restored.openSession({
      sessionId: "snapshot-restored-session",
      instanceId: restored.id,
      access: "owner",
    });
    await expect(
      restored.execute(restoredSession, {
        operation: "GET",
        payload: ["binary"],
      }),
    ).resolves.toEqual({ value: new Uint8Array([0, 255, 65]) });
    await expect(
      restored.execute(restoredSession, {
        operation: "TTL",
        payload: ["binary"],
      }),
    ).resolves.toEqual({ value: 59 });
    await expect(
      restored.execute(restoredSession, {
        operation: "GET",
        payload: ["surrogate-\ud800"],
      }),
    ).resolves.toEqual({ value: new TextEncoder().encode("preserved-key") });
    await Promise.all([source.stop(), restored.stop()]);
  });

  it("rejects malformed and incompatible snapshots before starting an instance", async () => {
    const adapter = new KeyValueEngineAdapter();
    expect(() =>
      adapter.createInstance({ snapshot: new Uint8Array([1, 2]) }, "bad"),
    ).toThrow(expect.objectContaining({ code: "snapshot-invalid" }));
    const foreignEngineSnapshot = encodeSnapshot(
      "postgresql",
      "pglite-data-dir-gzip-v1",
      new Uint8Array(),
    );
    expect(() =>
      adapter.createInstance({ snapshot: foreignEngineSnapshot }, "foreign"),
    ).toThrow(expect.objectContaining({ code: "snapshot-incompatible" }));
  });
});
