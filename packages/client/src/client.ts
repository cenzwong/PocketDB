import {
  decodeCapabilityManifest,
  decodeEnvelope,
  encodeEnvelope,
  parseInvitation,
  type Invitation,
  type InvitationTarget,
  type CapabilityManifest,
  type ProtocolEnvelope,
  type ProtocolError,
  type ProtocolValue,
} from "@pocketdb/protocol";
import type { TransportConnection, Unsubscribe } from "@pocketdb/transport";

export type ClientState =
  | "connecting"
  | "connected"
  | "closing"
  | "closed"
  | "failed";

export interface ClientStateEvent {
  readonly state: ClientState;
  readonly error?: Pick<PocketDBClientError, "code" | "message">;
}

export type ClientStateListener = (event: ClientStateEvent) => void;

export type ClientEngineCapabilities = CapabilityManifest;

export interface SqlSchemaOptions extends ClientRequestOptions {
  readonly schema?: string;
  readonly table?: string | null;
}

export interface SqlSchemaColumn {
  readonly table_schema: string;
  readonly table_name: string;
  readonly column_name: string;
  readonly ordinal_position: number;
  readonly data_type: string;
  readonly udt_name: string;
  readonly is_nullable: "YES" | "NO";
  readonly column_default: string | null;
}

export interface SqlQueryDescription {
  readonly parameters: readonly { readonly dataTypeID: number }[];
  readonly fields: readonly {
    readonly name: string;
    readonly dataTypeID: number;
  }[];
}

export interface ConnectPeerOptions {
  readonly signal: AbortSignal;
}

/** The connector must return only after transport setup and peer authentication succeed. */
export type ConnectPeer = (
  invitation: Invitation,
  options: ConnectPeerOptions,
) => Promise<TransportConnection>;

export interface ConnectOptions {
  readonly connectPeer: ConnectPeer;
  readonly expectedTarget?: InvitationTarget;
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly connectRetry?: ConnectRetryOptions;
  readonly signal?: AbortSignal;
}

export interface ConnectRetryOptions {
  /** Total transport/authentication attempts, including the first attempt. */
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface ClientRequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface SqlQueryOptions extends ClientRequestOptions {
  readonly rowMode?: "object" | "array";
}

export interface BaseClient {
  readonly engineId: Invitation["engineId"];
  readonly peerId: string;
  readonly sessionId: string;
  readonly access: Invitation["access"];
  readonly capabilities: ClientEngineCapabilities;
  readonly state: ClientState;
  onStateChange?(listener: ClientStateListener): Unsubscribe;
  close(): Promise<void>;
}

export interface SqlClient extends BaseClient {
  readonly engineId: "postgresql" | "sqlite" | "duckdb";
  query<Result extends ProtocolValue = ProtocolValue>(
    sql: string,
    params?: readonly ProtocolValue[],
    options?: SqlQueryOptions,
  ): Promise<Result>;
  schema(options?: SqlSchemaOptions): Promise<readonly SqlSchemaColumn[]>;
  describeQuery(
    sql: string,
    options?: ClientRequestOptions,
  ): Promise<SqlQueryDescription>;
}

export interface KeyValueCommands {
  ping(options?: ClientRequestOptions): Promise<string>;
  get(key: string, options?: ClientRequestOptions): Promise<Uint8Array | null>;
  set(
    key: string,
    value: string | Uint8Array | ArrayBuffer,
    options?: ClientRequestOptions,
  ): Promise<"OK">;
  delete(
    keys: readonly string[],
    options?: ClientRequestOptions,
  ): Promise<number>;
}

export interface KeyValueClient extends BaseClient {
  readonly engineId: "kv";
  readonly kv: KeyValueCommands;
}

export type PocketDBClient = SqlClient | KeyValueClient;

export class PocketDBClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome?: ProtocolError["outcome"],
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PocketDBClientError";
  }
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_RETRY: Required<ConnectRetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 200,
  maxDelayMs: 1_000,
};

export async function connect(
  connectionUri: string,
  options: ConnectOptions,
): Promise<PocketDBClient> {
  validateTimeout(
    "connectTimeoutMs",
    options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  );
  validateTimeout(
    "requestTimeoutMs",
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );
  let invitation: Invitation;
  try {
    invitation = parseInvitation(connectionUri, {
      expectedTarget: options.expectedTarget,
    });
  } catch (cause) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      typeof cause.code === "string"
    ) {
      throw new PocketDBClientError(
        cause.code,
        cause.message,
        "not-started",
        false,
        { cause },
      );
    }
    throw cause;
  }
  const controller = new AbortController();
  const signal = combineAbortSignals(controller.signal, options.signal);
  let connectTimedOut = false;
  const connectTimeoutMs =
    options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const connectRetry = resolveConnectRetry(options.connectRetry);
  const timer = setTimeout(() => {
    connectTimedOut = true;
    controller.abort(new DOMException("Connection timed out.", "TimeoutError"));
  }, connectTimeoutMs);
  let abandoned = false;
  const connecting = connectPeerWithRetries(
    invitation,
    options.connectPeer,
    signal,
    controller,
    connectRetry,
  );
  void connecting.then(
    (lateConnection) => {
      if (abandoned)
        void lateConnection.disconnect("connection attempt expired");
    },
    () => undefined,
  );

  let transport: TransportConnection | undefined;
  try {
    transport = await waitForConnection(connecting, signal, controller);
    if (transport.state !== "connected") {
      throw new PocketDBClientError(
        "not-connected",
        "The peer connector returned a disconnected transport.",
        "not-started",
      );
    }
    const client = new ConnectedClient(
      invitation,
      transport,
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
    await client.initialize(signal);
    clearTimeout(timer);
    return client.forEngine();
  } catch (cause) {
    abandoned = true;
    clearTimeout(timer);
    controller.abort();
    if (transport) await transport.disconnect("client connection failed");
    if (connectTimedOut) {
      throw new PocketDBClientError(
        "connect-timeout",
        "The PocketDB connection setup exceeded its deadline.",
        transport ? "unknown" : "not-started",
        false,
        { cause },
      );
    }
    if (cause instanceof PocketDBClientError) throw cause;
    if (
      cause instanceof Error &&
      "code" in cause &&
      typeof cause.code === "string"
    ) {
      throw new PocketDBClientError(
        cause.code,
        cause.message,
        "not-started",
        isRetryableConnectError(cause),
        { cause },
      );
    }
    throw new PocketDBClientError(
      signal.aborted ? "connect-timeout" : "connect-failed",
      "The PocketDB peer connection could not be established.",
      "not-started",
      isRetryableConnectError(cause),
      { cause },
    );
  }
}

type CorrelatedEnvelope = Extract<ProtocolEnvelope, { readonly id: string }>;

interface PendingResponse {
  readonly resolve: (envelope: CorrelatedEnvelope) => void;
  readonly reject: (error: PocketDBClientError) => void;
  timer?: ReturnType<typeof setTimeout>;
  abortListener?: () => void;
  signal?: AbortSignal;
}

class ConnectedClient implements BaseClient {
  readonly engineId: Invitation["engineId"];
  readonly sessionId: string;
  private currentState: ClientState = "connecting";
  private readonly pending = new Map<string, PendingResponse>();
  private readonly stateListeners = new Set<ClientStateListener>();
  private readonly messageUnsubscribe: Unsubscribe;
  private readonly stateUnsubscribe: Unsubscribe;
  private requestSequence = 0;
  private closePromise?: Promise<void>;
  private terminalError?: PocketDBClientError;
  private engineCapabilities?: ClientEngineCapabilities;

  constructor(
    private readonly invitation: Invitation,
    private readonly transport: TransportConnection,
    private readonly defaultTimeoutMs: number,
  ) {
    this.engineId = invitation.engineId;
    this.sessionId = randomId("session");
    this.messageUnsubscribe = transport.onMessage(this.onMessage);
    this.stateUnsubscribe = transport.onStateChange((event) => {
      if (event.state !== "connected") {
        const message = event.reason ?? "The peer connection was lost.";
        this.failPending(
          new PocketDBClientError("connection-lost", message, "unknown"),
        );
        if (this.currentState !== "closing") {
          this.terminalError = new PocketDBClientError(
            "connection-lost",
            message,
            "not-started",
            true,
          );
          this.setState("failed", this.terminalError);
        }
      }
    });
  }

  get state(): ClientState {
    return this.currentState;
  }

  onStateChange(listener: ClientStateListener): Unsubscribe {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  get peerId(): string {
    return this.transport.peerId;
  }

  get access(): Invitation["access"] {
    return this.invitation.access;
  }

  get capabilities(): ClientEngineCapabilities {
    if (!this.engineCapabilities) {
      throw new PocketDBClientError(
        "not-connected",
        "Capabilities are not available before connection setup completes.",
        "not-started",
      );
    }
    return this.engineCapabilities;
  }

  async initialize(signal: AbortSignal): Promise<void> {
    const hello = await this.exchange(
      {
        version: 1,
        type: "hello",
        id: this.nextRequestId(),
        supportedVersions: [1],
      },
      { signal },
    );
    if (hello.type !== "hello-ack" || hello.selectedVersion !== 1) {
      throw new PocketDBClientError(
        "protocol-negotiation-failed",
        "The host did not negotiate PocketDB protocol version 1.",
        "not-started",
      );
    }
    this.engineCapabilities = readEngineCapabilities(
      hello.engines,
      this.engineId,
      this.access,
    );
    const opened = await this.exchange(
      {
        version: 1,
        type: "open-session",
        id: this.nextRequestId(),
        sessionId: this.sessionId,
        instanceId: this.invitation.instanceId,
        engineId: this.engineId,
        access: this.invitation.access,
      },
      { signal },
    );
    if (opened.type !== "response") {
      throw new PocketDBClientError(
        "session-open-failed",
        "The host did not open the invited database session.",
        "not-started",
      );
    }
    this.setState("connected");
  }

  forEngine(): PocketDBClient {
    if (
      this.engineId === "postgresql" ||
      this.engineId === "sqlite" ||
      this.engineId === "duckdb"
    )
      return new SqlClientView(this);
    return new KeyValueClientView(this);
  }

  async query<Result extends ProtocolValue>(
    sql: string,
    params: readonly ProtocolValue[] = [],
    options: SqlQueryOptions = {},
  ): Promise<Result> {
    this.requireCapability("query");
    if (typeof sql !== "string" || sql.trim() === "") {
      throw new PocketDBClientError(
        "invalid-query",
        "SQL text must not be empty.",
        "not-started",
      );
    }
    const response = await this.runOperation(
      "query",
      {
        sql,
        params: [...params],
        ...(options.rowMode === undefined ? {} : { rowMode: options.rowMode }),
      },
      options,
    );
    return response as Result;
  }

  async schema(
    options: SqlSchemaOptions = {},
  ): Promise<readonly SqlSchemaColumn[]> {
    this.requireCapability("schema");
    const { schema, table, timeoutMs, signal } = options;
    const response = await this.runOperation(
      "schema",
      { schema: schema ?? "public", table: table ?? null },
      { timeoutMs, signal },
    );
    if (!isRecord(response) || !Array.isArray(response.rows)) {
      throw new PocketDBClientError(
        "invalid-response",
        "The host returned an invalid schema description.",
        "unknown",
      );
    }
    return response.rows as unknown as readonly SqlSchemaColumn[];
  }

  async describeQuery(
    sql: string,
    options: ClientRequestOptions = {},
  ): Promise<SqlQueryDescription> {
    this.requireCapability("describe-query");
    if (typeof sql !== "string" || sql.trim() === "") {
      throw new PocketDBClientError(
        "invalid-query",
        "SQL text must not be empty.",
        "not-started",
      );
    }
    const response = await this.runOperation(
      "describe-query",
      { sql },
      options,
    );
    if (
      !isRecord(response) ||
      !Array.isArray(response.parameters) ||
      !Array.isArray(response.fields)
    ) {
      throw new PocketDBClientError(
        "invalid-response",
        "The host returned an invalid query description.",
        "unknown",
      );
    }
    return response as unknown as SqlQueryDescription;
  }

  async kvCommand<Result extends ProtocolValue>(
    operation: string,
    args: readonly ProtocolValue[],
    options: ClientRequestOptions = {},
  ): Promise<Result> {
    this.requireCapability(operation);
    return (await this.runOperation(operation, args, options)) as Result;
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.currentState === "closed") return;
    this.setState("closing");
    this.closePromise = this.finishClose();
    return this.closePromise;
  }

  private async finishClose(): Promise<void> {
    let closeError: unknown;
    try {
      if (this.transport.state === "connected") {
        await this.exchange(
          {
            version: 1,
            type: "close-session",
            id: this.nextRequestId(),
            sessionId: this.sessionId,
          },
          { allowClosing: true },
        );
      }
    } catch (cause) {
      closeError = cause;
    } finally {
      this.failPending(
        new PocketDBClientError(
          "connection-closed",
          "The PocketDB connection was closed.",
          "unknown",
        ),
      );
      if (this.transport.state === "connected") {
        try {
          await this.transport.send(
            new TextEncoder().encode(
              encodeEnvelope({
                version: 1,
                type: "disconnect",
                reason: "client closed",
              }),
            ),
          );
        } catch {
          // Closing the transport is the final cleanup boundary.
        }
        await this.transport.disconnect("client closed");
      }
      this.messageUnsubscribe();
      this.stateUnsubscribe();
      this.setState("closed");
    }
    if (closeError) throw closeError;
  }

  private async runOperation(
    operation: string,
    payload: ProtocolValue,
    options: ClientRequestOptions,
  ): Promise<ProtocolValue> {
    if (this.currentState !== "connected") this.throwStateError();
    const response = await this.exchange(
      {
        version: 1,
        type: "request",
        id: this.nextRequestId(),
        sessionId: this.sessionId,
        instanceId: this.invitation.instanceId,
        engineId: this.engineId,
        operation,
        payload,
      },
      options,
    );
    if (response.type !== "response") {
      throw new PocketDBClientError(
        "invalid-response",
        "The host returned an unexpected response envelope.",
        "unknown",
      );
    }
    return response.payload;
  }

  private exchange(
    envelope: CorrelatedEnvelope,
    options: ClientRequestOptions & { readonly allowClosing?: boolean } = {},
  ): Promise<ProtocolEnvelope> {
    if (
      this.currentState !== "connected" &&
      this.currentState !== "connecting" &&
      !(options.allowClosing && this.currentState === "closing")
    ) {
      return Promise.reject(
        this.terminalError ??
          new PocketDBClientError(
            "connection-closed",
            "The PocketDB connection is not open.",
            "not-started",
          ),
      );
    }
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    validateTimeout("timeoutMs", timeoutMs);
    if (options.signal?.aborted) {
      return Promise.reject(
        new PocketDBClientError(
          "request-aborted",
          "The request was cancelled before it was sent.",
          "not-started",
        ),
      );
    }
    if (!this.transport.state || this.transport.state !== "connected") {
      return Promise.reject(
        new PocketDBClientError(
          "not-connected",
          "The peer transport is not connected.",
          "not-started",
        ),
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = new TextEncoder().encode(encodeEnvelope(envelope));
    } catch (cause) {
      return Promise.reject(
        new PocketDBClientError(
          "invalid-request",
          "The request could not be encoded for the PocketDB protocol.",
          "not-started",
          false,
          { cause },
        ),
      );
    }

    return new Promise<CorrelatedEnvelope>((resolve, reject) => {
      const pending: PendingResponse = {
        resolve,
        reject,
        signal: options.signal,
      };
      this.pending.set(envelope.id, pending);
      pending.timer = setTimeout(() => {
        this.settle(
          envelope.id,
          new PocketDBClientError(
            "request-timeout",
            `PocketDB request exceeded its ${timeoutMs} ms deadline. The operation outcome is unknown.`,
            "unknown",
          ),
        );
      }, timeoutMs);
      if (options.signal) {
        pending.abortListener = () => {
          this.settle(
            envelope.id,
            new PocketDBClientError(
              "request-aborted",
              "The request was cancelled after it was sent; its outcome is unknown.",
              "unknown",
            ),
          );
        };
        options.signal.addEventListener("abort", pending.abortListener, {
          once: true,
        });
      }
      void this.transport.send(bytes).then(
        () => undefined,
        (cause: unknown) => {
          const transportCode =
            typeof cause === "object" &&
            cause !== null &&
            "code" in cause &&
            typeof cause.code === "string"
              ? cause.code
              : "transport-send-failed";
          const definitelyNotSent = [
            "backpressure",
            "invalid-message",
            "message-too-large",
            "not-connected",
            "unreliable-channel",
          ].includes(transportCode);
          this.settle(
            envelope.id,
            new PocketDBClientError(
              transportCode,
              "The request could not be sent to the host.",
              definitelyNotSent ? "not-started" : "unknown",
              false,
              { cause },
            ),
          );
        },
      );
    });
  }

  private readonly onMessage = (bytes: Uint8Array): void => {
    let envelope: ProtocolEnvelope;
    try {
      envelope = decodeEnvelope(bytes);
    } catch (cause) {
      this.terminalError = new PocketDBClientError(
        "invalid-response",
        "The host sent an invalid protocol envelope.",
        "unknown",
        false,
        { cause },
      );
      this.setState("failed", this.terminalError);
      this.failPending(this.terminalError);
      return;
    }
    if (!("id" in envelope)) return;
    const pending = this.pending.get(envelope.id);
    if (!pending) return;
    if (envelope.type === "error") {
      this.settle(
        envelope.id,
        new PocketDBClientError(
          envelope.error.code,
          envelope.error.message,
          envelope.error.outcome ?? "failed",
          envelope.error.retryable ?? false,
        ),
      );
      return;
    }
    if (envelope.type !== "response" && envelope.type !== "hello-ack") {
      this.settle(
        envelope.id,
        new PocketDBClientError(
          "invalid-response",
          "The host returned an unexpected protocol message.",
          "unknown",
        ),
      );
      return;
    }
    this.settle(envelope.id, undefined, envelope);
  };

  private settle(
    id: string,
    error?: PocketDBClientError,
    envelope?: CorrelatedEnvelope,
  ): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    if (pending.abortListener)
      pending.signal?.removeEventListener("abort", pending.abortListener);
    if (error) pending.reject(error);
    else if (envelope) pending.resolve(envelope);
  }

  private failPending(error: PocketDBClientError): void {
    for (const [id] of this.pending) this.settle(id, error);
  }

  private setState(state: ClientState, error?: PocketDBClientError): void {
    if (this.currentState === state) return;
    this.currentState = state;
    const event: ClientStateEvent = {
      state,
      ...(error ? { error: { code: error.code, message: error.message } } : {}),
    };
    for (const listener of this.stateListeners) listener(event);
  }

  private requireCapability(operation: string): void {
    if (this.currentState !== "connected") this.throwStateError();
    if (
      !this.capabilities.operations.some(
        (candidate) => candidate.toLowerCase() === operation.toLowerCase(),
      )
    ) {
      throw new PocketDBClientError(
        "unsupported-operation",
        `The invited engine does not support '${operation}'.`,
        "not-started",
      );
    }
  }

  private throwStateError(): never {
    throw (
      this.terminalError ??
      new PocketDBClientError(
        "connection-closed",
        "The PocketDB connection is not open.",
        "not-started",
      )
    );
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `${this.sessionId}-${this.requestSequence}`;
  }
}

class SqlClientView implements SqlClient {
  readonly engineId: "postgresql" | "sqlite" | "duckdb";
  constructor(private readonly connection: ConnectedClient) {
    this.engineId = connection.engineId as "postgresql" | "sqlite" | "duckdb";
  }
  get peerId(): string {
    return this.connection.peerId;
  }
  get sessionId(): string {
    return this.connection.sessionId;
  }
  get access(): Invitation["access"] {
    return this.connection.access;
  }
  get capabilities(): ClientEngineCapabilities {
    return this.connection.capabilities;
  }
  get state(): ClientState {
    return this.connection.state;
  }
  onStateChange(listener: ClientStateListener): Unsubscribe {
    return this.connection.onStateChange(listener);
  }
  close(): Promise<void> {
    return this.connection.close();
  }
  query<Result extends ProtocolValue = ProtocolValue>(
    sql: string,
    params: readonly ProtocolValue[] = [],
    options: SqlQueryOptions = {},
  ): Promise<Result> {
    return this.connection.query<Result>(sql, params, options);
  }
  schema(options?: SqlSchemaOptions): Promise<readonly SqlSchemaColumn[]> {
    return this.connection.schema(options);
  }
  describeQuery(
    sql: string,
    options?: ClientRequestOptions,
  ): Promise<SqlQueryDescription> {
    return this.connection.describeQuery(sql, options);
  }
}

class KeyValueClientView implements KeyValueClient {
  readonly engineId = "kv" as const;
  readonly kv: KeyValueCommands;
  constructor(private readonly connection: ConnectedClient) {
    this.kv = {
      ping: async (options) =>
        this.connection.kvCommand<string>("PING", [], options),
      get: async (key, options) => {
        const value = await this.connection.kvCommand<ProtocolValue>(
          "GET",
          [key],
          options,
        );
        if (value === null) return null;
        if (!(value instanceof Uint8Array)) {
          throw new PocketDBClientError(
            "invalid-response",
            "The key-value engine returned a value that is not binary data.",
            "unknown",
          );
        }
        return value;
      },
      set: async (key, value, options) => {
        const result = await this.connection.kvCommand<ProtocolValue>(
          "SET",
          [key, value],
          options,
        );
        if (result !== "OK") {
          throw new PocketDBClientError(
            "invalid-response",
            "The key-value engine returned an unexpected SET result.",
            "unknown",
          );
        }
        return "OK";
      },
      delete: async (keys, options) => {
        const result = await this.connection.kvCommand<ProtocolValue>(
          "DEL",
          keys,
          options,
        );
        if (typeof result !== "number") {
          throw new PocketDBClientError(
            "invalid-response",
            "The key-value engine returned an unexpected DEL result.",
            "unknown",
          );
        }
        return result;
      },
    };
  }
  get peerId(): string {
    return this.connection.peerId;
  }
  get sessionId(): string {
    return this.connection.sessionId;
  }
  get access(): Invitation["access"] {
    return this.connection.access;
  }
  get capabilities(): ClientEngineCapabilities {
    return this.connection.capabilities;
  }
  get state(): ClientState {
    return this.connection.state;
  }
  onStateChange(listener: ClientStateListener): Unsubscribe {
    return this.connection.onStateChange(listener);
  }
  close(): Promise<void> {
    return this.connection.close();
  }
}

function readEngineCapabilities(
  value: ProtocolValue,
  engineId: Invitation["engineId"],
  access: Invitation["access"],
): ClientEngineCapabilities {
  if (!Array.isArray(value)) throw invalidCapabilities();
  for (const item of value) {
    if (!isRecord(item) || item.id !== engineId || !isRecord(item.capabilities))
      continue;
    try {
      return decodeCapabilityManifest(item.capabilities, {
        engineId,
        access,
      });
    } catch (cause) {
      const code =
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        typeof cause.code === "string"
          ? cause.code
          : "invalid-capabilities";
      throw new PocketDBClientError(
        code,
        cause instanceof Error
          ? cause.message
          : "The host returned malformed engine capabilities.",
        "not-started",
        false,
        { cause },
      );
    }
  }
  throw new PocketDBClientError(
    "engine-unavailable",
    `The host does not advertise the invited '${engineId}' engine.`,
    "not-started",
  );
}

function invalidCapabilities(): PocketDBClientError {
  return new PocketDBClientError(
    "invalid-capabilities",
    "The host returned malformed engine capabilities.",
    "not-started",
  );
}

function isRecord(value: unknown): value is Record<string, ProtocolValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateTimeout(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function resolveConnectRetry(
  options: ConnectRetryOptions = {},
): Required<ConnectRetryOptions> {
  const resolved = {
    maxAttempts: options.maxAttempts ?? DEFAULT_CONNECT_RETRY.maxAttempts,
    initialDelayMs:
      options.initialDelayMs ?? DEFAULT_CONNECT_RETRY.initialDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_CONNECT_RETRY.maxDelayMs,
  };
  if (
    !Number.isSafeInteger(resolved.maxAttempts) ||
    resolved.maxAttempts < 1 ||
    resolved.maxAttempts > 5
  ) {
    throw new RangeError("connectRetry.maxAttempts must be between 1 and 5.");
  }
  validateTimeout("connectRetry.initialDelayMs", resolved.initialDelayMs);
  validateTimeout("connectRetry.maxDelayMs", resolved.maxDelayMs);
  if (resolved.maxDelayMs < resolved.initialDelayMs) {
    throw new RangeError(
      "connectRetry.maxDelayMs must be greater than or equal to initialDelayMs.",
    );
  }
  return resolved;
}

async function connectPeerWithRetries(
  invitation: Invitation,
  connectPeer: ConnectPeer,
  signal: AbortSignal,
  deadlineController: AbortController,
  retry: Required<ConnectRetryOptions>,
): Promise<TransportConnection> {
  let delayMs = retry.initialDelayMs;
  let lastError: unknown;
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    if (signal.aborted) throw connectAbortError(deadlineController);
    const connecting = Promise.resolve().then(() =>
      connectPeer(invitation, { signal }),
    );
    try {
      const transport = await waitForConnection(
        connecting,
        signal,
        deadlineController,
      );
      if (transport.state !== "connected") {
        await transport.disconnect("connection attempt did not stay connected");
        throw new PocketDBClientError(
          "not-connected",
          "The peer connector returned a disconnected transport.",
          "not-started",
          true,
        );
      }
      return transport;
    } catch (error) {
      lastError = error;
      if (
        signal.aborted ||
        attempt >= retry.maxAttempts ||
        !isRetryableConnectError(error)
      ) {
        throw error;
      }
      await waitBeforeRetry(delayMs, signal, deadlineController);
      delayMs = Math.min(delayMs * 2, retry.maxDelayMs);
    }
  }
  throw lastError;
}

function isRetryableConnectError(error: unknown): boolean {
  if (error instanceof PocketDBClientError) return error.retryable;
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return false;
  }
  return [
    "connection-failed",
    "connection-lost",
    "connection-timeout",
    "ice-gathering-timeout",
    "signaling-http-error",
    "signaling-peer-timeout",
    "signaling-unavailable",
  ].includes(error.code);
}

function waitBeforeRetry(
  durationMs: number,
  signal: AbortSignal,
  deadlineController: AbortController,
): Promise<void> {
  if (signal.aborted)
    return Promise.reject(connectAbortError(deadlineController));
  return new Promise((resolve, reject) => {
    const finish = (error?: PocketDBClientError): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = (): void => finish(connectAbortError(deadlineController));
    const timer = setTimeout(() => finish(), durationMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function connectAbortError(
  deadlineController: AbortController,
): PocketDBClientError {
  return new PocketDBClientError(
    deadlineController.signal.aborted ? "connect-timeout" : "connect-aborted",
    deadlineController.signal.aborted
      ? "The PocketDB connection exceeded its deadline."
      : "The PocketDB connection was cancelled.",
    "not-started",
  );
}

function randomId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new PocketDBClientError(
      "secure-random-unavailable",
      "A cryptographically secure random source is required.",
      "not-started",
    );
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  const token = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}-${token}`;
}

function combineAbortSignals(
  first: AbortSignal,
  second?: AbortSignal,
): AbortSignal {
  if (!second) return first;
  if (typeof AbortSignal.any === "function")
    return AbortSignal.any([first, second]);
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => controller.abort(signal.reason);
  if (first.aborted) abort(first);
  else first.addEventListener("abort", () => abort(first), { once: true });
  if (second.aborted) abort(second);
  else second.addEventListener("abort", () => abort(second), { once: true });
  return controller.signal;
}

async function waitForConnection(
  connecting: Promise<TransportConnection>,
  signal: AbortSignal,
  deadlineController: AbortController,
): Promise<TransportConnection> {
  if (signal.aborted) {
    throw new PocketDBClientError(
      "connect-aborted",
      "The PocketDB connection was cancelled.",
      "not-started",
    );
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(
        new PocketDBClientError(
          deadlineController.signal.aborted
            ? "connect-timeout"
            : "connect-aborted",
          deadlineController.signal.aborted
            ? "The peer connection exceeded its deadline."
            : "The PocketDB connection was cancelled.",
          "not-started",
        ),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    connecting.then(
      (connection) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          void connection.disconnect("connection attempt expired");
          abort();
          return;
        }
        resolve(connection);
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(cause);
      },
    );
  });
}
