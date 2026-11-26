import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_CRDT_UPDATE_BYTES, YjsReplica } from "../src/replica";

describe("Yjs typed replica adapter", () => {
  it("converges independent offline map, array, text and document edits", () => {
    const alice = new YjsReplica();
    const bob = new YjsReplica();
    try {
      const aliceTasks = alice.map<{ done: boolean }>("tasks");
      const bobTasks = bob.map<{ done: boolean }>("tasks");
      aliceTasks.set("alice", { done: false });
      bobTasks.set("bob", { done: true });
      alice.map<string>("same-key").set("status", "alice-offline");
      bob.map<string>("same-key").set("status", "bob-offline");
      alice.array<string>("events").push("alice-created");
      bob.array<string>("events").push("bob-created");
      alice.text("notes").insert(0, "hello");
      bob.text("notes").insert(0, "world");
      alice
        .documentFor<{ title: string; count: number }>("settings")
        .set("title", "Shared board");
      bob
        .documentFor<{ title: string; count: number }>("settings")
        .set("count", 2);

      const aliceUpdate = alice.encodeUpdate();
      const bobUpdate = bob.encodeUpdate();
      alice.applyUpdate(bobUpdate);
      bob.applyUpdate(aliceUpdate);
      alice.applyUpdate(bobUpdate);
      bob.applyUpdate(aliceUpdate);

      expect(alice.map<{ done: boolean }>("tasks").toJSON()).toEqual(
        bob.map<{ done: boolean }>("tasks").toJSON(),
      );
      expect(alice.array<string>("events").toArray()).toEqual(
        bob.array<string>("events").toArray(),
      );
      expect(alice.text("notes").toString()).toBe(bob.text("notes").toString());
      expect(alice.documentFor("settings").toJSON()).toEqual(
        bob.documentFor("settings").toJSON(),
      );
      expect(alice.map<string>("same-key").get("status")).toBe(
        bob.map<string>("same-key").get("status"),
      );
      expect(alice.encodeStateVector()).toEqual(bob.encodeStateVector());
    } finally {
      alice.destroy();
      bob.destroy();
    }
  });

  it("lets a read-only replica consume updates but rejects local mutation", () => {
    const writer = new YjsReplica();
    const reader = new YjsReplica({ localWriteAccess: false });
    try {
      writer.map<string>("state").set("value", "shared");
      reader.applyUpdate(writer.encodeUpdate());
      expect(reader.map<string>("state").get("value")).toBe("shared");
      expect(() =>
        reader.map<string>("state").set("value", "local"),
      ).toThrowError(expect.objectContaining({ code: "read-only" }));
    } finally {
      writer.destroy();
      reader.destroy();
    }
  });

  it("bounds update size and validates names and JSON-compatible values", () => {
    const replica = new YjsReplica({ maxUpdateBytes: 8 });
    try {
      expect(() => replica.map(" ")).toThrow(
        expect.objectContaining({ code: "invalid-name" }),
      );
      expect(() =>
        replica.map("state").set("bad", Number.POSITIVE_INFINITY),
      ).toThrow(expect.objectContaining({ code: "invalid-value" }));
      replica
        .map("state")
        .set("value", "a value long enough to exceed eight bytes");
      expect(() => replica.encodeUpdate()).toThrow(
        expect.objectContaining({ code: "update-too-large" }),
      );
      expect(() => replica.applyUpdate(new Uint8Array(9))).toThrow(
        expect.objectContaining({ code: "update-too-large" }),
      );
      expect(DEFAULT_MAX_CRDT_UPDATE_BYTES).toBe(16 * 1024 - 4);
    } finally {
      replica.destroy();
    }
  });

  it("copies JSON values so caller mutation cannot bypass Yjs updates", () => {
    const replica = new YjsReplica();
    try {
      const input = { nested: { value: "original" } };
      const values = replica.map<{ nested: { value: string } }>("values");
      values.set("item", input);
      input.nested.value = "changed outside the replica";
      const returned = values.get("item");
      if (!returned) throw new Error("stored value is missing");
      returned.nested.value = "changed through a read result";
      expect(values.get("item")).toEqual({ nested: { value: "original" } });
    } finally {
      replica.destroy();
    }
  });

  it("rejects malformed updates and prevents use after close", () => {
    const replica = new YjsReplica();
    expect(() => replica.applyUpdate(new Uint8Array([255]))).toThrow(
      expect.objectContaining({ code: "invalid-update" }),
    );
    replica.destroy();
    expect(() => replica.encodeStateVector()).toThrow(
      expect.objectContaining({ code: "invalid-update" }),
    );
  });
});
