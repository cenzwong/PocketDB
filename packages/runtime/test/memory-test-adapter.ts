import type {
  EngineAdapter,
  EngineCapabilities,
  EngineConfig,
  EngineHealth,
  EngineInstance,
  EngineRequest,
  EngineResponse,
  EngineSession,
  InstanceId,
  SessionContext,
} from "../src/contracts";
import { EngineOperationError } from "../src/contracts";

export interface TestEngineOptions {
  readonly failStart?: boolean;
  readonly failOpenSession?: boolean;
  readonly failCloseSession?: boolean;
  readonly failExecute?: boolean;
  readonly failHealth?: boolean;
  readonly failStop?: boolean;
}

export class MemoryTestAdapter implements EngineAdapter {
  readonly id = "memory-test";
  readonly createdInstances = new Map<InstanceId, MemoryTestInstance>();

  capabilities(): EngineCapabilities {
    return {
      operations: ["set", "get"],
      readOnlyOperations: ["get"],
      features: { transactions: false, binaryValues: false },
    };
  }

  createInstance(config: EngineConfig, instanceId: InstanceId): EngineInstance {
    const instance = new MemoryTestInstance(
      instanceId,
      this.id,
      config as TestEngineOptions,
    );
    this.createdInstances.set(instanceId, instance);
    return instance;
  }
}

export class MemoryTestInstance implements EngineInstance {
  readonly values = new Map<string, string>();
  readonly sessions = new Map<string, EngineSession>();
  started = false;
  stopped = false;

  constructor(
    readonly id: InstanceId,
    readonly engineId: string,
    private readonly options: TestEngineOptions = {},
  ) {}

  async start(): Promise<void> {
    if (this.options.failStart) throw new Error("start failure");
    if (this.started || this.stopped) throw new Error("invalid start state");
    this.started = true;
  }

  async openSession(context: SessionContext): Promise<EngineSession> {
    this.requireStarted();
    if (this.options.failOpenSession) throw new Error("open failure");
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
    if (this.options.failExecute) throw new Error("execute failure");
    if (this.sessions.get(session.id) !== session)
      throw new Error("session is not open");
    if (request.operation === "structured-error") {
      throw new EngineOperationError(
        "test-invalid-operation",
        "Structured engine operation failure.",
      );
    }

    const payload = request.payload as
      | { key?: unknown; value?: unknown }
      | undefined;
    if (typeof payload?.key !== "string")
      throw new Error("key must be a string");
    if (request.operation === "set") {
      if (typeof payload.value !== "string")
        throw new Error("value must be a string");
      this.values.set(payload.key, payload.value);
      return { value: "OK" };
    }
    if (request.operation === "get") {
      return { value: this.values.get(payload.key) ?? null };
    }
    throw new Error(`unsupported operation '${request.operation}'`);
  }

  async closeSession(session: EngineSession): Promise<void> {
    if (this.options.failCloseSession) throw new Error("close failure");
    if (!this.sessions.delete(session.id))
      throw new Error("session is not open");
  }

  async health(): Promise<EngineHealth> {
    if (this.options.failHealth) throw new Error("health failure");
    return {
      status: this.stopped ? "stopped" : this.started ? "healthy" : "starting",
    };
  }

  async stop(): Promise<void> {
    if (this.options.failStop) throw new Error("stop failure");
    this.sessions.clear();
    this.started = false;
    this.stopped = true;
  }

  private requireStarted(): void {
    if (!this.started) throw new Error("instance is not started");
  }
}
