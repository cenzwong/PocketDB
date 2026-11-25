export type EngineId = string;
export type InstanceId = string;
export type SessionId = string;
export type SessionAccess = "owner" | "read-write" | "read-only";

export interface EngineCapabilities {
  readonly operations: readonly string[];
  /** Operations an adapter can safely execute for a read-only session. */
  readonly readOnlyOperations?: readonly string[];
  readonly features: Readonly<Record<string, boolean | number | string>>;
}

export interface EngineConfig {
  readonly [key: string]: unknown;
}

export interface SessionContext {
  readonly sessionId: SessionId;
  readonly instanceId: InstanceId;
  /** Every session must declare its access level; missing scope fails closed. */
  readonly access: SessionAccess;
  readonly principal?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface EngineSession {
  readonly id: SessionId;
  readonly instanceId: InstanceId;
  readonly access: SessionAccess;
}

export interface EngineRequest {
  readonly operation: string;
  readonly payload?: unknown;
  readonly signal?: AbortSignal;
}

export interface EngineResponse {
  readonly value: unknown;
}

export type EngineHealthStatus =
  | "starting"
  | "healthy"
  | "degraded"
  | "stopped";

export interface EngineHealth {
  readonly status: EngineHealthStatus;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface EngineInstance {
  readonly id: InstanceId;
  readonly engineId: EngineId;
  start(): Promise<void>;
  openSession(context: SessionContext): Promise<EngineSession>;
  execute(
    session: EngineSession,
    request: EngineRequest,
  ): Promise<EngineResponse>;
  closeSession(session: EngineSession): Promise<void>;
  health(): Promise<EngineHealth>;
  stop(): Promise<void>;
}

/** Optional capability for engines that can export a portable whole-instance snapshot. */
export interface SnapshotEngineInstance extends EngineInstance {
  exportSnapshot(): Promise<Uint8Array>;
}

/** Optional capability for importing or exporting an engine-native database file. */
export interface NativeFileEngineInstance extends EngineInstance {
  exportNativeFile(): Promise<Uint8Array>;
}

/** Optional owner-only API for registering and ingesting a bounded local dataset. */
export interface DatasetImportResult {
  readonly tableName: string;
  readonly format: "csv" | "json" | "parquet";
  readonly rowCount: number;
}

export interface DatasetImportEngineInstance extends EngineInstance {
  importDataset(
    fileName: string,
    bytes: Uint8Array,
  ): Promise<DatasetImportResult>;
}

export interface EngineAdapter {
  readonly id: EngineId;
  capabilities(): EngineCapabilities;
  createInstance(config: EngineConfig, instanceId: InstanceId): EngineInstance;
}

export type EngineRuntimeErrorCode =
  | "invalid-identifier"
  | "adapter-already-registered"
  | "adapter-not-registered"
  | "instance-already-exists"
  | "instance-not-found"
  | "instance-start-failed"
  | "instance-not-started"
  | "session-already-exists"
  | "session-not-found"
  | "session-instance-mismatch"
  | "session-open-failed"
  | "session-close-failed"
  | "execution-failed"
  | "health-check-failed"
  | "instance-stop-failed"
  | "worker-queue-full"
  | "worker-terminated"
  | "worker-request-timeout"
  | "worker-message-error"
  | "request-aborted";

export class EngineRuntimeError extends Error {
  constructor(
    readonly code: EngineRuntimeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EngineRuntimeError";
  }
}

/** An engine-defined operation failure that the runtime preserves across boundaries. */
export class EngineOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message, options);
    this.name = "EngineOperationError";
  }
}
