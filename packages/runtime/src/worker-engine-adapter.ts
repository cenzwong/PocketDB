import {
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
  type SessionContext,
  type SnapshotEngineInstance,
} from "./contracts";
import type { DatasetImportResult } from "./contracts";
import type {
  SerializedWorkerError,
  WorkerCallMessage,
  WorkerCallMethod,
  WorkerReplyMessage,
  WorkerRequestMessage,
} from "./worker-protocol";

export interface WorkerLike {
  postMessage(message: WorkerRequestMessage): void;
  terminate(): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerReplyMessage>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "messageerror",
    listener: (event: MessageEvent) => void,
  ): void;
}

export interface WorkerEngineOptions {
  readonly maxPendingRequests?: number;
  readonly requestTimeoutMs?: number;
}

interface PendingCall {
  readonly id: number;
  readonly method: WorkerCallMethod;
  readonly args: Omit<
    WorkerCallMessage,
    "type" | "id" | "method" | "instanceId"
  >;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  timer?: ReturnType<typeof setTimeout>;
  abortListener?: () => void;
  settled: boolean;
}

export class WorkerEngineAdapter implements EngineAdapter {
  constructor(
    readonly id: string,
    private readonly engineCapabilities: EngineCapabilities,
    private readonly createWorker: (instanceId: InstanceId) => WorkerLike,
    private readonly options: WorkerEngineOptions = {},
  ) {}

  capabilities(): EngineCapabilities {
    return this.engineCapabilities;
  }

  createInstance(config: EngineConfig, instanceId: InstanceId): EngineInstance {
    return new WorkerEngineInstance(
      this.id,
      instanceId,
      config,
      this.createWorker(instanceId),
      this.options,
    );
  }
}

export class WorkerEngineInstance
  implements EngineInstance, SnapshotEngineInstance
{
  private readonly pending = new Map<number, PendingCall>();
  private readonly queue: PendingCall[] = [];
  private readonly maxPendingRequests: number;
  private readonly requestTimeoutMs: number;
  private nextRequestId = 0;
  private active?: PendingCall;
  private state: "new" | "started" | "stopping" | "stopped" | "failed" = "new";
  private terminalError?: EngineRuntimeError;
  private workerTerminated = false;

  constructor(
    readonly engineId: string,
    readonly id: InstanceId,
    private readonly config: EngineConfig,
    private readonly worker: WorkerLike,
    options: WorkerEngineOptions = {},
  ) {
    this.maxPendingRequests = options.maxPendingRequests ?? 32;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    if (
      !Number.isInteger(this.maxPendingRequests) ||
      this.maxPendingRequests < 1
    ) {
      throw new RangeError("maxPendingRequests must be a positive integer.");
    }
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new RangeError("requestTimeoutMs must be greater than zero.");
    }
    worker.addEventListener("message", (event) => this.handleReply(event.data));
    worker.addEventListener("error", () =>
      this.fail(this.makeError("worker-terminated")),
    );
    worker.addEventListener("messageerror", () =>
      this.fail(this.makeError("worker-message-error")),
    );
  }

  async start(): Promise<void> {
    if (this.state !== "new") {
      throw new EngineRuntimeError(
        "instance-not-started",
        `Worker instance '${this.id}' cannot start from ${this.state}.`,
      );
    }
    try {
      await this.call("start", { config: this.config });
      this.state = "started";
    } catch (error) {
      this.state = "failed";
      this.worker.terminate();
      throw error;
    }
  }

  openSession(context: SessionContext): Promise<EngineSession> {
    this.requireStarted();
    return this.call("open-session", { context }) as Promise<EngineSession>;
  }

  execute(
    session: EngineSession,
    request: EngineRequest,
  ): Promise<EngineResponse> {
    this.requireStarted();
    const { signal, ...serializableRequest } = request;
    return this.call(
      "execute",
      { sessionId: session.id, request: serializableRequest },
      signal,
    ) as Promise<EngineResponse>;
  }

  closeSession(session: EngineSession): Promise<void> {
    this.requireStarted();
    return this.call("close-session", {
      sessionId: session.id,
    }) as Promise<void>;
  }

  health(): Promise<EngineHealth> {
    this.requireStarted();
    return this.call("health", {}) as Promise<EngineHealth>;
  }

  exportSnapshot(): Promise<Uint8Array> {
    this.requireStarted();
    return this.call("export-snapshot", {}) as Promise<Uint8Array>;
  }

  exportNativeFile(): Promise<Uint8Array> {
    this.requireStarted();
    return this.call("export-native-file", {}) as Promise<Uint8Array>;
  }

  importDataset(
    fileName: string,
    fileBytes: Uint8Array,
  ): Promise<DatasetImportResult> {
    this.requireStarted();
    return this.call("import-dataset", {
      fileName,
      fileBytes,
    }) as Promise<DatasetImportResult>;
  }

  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    this.requireStarted();
    this.state = "stopping";
    try {
      await this.call("stop", {});
    } finally {
      this.state = "stopped";
      this.terminateWorker();
      this.fail(this.makeError("worker-terminated", "Worker stopped."));
    }
  }

  terminate(): void {
    if (this.state === "stopped" || this.state === "failed") return;
    this.state = "failed";
    this.terminalError = this.makeError("worker-terminated");
    this.fail(this.terminalError);
  }

  private call(
    method: WorkerCallMethod,
    args: PendingCall["args"],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const failure = this.terminalError;
    if (failure) return Promise.reject(failure);
    if (this.state === "stopped" || this.state === "failed") {
      return Promise.reject(this.makeError("worker-terminated"));
    }
    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(this.makeError("worker-queue-full"));
    }
    if (signal?.aborted)
      return Promise.reject(this.makeError("request-aborted"));

    const id = ++this.nextRequestId;
    return new Promise((resolve, reject) => {
      const pending: PendingCall = {
        id,
        method,
        args,
        resolve,
        reject,
        signal,
        settled: false,
      };
      if (signal) {
        pending.abortListener = () => this.abort(pending);
        signal.addEventListener("abort", pending.abortListener, { once: true });
      }
      this.pending.set(id, pending);
      this.queue.push(pending);
      this.pump();
    });
  }

  private pump(): void {
    if (
      this.active ||
      this.queue.length === 0 ||
      this.state === "failed" ||
      this.state === "stopped"
    )
      return;
    const pending = this.queue.shift();
    if (!pending) return;
    if (pending.signal?.aborted) {
      this.settle(pending, this.makeError("request-aborted"));
      this.pump();
      return;
    }

    this.active = pending;
    pending.timer = setTimeout(
      () => this.fail(this.makeError("worker-request-timeout")),
      this.requestTimeoutMs,
    );
    try {
      this.worker.postMessage({
        type: "call",
        id: pending.id,
        method: pending.method,
        instanceId: this.id,
        ...pending.args,
      });
    } catch (cause) {
      this.fail(
        this.makeError(
          "worker-message-error",
          "Could not send a request to the worker.",
          cause,
        ),
      );
    }
  }

  private abort(pending: PendingCall): void {
    if (!this.pending.has(pending.id)) return;
    if (this.active === pending) {
      if (!pending.settled) {
        pending.settled = true;
        pending.reject(this.makeError("request-aborted"));
      }
      try {
        this.worker.postMessage({ type: "cancel", id: pending.id });
      } catch {
        this.fail(this.makeError("worker-message-error"));
      }
      return;
    }
    const index = this.queue.indexOf(pending);
    if (index >= 0) this.queue.splice(index, 1);
    this.settle(pending, this.makeError("request-aborted"));
  }

  private handleReply(reply: WorkerReplyMessage): void {
    const pending = this.pending.get(reply.id);
    if (!pending || pending !== this.active || reply.type !== "reply") return;
    if (pending.timer) clearTimeout(pending.timer);
    this.active = undefined;
    if (reply.ok) this.settle(pending, undefined, reply.result);
    else this.settle(pending, this.fromWorkerError(reply.error));
    this.pump();
  }

  private settle(pending: PendingCall, error?: Error, result?: unknown): void {
    if (!this.pending.delete(pending.id)) return;
    if (pending.timer) clearTimeout(pending.timer);
    if (pending.abortListener)
      pending.signal?.removeEventListener("abort", pending.abortListener);
    if (pending.settled) return;
    pending.settled = true;
    if (error) pending.reject(error);
    else pending.resolve(result);
  }

  private fail(error: EngineRuntimeError): void {
    if (this.state !== "stopped") this.state = "failed";
    this.terminalError ??= error;
    this.terminateWorker();
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      if (pending.abortListener)
        pending.signal?.removeEventListener("abort", pending.abortListener);
      if (!pending.settled) pending.reject(this.terminalError);
    }
    this.pending.clear();
    this.queue.length = 0;
    this.active = undefined;
  }

  private terminateWorker(): void {
    if (this.workerTerminated) return;
    this.workerTerminated = true;
    this.worker.terminate();
  }

  private fromWorkerError(error?: SerializedWorkerError): Error {
    const knownCodes = new Set<string>([
      "invalid-identifier",
      "adapter-already-registered",
      "adapter-not-registered",
      "instance-already-exists",
      "instance-not-found",
      "instance-start-failed",
      "instance-not-started",
      "session-already-exists",
      "session-not-found",
      "session-instance-mismatch",
      "session-open-failed",
      "session-close-failed",
      "execution-failed",
      "health-check-failed",
      "instance-stop-failed",
      "worker-queue-full",
      "worker-terminated",
      "worker-request-timeout",
      "worker-message-error",
      "request-aborted",
    ]);
    if (error && knownCodes.has(error.code)) {
      return this.makeError(
        error.code as ConstructorParameters<typeof EngineRuntimeError>[0],
        error.message,
      );
    }
    if (error && /^[a-z][a-z0-9-]{0,127}$/.test(error.code)) {
      return new EngineOperationError(
        error.code,
        error.message,
        undefined,
        error.details,
      );
    }
    return this.makeError(
      "execution-failed",
      "The worker returned an invalid error.",
    );
  }

  private requireStarted(): void {
    if (this.state !== "started") {
      throw this.terminalError ?? this.makeError("instance-not-started");
    }
  }

  private makeError(
    code: ConstructorParameters<typeof EngineRuntimeError>[0],
    message = `Worker instance '${this.id}' failed (${code}).`,
    cause?: unknown,
  ): EngineRuntimeError {
    return new EngineRuntimeError(
      code,
      message,
      cause === undefined ? undefined : { cause },
    );
  }
}
