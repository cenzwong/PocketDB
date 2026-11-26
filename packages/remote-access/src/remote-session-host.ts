import {
  createCapabilityManifest,
  encodeEnvelope,
  ProtocolCodecError,
  DEFAULT_MAX_MESSAGE_BYTES,
  MAX_PROTOCOL_STRING_LENGTH,
  type AuthenticatedPeerSession,
  decodeEnvelope,
  type ProtocolEnvelope,
  type ProtocolError,
  type ProtocolValue,
} from "@pocketdb/protocol";
import {
  EngineOperationError,
  EngineRuntimeError,
  type DatabaseRuntime,
  type EngineRequest,
  type SessionAccess,
} from "@pocketdb/runtime";
import type { TransportConnection, Unsubscribe } from "@pocketdb/transport";

export interface RemoteSessionHostOptions {
  readonly requestTimeoutMs?: number;
  readonly maxActiveRequests?: number;
  readonly maxCompletedRequests?: number;
  readonly maxOpenSessions?: number;
  readonly maxRequestBytes?: number;
  readonly maxResultBytes?: number;
  readonly maxRequestsPerWindow?: number;
  readonly rateLimitWindowMs?: number;
  readonly onRequestComplete?: (event: RemoteRequestMetric) => void;
}

export interface RemoteRequestMetric {
  readonly outcome: "success" | "failed" | "unknown";
  readonly durationMs: number;
  readonly executionDurationMs: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly activeRequests: number;
  readonly operation: string;
  readonly code?: string;
}

export interface RemoteSessionAuthorization {
  /** Must re-check expiry, revocation, peer binding and connection ownership. */
  authorize(): AuthenticatedPeerSession;
}

interface OpenRemoteSession {
  readonly instanceId: string;
  readonly engineId: string;
  readonly access: Exclude<SessionAccess, "owner">;
}

interface RequestRecord {
  readonly encodedRequest: string;
  readonly controller: AbortController;
  timeout?: ReturnType<typeof setTimeout>;
  result?: ProtocolEnvelope;
  sent: boolean;
  running: boolean;
  metricReported: boolean;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ACTIVE_REQUESTS = 64;
const DEFAULT_MAX_COMPLETED_REQUESTS = 256;
const DEFAULT_MAX_OPEN_SESSIONS = 16;
const DEFAULT_MAX_REQUEST_BYTES = DEFAULT_MAX_MESSAGE_BYTES;
const DEFAULT_MAX_RESULT_BYTES = DEFAULT_MAX_MESSAGE_BYTES;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 120;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/** Routes one already-authenticated peer connection to hosted engine sessions. */
export class RemoteSessionHost {
  private readonly requestTimeoutMs: number;
  private readonly maxActiveRequests: number;
  private readonly maxCompletedRequests: number;
  private readonly maxOpenSessions: number;
  private readonly maxRequestBytes: number;
  private readonly maxResultBytes: number;
  private readonly maxRequestsPerWindow: number;
  private readonly rateLimitWindowMs: number;
  private requestWindowStartedAt = Date.now();
  private requestsInWindow = 0;
  private readonly sessions = new Map<string, OpenRemoteSession>();
  private readonly pendingSessions = new Set<string>();
  private readonly requests = new Map<string, RequestRecord>();
  private readonly messageUnsubscribe: Unsubscribe;
  private readonly stateUnsubscribe: Unsubscribe;
  private closed = false;
  private negotiated = false;
  private readonly initialAuthorization: AuthenticatedPeerSession;
  private readonly onRequestComplete?: (event: RemoteRequestMetric) => void;

  constructor(
    private readonly runtime: DatabaseRuntime,
    private readonly connection: TransportConnection,
    private readonly authorization: RemoteSessionAuthorization,
    options: RemoteSessionHostOptions = {},
  ) {
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxActiveRequests =
      options.maxActiveRequests ?? DEFAULT_MAX_ACTIVE_REQUESTS;
    this.maxCompletedRequests =
      options.maxCompletedRequests ?? DEFAULT_MAX_COMPLETED_REQUESTS;
    this.maxOpenSessions = options.maxOpenSessions ?? DEFAULT_MAX_OPEN_SESSIONS;
    const transportMessageLimit = Math.min(
      connection.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
      DEFAULT_MAX_MESSAGE_BYTES,
    );
    this.maxRequestBytes = Math.min(
      options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
      transportMessageLimit,
    );
    this.maxResultBytes = Math.min(
      options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
      transportMessageLimit,
    );
    this.maxRequestsPerWindow =
      options.maxRequestsPerWindow ?? DEFAULT_MAX_REQUESTS_PER_WINDOW;
    this.rateLimitWindowMs =
      options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    this.onRequestComplete = options.onRequestComplete;
    if (
      (options.maxRequestBytes ?? 0) > DEFAULT_MAX_MESSAGE_BYTES ||
      (options.maxResultBytes ?? 0) > DEFAULT_MAX_MESSAGE_BYTES
    ) {
      throw new RangeError(
        `Request and result byte limits cannot exceed the protocol limit of ${DEFAULT_MAX_MESSAGE_BYTES}.`,
      );
    }
    validateLimit("requestTimeoutMs", this.requestTimeoutMs);
    validateLimit("maxActiveRequests", this.maxActiveRequests);
    validateLimit("maxCompletedRequests", this.maxCompletedRequests);
    validateLimit("maxOpenSessions", this.maxOpenSessions);
    validateLimit("maxRequestBytes", this.maxRequestBytes);
    validateLimit("maxResultBytes", this.maxResultBytes);
    validateLimit("maxRequestsPerWindow", this.maxRequestsPerWindow);
    validateLimit("rateLimitWindowMs", this.rateLimitWindowMs);
    this.initialAuthorization = authorization.authorize();
    this.messageUnsubscribe = connection.onMessage(this.onMessage);
    this.stateUnsubscribe = connection.onStateChange(this.onStateChange);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.messageUnsubscribe();
    this.stateUnsubscribe();
    for (const request of this.requests.values()) {
      clearTimeout(request.timeout);
      request.controller.abort();
    }
    const sessions = [...this.sessions.keys()];
    this.sessions.clear();
    await Promise.allSettled(
      sessions.map((sessionId) => this.runtime.closeSession(sessionId)),
    );
  }

  private readonly onMessage = (message: Uint8Array): void => {
    void this.handleMessage(message);
  };

  private readonly onStateChange = (): void => {
    void this.close();
  };

  private async handleMessage(message: Uint8Array): Promise<void> {
    if (this.closed) return;
    if (message.byteLength > this.maxRequestBytes) {
      await this.sendError("resource-limit", undefined, {
        code: "request-too-large",
        message: `The incoming message exceeds the ${this.maxRequestBytes}-byte request limit.`,
        retryable: false,
        outcome: "not-started",
      });
      await this.connection.disconnect("request exceeds configured size limit");
      await this.close();
      return;
    }
    let envelope: ProtocolEnvelope;
    try {
      envelope = decodeEnvelope(message);
    } catch {
      await this.connection.disconnect("invalid protocol envelope");
      await this.close();
      return;
    }

    try {
      if (envelope.type === "heartbeat") {
        this.requireAuthorization();
        await this.send({ ...envelope });
        return;
      }
      if (envelope.type === "hello") {
        const auth = this.requireAuthorization();
        if (!envelope.supportedVersions.includes(1)) {
          await this.sendError(envelope.id, undefined, {
            code: "unsupported-version",
            message: "This host supports protocol version 1 only.",
            outcome: "not-started",
          });
          return;
        }
        this.negotiated = true;
        await this.send({
          version: 1,
          type: "hello-ack",
          id: envelope.id,
          selectedVersion: 1,
          engines: this.runtime
            .listEngines()
            .filter(({ id }) => id === auth.engineId)
            .map(({ id, capabilities }) => ({
              id,
              capabilities: createCapabilityManifest(
                id,
                auth.access,
                capabilities,
              ) as unknown as ProtocolValue,
            })),
        });
        return;
      }
      if (envelope.type === "open-session") {
        this.requireAuthorization();
        this.requireNegotiated();
        await this.openSession(envelope);
        return;
      }
      if (envelope.type === "close-session") {
        this.requireAuthorization();
        this.requireNegotiated();
        await this.closeSession(envelope);
        return;
      }
      if (envelope.type === "request") {
        this.requireAuthorization();
        this.requireNegotiated();
        await this.executeRequest(envelope);
        return;
      }
      if (envelope.type === "disconnect") {
        await this.close();
        return;
      }
      throw new RemoteAccessError(
        "unexpected-message",
        `The host cannot process '${envelope.type}' in this session state.`,
        "not-started",
      );
    } catch (cause) {
      const authenticationFailed = isAuthenticationFailure(cause);
      const id = "id" in envelope ? envelope.id : "remote-error";
      const sessionId =
        "sessionId" in envelope ? envelope.sessionId : undefined;
      await this.sendError(id, sessionId, toProtocolError(cause));
      if (authenticationFailed) await this.close();
    }
  }

  private async openSession(
    envelope: Extract<ProtocolEnvelope, { type: "open-session" }>,
  ): Promise<void> {
    const auth = this.requireAuthorization();
    if (
      envelope.instanceId !== auth.instanceId ||
      envelope.engineId !== auth.engineId ||
      envelope.access !== auth.access
    ) {
      throw new RemoteAccessError(
        "permission-denied",
        "The requested session does not match the authenticated invitation scope.",
        "not-started",
      );
    }
    if (
      this.sessions.has(envelope.sessionId) ||
      this.pendingSessions.has(envelope.sessionId)
    ) {
      throw new RemoteAccessError(
        "session-already-open",
        "The requested remote session ID is already open.",
        "not-started",
      );
    }
    if (
      this.sessions.size + this.pendingSessions.size >=
      this.maxOpenSessions
    ) {
      throw new RemoteAccessError(
        "session-limit-reached",
        "The connection has reached its open-session limit.",
        "not-started",
      );
    }
    const engines = this.runtime.listEngines();
    const engine = engines.find(({ id }) => id === auth.engineId);
    if (!engine) {
      throw new RemoteAccessError(
        "adapter-not-registered",
        "The invited database engine is not available.",
        "not-started",
      );
    }
    const sessionId = envelope.sessionId;
    this.pendingSessions.add(sessionId);
    try {
      const session = await this.runtime.openSession(auth.instanceId, {
        sessionId,
        instanceId: auth.instanceId,
        access: auth.access,
        principal: auth.clientId,
      });
      if (this.closed) {
        await this.runtime.closeSession(session.id);
        return;
      }
      this.sessions.set(session.id, {
        instanceId: auth.instanceId,
        engineId: auth.engineId,
        access: auth.access,
      });
    } finally {
      this.pendingSessions.delete(sessionId);
    }
    await this.send({
      version: 1,
      type: "response",
      id: envelope.id,
      sessionId,
      payload: {
        opened: true,
        capabilities: createCapabilityManifest(
          engine.id,
          auth.access,
          engine.capabilities,
        ) as unknown as ProtocolValue,
      },
    });
  }

  private async closeSession(
    envelope: Extract<ProtocolEnvelope, { type: "close-session" }>,
  ): Promise<void> {
    if (!this.sessions.has(envelope.sessionId)) {
      throw new RemoteAccessError(
        "session-not-found",
        "The session is not open on this authenticated connection.",
        "not-started",
      );
    }
    await this.runtime.closeSession(envelope.sessionId);
    this.sessions.delete(envelope.sessionId);
    await this.send({
      version: 1,
      type: "response",
      id: envelope.id,
      sessionId: envelope.sessionId,
      payload: { closed: true },
    });
  }

  private async executeRequest(
    envelope: Extract<ProtocolEnvelope, { type: "request" }>,
  ): Promise<void> {
    const startedAt = performance.now();
    const route = this.sessions.get(envelope.sessionId);
    if (
      !route ||
      route.instanceId !== envelope.instanceId ||
      route.engineId !== envelope.engineId
    ) {
      throw new RemoteAccessError(
        "session-not-found",
        "The request does not match an open session on this connection.",
        "not-started",
      );
    }
    if (this.requests.has(envelope.id)) {
      const existing = this.requests.get(envelope.id);
      const encodedRequest = encodeEnvelope(envelope);
      if (existing?.encodedRequest !== encodedRequest) {
        throw new RemoteAccessError(
          "request-id-conflict",
          "A request ID cannot be reused with a different operation or payload.",
          "not-started",
        );
      }
      if (existing.result) await this.send(existing.result);
      return;
    }
    this.consumeRateLimit();
    if (this.activeRequestCount() >= this.maxActiveRequests) {
      throw new RemoteAccessError(
        "request-limit-reached",
        "The connection has reached its active request limit.",
        "not-started",
      );
    }

    const encodedRequest = encodeEnvelope(envelope);
    const record: RequestRecord = {
      encodedRequest,
      controller: new AbortController(),
      sent: false,
      running: true,
      metricReported: false,
    };
    this.requests.set(envelope.id, record);
    const request: EngineRequest = {
      operation: envelope.operation,
      payload: envelope.payload,
      signal: record.controller.signal,
    };
    record.timeout = setTimeout(() => {
      if (record.result) return;
      record.controller.abort();
      record.result = {
        version: 1,
        type: "error",
        id: envelope.id,
        sessionId: envelope.sessionId,
        error: {
          code: "request-timeout",
          message:
            "Execution timed out after dispatch; the operation outcome is unknown.",
          retryable: false,
          outcome: "unknown",
        },
      };
      record.sent = true;
      void this.send(record.result);
    }, this.requestTimeoutMs);

    const executionStartedAt = performance.now();
    let executionDurationMs = 0;
    try {
      const response = await this.runtime.execute(envelope.sessionId, request);
      executionDurationMs = Math.max(0, performance.now() - executionStartedAt);
      if (!record.result) {
        const result: ProtocolEnvelope = {
          version: 1,
          type: "response",
          id: envelope.id,
          sessionId: envelope.sessionId,
          payload: response.value as ProtocolValue,
        };
        try {
          encodeEnvelope(result, { maxBytes: this.maxResultBytes });
          record.result = result;
        } catch (cause) {
          const tooLarge =
            cause instanceof ProtocolCodecError &&
            cause.code === "message-too-large";
          record.result = {
            version: 1,
            type: "error",
            id: envelope.id,
            sessionId: envelope.sessionId,
            error: {
              code: tooLarge ? "result-too-large" : "result-encoding-failed",
              message: tooLarge
                ? `The completed operation result exceeds the ${this.maxResultBytes}-byte response limit. Its outcome is unknown to the client.`
                : "The completed operation result could not be encoded. Its outcome is unknown to the client.",
              retryable: false,
              outcome: "unknown",
            },
          };
        }
      }
    } catch (cause) {
      executionDurationMs = Math.max(0, performance.now() - executionStartedAt);
      if (!record.result) {
        record.result = {
          version: 1,
          type: "error",
          id: envelope.id,
          sessionId: envelope.sessionId,
          error: toProtocolError(cause),
        };
      }
    } finally {
      clearTimeout(record.timeout);
      record.running = false;
      if (record.result && !record.sent) {
        record.sent = true;
        await this.send(record.result).catch(() => undefined);
      }
      if (record.result && !record.metricReported) {
        record.metricReported = true;
        this.reportRequestMetric({
          outcome: requestOutcome(record.result),
          durationMs: Math.max(0, performance.now() - startedAt),
          executionDurationMs,
          requestBytes: new TextEncoder().encode(encodedRequest).byteLength,
          responseBytes: new TextEncoder().encode(encodeEnvelope(record.result))
            .byteLength,
          activeRequests: this.activeRequestCount(),
          operation: envelope.operation,
          ...(record.result.type === "error"
            ? { code: record.result.error.code }
            : {}),
        });
      }
      this.trimCompletedRequests();
    }
  }

  private reportRequestMetric(event: RemoteRequestMetric): void {
    try {
      this.onRequestComplete?.(event);
    } catch {
      // Observability must not affect request execution or delivery.
    }
  }

  private requireAuthorization(): AuthenticatedPeerSession {
    if (this.closed || this.connection.state !== "connected") {
      throw new RemoteAccessError(
        "not-connected",
        "The peer connection is no longer available.",
        "not-started",
      );
    }
    let current: AuthenticatedPeerSession;
    try {
      current = this.authorization.authorize();
    } catch {
      throw new RemoteAccessError(
        "authentication-revoked",
        "The authenticated peer session is expired, revoked or no longer bound to this connection.",
        "not-started",
      );
    }
    if (
      current.sessionId !== this.initialAuthorization.sessionId ||
      current.instanceId !== this.initialAuthorization.instanceId ||
      current.engineId !== this.initialAuthorization.engineId ||
      current.roomId !== this.initialAuthorization.roomId ||
      current.hostId !== this.initialAuthorization.hostId ||
      current.clientId !== this.initialAuthorization.clientId ||
      current.access !== this.initialAuthorization.access ||
      current.expiresAt !== this.initialAuthorization.expiresAt
    ) {
      throw new RemoteAccessError(
        "authentication-invalid-session",
        "The authenticated peer session changed or was revoked.",
        "not-started",
      );
    }
    return current;
  }

  private requireNegotiated(): void {
    if (!this.negotiated) {
      throw new RemoteAccessError(
        "protocol-not-negotiated",
        "Negotiate protocol version 1 before opening sessions or executing requests.",
        "not-started",
      );
    }
  }

  private activeRequestCount(): number {
    let count = 0;
    for (const request of this.requests.values()) if (request.running) count++;
    return count;
  }

  private consumeRateLimit(): void {
    const now = Date.now();
    if (now - this.requestWindowStartedAt >= this.rateLimitWindowMs) {
      this.requestWindowStartedAt = now;
      this.requestsInWindow = 0;
    }
    if (this.requestsInWindow >= this.maxRequestsPerWindow) {
      throw new RemoteAccessError(
        "request-rate-limit",
        "The connection has exceeded its request rate limit.",
        "not-started",
      );
    }
    this.requestsInWindow += 1;
  }

  private trimCompletedRequests(): void {
    let completed = [...this.requests.entries()].filter(
      ([, record]) => record.result && !record.running,
    );
    while (completed.length > this.maxCompletedRequests) {
      const [oldestId] = completed[0];
      this.requests.delete(oldestId);
      completed = completed.slice(1);
    }
  }

  private async send(envelope: ProtocolEnvelope): Promise<void> {
    if (this.closed || this.connection.state !== "connected") return;
    try {
      await this.connection.send(
        new TextEncoder().encode(encodeEnvelope(envelope)),
      );
    } catch {
      await this.close();
    }
  }

  private async sendError(
    id: string,
    sessionId: string | undefined,
    error: ProtocolError,
  ): Promise<void> {
    await this.send({
      version: 1,
      type: "error",
      id,
      ...(sessionId === undefined ? {} : { sessionId }),
      error,
    });
  }
}

function requestOutcome(
  result: ProtocolEnvelope,
): "success" | "failed" | "unknown" {
  if (result.type === "response") return "success";
  if (result.type !== "error") return "failed";
  return result.error.outcome === "unknown" ? "unknown" : "failed";
}

function isAuthenticationFailure(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string" &&
    cause.code.startsWith("authentication-")
  );
}

export class RemoteAccessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome: ProtocolError["outcome"] = "not-started",
  ) {
    super(message);
    this.name = "RemoteAccessError";
  }
}

function toProtocolError(cause: unknown): ProtocolError {
  const message =
    cause instanceof Error && cause.message
      ? cause.message.slice(0, MAX_PROTOCOL_STRING_LENGTH)
      : "The remote operation could not be completed.";
  if (cause instanceof EngineOperationError) {
    const notStarted = cause.code === "permission-denied";
    return {
      code: cause.code,
      message,
      retryable: false,
      outcome: notStarted ? "not-started" : "failed",
    };
  }
  if (cause instanceof EngineRuntimeError) {
    const notStarted = [
      "session-not-found",
      "instance-not-found",
      "instance-not-started",
      "request-aborted",
    ].includes(cause.code);
    return {
      code: cause.code,
      message,
      retryable: false,
      outcome: notStarted ? "not-started" : "failed",
    };
  }
  if (cause instanceof RemoteAccessError) {
    return {
      code: cause.code,
      message,
      retryable: false,
      outcome: cause.outcome,
    };
  }
  return {
    code: "remote-operation-failed",
    message: "The remote operation could not be completed.",
    retryable: false,
    outcome: "failed",
  };
}

function validateLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}
