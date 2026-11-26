import {
  EngineOperationError,
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
  installEngineWorker,
  type EngineWorkerScope,
} from "@pocketdb/runtime";

class BrowserWorkerFixture implements EngineAdapter {
  readonly id = "browser-worker-fixture";

  capabilities(): EngineCapabilities {
    return {
      operations: ["set", "get", "identity", "wait", "structured-error"],
      features: { cancellation: true },
    };
  }

  createInstance(_config: EngineConfig, id: InstanceId): EngineInstance {
    const values = new Map<string, string>();
    const sessions = new Map<SessionId, SessionContext>();
    let started = false;
    let stopped = false;

    return {
      id,
      engineId: this.id,
      async start() {
        started = true;
      },
      async openSession(context) {
        if (!started) throw new Error("fixture not started");
        sessions.set(context.sessionId, context);
        return { id: context.sessionId, instanceId: id };
      },
      async execute(
        session: EngineSession,
        request: EngineRequest,
      ): Promise<EngineResponse> {
        if (!started || sessions.get(session.id)?.sessionId !== session.id) {
          throw new Error("session not open");
        }
        const payload = request.payload as
          | { key?: string; value?: string; ms?: number }
          | undefined;
        if (request.operation === "identity") {
          return {
            value: {
              sessionId: session.id,
              principal: sessions.get(session.id)?.principal,
            },
          };
        }
        if (request.operation === "structured-error") {
          throw new EngineOperationError(
            "fixture-invalid-operation",
            "Fixture operation failed validation.",
            undefined,
            { sqlState: "XX000" },
          );
        }
        if (request.operation === "wait") {
          await delay(payload?.ms ?? 50, request.signal);
          return {
            value: { sessionId: session.id, waitedMs: payload?.ms ?? 50 },
          };
        }
        if (typeof payload?.key !== "string") throw new Error("key required");
        if (request.operation === "set") {
          if (typeof payload.value !== "string")
            throw new Error("value required");
          values.set(payload.key, payload.value);
          return { value: "OK" };
        }
        if (request.operation === "get")
          return { value: values.get(payload.key) ?? null };
        throw new Error("unsupported operation");
      },
      async closeSession(session: EngineSession) {
        sessions.delete(session.id);
      },
      async health(): Promise<EngineHealth> {
        return {
          status: stopped ? "stopped" : started ? "healthy" : "starting",
        };
      },
      async stop() {
        sessions.clear();
        values.clear();
        started = false;
        stopped = true;
      },
    };
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Worker operation cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}

installEngineWorker(
  globalThis as unknown as EngineWorkerScope,
  new BrowserWorkerFixture(),
);
