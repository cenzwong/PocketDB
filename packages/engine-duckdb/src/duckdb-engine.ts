import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbMvpUrl from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import duckdbMvpWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import {
  EngineOperationError,
  EngineRuntimeError,
  assertEngineOperationPermission,
  type DatasetImportResult,
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

const MAX_DATASET_BYTES = 32 * 1024 * 1024;
const MAX_RESULT_ROWS = 10_000;
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
const capabilities: EngineCapabilities = {
  operations: ["query"],
  readOnlyOperations: ["query"],
  features: {
    analyticalSql: true,
    localDatasetIngestion: true,
    supportedDatasetFormats: "csv,json,parquet",
    resultFormat: "arrow-to-json",
    maxDatasetBytes: MAX_DATASET_BYTES,
    maxResultRows: MAX_RESULT_ROWS,
    maxResultBytes: MAX_RESULT_BYTES,
    maximumThreads: 1,
    persistentDataDir: false,
    persistence: "memory",
    browserRequirements: "secure-context",
    wasmVariant: "mvp-single-threaded",
    browserLoading: "lazy",
  },
};

type DuckDBConnection = Awaited<ReturnType<duckdb.AsyncDuckDB["connect"]>>;

export class DuckDBEngineAdapter implements EngineAdapter {
  readonly id = "duckdb";

  capabilities(): EngineCapabilities {
    return capabilities;
  }

  createInstance(config: EngineConfig, instanceId: InstanceId): EngineInstance {
    const dataDir = config.dataDir;
    if (dataDir !== undefined && typeof dataDir !== "string") {
      throw new EngineRuntimeError(
        "instance-start-failed",
        "DuckDB dataDir must be a string.",
      );
    }
    if (dataDir !== undefined && dataDir !== "memory://") {
      throw new EngineOperationError(
        "duckdb-storage-unavailable",
        "This DuckDB adapter currently supports session memory storage only.",
      );
    }
    return new DuckDBEngineInstance(instanceId);
  }
}

export class DuckDBEngineInstance implements EngineInstance {
  private database?: duckdb.AsyncDuckDB;
  private worker?: Worker;
  private readonly sessions = new Map<SessionId, EngineSession>();
  private readonly connections = new Map<SessionId, DuckDBConnection>();
  private state: "new" | "started" | "stopping" | "stopped" | "failed" = "new";
  private operationTail: Promise<void> = Promise.resolve();
  private transactionOwner?: SessionId;

  constructor(readonly id: InstanceId) {}

  get engineId(): string {
    return "duckdb";
  }

  async start(): Promise<void> {
    if (this.state !== "new") {
      throw new EngineRuntimeError(
        "instance-not-started",
        `DuckDB instance '${this.id}' cannot start from ${this.state}.`,
      );
    }
    let phase = "storage ownership";
    try {
      phase = "bundle selection";
      const bundle = await duckdb.selectBundle({
        mvp: { mainModule: duckdbMvpUrl, mainWorker: duckdbMvpWorkerUrl },
      });
      if (!bundle.mainModule || !bundle.mainWorker) {
        throw new Error("DuckDB MVP WASM bundle could not be resolved.");
      }
      this.worker = new Worker(bundle.mainWorker);
      this.database = new duckdb.AsyncDuckDB(
        new duckdb.VoidLogger(),
        this.worker,
      );
      phase = "WASM instantiation";
      await this.database.instantiate(bundle.mainModule, bundle.pthreadWorker);
      await this.database.getVersion();
      phase = "database open";
      await this.database.open({
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      });
      phase = "connection creation";
      const connection = await this.database.connect();
      await connection.close();
      this.state = "started";
    } catch (cause) {
      this.state = "failed";
      await this.closeDatabase();
      if (
        cause instanceof EngineRuntimeError ||
        cause instanceof EngineOperationError
      ) {
        throw cause;
      }
      throw new EngineOperationError(
        "duckdb-start-failed",
        cause instanceof Error
          ? `DuckDB WASM could not start during ${phase}: ${cause.message}`
          : "DuckDB WASM could not start. Check worker, WASM and storage support.",
        { cause },
      );
    }
  }

  async openSession(context: SessionContext): Promise<EngineSession> {
    this.requireStarted();
    if (context.instanceId !== this.id) {
      throw new EngineRuntimeError(
        "session-instance-mismatch",
        "Session belongs to another DuckDB instance.",
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
    const connection = await this.requireDatabase().connect();
    this.sessions.set(session.id, session);
    this.connections.set(session.id, connection);
    return session;
  }

  execute(
    session: EngineSession,
    request: EngineRequest,
  ): Promise<EngineResponse> {
    this.requireStarted();
    this.requireSession(session);
    assertEngineOperationPermission(session.access, capabilities, request);
    if (request.operation.toLowerCase() !== "query") {
      throw new EngineOperationError(
        "duckdb-unsupported-operation",
        `Unsupported DuckDB operation '${request.operation}'.`,
      );
    }
    const payload = requireQuery(request.payload);
    const readOnly = session.access === "read-only";
    if (readOnly && !isSingleSelect(payload.sql)) {
      throw new EngineOperationError(
        "permission-denied",
        "Read-only DuckDB sessions accept a single SELECT statement only.",
      );
    }
    if (this.transactionOwner && this.transactionOwner !== session.id) {
      throw new EngineOperationError(
        "duckdb-session-busy",
        "Another session owns an active DuckDB transaction; retry after it completes.",
      );
    }
    if (request.signal?.aborted) {
      throw new EngineRuntimeError(
        "request-aborted",
        "DuckDB operation was cancelled before execution.",
      );
    }
    return this.runExclusive(async () => {
      const connection = this.requireConnection(session.id);
      let statement: Awaited<ReturnType<typeof connection.prepare>> | undefined;
      let readOnlyTransaction = false;
      try {
        if (readOnly) {
          await connection.query("BEGIN TRANSACTION READ ONLY");
          readOnlyTransaction = true;
        }
        statement = await connection.prepare(payload.sql);
        const stream = await statement.send(...(payload.params ?? []));
        const rows: Record<string, unknown>[] = [];
        let columns: string[] = [];
        let resultBytes = 0;
        let truncated = false;
        const cancel = (): void => {
          void stream.cancel().catch(() => undefined);
        };
        request.signal?.addEventListener("abort", cancel, { once: true });
        try {
          for await (const batch of stream) {
            if (columns.length === 0) {
              columns = batch.schema.fields.map(({ name }) => name);
            }
            for (const row of batch.toArray()) {
              if (request.signal?.aborted) {
                throw new EngineRuntimeError(
                  "request-aborted",
                  "DuckDB query was cancelled while running.",
                );
              }
              if (rows.length >= MAX_RESULT_ROWS) {
                truncated = true;
                await stream.cancel().catch(() => undefined);
                break;
              }
              const normalized = normalizeRow(
                row.toJSON(),
                batch.schema.fields,
              );
              const size = new TextEncoder().encode(
                JSON.stringify(normalized),
              ).byteLength;
              if (resultBytes + size > MAX_RESULT_BYTES) {
                truncated = true;
                await stream.cancel().catch(() => undefined);
                break;
              }
              rows.push(normalized);
              resultBytes += size;
            }
            if (truncated) break;
          }
        } finally {
          request.signal?.removeEventListener("abort", cancel);
        }
        this.updateTransactionOwner(session.id, payload.sql);
        return {
          value: {
            rows,
            columns,
            format: "arrow-to-json",
            truncated,
            rowCount: rows.length,
          },
        };
      } catch (cause) {
        if (
          cause instanceof EngineRuntimeError ||
          cause instanceof EngineOperationError
        ) {
          throw cause;
        }
        throw new EngineOperationError(
          "duckdb-query-failed",
          cause instanceof Error ? cause.message : "DuckDB query failed.",
          { cause },
        );
      } finally {
        try {
          await statement?.close();
        } finally {
          if (readOnlyTransaction) {
            await this.endReadOnlyTransaction(session.id, connection);
          }
        }
      }
    });
  }

  private async endReadOnlyTransaction(
    sessionId: SessionId,
    connection: DuckDBConnection,
  ): Promise<void> {
    try {
      await connection.query("ROLLBACK");
    } catch (cause) {
      this.connections.delete(sessionId);
      await connection.close().catch(() => undefined);
      throw new EngineOperationError(
        "duckdb-query-failed",
        "DuckDB could not close the read-only transaction.",
        { cause },
      );
    }
  }

  async importDataset(
    fileName: string,
    bytes: Uint8Array,
  ): Promise<DatasetImportResult> {
    this.requireStarted();
    const { format, tableName } = parseDatasetName(fileName);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_DATASET_BYTES) {
      throw new EngineOperationError(
        "duckdb-dataset-too-large",
        "Dataset files must contain data and be no larger than 32 MiB.",
      );
    }
    return this.runExclusive(async () => {
      const database = this.requireDatabase();
      const connection = await database.connect();
      const virtualName = `pocketdb-${crypto.randomUUID()}.${format}`;
      try {
        await database.registerFileBuffer(virtualName, bytes.slice());
        if (format === "csv") {
          await connection.insertCSVFromPath(virtualName, { name: tableName });
        } else if (format === "json") {
          await connection.insertJSONFromPath(virtualName, { name: tableName });
        } else {
          await connection.query(
            `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_parquet('${virtualName}')`,
          );
        }
        const count = await connection.query(
          `SELECT count(*) AS row_count FROM "${tableName}"`,
        );
        const rowCount = Number(count.toArray()[0]?.toJSON().row_count ?? 0);
        return { tableName, format, rowCount };
      } catch (cause) {
        if (cause instanceof EngineOperationError) throw cause;
        throw new EngineOperationError(
          "duckdb-dataset-import-failed",
          cause instanceof Error
            ? cause.message
            : "DuckDB could not import the dataset.",
          { cause },
        );
      } finally {
        await database.dropFile(virtualName).catch(() => undefined);
        await connection.close();
      }
    });
  }

  async closeSession(session: EngineSession): Promise<void> {
    this.requireStarted();
    this.requireSession(session);
    await this.runExclusive(async () => {
      const connection = this.connections.get(session.id);
      if (this.transactionOwner === session.id) {
        try {
          await connection?.query("ROLLBACK");
        } finally {
          this.transactionOwner = undefined;
        }
      }
      await connection?.close();
      this.connections.delete(session.id);
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
        engine: "DuckDB-Wasm",
        version: "1.32.0",
        bundle: "mvp-single-threaded",
        storage: "memory",
        activeSessions: this.sessions.size,
        transactionActive: this.transactionOwner !== undefined,
      },
    };
  }

  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    this.state = "stopping";
    await this.runExclusive(async () => {
      const failures: unknown[] = [];
      const owner = this.transactionOwner;
      if (owner) {
        await this.connections
          .get(owner)
          ?.query("ROLLBACK")
          .catch((error) => failures.push(error));
      }
      this.transactionOwner = undefined;
      for (const connection of this.connections.values()) {
        await connection.close().catch((error) => failures.push(error));
      }
      this.connections.clear();
      this.sessions.clear();
      try {
        await this.closeDatabase();
      } catch (error) {
        failures.push(error);
      }
      this.state = "stopped";
      if (failures.length > 0) {
        throw new EngineRuntimeError(
          "instance-stop-failed",
          `DuckDB instance '${this.id}' stopped with ${failures.length} cleanup error(s).`,
          { cause: new AggregateError(failures) },
        );
      }
    });
  }

  private async closeDatabase(): Promise<void> {
    const database = this.database;
    const worker = this.worker;
    this.database = undefined;
    this.worker = undefined;
    await database?.terminate().catch(() => undefined);
    worker?.terminate();
  }

  private requireDatabase(): duckdb.AsyncDuckDB {
    if (!this.database) {
      throw new EngineRuntimeError(
        "instance-not-started",
        `DuckDB instance '${this.id}' is unavailable.`,
      );
    }
    return this.database;
  }

  private requireConnection(sessionId: SessionId): DuckDBConnection {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      throw new EngineRuntimeError(
        "session-not-found",
        `DuckDB session '${sessionId}' is not open.`,
      );
    }
    return connection;
  }

  private requireStarted(): void {
    if (this.state !== "started") {
      throw new EngineRuntimeError(
        "instance-not-started",
        `DuckDB instance '${this.id}' is ${this.state}.`,
      );
    }
  }

  private requireSession(session: EngineSession): void {
    if (
      session.instanceId !== this.id ||
      this.sessions.get(session.id) !== session
    ) {
      throw new EngineRuntimeError(
        "session-not-found",
        `Session '${session.id}' is not open on this DuckDB instance.`,
      );
    }
  }

  private updateTransactionOwner(sessionId: SessionId, sql: string): void {
    const command = /^\s*(BEGIN|COMMIT|END|ROLLBACK)\b/i
      .exec(sql)?.[1]
      ?.toLowerCase();
    if (command === "begin") this.transactionOwner = sessionId;
    if (
      (command === "commit" || command === "end" || command === "rollback") &&
      this.transactionOwner === sessionId
    ) {
      this.transactionOwner = undefined;
    }
  }

  private runExclusive<T>(action: () => T | Promise<T>): Promise<T> {
    const result = this.operationTail.then(action, action);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function parseDatasetName(fileName: string): {
  format: "csv" | "json" | "parquet";
  tableName: string;
} {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const match = /^(.*)\.(csv|json|parquet)$/i.exec(base);
  if (!match) {
    throw new EngineOperationError(
      "duckdb-unsupported-dataset-format",
      "Choose a .csv, .json or .parquet dataset.",
    );
  }
  const rawNamePart = match[1] ?? "";
  const formatPart = match[2] ?? "";
  const format = formatPart.toLowerCase() as "csv" | "json" | "parquet";
  const rawName = rawNamePart.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const tableName = /^[a-z_]/.test(rawName)
    ? rawName.slice(0, 64)
    : `dataset_${rawName}`.slice(0, 64);
  return { format, tableName: tableName || "dataset" };
}

function requireQuery(value: unknown): {
  sql: string;
  params?: unknown[];
} {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as { sql?: unknown }).sql !== "string" ||
    !(value as { sql: string }).sql.trim()
  ) {
    throw new EngineOperationError(
      "duckdb-invalid-request",
      "A non-empty SQL string is required.",
    );
  }
  const payload = value as { sql: string; params?: unknown };
  if (payload.params !== undefined && !Array.isArray(payload.params)) {
    throw new EngineOperationError(
      "duckdb-invalid-request",
      "SQL params must be an array.",
    );
  }
  if (
    Array.isArray(payload.params) &&
    payload.params.some(
      (item) =>
        item !== null &&
        typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean" &&
        typeof item !== "bigint" &&
        !(item instanceof Uint8Array),
    )
  ) {
    throw new EngineOperationError(
      "duckdb-invalid-request",
      "DuckDB parameters must be scalar values or byte arrays.",
    );
  }
  return { sql: payload.sql, params: payload.params as unknown[] | undefined };
}

function isSingleSelect(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  return /^SELECT\b/i.test(trimmed) && !trimmed.includes(";");
}

function normalizeRow(
  row: unknown,
  fields: ReadonlyArray<{ name: string; type: { toString(): string } }> = [],
): Record<string, unknown> {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new EngineOperationError(
      "duckdb-result-invalid",
      "DuckDB returned a row outside the supported object result format.",
    );
  }
  const fieldTypes = new Map(
    fields.map((field) => [field.name, field.type.toString()]),
  );
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      normalizeValue(value, fieldTypes.get(key)),
    ]),
  );
}

function normalizeValue(value: unknown, arrowType?: string): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (
    value instanceof Uint32Array &&
    value.length === 4 &&
    /decimal|hugeint|int128/i.test(arrowType ?? "")
  ) {
    const unsigned = value.reduce(
      (total, word, index) => total | (BigInt(word) << (32n * BigInt(index))),
      0n,
    );
    const integer =
      (value.at(3) ?? 0) & 0x80000000 ? unsigned - (1n << 128n) : unsigned;
    const scale = Number(
      /decimal\(\d+,\s*(\d+)\)/i.exec(arrowType ?? "")?.[1] ?? 0,
    );
    return formatDecimal(integer, scale);
  }
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<unknown>, (item) =>
      normalizeValue(item),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

function formatDecimal(value: bigint, scale: number): string {
  if (scale <= 0) return value.toString();
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
