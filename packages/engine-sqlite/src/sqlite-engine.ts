import initSqlite from "@sqlite.org/sqlite-wasm";
import type { BindableValue, BindingSpec } from "@sqlite.org/sqlite-wasm";
import sqliteWasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import {
  EngineOperationError,
  EngineRuntimeError,
  MAX_SNAPSHOT_BYTES,
  assertEngineOperationPermission,
  decodeSnapshot,
  encodeSnapshot,
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
} from "@pocketdb/runtime";

const SQLITE_VERSION = "3.54.1";
const SNAPSHOT_FORMAT = "sqlite-database-file-v1";
const SQLITE_MAGIC = "SQLite format 3\0";
const capabilities: EngineCapabilities = {
  operations: ["query"],
  readOnlyOperations: ["query"],
  features: {
    parameterizedQueries: true,
    transactions: true,
    persistentDataDir: true,
    portableSnapshots: true,
    nativeFileImportExport: true,
    memoryFallback: true,
    persistence: "opfs-sahpool",
    browserRequirements: "secure-context,opfs,web-locks",
    maxConcurrentOwners: 1,
    maxDatabaseFileBytes: MAX_SNAPSHOT_BYTES,
  },
};

type SqliteModule = Awaited<ReturnType<typeof initSqlite>>;
type SqliteDb = InstanceType<SqliteModule["oo1"]["DB"]>;
type SahPool = Awaited<ReturnType<SqliteModule["installOpfsSAHPoolVfs"]>>;

export class SqliteEngineAdapter implements EngineAdapter {
  readonly id = "sqlite";

  capabilities(): EngineCapabilities {
    return capabilities;
  }

  createInstance(config: EngineConfig, instanceId: InstanceId): EngineInstance {
    const dataDir = config.dataDir;
    if (dataDir !== undefined && typeof dataDir !== "string") {
      throw new EngineRuntimeError(
        "instance-start-failed",
        "SQLite dataDir must be a string.",
      );
    }
    return new SqliteEngineInstance(
      instanceId,
      dataDir ?? "memory://",
      readBytes(config.snapshot, "SQLite snapshot"),
      readBytes(config.databaseFile, "SQLite database file"),
    );
  }
}

export class SqliteEngineInstance implements EngineInstance {
  private database?: SqliteDb;
  private sqlite?: SqliteModule;
  private pool?: SahPool;
  private readonly sessions = new Map<SessionId, EngineSession>();
  private state: "new" | "started" | "stopping" | "stopped" | "failed" = "new";
  private releaseLock?: () => void;
  private lockRequest?: Promise<void>;
  private operationTail: Promise<void> = Promise.resolve();
  private transactionOwner?: SessionId;

  constructor(
    readonly id: InstanceId,
    private readonly dataDir = "memory://",
    private readonly snapshot?: Uint8Array,
    private readonly databaseFile?: Uint8Array,
  ) {}

  get engineId(): string {
    return "sqlite";
  }

  async start(): Promise<void> {
    if (this.state !== "new")
      throw new EngineRuntimeError(
        "instance-not-started",
        `SQLite instance '${this.id}' cannot start from ${this.state}.`,
      );
    try {
      const snapshotPayload = this.snapshot
        ? decodeSnapshot(
            this.snapshot,
            this.engineId,
            SNAPSHOT_FORMAT,
            SQLITE_VERSION,
          ).payload
        : undefined;
      const importBytes = snapshotPayload ?? this.databaseFile;
      if (importBytes) validateSqliteFile(importBytes);
      if (!this.isMemory()) await this.acquireStorageOwnership();
      const nodeRuntime =
        (
          globalThis as typeof globalThis & {
            process?: { versions?: { node?: string } };
          }
        ).process?.versions?.node !== undefined;
      if (nodeRuntime) {
        this.sqlite = await initSqlite();
      } else {
        const initialize = initSqlite as unknown as (options: {
          locateFile(path: string, prefix: string): string;
        }) => Promise<SqliteModule>;
        this.sqlite = await initialize({
          locateFile: (path, prefix) =>
            path.endsWith(".wasm") ? sqliteWasmUrl : `${prefix}${path}`,
        });
      }
      if (this.isMemory()) {
        this.database = new this.sqlite.oo1.DB({ filename: ":memory:" });
        if (importBytes) this.importIntoMemory(importBytes);
      } else {
        if (!globalThis.navigator?.storage?.getDirectory) {
          throw new EngineOperationError(
            "sqlite-storage-unavailable",
            "SQLite OPFS storage is not available in this browser.",
          );
        }
        const name = this.storageName();
        this.pool = await this.sqlite.installOpfsSAHPoolVfs({
          name: `pocketdb-${name}`,
          directory: `/pocketdb-${name}`,
          initialCapacity: 6,
        });
        const fileName = `/${name}.sqlite`;
        if (importBytes) await this.pool.importDb(fileName, importBytes);
        this.database = new this.pool.OpfsSAHPoolDb(fileName);
      }
      this.requireDatabase().exec("PRAGMA journal_mode=DELETE");
      this.state = "started";
    } catch (cause) {
      this.state = "failed";
      await this.cleanupStorage();
      if (
        cause instanceof EngineOperationError ||
        cause instanceof EngineRuntimeError
      )
        throw cause;
      throw new EngineOperationError(
        "sqlite-storage-unavailable",
        "SQLite could not open its database. Check secure-context, OPFS and Web Lock support.",
        { cause },
      );
    }
  }

  async openSession(context: SessionContext): Promise<EngineSession> {
    this.requireStarted();
    if (context.instanceId !== this.id)
      throw new EngineRuntimeError(
        "session-instance-mismatch",
        "Session belongs to another SQLite instance.",
      );
    if (this.sessions.has(context.sessionId))
      throw new EngineRuntimeError(
        "session-already-exists",
        `Session '${context.sessionId}' is already open.`,
      );
    const session = Object.freeze({
      id: context.sessionId,
      instanceId: this.id,
      access: context.access,
    });
    this.sessions.set(session.id, session);
    return session;
  }

  execute(
    session: EngineSession,
    request: EngineRequest,
  ): Promise<EngineResponse> {
    this.requireStarted();
    this.requireSession(session);
    assertEngineOperationPermission(session.access, capabilities, request);
    if (request.operation.toLowerCase() !== "query")
      throw new EngineOperationError(
        "sqlite-unsupported-operation",
        `Unsupported SQLite operation '${request.operation}'.`,
      );
    const payload = requireQuery(request.payload);
    if (session.access === "read-only" && !isSingleSelect(payload.sql)) {
      throw new EngineOperationError(
        "permission-denied",
        "Read-only SQLite sessions accept a single SELECT statement only.",
      );
    }
    if (request.signal?.aborted)
      throw new EngineRuntimeError(
        "request-aborted",
        "SQLite operation was cancelled before execution.",
      );
    return this.runExclusive(() => {
      if (this.transactionOwner && this.transactionOwner !== session.id) {
        throw new EngineOperationError(
          "sqlite-session-busy",
          "Another session owns an active SQLite transaction; retry after it completes.",
        );
      }
      if (request.signal?.aborted)
        throw new EngineRuntimeError(
          "request-aborted",
          "SQLite operation was cancelled before execution.",
        );
      try {
        const rows = this.requireDatabase().exec({
          sql: payload.sql,
          bind: payload.params as BindingSpec | undefined,
          returnValue: "resultRows",
          rowMode: payload.rowMode ?? "object",
        }) as unknown[];
        this.updateTransactionOwner(session.id, payload.sql);
        return { value: { rows } };
      } catch (cause) {
        if (
          cause instanceof EngineOperationError ||
          cause instanceof EngineRuntimeError
        )
          throw cause;
        const message =
          cause instanceof Error ? cause.message : "SQLite query failed.";
        throw new EngineOperationError("sqlite-query-failed", message, {
          cause,
        });
      }
    });
  }

  async closeSession(session: EngineSession): Promise<void> {
    this.requireStarted();
    this.requireSession(session);
    await this.runExclusive(() => {
      if (this.transactionOwner === session.id) {
        try {
          this.requireDatabase().exec("ROLLBACK");
        } finally {
          this.transactionOwner = undefined;
        }
      }
      this.sessions.delete(session.id);
    });
  }

  async health(): Promise<EngineHealth> {
    return {
      status:
        this.state === "started" && this.database
          ? "healthy"
          : this.state === "stopped"
            ? "stopped"
            : this.state === "failed"
              ? "degraded"
              : "starting",
      details: {
        engine: "SQLite",
        version: SQLITE_VERSION,
        storage: this.isMemory() ? "memory" : "opfs-sahpool",
        activeSessions: this.sessions.size,
        transactionActive: this.transactionOwner !== undefined,
      },
    };
  }

  async exportSnapshot(): Promise<Uint8Array> {
    return this.runExclusive(() => {
      this.requireStarted();
      if (this.transactionOwner)
        throw new EngineOperationError(
          "sqlite-snapshot-transaction-active",
          "Commit or roll back the active transaction before exporting.",
        );
      const payload = this.requireSqlite().capi.sqlite3_js_db_export(
        this.requireDatabase(),
      );
      if (payload.byteLength > MAX_SNAPSHOT_BYTES) {
        throw new EngineOperationError(
          "snapshot-invalid",
          "SQLite file exceeds the 256 MiB transfer limit.",
        );
      }
      return encodeSnapshot(
        this.engineId,
        SNAPSHOT_FORMAT,
        payload,
        Date.now(),
        SQLITE_VERSION,
      );
    });
  }

  async exportNativeFile(): Promise<Uint8Array> {
    return this.runExclusive(() => {
      this.requireStarted();
      if (this.transactionOwner)
        throw new EngineOperationError(
          "sqlite-snapshot-transaction-active",
          "Commit or roll back the active transaction before exporting.",
        );
      const bytes = this.requireSqlite().capi.sqlite3_js_db_export(
        this.requireDatabase(),
      );
      if (bytes.byteLength > MAX_SNAPSHOT_BYTES) {
        throw new EngineOperationError(
          "sqlite-file-too-large",
          "SQLite file exceeds the 256 MiB transfer limit.",
        );
      }
      return bytes.slice();
    });
  }

  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    this.state = "stopping";
    await this.runExclusive(async () => {
      if (this.database && this.transactionOwner) {
        try {
          this.database.exec("ROLLBACK");
        } catch {
          /* shutdown continues */
        }
      }
      this.transactionOwner = undefined;
      this.database?.close();
      this.database = undefined;
      this.sessions.clear();
      await this.cleanupStorage();
      this.state = "stopped";
    });
  }

  private requireDatabase(): SqliteDb {
    if (!this.database)
      throw new EngineRuntimeError(
        "instance-not-started",
        `SQLite instance '${this.id}' is unavailable.`,
      );
    return this.database;
  }
  private requireSqlite(): SqliteModule {
    if (!this.sqlite)
      throw new EngineRuntimeError(
        "instance-not-started",
        "SQLite WASM is unavailable.",
      );
    return this.sqlite;
  }
  private importIntoMemory(bytes: Uint8Array): void {
    const sqlite = this.requireSqlite();
    const database = this.requireDatabase();
    const pointer = sqlite.wasm.allocFromTypedArray(bytes);
    const result = sqlite.capi.sqlite3_deserialize(
      database,
      "main",
      pointer,
      bytes.byteLength,
      bytes.byteLength,
      sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
        sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    if (result !== sqlite.capi.SQLITE_OK) {
      sqlite.wasm.dealloc(pointer);
      throw new EngineOperationError(
        "snapshot-invalid",
        `SQLite could not import the database file (code ${result}).`,
      );
    }
  }
  private requireStarted(): void {
    if (this.state !== "started")
      throw new EngineRuntimeError(
        "instance-not-started",
        `SQLite instance '${this.id}' is ${this.state}.`,
      );
  }
  private requireSession(session: EngineSession): void {
    if (
      session.instanceId !== this.id ||
      this.sessions.get(session.id) !== session
    )
      throw new EngineRuntimeError(
        "session-not-found",
        `Session '${session.id}' is not open on this SQLite instance.`,
      );
  }
  private updateTransactionOwner(sessionId: SessionId, sql: string): void {
    const command = /^\s*(BEGIN|COMMIT|END|ROLLBACK)\b/i
      .exec(sql)?.[1]
      ?.toLowerCase();
    if (command === "begin") this.transactionOwner = sessionId;
    const rollbackToSavepoint = /^\s*ROLLBACK(?:\s+TRANSACTION)?\s+TO\b/i.test(
      sql,
    );
    if (
      (command === "commit" ||
        command === "end" ||
        (command === "rollback" && !rollbackToSavepoint)) &&
      this.transactionOwner === sessionId
    )
      this.transactionOwner = undefined;
  }
  private isMemory(): boolean {
    return this.dataDir === "memory://";
  }
  private storageName(): string {
    return (
      this.dataDir.slice("opfs://".length).replace(/[^a-zA-Z0-9_-]/g, "-") ||
      "database"
    );
  }
  private runExclusive<T>(action: () => T | Promise<T>): Promise<T> {
    const result = this.operationTail.then(action, action);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async acquireStorageOwnership(): Promise<void> {
    if (!globalThis.navigator?.locks)
      throw new EngineOperationError(
        "sqlite-storage-unavailable",
        "Persistent SQLite storage requires Web Locks in this browser.",
      );
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
    const request = navigator.locks.request(
      `pocketdb:sqlite:${this.dataDir}`,
      { mode: "exclusive", ifAvailable: true },
      (lock) => {
        if (!lock) {
          rejectAcquired(
            new EngineOperationError(
              "sqlite-storage-already-owned",
              "This SQLite database is already open in another tab or worker.",
            ),
          );
          return;
        }
        this.releaseLock = release;
        resolveAcquired();
        return lifetime;
      },
    );
    this.lockRequest = request.then(
      () => undefined,
      () => undefined,
    );
    void request.catch((cause) =>
      rejectAcquired(
        new EngineOperationError(
          "sqlite-storage-unavailable",
          "The browser could not acquire SQLite storage ownership.",
          { cause },
        ),
      ),
    );
    await acquired;
  }
  private async cleanupStorage(): Promise<void> {
    // removeVfs() deletes its OPFS directory and would erase persisted databases.
    // The worker is terminated after stop, which releases the VFS handles without deleting data.
    this.pool = undefined;
    this.releaseLock?.();
    this.releaseLock = undefined;
    await this.lockRequest;
    this.lockRequest = undefined;
  }
}

function readBytes(value: unknown, name: string): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof Uint8Array))
    throw new EngineOperationError(
      "snapshot-invalid",
      `${name} must be a Uint8Array.`,
    );
  return value.slice();
}
function validateSqliteFile(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) {
    throw new EngineOperationError(
      "sqlite-file-too-large",
      "SQLite file exceeds the 256 MiB transfer limit.",
    );
  }
  const magic = new TextEncoder().encode(SQLITE_MAGIC);
  if (
    bytes.byteLength < 100 ||
    !magic.every((byte, index) => bytes[index] === byte)
  ) {
    throw new EngineOperationError(
      "snapshot-invalid",
      "The file is not a SQLite database.",
    );
  }
}
function isSingleSelect(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  return /^SELECT\b/i.test(trimmed) && !trimmed.includes(";");
}
function requireQuery(value: unknown): {
  sql: string;
  params?: unknown[];
  rowMode?: "object" | "array";
} {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { sql?: unknown }).sql !== "string" ||
    !(value as { sql: string }).sql.trim()
  )
    throw new EngineOperationError(
      "sqlite-invalid-request",
      "A non-empty SQL string is required.",
    );
  const payload = value as { sql: string; params?: unknown; rowMode?: unknown };
  if (payload.params !== undefined && !Array.isArray(payload.params))
    throw new EngineOperationError(
      "sqlite-invalid-request",
      "SQL params must be an array.",
    );
  if (
    payload.rowMode !== undefined &&
    payload.rowMode !== "object" &&
    payload.rowMode !== "array"
  )
    throw new EngineOperationError(
      "sqlite-invalid-request",
      "rowMode must be 'object' or 'array'.",
    );
  if (
    Array.isArray(payload.params) &&
    payload.params.some(
      (value) =>
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        typeof value !== "bigint" &&
        !(value instanceof Uint8Array) &&
        !(value instanceof ArrayBuffer),
    )
  )
    throw new EngineOperationError(
      "sqlite-invalid-request",
      "SQLite parameters must be scalar values or byte arrays.",
    );
  return {
    sql: payload.sql,
    params: payload.params as BindableValue[] | undefined,
    rowMode: payload.rowMode as "object" | "array" | undefined,
  };
}
