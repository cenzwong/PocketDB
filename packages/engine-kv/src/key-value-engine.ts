import {
  EngineOperationError,
  EngineRuntimeError,
  assertEngineOperationPermission,
  type EngineAdapter,
  type EngineCapabilities,
  type EngineConfig,
  type EngineHealth,
  type EngineInstance,
  type EngineRequest,
  type EngineResponse,
  type EngineSession,
  type InstanceId,
  type SessionContext,
  type SessionId,
  encodeSnapshot,
  decodeSnapshot,
} from "@pocketdb/runtime";

const MIN_INTEGER = -(1n << 63n);
const MAX_INTEGER = (1n << 63n) - 1n;
const encoder = new TextEncoder();
export const DEFAULT_KEY_VALUE_MEMORY_BYTES = 64 * 1024 * 1024;
export const MAX_KEY_VALUE_MEMORY_BYTES = DEFAULT_KEY_VALUE_MEMORY_BYTES;
export const KEY_VALUE_ENTRY_OVERHEAD_BYTES = 128;
export const DEFAULT_SCAN_COUNT = 10;
export const MAX_SCAN_COUNT = 1_000;
const KV_SNAPSHOT_FORMAT = "kv-entries-v1";

export interface KeyValueEngineOptions {
  readonly maxMemoryBytes?: number;
  readonly now?: () => number;
  readonly dataDir?: string;
  readonly snapshot?: Uint8Array;
}

const capabilities: EngineCapabilities = {
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
    persistence: true,
    persistentDataDir: true,
    portableSnapshots: true,
    memoryBudgetBytes: DEFAULT_KEY_VALUE_MEMORY_BYTES,
    commandSetVersion: 2,
  },
};

export class KeyValueCommandError extends EngineOperationError {
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "KeyValueCommandError";
  }
}

export class KeyValueEngineAdapter implements EngineAdapter {
  readonly id = "kv";

  capabilities(): EngineCapabilities {
    return capabilities;
  }

  createInstance(config: EngineConfig, instanceId: InstanceId): EngineInstance {
    const maxMemoryBytes = config.maxMemoryBytes;
    if (
      maxMemoryBytes !== undefined &&
      (typeof maxMemoryBytes !== "number" ||
        !Number.isSafeInteger(maxMemoryBytes) ||
        maxMemoryBytes < KEY_VALUE_ENTRY_OVERHEAD_BYTES ||
        maxMemoryBytes > MAX_KEY_VALUE_MEMORY_BYTES)
    ) {
      throw new TypeError(
        `maxMemoryBytes must be an integer between ${KEY_VALUE_ENTRY_OVERHEAD_BYTES} and ${MAX_KEY_VALUE_MEMORY_BYTES}.`,
      );
    }
    const dataDir = config.dataDir;
    if (dataDir !== undefined && typeof dataDir !== "string") {
      throw new EngineRuntimeError(
        "instance-start-failed",
        "Key-value dataDir must be a string.",
      );
    }
    return new KeyValueEngineInstance(instanceId, this.id, {
      maxMemoryBytes: maxMemoryBytes as number | undefined,
      dataDir: dataDir ?? "memory://",
      snapshot: requireSnapshotConfig(config.snapshot),
    });
  }
}

export class KeyValueEngineInstance implements EngineInstance {
  private readonly values = new Map<string, Uint8Array>();
  private readonly expiresAt = new Map<string, number>();
  private readonly sessions = new Map<SessionId, EngineSession>();
  private readonly dirtyKeys = new Set<string>();
  private readonly deletedKeys = new Set<string>();
  private state: "new" | "started" | "stopped" | "failed" = "new";
  private memoryUsedBytes = 0;
  private readonly maxMemoryBytes: number;
  private readonly clock: () => number;
  private readonly dataDir: string;
  private readonly importEntries?: readonly StoredEntry[];
  private database?: IDBDatabase;
  private releaseStorageLock?: () => void;
  private storageLockRequest?: Promise<void>;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    readonly id: InstanceId,
    readonly engineId = "kv",
    options: KeyValueEngineOptions = {},
  ) {
    this.maxMemoryBytes =
      options.maxMemoryBytes ?? DEFAULT_KEY_VALUE_MEMORY_BYTES;
    this.dataDir = options.dataDir ?? "memory://";
    this.clock = options.now ?? Date.now;
    this.importEntries = options.snapshot
      ? decodeKeyValueSnapshot(options.snapshot, this.clock())
      : undefined;
    if (
      !Number.isSafeInteger(this.maxMemoryBytes) ||
      this.maxMemoryBytes < KEY_VALUE_ENTRY_OVERHEAD_BYTES ||
      this.maxMemoryBytes > MAX_KEY_VALUE_MEMORY_BYTES
    ) {
      throw new RangeError(
        `maxMemoryBytes must be an integer between ${KEY_VALUE_ENTRY_OVERHEAD_BYTES} and ${MAX_KEY_VALUE_MEMORY_BYTES}.`,
      );
    }
  }

  async start(): Promise<void> {
    if (this.state !== "new") {
      throw new EngineRuntimeError(
        "instance-not-started",
        `Key-value instance '${this.id}' cannot start from ${this.state}.`,
      );
    }
    try {
      if (this.isPersistent()) {
        if (this.dataDir.length === "idb://".length) {
          throw new EngineOperationError(
            "key-value-storage-unavailable",
            "Persistent key-value storage requires a non-empty idb:// data directory.",
          );
        }
        await this.acquireStorageOwnership();
        this.database = await openDatabase(this.databaseName());
        const entries = this.importEntries
          ? this.importEntries
          : await readEntries(this.database);
        this.loadEntries(entries);
        if (this.importEntries) {
          await replaceEntries(this.database, entries);
        }
        await this.persistChanges();
      } else if (this.dataDir !== "memory://") {
        throw new EngineOperationError(
          "key-value-storage-unavailable",
          "Persistent key-value storage requires an idb:// data directory.",
        );
      } else if (this.importEntries) {
        this.loadEntries(this.importEntries);
      }
      this.state = "started";
    } catch (cause) {
      this.values.clear();
      this.expiresAt.clear();
      this.dirtyKeys.clear();
      this.deletedKeys.clear();
      this.memoryUsedBytes = 0;
      await this.closeDatabase();
      await this.releaseStorageOwnership();
      if (cause instanceof EngineOperationError) throw cause;
      if (this.isPersistent()) throw toStorageError(cause, "opening");
      throw new EngineRuntimeError(
        "instance-start-failed",
        `Key-value instance '${this.id}' failed to start.`,
        { cause },
      );
    }
  }

  private loadEntries(entries: readonly StoredEntry[]): void {
    for (const entry of entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= this.clock()) {
        if (this.database) this.deletedKeys.add(entry.key);
        continue;
      }
      const value = toBytes(entry.value);
      this.values.set(entry.key, value);
      if (entry.expiresAt !== undefined)
        this.expiresAt.set(entry.key, entry.expiresAt);
      this.memoryUsedBytes += this.entryBytes(entry.key, value);
    }
    if (this.memoryUsedBytes > this.maxMemoryBytes) {
      throw new EngineOperationError(
        "key-value-memory-limit",
        `Persisted data exceeds the ${this.maxMemoryBytes}-byte key-value memory budget.`,
      );
    }
  }

  async exportSnapshot(): Promise<Uint8Array> {
    return this.runExclusive(async () => {
      this.requireStarted();
      this.purgeExpired();
      const entries: StoredEntry[] = [...this.values].map(([key, value]) => ({
        key,
        value: value.slice(),
        expiresAt: this.expiresAt.get(key),
      }));
      return encodeSnapshot(
        this.engineId,
        KV_SNAPSHOT_FORMAT,
        encodeKeyValueEntries(entries),
      );
    });
  }

  async openSession(context: SessionContext): Promise<EngineSession> {
    this.requireStarted();
    if (context.instanceId !== this.id) {
      throw new EngineRuntimeError(
        "session-instance-mismatch",
        "Session belongs to another instance.",
      );
    }
    if (this.sessions.has(context.sessionId)) {
      throw new EngineRuntimeError(
        "session-already-exists",
        `Session '${context.sessionId}' is already open.`,
      );
    }
    const session = Object.freeze({
      id: context.sessionId,
      instanceId: this.id,
      access: context.access,
    });
    this.sessions.set(session.id, session);
    return session;
  }

  async execute(
    session: EngineSession,
    request: EngineRequest,
  ): Promise<EngineResponse> {
    return this.runExclusive(async () => {
      this.requireStarted();
      this.requireSession(session);
      assertEngineOperationPermission(session.access, capabilities, request);
      if (request.signal?.aborted) {
        throw new EngineRuntimeError(
          "request-aborted",
          "Key-value operation was cancelled before execution.",
        );
      }
      const operation = request.operation.toUpperCase();
      const args = commandArguments(request.payload);
      let response: EngineResponse;
      switch (operation) {
        case "PING":
          response = this.ping(args);
          break;
        case "GET":
          requireArity(operation, args, 1);
          response = {
            value: cloneValue(this.getLiveValue(requireKey(args[0]))),
          };
          break;
        case "SET": {
          requireArity(operation, args, 2);
          const key = requireKey(args[0]);
          const value = requireBytes(args[1], this.maxMemoryBytes);
          this.writeEntries([[key, value]]);
          response = { value: "OK" };
          break;
        }
        case "DEL": {
          requireAtLeastOne(operation, args);
          const keys = args.map(requireKey);
          let deleted = 0;
          for (const key of keys) if (this.deleteLiveKey(key)) deleted += 1;
          response = { value: deleted };
          break;
        }
        case "EXISTS": {
          requireAtLeastOne(operation, args);
          const keys = args.map(requireKey);
          response = {
            value: keys.reduce(
              (count, key) =>
                count + Number(this.getLiveValue(key) !== undefined),
              0,
            ),
          };
          break;
        }
        case "MGET": {
          requireAtLeastOne(operation, args);
          const keys = args.map(requireKey);
          response = {
            value: keys.map((key) => cloneValue(this.getLiveValue(key))),
          };
          break;
        }
        case "MSET":
          response = this.mset(args);
          break;
        case "INCR":
        case "DECR":
          requireArity(operation, args, 1);
          response = this.increment(
            requireKey(args[0]),
            operation === "INCR" ? 1n : -1n,
          );
          break;
        case "EXPIRE":
          requireArity(operation, args, 2);
          response = this.expire(
            requireKey(args[0]),
            requireIntegerArgument(args[1], operation),
          );
          break;
        case "TTL":
          requireArity(operation, args, 1);
          response = this.ttl(requireKey(args[0]));
          break;
        case "PERSIST":
          requireArity(operation, args, 1);
          response = this.persist(requireKey(args[0]));
          break;
        case "SCAN":
          response = this.scan(args);
          break;
        case "DBSIZE":
          requireArity(operation, args, 0);
          this.purgeExpired();
          response = { value: this.values.size };
          break;
        default:
          throw commandError(
            "key-value-unknown-command",
            `ERR unknown command '${request.operation}'.`,
          );
      }
      try {
        await this.persistChanges();
      } catch (cause) {
        this.state = "failed";
        throw toStorageError(cause, "writing");
      }
      return response;
    });
  }

  async closeSession(session: EngineSession): Promise<void> {
    this.requireStarted();
    this.requireSession(session);
    this.sessions.delete(session.id);
  }

  async health(): Promise<EngineHealth> {
    return {
      status:
        this.state === "started"
          ? "healthy"
          : this.state === "stopped"
            ? "stopped"
            : this.state === "failed"
              ? "degraded"
              : "starting",
    };
  }

  async stop(): Promise<void> {
    await this.runExclusive(async () => {
      this.state = "stopped";
      this.values.clear();
      this.expiresAt.clear();
      this.dirtyKeys.clear();
      this.deletedKeys.clear();
      this.memoryUsedBytes = 0;
      this.sessions.clear();
      await this.closeDatabase();
      await this.releaseStorageOwnership();
    });
  }

  private ping(args: readonly unknown[]): EngineResponse {
    if (args.length === 0) return { value: "PONG" };
    if (args.length === 1) {
      const value = args[0];
      if (typeof value === "string") return { value };
      return { value: requireBytes(value) };
    }
    requireArity("PING", args, 1);
    return { value: "PONG" };
  }

  private mset(args: readonly unknown[]): EngineResponse {
    if (args.length < 2 || args.length % 2 !== 0) {
      throw wrongArity("MSET");
    }
    const entries: [string, Uint8Array][] = [];
    for (let index = 0; index < args.length; index += 2) {
      entries.push([
        requireKey(args[index]),
        requireBytes(args[index + 1], this.maxMemoryBytes),
      ]);
    }
    this.writeEntries(entries);
    return { value: "OK" };
  }

  private increment(key: string, delta: bigint): EngineResponse {
    const stored = this.getLiveValue(key);
    const current = stored === undefined ? 0n : parseInteger(stored);
    const next = current + delta;
    if (next < MIN_INTEGER || next > MAX_INTEGER) {
      throw commandError(
        "key-value-integer-overflow",
        "ERR increment or decrement would overflow.",
      );
    }
    const value = encoder.encode(next.toString(10));
    this.writeEntries([[key, value]], { preserveExpiry: true });
    return { value: next };
  }

  private expire(key: string, seconds: number): EngineResponse {
    if (this.getLiveValue(key) === undefined) return { value: 0 };
    if (seconds <= 0) {
      this.deleteStoredKey(key);
      return { value: 1 };
    }
    const expiresAt = this.clock() + seconds * 1_000;
    if (!Number.isSafeInteger(expiresAt)) {
      throw commandError(
        "key-value-invalid-expiry",
        "ERR invalid expire time.",
      );
    }
    this.expiresAt.set(key, expiresAt);
    this.markDirty(key);
    return { value: 1 };
  }

  private ttl(key: string): EngineResponse {
    if (this.getLiveValue(key) === undefined) return { value: -2 };
    const expiry = this.expiresAt.get(key);
    if (expiry === undefined) return { value: -1 };
    return { value: Math.max(0, Math.floor((expiry - this.clock()) / 1_000)) };
  }

  private persist(key: string): EngineResponse {
    if (this.getLiveValue(key) === undefined) return { value: 0 };
    const removed = this.expiresAt.delete(key);
    if (removed) this.markDirty(key);
    return { value: Number(removed) };
  }

  private scan(args: readonly unknown[]): EngineResponse {
    if (args.length === 0) throw wrongArity("SCAN");
    const cursor = requireIntegerArgument(args[0], "SCAN");
    if (cursor < 0) {
      throw commandError("key-value-invalid-cursor", "ERR invalid cursor.");
    }
    let pattern = "*";
    let count = DEFAULT_SCAN_COUNT;
    if ((args.length - 1) % 2 !== 0) throw wrongArity("SCAN");
    for (let index = 1; index < args.length; index += 2) {
      const option = requireStringOption(args[index], "SCAN").toUpperCase();
      if (option === "MATCH") {
        pattern = requireStringOption(args[index + 1], "SCAN");
      } else if (option === "COUNT") {
        count = requireIntegerArgument(args[index + 1], "SCAN");
        if (count < 1 || count > MAX_SCAN_COUNT) {
          throw commandError(
            "key-value-invalid-scan-count",
            `ERR SCAN count must be between 1 and ${MAX_SCAN_COUNT}.`,
          );
        }
      } else {
        throw commandError(
          "key-value-invalid-arguments",
          "ERR invalid SCAN option.",
        );
      }
    }
    this.purgeExpired();
    const matcher = compileGlob(pattern);
    const matching: string[] = [];
    let matchingCount = 0;
    let hasMore = false;
    for (const key of this.values.keys()) {
      if (!matcher(key)) continue;
      if (matchingCount >= cursor) {
        if (matching.length === count) {
          hasMore = true;
          break;
        }
        matching.push(key);
      }
      matchingCount += 1;
    }
    if (!hasMore && cursor > matchingCount) {
      throw commandError("key-value-invalid-cursor", "ERR invalid cursor.");
    }
    const nextCursor = hasMore ? cursor + matching.length : 0;
    return { value: [String(nextCursor), matching] };
  }

  private writeEntries(
    entries: readonly (readonly [string, Uint8Array])[],
    options: { readonly preserveExpiry?: boolean } = {},
  ): void {
    this.purgeExpired();
    const finalValues = new Map(entries);
    let nextUsage = this.memoryUsedBytes;
    for (const [key, value] of finalValues) {
      const current = this.values.get(key);
      if (current !== undefined) nextUsage -= this.entryBytes(key, current);
      nextUsage += this.entryBytes(key, value);
    }
    if (nextUsage > this.maxMemoryBytes) {
      throw commandError(
        "key-value-memory-limit",
        `ERR write would exceed the ${this.maxMemoryBytes}-byte key-value memory budget.`,
      );
    }
    for (const [key, value] of finalValues) {
      this.values.set(key, value);
      if (!options.preserveExpiry) this.expiresAt.delete(key);
      this.markDirty(key);
    }
    this.memoryUsedBytes = nextUsage;
  }

  private getLiveValue(key: string): Uint8Array | undefined {
    const expiry = this.expiresAt.get(key);
    if (expiry !== undefined && expiry <= this.clock()) {
      this.deleteStoredKey(key);
      return undefined;
    }
    return this.values.get(key);
  }

  private deleteLiveKey(key: string): boolean {
    this.getLiveValue(key);
    return this.deleteStoredKey(key);
  }

  private deleteStoredKey(key: string): boolean {
    const value = this.values.get(key);
    if (value === undefined) {
      this.expiresAt.delete(key);
      return false;
    }
    this.memoryUsedBytes -= this.entryBytes(key, value);
    this.values.delete(key);
    this.expiresAt.delete(key);
    if (this.database) {
      this.dirtyKeys.delete(key);
      this.deletedKeys.add(key);
    }
    return true;
  }

  private purgeExpired(): void {
    const now = this.clock();
    for (const [key, expiry] of this.expiresAt) {
      if (expiry <= now) this.deleteStoredKey(key);
    }
  }

  private entryBytes(key: string, value: Uint8Array): number {
    return (
      encoder.encode(key).byteLength +
      value.byteLength +
      KEY_VALUE_ENTRY_OVERHEAD_BYTES
    );
  }

  private markDirty(key: string): void {
    if (!this.database) return;
    this.deletedKeys.delete(key);
    this.dirtyKeys.add(key);
  }

  private isPersistent(): boolean {
    return this.dataDir.startsWith("idb://");
  }

  private databaseName(): string {
    return `pocketdb-kv-${this.dataDir.slice("idb://".length)}`;
  }

  private async persistChanges(): Promise<void> {
    const database = this.database;
    if (!database || (this.dirtyKeys.size === 0 && this.deletedKeys.size === 0))
      return;
    const transaction = database.transaction("entries", "readwrite");
    const store = transaction.objectStore("entries");
    for (const key of this.deletedKeys) store.delete(key);
    for (const key of this.dirtyKeys) {
      const value = this.values.get(key);
      if (!value) continue;
      store.put({
        key,
        value: value.slice(),
        expiresAt: this.expiresAt.get(key),
      } satisfies StoredEntry);
    }
    await transactionDone(transaction);
    this.dirtyKeys.clear();
    this.deletedKeys.clear();
  }

  private async acquireStorageOwnership(): Promise<void> {
    if (!globalThis.indexedDB || !globalThis.navigator?.locks) {
      throw new EngineOperationError(
        "key-value-storage-unavailable",
        "Persistent key-value storage requires IndexedDB and Web Locks in this browser.",
      );
    }
    let resolveAcquired!: () => void;
    let rejectAcquired!: (error: unknown) => void;
    const acquired = new Promise<void>((resolve, reject) => {
      resolveAcquired = resolve;
      rejectAcquired = reject;
    });
    let release!: () => void;
    const lifetime = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = globalThis.navigator.locks.request(
      `pocketdb:kv:${this.dataDir}`,
      { mode: "exclusive", ifAvailable: true },
      (lock) => {
        if (!lock) {
          rejectAcquired(
            new EngineOperationError(
              "key-value-storage-already-owned",
              "This key-value database is already open in another tab or worker.",
            ),
          );
          return;
        }
        this.releaseStorageLock = release;
        resolveAcquired();
        return lifetime;
      },
    );
    this.storageLockRequest = request.then(
      () => undefined,
      () => undefined,
    );
    void request.catch((cause: unknown) => {
      rejectAcquired(
        new EngineOperationError(
          "key-value-storage-unavailable",
          "The browser could not acquire persistent key-value ownership.",
          { cause },
        ),
      );
    });
    await acquired;
  }

  private async releaseStorageOwnership(): Promise<void> {
    this.releaseStorageLock?.();
    this.releaseStorageLock = undefined;
    const request = this.storageLockRequest;
    this.storageLockRequest = undefined;
    if (request) await request;
  }

  private async closeDatabase(): Promise<void> {
    this.database?.close();
    this.database = undefined;
  }

  private runExclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(action, action);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private requireSession(session: EngineSession): void {
    if (
      session.instanceId !== this.id ||
      this.sessions.get(session.id) !== session
    ) {
      throw new EngineRuntimeError(
        "session-not-found",
        `Session '${session.id}' is not open on this instance.`,
      );
    }
  }

  private requireStarted(): void {
    if (this.state !== "started") {
      throw new EngineRuntimeError(
        "instance-not-started",
        `Key-value instance '${this.id}' is ${this.state}.`,
      );
    }
  }
}

function commandArguments(payload: unknown): readonly unknown[] {
  if (payload === undefined) return [];
  if (!Array.isArray(payload)) {
    throw commandError(
      "key-value-invalid-arguments",
      "ERR command arguments must be an array.",
    );
  }
  return payload;
}

interface StoredEntry {
  readonly key: string;
  readonly value: Uint8Array;
  readonly expiresAt?: number;
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("entries", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade was blocked by another connection."));
  });
}

function readEntries(database: IDBDatabase): Promise<StoredEntry[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("entries", "readonly");
    const request = transaction.objectStore("entries").getAll();
    request.onsuccess = () => {
      const entries: StoredEntry[] = [];
      for (const value of request.result as unknown[]) {
        if (
          !isStoredEntry(value) ||
          (value.expiresAt !== undefined &&
            (!Number.isSafeInteger(value.expiresAt) || value.expiresAt < 0))
        ) {
          reject(new Error("Persistent key-value data is invalid."));
          return;
        }
        entries.push({
          key: value.key,
          value: toBytes(value.value),
          expiresAt: value.expiresAt,
        });
      }
      resolve(entries);
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function isStoredEntry(value: unknown): value is StoredEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredEntry).key === "string" &&
    ((value as StoredEntry).value instanceof Uint8Array ||
      (value as StoredEntry).value instanceof ArrayBuffer)
  );
}

function toBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value.slice() : new Uint8Array(value);
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function requireSnapshotConfig(value: unknown): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof Uint8Array)) {
    throw new EngineOperationError(
      "snapshot-invalid",
      "Key-value snapshot configuration must be a Uint8Array.",
    );
  }
  return value.slice();
}

function decodeKeyValueSnapshot(
  snapshot: Uint8Array,
  now: number,
): StoredEntry[] {
  const { payload } = decodeSnapshot(snapshot, "kv", KV_SNAPSHOT_FORMAT);
  if (payload.byteLength < 4) {
    throw new EngineOperationError(
      "snapshot-invalid",
      "Key-value payload is truncated.",
    );
  }
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const count = view.getUint32(0);
  if (count > DEFAULT_KEY_VALUE_MEMORY_BYTES / KEY_VALUE_ENTRY_OVERHEAD_BYTES) {
    throw new EngineOperationError(
      "snapshot-invalid",
      "Key-value snapshot has too many entries.",
    );
  }
  const entries: StoredEntry[] = [];
  const seen = new Set<string>();
  let offset = 4;
  let memoryBytes = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 16 > payload.byteLength) {
      throw new EngineOperationError(
        "snapshot-invalid",
        "Key-value entry header is truncated.",
      );
    }
    const keyLength = view.getUint32(offset);
    const valueLength = view.getUint32(offset + 4);
    const rawExpiry = view.getFloat64(offset + 8);
    offset += 16;
    const end = offset + keyLength + valueLength;
    if (end > payload.byteLength || end < offset) {
      throw new EngineOperationError(
        "snapshot-invalid",
        "Key-value entry length is invalid.",
      );
    }
    if (keyLength % 2 !== 0) {
      throw new EngineOperationError(
        "snapshot-invalid",
        "Key-value key encoding length is invalid.",
      );
    }
    const key = decodeKey(payload.subarray(offset, offset + keyLength));
    const expiry = rawExpiry === -1 ? undefined : rawExpiry;
    if (
      seen.has(key) ||
      (expiry !== undefined && (!Number.isSafeInteger(expiry) || expiry < 0))
    ) {
      throw new EngineOperationError(
        "snapshot-invalid",
        "Key-value entry metadata is invalid.",
      );
    }
    seen.add(key);
    const value = payload.slice(offset + keyLength, end);
    offset = end;
    if (expiry !== undefined && expiry <= now) continue;
    memoryBytes +=
      encoder.encode(key).byteLength +
      value.byteLength +
      KEY_VALUE_ENTRY_OVERHEAD_BYTES;
    if (memoryBytes > DEFAULT_KEY_VALUE_MEMORY_BYTES) {
      throw new EngineOperationError(
        "snapshot-invalid",
        "Key-value snapshot exceeds the engine memory budget.",
      );
    }
    entries.push({ key, value, expiresAt: expiry });
  }
  if (offset !== payload.byteLength) {
    throw new EngineOperationError(
      "snapshot-invalid",
      "Key-value payload contains trailing bytes.",
    );
  }
  return entries;
}

function encodeKeyValueEntries(entries: readonly StoredEntry[]): Uint8Array {
  const byteLength =
    4 +
    entries.reduce((length, entry) => {
      const keyLength = entry.key.length * 2;
      return length + 16 + keyLength + entry.value.byteLength;
    }, 0);
  const output = new Uint8Array(byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, entries.length);
  let offset = 4;
  for (const entry of entries) {
    const keyLength = entry.key.length * 2;
    view.setUint32(offset, keyLength);
    view.setUint32(offset + 4, entry.value.byteLength);
    view.setFloat64(offset + 8, entry.expiresAt ?? -1);
    for (let index = 0; index < entry.key.length; index += 1) {
      view.setUint16(
        offset + 16 + index * 2,
        entry.key.charCodeAt(index),
        true,
      );
    }
    output.set(entry.value, offset + 16 + keyLength);
    offset += 16 + keyLength + entry.value.byteLength;
  }
  return output;
}

function decodeKey(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 16_384) {
    const end = Math.min(offset + 16_384, bytes.byteLength);
    const units: number[] = [];
    for (let index = offset; index < end; index += 2) {
      units.push(view.getUint16(index, true));
    }
    chunks.push(String.fromCharCode(...units));
  }
  return chunks.join("");
}

async function replaceEntries(
  database: IDBDatabase,
  entries: readonly StoredEntry[],
): Promise<void> {
  const transaction = database.transaction("entries", "readwrite");
  const store = transaction.objectStore("entries");
  store.clear();
  for (const entry of entries) {
    store.put({
      key: entry.key,
      value: entry.value.slice(),
      expiresAt: entry.expiresAt,
    } satisfies StoredEntry);
  }
  await transactionDone(transaction);
}

function toStorageError(cause: unknown, action: string): EngineOperationError {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string" &&
    cause.code.startsWith("key-value-storage-")
  ) {
    return cause as EngineOperationError;
  }
  if (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause.name === "QuotaExceededError" ||
      cause.name === "NS_ERROR_DOM_QUOTA_REACHED")
  ) {
    return new EngineOperationError(
      "key-value-storage-quota-exceeded",
      `Browser storage quota was exceeded while ${action} the key-value database.`,
      { cause },
    );
  }
  return new EngineOperationError(
    "key-value-storage-unavailable",
    `Persistent key-value storage failed while ${action} the database.`,
    { cause },
  );
}

function requireArity(
  operation: string,
  args: readonly unknown[],
  expected: number,
): void {
  if (args.length !== expected) throw wrongArity(operation);
}

function requireAtLeastOne(operation: string, args: readonly unknown[]): void {
  if (args.length === 0) throw wrongArity(operation);
}

function wrongArity(operation: string): KeyValueCommandError {
  return commandError(
    "key-value-wrong-number-of-arguments",
    `ERR wrong number of arguments for '${operation.toLowerCase()}' command.`,
  );
}

function requireKey(value: unknown): string {
  if (typeof value !== "string") {
    throw commandError("key-value-invalid-key", "ERR keys must be strings.");
  }
  return value;
}

function requireBytes(
  value: unknown,
  maxMemoryBytes = MAX_KEY_VALUE_MEMORY_BYTES,
): Uint8Array {
  if (typeof value === "string") {
    const bytes = encoder.encode(value);
    if (bytes.byteLength + KEY_VALUE_ENTRY_OVERHEAD_BYTES > maxMemoryBytes) {
      throw memoryLimitError(maxMemoryBytes);
    }
    return bytes;
  }
  if (value instanceof ArrayBuffer) {
    if (value.byteLength + KEY_VALUE_ENTRY_OVERHEAD_BYTES > maxMemoryBytes) {
      throw memoryLimitError(maxMemoryBytes);
    }
    return new Uint8Array(value.slice(0));
  }
  if (ArrayBuffer.isView(value)) {
    if (value.byteLength + KEY_VALUE_ENTRY_OVERHEAD_BYTES > maxMemoryBytes) {
      throw memoryLimitError(maxMemoryBytes);
    }
    return new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).slice();
  }
  throw commandError(
    "key-value-invalid-value",
    "ERR values must be strings or binary data.",
  );
}

function memoryLimitError(maxMemoryBytes: number): KeyValueCommandError {
  return commandError(
    "key-value-memory-limit",
    `ERR write would exceed the ${maxMemoryBytes}-byte key-value memory budget.`,
  );
}

function requireIntegerArgument(value: unknown, operation: string): number {
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && /^-?(0|[1-9]\d*)$/.test(value)) {
    parsed = Number(value);
  } else {
    throw commandError(
      "key-value-invalid-integer",
      `ERR ${operation} integer argument is invalid.`,
    );
  }
  if (!Number.isSafeInteger(parsed)) {
    throw commandError(
      "key-value-invalid-integer",
      `ERR ${operation} integer argument is out of range.`,
    );
  }
  return parsed;
}

function requireStringOption(value: unknown, operation: string): string {
  if (typeof value !== "string") {
    throw commandError(
      "key-value-invalid-arguments",
      `ERR ${operation} options must be strings.`,
    );
  }
  return value;
}

function compileGlob(pattern: string): (value: string) => boolean {
  return (value) => {
    let previous = new Uint8Array(value.length + 1);
    previous[0] = 1;
    for (let patternIndex = 0; patternIndex < pattern.length; patternIndex++) {
      const token = pattern[patternIndex];
      const current = new Uint8Array(value.length + 1);
      if (token === "*") {
        current[0] = previous[0];
        for (let index = 1; index <= value.length; index++)
          current[index] = previous[index] || current[index - 1] ? 1 : 0;
      } else {
        for (let index = 1; index <= value.length; index++)
          current[index] =
            previous[index - 1] && (token === "?" || token === value[index - 1])
              ? 1
              : 0;
      }
      previous = current;
    }
    return previous[value.length] === 1;
  };
}

function cloneValue(value: Uint8Array | undefined): Uint8Array | null {
  return value ? value.slice() : null;
}

function parseInteger(bytes: Uint8Array): bigint {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw commandError(
      "key-value-not-integer-or-out-of-range",
      "ERR value is not an integer or out of range.",
      cause,
    );
  }
  if (!/^-?(0|[1-9]\d*)$/.test(text)) {
    throw commandError(
      "key-value-not-integer-or-out-of-range",
      "ERR value is not an integer or out of range.",
    );
  }
  const value = BigInt(text);
  if (value < MIN_INTEGER || value > MAX_INTEGER) {
    throw commandError(
      "key-value-not-integer-or-out-of-range",
      "ERR value is not an integer or out of range.",
    );
  }
  return value;
}

function commandError(
  code: string,
  message: string,
  cause?: unknown,
): KeyValueCommandError {
  return new KeyValueCommandError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
