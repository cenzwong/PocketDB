import { decodeSnapshot, encodeSnapshot } from "@pocketdb/runtime";
import {
  CrdtOperationError,
  MAX_CRDT_STATE_BYTES,
  YjsReplica,
  type YjsReplicaOptions,
} from "./replica";

const SNAPSHOT_FORMAT = "yjs-state-v1";
const SNAPSHOT_ENGINE_VERSION = "13.6.33";
const DATABASE_NAME = "pocketdb-crdt-replicas-v1";
const OBJECT_STORE = "replicas";

export type ReplicaPersistenceErrorCode =
  | "storage-unavailable"
  | "storage-already-owned"
  | "storage-quota-exceeded"
  | "storage-invalid"
  | "snapshot-invalid"
  | "snapshot-incompatible"
  | "replica-too-large"
  | "closed";

export class ReplicaPersistenceError extends Error {
  constructor(
    readonly code: ReplicaPersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReplicaPersistenceError";
  }
}

export interface IndexedDBReplicaPersistenceOptions extends YjsReplicaOptions {
  readonly onError?: (error: ReplicaPersistenceError) => void;
}

/** IndexedDB persistence with exclusive same-origin ownership for one replica ID. */
export class IndexedDBReplicaPersistence {
  readonly replica: YjsReplica;
  private readonly db: IDBDatabase;
  private readonly releaseLock: () => void;
  private readonly unsubscribe: () => void;
  private currentState: "open" | "closed" = "open";
  private pendingWrites: Promise<void> = Promise.resolve();
  private persistenceError?: ReplicaPersistenceError;

  private constructor(
    readonly replicaId: string,
    replica: YjsReplica,
    db: IDBDatabase,
    releaseLock: () => void,
    private readonly onError?: (error: ReplicaPersistenceError) => void,
  ) {
    this.replica = replica;
    this.db = db;
    this.releaseLock = releaseLock;
    this.unsubscribe = replica.onUpdate(() => this.queueWrite());
  }

  static async open(
    replicaId: string,
    options: IndexedDBReplicaPersistenceOptions = {},
  ): Promise<IndexedDBReplicaPersistence> {
    validateReplicaId(replicaId);
    const releaseLock = await acquireReplicaLock(replicaId);
    let db: IDBDatabase | undefined;
    let replica: YjsReplica | undefined;
    try {
      db = await openDatabase();
      const stored = await readReplica(db, replicaId);
      replica = new YjsReplica(options);
      if (stored) {
        validatePortableState(stored);
        replica.applyPortableState(stored);
      }
      return new IndexedDBReplicaPersistence(
        replicaId,
        replica,
        db,
        releaseLock,
        options.onError,
      );
    } catch (cause) {
      replica?.destroy();
      db?.close();
      releaseLock();
      throw toPersistenceError(cause);
    }
  }

  get state(): "open" | "closed" {
    return this.currentState;
  }

  async flush(): Promise<void> {
    this.assertOpen();
    await this.pendingWrites;
    if (this.persistenceError) throw this.persistenceError;
    await this.writeState(this.replica.encodePortableState());
  }

  async exportSnapshot(): Promise<Uint8Array> {
    this.assertOpen();
    await this.flush();
    return createReplicaSnapshot(this.replica);
  }

  async close(): Promise<void> {
    if (this.currentState === "closed") return;
    let failure: unknown;
    try {
      await this.flush();
    } catch (cause) {
      failure = cause;
    } finally {
      this.currentState = "closed";
      this.unsubscribe();
      this.db.close();
      this.replica.destroy();
      this.releaseLock();
    }
    if (failure) throw failure;
  }

  private queueWrite(): void {
    if (this.currentState !== "open") return;
    let state: Uint8Array;
    try {
      state = this.replica.encodePortableState();
    } catch (cause) {
      this.recordError(toPersistenceError(cause));
      return;
    }
    this.pendingWrites = this.pendingWrites
      .then(() => this.writeState(state))
      .catch((cause: unknown) => this.recordError(toPersistenceError(cause)));
  }

  private async writeState(state: Uint8Array): Promise<void> {
    this.assertOpen();
    if (state.byteLength > MAX_CRDT_STATE_BYTES)
      throw new ReplicaPersistenceError(
        "replica-too-large",
        `Replica state exceeds the ${MAX_CRDT_STATE_BYTES}-byte limit.`,
      );
    await new Promise<void>((resolve, reject) => {
      const transaction = this.db.transaction(OBJECT_STORE, "readwrite");
      transaction.objectStore(OBJECT_STORE).put(
        {
          replicaId: this.replicaId,
          state: state.slice(),
          updatedAt: Date.now(),
        },
        this.replicaId,
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }).catch((cause: unknown) => {
      throw toPersistenceError(cause);
    });
    this.persistenceError = undefined;
  }

  private recordError(error: ReplicaPersistenceError): void {
    this.persistenceError = error;
    try {
      this.onError?.(error);
    } catch {
      // Persistence failures must not escape through Yjs' synchronous update event.
    }
  }

  private assertOpen(): void {
    if (this.currentState !== "open")
      throw new ReplicaPersistenceError(
        "closed",
        "Replica persistence is closed.",
      );
  }
}

/** Exports a complete versioned Yjs state; portable size is capped at 256 MiB. */
export function createReplicaSnapshot(replica: YjsReplica): Uint8Array {
  try {
    return encodeSnapshot(
      "crdt",
      SNAPSHOT_FORMAT,
      replica.encodePortableState(),
      Date.now(),
      SNAPSHOT_ENGINE_VERSION,
    );
  } catch (cause) {
    throw toPersistenceError(cause);
  }
}

/** Creates an isolated replica from a compatible snapshot after validating the entire payload. */
export function restoreReplicaSnapshot(
  snapshot: Uint8Array,
  options: YjsReplicaOptions = {},
): YjsReplica {
  const state = decodeReplicaSnapshot(snapshot);
  const replica = new YjsReplica(options);
  try {
    replica.applyPortableState(state);
    return replica;
  } catch (cause) {
    replica.destroy();
    throw toPersistenceError(cause);
  }
}

/** Merges a compatible snapshot into a replica without replacing its current state. */
export function mergeReplicaSnapshot(
  destination: YjsReplica,
  snapshot: Uint8Array,
): void {
  const incoming = decodeReplicaSnapshot(snapshot);
  const candidate = new YjsReplica();
  try {
    candidate.applyPortableState(destination.encodePortableState());
    candidate.applyPortableState(incoming);
    const merged = candidate.encodePortableState();
    destination.applyPortableState(merged);
  } catch (cause) {
    throw toPersistenceError(cause);
  } finally {
    candidate.destroy();
  }
}

function decodeReplicaSnapshot(snapshot: Uint8Array): Uint8Array {
  try {
    const { payload } = decodeSnapshot(
      snapshot,
      "crdt",
      SNAPSHOT_FORMAT,
      SNAPSHOT_ENGINE_VERSION,
    );
    validatePortableState(payload);
    return payload;
  } catch (cause) {
    throw toPersistenceError(cause);
  }
}

function validatePortableState(state: Uint8Array): void {
  const validationReplica = new YjsReplica();
  try {
    validationReplica.applyPortableState(state);
    validationReplica.encodePortableState();
  } finally {
    validationReplica.destroy();
  }
}

function validateReplicaId(replicaId: string): void {
  if (
    typeof replicaId !== "string" ||
    replicaId.trim().length === 0 ||
    new TextEncoder().encode(replicaId).byteLength > 512
  )
    throw new ReplicaPersistenceError(
      "storage-unavailable",
      "Replica IDs must contain 1 to 512 UTF-8 bytes.",
    );
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    return Promise.reject(
      new ReplicaPersistenceError(
        "storage-unavailable",
        "IndexedDB is unavailable in this browser context.",
      ),
    );
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE))
        request.result.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new ReplicaPersistenceError(
          "storage-unavailable",
          "IndexedDB database upgrade was blocked by another tab.",
        ),
      );
  });
}

function readReplica(
  db: IDBDatabase,
  replicaId: string,
): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE, "readonly");
    const request = transaction.objectStore(OBJECT_STORE).get(replicaId);
    request.onsuccess = () => {
      const value: unknown = request.result?.state;
      if (value === undefined) {
        resolve(undefined);
        return;
      }
      if (value instanceof Uint8Array) {
        resolve(value.slice());
        return;
      }
      if (value instanceof ArrayBuffer) {
        resolve(new Uint8Array(value));
        return;
      }
      reject(
        new ReplicaPersistenceError(
          "storage-invalid",
          "Stored replica state is not binary.",
        ),
      );
    };
    request.onerror = () => reject(request.error);
  });
}

async function acquireReplicaLock(replicaId: string): Promise<() => void> {
  if (typeof navigator === "undefined" || !navigator.locks)
    throw new ReplicaPersistenceError(
      "storage-unavailable",
      "Persistent replicas require Web Locks and IndexedDB.",
    );
  let acquired!: (value: boolean) => void;
  const acquiredPromise = new Promise<boolean>(
    (resolve) => (acquired = resolve),
  );
  let release!: () => void;
  const releasePromise = new Promise<void>((resolve) => (release = resolve));
  const request = navigator.locks
    .request(
      `pocketdb-crdt:${replicaId}`,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        acquired(lock !== null);
        if (lock) await releasePromise;
      },
    )
    .catch((cause: unknown) => {
      acquired(false);
      throw cause;
    });
  const hasLock = await acquiredPromise;
  if (!hasLock) {
    await request.catch(() => undefined);
    throw new ReplicaPersistenceError(
      "storage-already-owned",
      `Replica ${replicaId} is already open in another context.`,
    );
  }
  void request.catch(() => undefined);
  return release;
}

function toPersistenceError(cause: unknown): ReplicaPersistenceError {
  if (cause instanceof ReplicaPersistenceError) return cause;
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    if (cause.code === "snapshot-invalid")
      return new ReplicaPersistenceError("snapshot-invalid", String(cause), {
        cause,
      });
    if (cause.code === "snapshot-incompatible")
      return new ReplicaPersistenceError(
        "snapshot-incompatible",
        String(cause),
        { cause },
      );
  }
  if (cause instanceof CrdtOperationError) {
    const code =
      cause.code === "state-too-large" || cause.code === "update-too-large"
        ? "replica-too-large"
        : "storage-invalid";
    return new ReplicaPersistenceError(code, cause.message, { cause });
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/quota/i.test(message))
    return new ReplicaPersistenceError(
      "storage-quota-exceeded",
      "Browser storage quota was exceeded while saving the replica.",
      { cause },
    );
  return new ReplicaPersistenceError(
    "storage-unavailable",
    "Replica persistence operation failed.",
    { cause },
  );
}
