import {
  EngineExecutionUncertainError,
  EngineOperationError,
  EngineRuntimeError,
  type EngineAdapter,
  type EngineCapabilities,
  type EngineConfig,
  type EngineHealth,
  type EngineInstance,
  type EngineRequest,
  type EngineResponse,
  type EngineSession,
  type InstanceId,
  type SnapshotEngineInstance,
  type NativeFileEngineInstance,
  type DatasetImportEngineInstance,
  type DatasetImportResult,
  type SessionContext,
  type SessionId,
} from "./contracts";
import { assertEngineOperationPermission } from "./permissions";

interface RuntimeInstance {
  readonly engine: EngineInstance;
  readonly capabilities: EngineCapabilities;
  readonly sessions: Map<SessionId, EngineSession>;
  state: "starting" | "started" | "stopping";
}

interface SessionRoute {
  readonly instanceId: InstanceId;
  readonly session: EngineSession;
  readonly access: EngineSession["access"];
}

export class DatabaseRuntime {
  private readonly adapters = new Map<string, EngineAdapter>();
  private readonly instances = new Map<InstanceId, RuntimeInstance>();
  private readonly sessions = new Map<SessionId, SessionRoute>();
  private readonly openingSessions = new Set<SessionId>();

  registerAdapter(adapter: EngineAdapter): void {
    if (!adapter.id.trim()) {
      throw new EngineRuntimeError(
        "invalid-identifier",
        "An engine adapter must have a non-empty ID.",
      );
    }
    if (this.adapters.has(adapter.id)) {
      throw new EngineRuntimeError(
        "adapter-already-registered",
        `Engine adapter '${adapter.id}' is already registered.`,
      );
    }
    this.adapters.set(adapter.id, adapter);
  }

  listEngines(): readonly { id: string; capabilities: EngineCapabilities }[] {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.id,
      capabilities: adapter.capabilities(),
    }));
  }

  async startInstance(
    engineId: string,
    instanceId: InstanceId,
    config: EngineConfig = {},
  ): Promise<void> {
    this.requireIdentifier(instanceId, "Instance");
    if (this.instances.has(instanceId)) {
      throw new EngineRuntimeError(
        "instance-already-exists",
        `Instance '${instanceId}' already exists.`,
      );
    }

    const adapter = this.adapters.get(engineId);
    if (!adapter) {
      throw new EngineRuntimeError(
        "adapter-not-registered",
        `Engine adapter '${engineId}' is not registered.`,
      );
    }

    let engine: EngineInstance;
    try {
      engine = adapter.createInstance(config, instanceId);
      if (engine.id !== instanceId || engine.engineId !== engineId) {
        throw new Error(
          "The adapter returned an instance with mismatched identity.",
        );
      }
    } catch (cause) {
      throw new EngineRuntimeError(
        "instance-start-failed",
        `Engine '${engineId}' could not create instance '${instanceId}'.`,
        { cause },
      );
    }

    const record: RuntimeInstance = {
      engine,
      capabilities: adapter.capabilities(),
      sessions: new Map(),
      state: "starting",
    };
    this.instances.set(instanceId, record);
    try {
      await engine.start();
      record.state = "started";
    } catch (cause) {
      this.instances.delete(instanceId);
      try {
        await engine.stop();
      } catch {
        // Preserve the startup error; cleanup failure does not replace its cause.
      }
      throw new EngineRuntimeError(
        "instance-start-failed",
        `Engine instance '${instanceId}' failed to start.`,
        { cause },
      );
    }
  }

  async openSession(
    instanceId: InstanceId,
    context: SessionContext,
  ): Promise<EngineSession> {
    const record = this.requireStartedInstance(instanceId);
    this.requireIdentifier(context.sessionId, "Session");
    if (context.instanceId !== instanceId) {
      throw new EngineRuntimeError(
        "session-instance-mismatch",
        `Session '${context.sessionId}' is scoped to a different instance.`,
      );
    }
    const access = context.access;
    if (
      access !== "owner" &&
      access !== "read-write" &&
      access !== "read-only"
    ) {
      throw new EngineOperationError(
        "permission-denied",
        "The requested session access level is not supported.",
      );
    }
    const authorizedContext = { ...context, access };
    if (
      this.sessions.has(context.sessionId) ||
      this.openingSessions.has(context.sessionId)
    ) {
      throw new EngineRuntimeError(
        "session-already-exists",
        `Session '${context.sessionId}' is already open.`,
      );
    }

    this.openingSessions.add(context.sessionId);
    try {
      let session: EngineSession;
      try {
        session = await record.engine.openSession(authorizedContext);
      } catch (cause) {
        throw new EngineRuntimeError(
          "session-open-failed",
          `Session '${context.sessionId}' could not be opened.`,
          { cause },
        );
      }

      if (
        session.id !== context.sessionId ||
        session.instanceId !== instanceId ||
        session.access !== access
      ) {
        try {
          await record.engine.closeSession(session);
        } catch {
          // The invalid session is not registered, even if best-effort cleanup fails.
        }
        throw new EngineRuntimeError(
          "session-instance-mismatch",
          "The engine returned a session with an unexpected ID, instance scope or access level.",
        );
      }
      if (record.state !== "started") {
        try {
          await record.engine.closeSession(session);
        } catch {
          // The runtime is stopping this instance, so it will not register this session.
        }
        throw new EngineRuntimeError(
          "instance-not-started",
          `Instance '${instanceId}' stopped while opening a session.`,
        );
      }

      record.sessions.set(session.id, session);
      this.sessions.set(session.id, { instanceId, session, access });
      return session;
    } finally {
      this.openingSessions.delete(context.sessionId);
    }
  }

  async execute(
    sessionId: SessionId,
    request: EngineRequest,
  ): Promise<EngineResponse> {
    const route = this.sessions.get(sessionId);
    if (!route) {
      throw new EngineRuntimeError(
        "session-not-found",
        `Session '${sessionId}' is not open.`,
      );
    }
    const record = this.requireStartedInstance(route.instanceId);
    assertEngineOperationPermission(route.access, record.capabilities, request);
    try {
      return await record.engine.execute(route.session, request);
    } catch (cause) {
      if (
        cause instanceof EngineOperationError ||
        cause instanceof EngineExecutionUncertainError
      )
        throw cause;
      throw new EngineRuntimeError(
        "execution-failed",
        `Operation '${request.operation}' failed in session '${sessionId}'.`,
        { cause },
      );
    }
  }

  async closeSession(sessionId: SessionId): Promise<void> {
    const route = this.sessions.get(sessionId);
    if (!route) {
      throw new EngineRuntimeError(
        "session-not-found",
        `Session '${sessionId}' is not open.`,
      );
    }
    const record = this.instances.get(route.instanceId);
    this.sessions.delete(sessionId);
    record?.sessions.delete(sessionId);
    if (!record) return;

    try {
      await record.engine.closeSession(route.session);
    } catch (cause) {
      throw new EngineRuntimeError(
        "session-close-failed",
        `Session '${sessionId}' failed to close.`,
        { cause },
      );
    }
  }

  async health(instanceId: InstanceId): Promise<EngineHealth> {
    const record = this.requireStartedInstance(instanceId);
    try {
      return await record.engine.health();
    } catch (cause) {
      throw new EngineRuntimeError(
        "health-check-failed",
        `Health check failed for instance '${instanceId}'.`,
        { cause },
      );
    }
  }

  async exportSnapshot(instanceId: InstanceId): Promise<Uint8Array> {
    const record = this.requireStartedInstance(instanceId);
    if (record.capabilities.features.portableSnapshots !== true) {
      throw new EngineOperationError(
        "snapshot-unsupported",
        `Engine '${record.engine.engineId}' does not support portable snapshots.`,
      );
    }
    const engine = record.engine as Partial<SnapshotEngineInstance>;
    if (typeof engine.exportSnapshot !== "function") {
      throw new EngineOperationError(
        "snapshot-unsupported",
        `Engine '${record.engine.engineId}' advertises snapshots without an export implementation.`,
      );
    }
    return engine.exportSnapshot.call(record.engine);
  }

  async exportNativeFile(instanceId: InstanceId): Promise<Uint8Array> {
    const record = this.requireStartedInstance(instanceId);
    if (record.capabilities.features.nativeFileImportExport !== true) {
      throw new EngineOperationError(
        "native-file-unsupported",
        `Engine '${record.engine.engineId}' does not support native database files.`,
      );
    }
    const engine = record.engine as Partial<NativeFileEngineInstance>;
    if (typeof engine.exportNativeFile !== "function") {
      throw new EngineOperationError(
        "native-file-unsupported",
        `Engine '${record.engine.engineId}' advertises native files without an export implementation.`,
      );
    }
    return engine.exportNativeFile.call(record.engine);
  }

  async importDataset(
    instanceId: InstanceId,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<DatasetImportResult> {
    const record = this.requireStartedInstance(instanceId);
    if (record.capabilities.features.localDatasetIngestion !== true) {
      throw new EngineOperationError(
        "dataset-ingestion-unsupported",
        `Engine '${record.engine.engineId}' does not support local dataset ingestion.`,
      );
    }
    const engine = record.engine as Partial<DatasetImportEngineInstance>;
    if (typeof engine.importDataset !== "function") {
      throw new EngineOperationError(
        "dataset-ingestion-unsupported",
        `Engine '${record.engine.engineId}' advertises dataset ingestion without an implementation.`,
      );
    }
    return engine.importDataset.call(record.engine, fileName, bytes);
  }

  async stopInstance(instanceId: InstanceId): Promise<void> {
    const record = this.requireStartedInstance(instanceId);
    record.state = "stopping";
    const failures: unknown[] = [];

    for (const [sessionId, session] of record.sessions) {
      try {
        await record.engine.closeSession(session);
      } catch (cause) {
        failures.push(cause);
      } finally {
        record.sessions.delete(sessionId);
        this.sessions.delete(sessionId);
      }
    }

    try {
      await record.engine.stop();
    } catch (cause) {
      failures.push(cause);
    } finally {
      this.instances.delete(instanceId);
    }

    if (failures.length > 0) {
      throw new EngineRuntimeError(
        "instance-stop-failed",
        `Instance '${instanceId}' stopped with ${failures.length} cleanup error(s).`,
        { cause: new AggregateError(failures) },
      );
    }
  }

  private requireStartedInstance(instanceId: InstanceId): RuntimeInstance {
    const record = this.instances.get(instanceId);
    if (!record) {
      throw new EngineRuntimeError(
        "instance-not-found",
        `Instance '${instanceId}' is not registered.`,
      );
    }
    if (record.state !== "started") {
      throw new EngineRuntimeError(
        "instance-not-started",
        `Instance '${instanceId}' is ${record.state}.`,
      );
    }
    return record;
  }

  private requireIdentifier(value: string, label: string): void {
    if (!value.trim()) {
      throw new EngineRuntimeError(
        "invalid-identifier",
        `${label} ID must not be empty.`,
      );
    }
  }
}
