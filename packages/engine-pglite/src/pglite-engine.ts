import { PGlite, types } from "@electric-sql/pglite";
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
  MAX_SNAPSHOT_BYTES,
  decodeSnapshot,
  encodeSnapshot,
} from "@pocketdb/runtime";

interface QueryPayload {
  readonly sql: string;
  readonly params?: unknown[];
  readonly rowMode?: "object" | "array";
}

const capabilities: EngineCapabilities = {
  operations: ["query", "schema", "describe-query"],
  readOnlyOperations: ["query", "schema", "describe-query"],
  features: {
    parameterizedQueries: true,
    schemaInspection: true,
    transactions: true,
    persistentDataDir: true,
    portableSnapshots: true,
  },
};

const temporalText = (value: string): string => value;
const temporalParsers = {
  [types.DATE]: temporalText,
  [types.TIMESTAMP]: temporalText,
  [types.TIMESTAMPTZ]: temporalText,
};

const PGLITE_SNAPSHOT_FORMAT = "pglite-data-dir-gzip-v1";
const PGLITE_SNAPSHOT_ENGINE_VERSION = "0.6.0";

export class PGliteEngineAdapter implements EngineAdapter {
  readonly id = "postgresql";

  capabilities(): EngineCapabilities {
    return capabilities;
  }

  createInstance(config: EngineConfig, instanceId: InstanceId): EngineInstance {
    const dataDir = config.dataDir;
    if (dataDir !== undefined && typeof dataDir !== "string") {
      throw new EngineRuntimeError(
        "instance-start-failed",
        "PGlite dataDir must be a string.",
      );
    }
    return new PGliteEngineInstance(
      instanceId,
      this.id,
      dataDir ?? "memory://",
      requireSnapshotConfig(config.snapshot),
    );
  }
}

export class PGliteEngineInstance implements EngineInstance {
  private database?: PGlite;
  private readonly sessions = new Map<SessionId, EngineSession>();
  private state: "new" | "started" | "stopping" | "stopped" | "failed" = "new";
  private operationTail: Promise<void> = Promise.resolve();
  private transactionOwner?: SessionId;
  private releaseStorageLock?: () => void;
  private storageLockRequest?: Promise<void>;

  constructor(
    readonly id: InstanceId,
    readonly engineId = "postgresql",
    private readonly dataDir = "memory://",
    private readonly importSnapshot?: Uint8Array,
  ) {}

  async start(): Promise<void> {
    if (this.state !== "new") {
      throw new EngineRuntimeError(
        "instance-not-started",
        `PGlite instance '${this.id}' cannot start from ${this.state}.`,
      );
    }
    try {
      const payload = this.importSnapshot
        ? decodeSnapshot(
            this.importSnapshot,
            this.engineId,
            PGLITE_SNAPSHOT_FORMAT,
            PGLITE_SNAPSHOT_ENGINE_VERSION,
          ).payload
        : undefined;
      if (payload) await validatePGliteSnapshot(payload);
      await this.acquireStorageOwnership();
      if (payload) {
        try {
          this.database = await PGlite.create({
            ...(this.dataDir === "memory://" ? {} : { dataDir: this.dataDir }),
            loadDataDir: new Blob([payload.slice().buffer as ArrayBuffer]),
            parsers: temporalParsers,
          });
        } catch (cause) {
          if (isExistingDatabaseLoadError(cause)) {
            throw new EngineOperationError(
              "snapshot-target-not-empty",
              "PostgreSQL snapshots can only be restored into a fresh data directory.",
              { cause },
            );
          }
          throw cause;
        }
      } else {
        this.database = await PGlite.create(this.dataDir, {
          parsers: temporalParsers,
        });
      }
      this.state = "started";
    } catch (cause) {
      this.state = "failed";
      await this.releaseStorageOwnership();
      if (cause instanceof EngineOperationError) throw cause;
      if (this.isIndexedDBDataDir()) {
        if (isQuotaExceeded(cause)) {
          throw new EngineOperationError(
            "postgres-storage-quota-exceeded",
            "Browser storage quota was exceeded while opening the PostgreSQL database.",
            { cause },
          );
        }
        throw new EngineOperationError(
          "postgres-storage-unavailable",
          "Persistent browser storage could not open the PostgreSQL database.",
          { cause },
        );
      }
      throw new EngineRuntimeError(
        "instance-start-failed",
        `PGlite instance '${this.id}' failed to start.`,
        { cause },
      );
    }
  }

  async openSession(context: SessionContext): Promise<EngineSession> {
    this.requireStarted();
    if (context.instanceId !== this.id) {
      throw new EngineRuntimeError(
        "session-instance-mismatch",
        "Session belongs to another PGlite instance.",
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
    this.requireStarted();
    this.requireSession(session);
    assertEngineOperationPermission(session.access, capabilities, request);
    const signal = request.signal;
    if (signal?.aborted) {
      throw new EngineRuntimeError(
        "request-aborted",
        "PostgreSQL operation was cancelled before execution.",
      );
    }

    switch (request.operation.toLowerCase()) {
      case "query": {
        const payload = requireQueryPayload(request.payload);
        if (
          session.access === "read-only" &&
          !isSafeReadOnlySelect(payload.sql, payload.params)
        ) {
          throw new EngineOperationError(
            "permission-denied",
            "Read-only PostgreSQL sessions accept only a single parameterized SELECT from the safe query subset.",
          );
        }
        return {
          value: await this.runForSession(
            session.id,
            signal,
            async (database) => {
              if (session.access === "read-only") {
                return database.transaction(async (transaction) => {
                  await transaction.query("SET TRANSACTION READ ONLY");
                  return transaction.query(
                    payload.sql,
                    payload.params,
                    payload.rowMode ? { rowMode: payload.rowMode } : undefined,
                  );
                });
              }
              return database.query(
                payload.sql,
                payload.params,
                payload.rowMode ? { rowMode: payload.rowMode } : undefined,
              );
            },
          ),
        };
      }
      case "schema": {
        const payload = requireSchemaPayload(request.payload);
        return {
          value: await this.runForSession(session.id, signal, (database) =>
            database.query(
              `SELECT table_schema, table_name, column_name, ordinal_position,
                      data_type, udt_name, is_nullable, column_default
               FROM information_schema.columns
               WHERE table_schema = $1 AND ($2::text IS NULL OR table_name = $2)
               ORDER BY table_schema, table_name, ordinal_position`,
              [payload.schema, payload.table],
            ),
          ),
        };
      }
      case "describe-query": {
        const payload = requireQueryPayload(request.payload);
        return {
          value: await this.runForSession(
            session.id,
            signal,
            async (database) => {
              const result = await database.describeQuery(payload.sql);
              return {
                parameters: result.queryParams.map(({ dataTypeID }) => ({
                  dataTypeID,
                })),
                fields: result.resultFields.map(({ name, dataTypeID }) => ({
                  name,
                  dataTypeID,
                })),
              };
            },
          ),
        };
      }
      default:
        throw new EngineOperationError(
          "postgres-unsupported-operation",
          `Unsupported PostgreSQL operation '${request.operation}'.`,
        );
    }
  }

  async closeSession(session: EngineSession): Promise<void> {
    this.requireStarted();
    this.requireSession(session);
    try {
      await this.runExclusive(async () => {
        this.requireStarted();
        this.requireSession(session);
        if (this.transactionOwner === session.id) {
          try {
            await this.requireDatabase().query("ROLLBACK");
          } catch (cause) {
            this.state = "failed";
            throw this.toOperationError(cause, "postgres-rollback-failed");
          } finally {
            this.finishTransaction();
          }
        }
        this.sessions.delete(session.id);
      });
    } catch (cause) {
      throw new EngineRuntimeError(
        "session-close-failed",
        `PGlite session '${session.id}' failed to close.`,
        { cause },
      );
    }
  }

  async health(): Promise<EngineHealth> {
    const database = this.database;
    return {
      status:
        this.state === "started" && database?.ready && !database.closed
          ? "healthy"
          : this.state === "stopped"
            ? "stopped"
            : this.state === "failed"
              ? "degraded"
              : "starting",
      details: {
        engine: "PGlite",
        activeSessions: this.sessions.size,
        transactionActive: this.transactionOwner !== undefined,
      },
    };
  }

  async exportSnapshot(): Promise<Uint8Array> {
    return this.runExclusive(async () => {
      this.requireStarted();
      if (this.transactionOwner) {
        throw new EngineOperationError(
          "postgres-snapshot-transaction-active",
          "Commit or roll back the active transaction before exporting a PostgreSQL snapshot.",
        );
      }
      const dump = await this.requireDatabase().dumpDataDir("gzip");
      if (dump.size > MAX_SNAPSHOT_BYTES) {
        throw new EngineOperationError(
          "snapshot-invalid",
          "PostgreSQL snapshot exceeds the supported size limit.",
        );
      }
      const bytes = new Uint8Array(await dump.arrayBuffer());
      return encodeSnapshot(
        this.engineId,
        PGLITE_SNAPSHOT_FORMAT,
        bytes,
        Date.now(),
        PGLITE_SNAPSHOT_ENGINE_VERSION,
      );
    });
  }

  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    this.state = "stopping";
    const database = this.database;
    if (!database) {
      this.state = "stopped";
      this.sessions.clear();
      await this.releaseStorageOwnership();
      return;
    }

    const failures: unknown[] = [];
    await this.runExclusive(async () => {
      if (this.transactionOwner) {
        try {
          await database.query("ROLLBACK");
        } catch (cause) {
          failures.push(
            this.toOperationError(cause, "postgres-rollback-failed"),
          );
        } finally {
          this.finishTransaction();
        }
      }
      try {
        await database.close();
      } catch (cause) {
        failures.push(cause);
      }
      try {
        await this.releaseStorageOwnership();
      } catch (cause) {
        failures.push(cause);
      }
      this.database = undefined;
      this.sessions.clear();
      this.state = "stopped";
    });
    if (failures.length > 0) {
      throw new EngineRuntimeError(
        "instance-stop-failed",
        `PGlite instance '${this.id}' stopped with ${failures.length} cleanup error(s).`,
        { cause: new AggregateError(failures) },
      );
    }
  }

  private async runForSession<T>(
    sessionId: SessionId,
    signal: AbortSignal | undefined,
    action: (database: PGlite) => Promise<T>,
  ): Promise<T> {
    return this.runExclusive(async () => {
      this.requireStarted();
      if (this.transactionOwner && this.transactionOwner !== sessionId) {
        throw new EngineOperationError(
          "postgres-session-busy",
          "Another session owns an active transaction; retry after it completes.",
        );
      }
      if (signal?.aborted) {
        throw new EngineRuntimeError(
          "request-aborted",
          "PostgreSQL operation was cancelled before execution.",
        );
      }
      const database = this.requireDatabase();
      try {
        return await action(database);
      } catch (cause) {
        if (
          cause instanceof EngineRuntimeError ||
          cause instanceof EngineOperationError
        )
          throw cause;
        throw this.toOperationError(cause);
      } finally {
        this.transactionOwner = database.isInTransaction()
          ? sessionId
          : undefined;
      }
    });
  }

  private finishTransaction(): void {
    this.transactionOwner = undefined;
  }

  private requireSession(session: EngineSession): void {
    if (
      session.instanceId !== this.id ||
      this.sessions.get(session.id) !== session
    ) {
      throw new EngineRuntimeError(
        "session-not-found",
        `Session '${session.id}' is not open on this PGlite instance.`,
      );
    }
  }

  private requireDatabase(): PGlite {
    if (!this.database)
      throw new EngineRuntimeError(
        "instance-not-started",
        `PGlite instance '${this.id}' is unavailable.`,
      );
    return this.database;
  }

  private requireStarted(): void {
    if (this.state !== "started") {
      throw new EngineRuntimeError(
        "instance-not-started",
        `PGlite instance '${this.id}' is ${this.state}.`,
      );
    }
  }

  private runExclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(action, action);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private toOperationError(
    cause: unknown,
    fallbackCode = "postgres-query-failed",
  ): EngineOperationError {
    if (cause instanceof EngineOperationError) return cause;
    if (isQuotaExceeded(cause)) {
      return new EngineOperationError(
        "postgres-storage-quota-exceeded",
        "Browser storage quota was exceeded while writing the PostgreSQL database.",
        { cause },
      );
    }
    const error = cause as {
      code?: unknown;
      message?: unknown;
      severity?: unknown;
      detail?: unknown;
      hint?: unknown;
      position?: unknown;
      schema?: unknown;
      table?: unknown;
      column?: unknown;
      constraint?: unknown;
    };
    const sqlState =
      typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
        ? error.code
        : undefined;
    const details = Object.fromEntries(
      Object.entries({
        sqlState,
        severity: error?.severity,
        detail: error?.detail,
        hint: error?.hint,
        position: error?.position,
        schema: error?.schema,
        table: error?.table,
        column: error?.column,
        constraint: error?.constraint,
      }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const code = sqlState
      ? `postgres-sql-${sqlState.toLowerCase()}`
      : fallbackCode;
    const message =
      typeof error?.message === "string"
        ? error.message
        : "PostgreSQL operation failed.";
    return new EngineOperationError(code, message, { cause }, details);
  }

  private isIndexedDBDataDir(): boolean {
    return this.dataDir.startsWith("idb://");
  }

  private async acquireStorageOwnership(): Promise<void> {
    if (!this.isIndexedDBDataDir()) return;
    if (!globalThis.indexedDB || !globalThis.navigator?.locks) {
      throw new EngineOperationError(
        "postgres-storage-unavailable",
        "Persistent PostgreSQL storage requires IndexedDB and Web Locks in this browser.",
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
    const lockName = `pocketdb:pglite:${this.dataDir}`;
    const request = globalThis.navigator.locks.request(
      lockName,
      { mode: "exclusive", ifAvailable: true },
      (lock) => {
        if (!lock) {
          rejectAcquired(
            new EngineOperationError(
              "postgres-storage-already-owned",
              "This PostgreSQL database is already open in another tab or worker.",
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
          "postgres-storage-unavailable",
          "The browser could not acquire persistent database ownership.",
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
}

function requireSnapshotConfig(value: unknown): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof Uint8Array)) {
    throw new EngineOperationError(
      "snapshot-invalid",
      "PostgreSQL snapshot configuration must be a Uint8Array.",
    );
  }
  return value.slice();
}

async function validatePGliteSnapshot(payload: Uint8Array): Promise<void> {
  let candidate: PGlite | undefined;
  try {
    candidate = await PGlite.create({
      loadDataDir: new Blob([payload.slice().buffer as ArrayBuffer]),
    });
    await candidate.query("SELECT 1");
  } catch (cause) {
    throw new EngineOperationError(
      "snapshot-invalid",
      "PostgreSQL snapshot is not a readable PGlite data directory.",
      { cause },
    );
  } finally {
    await candidate?.close().catch(() => undefined);
  }
}

function isExistingDatabaseLoadError(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    cause.message.includes("Database already exists, cannot load from tarball")
  );
}

function requireQueryPayload(value: unknown): QueryPayload {
  if (
    !isRecord(value) ||
    typeof value.sql !== "string" ||
    value.sql.trim() === ""
  ) {
    throw new EngineOperationError(
      "postgres-invalid-request",
      "A non-empty SQL string is required.",
    );
  }
  if (value.params !== undefined && !Array.isArray(value.params)) {
    throw new EngineOperationError(
      "postgres-invalid-request",
      "SQL params must be an array.",
    );
  }
  if (
    value.rowMode !== undefined &&
    value.rowMode !== "object" &&
    value.rowMode !== "array"
  ) {
    throw new EngineOperationError(
      "postgres-invalid-request",
      "rowMode must be 'object' or 'array'.",
    );
  }
  return {
    sql: value.sql,
    params: value.params as unknown[] | undefined,
    rowMode: value.rowMode as "object" | "array" | undefined,
  };
}

/** A small parameter-only SELECT grammar; arbitrary read-only SQL stays disabled. */
function isSafeReadOnlySelect(sql: string, params: unknown[] = []): boolean {
  const identifier = "[A-Za-z_][A-Za-z0-9_]*";
  const qualifiedIdentifier = String.raw`${identifier}(?:\.${identifier})?`;
  const projection = String.raw`(?:\*|${qualifiedIdentifier}(?:\s*,\s*${qualifiedIdentifier})*)`;
  const predicate = String.raw`${qualifiedIdentifier}\s*=\s*\$[1-9][0-9]*`;
  const where = String.raw`(?:\s+WHERE\s+${predicate}(?:\s+AND\s+${predicate})*)?`;
  const order = String.raw`(?:\s+ORDER\s+BY\s+${qualifiedIdentifier}(?:\s+(?:ASC|DESC))?)?`;
  const limit = String.raw`(?:\s+LIMIT\s+(?:[1-9][0-9]*|\$[1-9][0-9]*))?`;
  const pattern = new RegExp(
    String.raw`^\s*SELECT\s+${projection}\s+FROM\s+${qualifiedIdentifier}${where}${order}${limit}\s*$`,
    "i",
  );
  if (!pattern.test(sql)) return false;
  for (const match of sql.matchAll(/\$([1-9][0-9]*)/g)) {
    const parameterIndex = Number(match[1]);
    if (!Number.isSafeInteger(parameterIndex) || parameterIndex > params.length)
      return false;
  }
  return true;
}

function requireSchemaPayload(value: unknown): {
  schema: string;
  table: string | null;
} {
  if (!isRecord(value)) {
    throw new EngineOperationError(
      "postgres-invalid-request",
      "Schema request must be an object.",
    );
  }
  const schema = value.schema ?? "public";
  const table = value.table ?? null;
  if (
    typeof schema !== "string" ||
    schema.length === 0 ||
    (table !== null && typeof table !== "string")
  ) {
    throw new EngineOperationError(
      "postgres-invalid-request",
      "Schema and table names must be strings.",
    );
  }
  return { schema, table: table as string | null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQuotaExceeded(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return false;
  }
  seen.add(value);
  const error = value as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  if (
    error.name === "QuotaExceededError" ||
    error.code === 22 ||
    (typeof error.message === "string" && /quota exceeded/i.test(error.message))
  ) {
    return true;
  }
  if (
    Array.isArray(error.errors) &&
    error.errors.some((item) => isQuotaExceeded(item, seen))
  ) {
    return true;
  }
  return isQuotaExceeded(error.cause, seen);
}
