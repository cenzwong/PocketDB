import {
  mergeReplicaSnapshot,
  restoreReplicaSnapshot,
  IndexedDBReplicaPersistence,
} from "../src/persistence";
import { encodeSnapshot } from "@pocketdb/runtime";
import { YjsReplica } from "../src/replica";

declare global {
  interface Window {
    __crdtPersistenceProbe?: {
      start: (replicaId: string) => Promise<void>;
      set: (key: string, value: string) => void;
      entries: () => [string, string][];
      flush: () => Promise<void>;
      snapshot: () => Promise<number[]>;
      tryStart: (replicaId: string) => Promise<{ ok: boolean; code?: string }>;
      close: () => Promise<void>;
      restoreEntries: (snapshot: number[]) => [string, string][];
      mergeAndRead: (snapshot: number[]) => {
        entries: [string, string][];
        code?: string;
      };
      malformedRestore: () => { code?: string; entries: [string, string][] };
      incompatibleRestore: () => { code?: string };
    };
  }
}

let active: IndexedDBReplicaPersistence | undefined;

async function start(replicaId: string): Promise<void> {
  if (active) throw new Error("A persistent replica is already open.");
  active = await IndexedDBReplicaPersistence.open(replicaId);
}

function entries(): [string, string][] {
  if (!active) throw new Error("No persistent replica is open.");
  return active.replica.map<string>("items").entries();
}

async function close(): Promise<void> {
  const persistence = active;
  active = undefined;
  await persistence?.close();
}

window.__crdtPersistenceProbe = {
  start,
  set(key, value) {
    if (!active) throw new Error("No persistent replica is open.");
    active.replica.map<string>("items").set(key, value);
  },
  entries,
  async flush() {
    if (!active) throw new Error("No persistent replica is open.");
    await active.flush();
  },
  async snapshot() {
    if (!active) throw new Error("No persistent replica is open.");
    return Array.from(await active.exportSnapshot());
  },
  async tryStart(replicaId) {
    try {
      const persistence = await IndexedDBReplicaPersistence.open(replicaId);
      await persistence.close();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code:
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "unknown-error",
      };
    }
  },
  close,
  restoreEntries(snapshot) {
    const replica = restoreReplicaSnapshot(new Uint8Array(snapshot));
    try {
      return replica.map<string>("items").entries();
    } finally {
      replica.destroy();
    }
  },
  mergeAndRead(snapshot) {
    if (!active) throw new Error("No persistent replica is open.");
    try {
      mergeReplicaSnapshot(active.replica, new Uint8Array(snapshot));
      return { entries: entries() };
    } catch (error) {
      return {
        entries: entries(),
        code:
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "unknown-error",
      };
    }
  },
  malformedRestore() {
    try {
      restoreReplicaSnapshot(new Uint8Array([1, 2]));
      return { entries: entries() };
    } catch (error) {
      return {
        entries: entries(),
        code:
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "unknown-error",
      };
    }
  },
  incompatibleRestore() {
    const other = new YjsReplica();
    other.map<string>("items").set("other", "engine");
    const snapshot = encodeSnapshot(
      "kv",
      "yjs-state-v1",
      other.encodePortableState(),
      Date.now(),
      "13.6.33",
    );
    other.destroy();
    try {
      restoreReplicaSnapshot(snapshot);
      return {};
    } catch (error) {
      return {
        code:
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : "unknown-error",
      };
    }
  },
};
