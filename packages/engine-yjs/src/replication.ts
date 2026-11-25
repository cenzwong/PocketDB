import type { AuthenticatedPeerSession } from "@pocketdb/protocol";
import {
  DEFAULT_WEBRTC_MAX_MESSAGE_BYTES,
  type TransportConnection,
  type Unsubscribe,
} from "@pocketdb/transport";
import { CrdtOperationError, type YjsReplica } from "./replica";

const FRAME_PREFIX = new Uint8Array([0x50, 0x44, 0x01]);
const FRAME_HEADER_BYTES = FRAME_PREFIX.byteLength + 1;
const STATE_VECTOR_FRAME = 1;
const UPDATE_FRAME = 2;
const REMOTE_UPDATE_ORIGIN = Object.freeze({ source: "authenticated-replica" });

export type ReplicaSyncRole = "host" | "client";
export type ReplicaSyncState = "new" | "connected" | "closed" | "failed";
export type ReplicaSyncErrorCode =
  | "unauthorized-peer"
  | "wrong-replica"
  | "invalid-frame"
  | "message-too-large"
  | "update-too-large"
  | "sync-failed";

export interface ReplicaSyncAuthorization {
  readonly replicaId: string;
  readonly localPeerId: string;
  readonly remotePeerId: string;
  readonly role: ReplicaSyncRole;
  /** Revalidates the connection-bound identity, capability, expiry and revocation state. */
  authorize(): AuthenticatedPeerSession;
}

export interface ReplicaSyncSessionOptions {
  readonly onError?: (error: ReplicaSyncError) => void;
}

export class ReplicaSyncError extends Error {
  constructor(
    readonly code: ReplicaSyncErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReplicaSyncError";
  }
}

/** Synchronizes one replica over an already authenticated, invitation-bound transport. */
export class ReplicaSyncSession {
  private currentState: ReplicaSyncState = "new";
  private messageTail: Promise<void> = Promise.resolve();
  private messageUnsubscribe?: Unsubscribe;
  private stateUnsubscribe?: Unsubscribe;
  private updateUnsubscribe?: Unsubscribe;
  private repliedToStateVector = false;
  private readonly maxMessageBytes: number;

  constructor(
    private readonly replica: YjsReplica,
    private readonly connection: TransportConnection,
    private readonly authorization: ReplicaSyncAuthorization,
    private readonly options: ReplicaSyncSessionOptions = {},
  ) {
    this.maxMessageBytes = Math.min(
      connection.maxMessageBytes ?? DEFAULT_WEBRTC_MAX_MESSAGE_BYTES,
      DEFAULT_WEBRTC_MAX_MESSAGE_BYTES,
    );
    if (
      !Number.isSafeInteger(this.maxMessageBytes) ||
      this.maxMessageBytes <= FRAME_HEADER_BYTES
    )
      throw new RangeError(
        "Transport message limit is too small for replication.",
      );
    if (
      !authorization.replicaId.trim() ||
      !authorization.localPeerId.trim() ||
      !authorization.remotePeerId.trim() ||
      authorization.localPeerId === authorization.remotePeerId
    )
      throw new TypeError(
        "Replication requires distinct identified peers and a replica ID.",
      );
  }

  get state(): ReplicaSyncState {
    return this.currentState;
  }

  async start(): Promise<void> {
    if (this.currentState !== "new")
      throw new ReplicaSyncError(
        "sync-failed",
        "Replication session can only be started once.",
      );
    try {
      this.authorizeSession();
      if (this.connection.state !== "connected")
        throw new ReplicaSyncError(
          "sync-failed",
          "Replication transport is not connected.",
        );
      this.currentState = "connected";
      this.messageUnsubscribe = this.connection.onMessage(this.onMessage);
      this.stateUnsubscribe = this.connection.onStateChange(this.onStateChange);
      this.updateUnsubscribe = this.replica.onUpdate(this.onReplicaUpdate);
      await this.sendFrame(
        STATE_VECTOR_FRAME,
        this.replica.encodeStateVector(),
      );
    } catch (cause) {
      const error = this.toReplicaSyncError(cause);
      this.fail(error);
      throw error;
    }
  }

  async close(reason = "replication session closed"): Promise<void> {
    if (this.currentState === "closed" || this.currentState === "failed")
      return;
    this.currentState = "closed";
    this.unsubscribeAll();
    await this.connection.disconnect(reason);
  }

  private readonly onMessage = (message: Uint8Array): void => {
    this.messageTail = this.messageTail
      .then(() => this.handleMessage(message))
      .catch((cause: unknown) => this.fail(this.toReplicaSyncError(cause)));
  };

  private readonly onStateChange = (): void => {
    if (this.currentState !== "connected") return;
    this.currentState = "closed";
    this.unsubscribeAll();
  };

  private readonly onReplicaUpdate = (
    update: Uint8Array,
    origin: unknown,
  ): void => {
    if (this.currentState !== "connected" || origin === REMOTE_UPDATE_ORIGIN)
      return;
    try {
      const session = this.authorizeSession();
      if (
        this.authorization.role === "client" &&
        session.access !== "read-write"
      )
        throw new ReplicaSyncError(
          "unauthorized-peer",
          "This member cannot publish replica updates.",
        );
      void this.sendFrame(UPDATE_FRAME, update).catch((cause: unknown) =>
        this.fail(this.toReplicaSyncError(cause)),
      );
    } catch (cause) {
      this.fail(this.toReplicaSyncError(cause));
    }
  };

  private async handleMessage(message: Uint8Array): Promise<void> {
    if (this.currentState !== "connected") return;
    if (!(message instanceof Uint8Array))
      throw new ReplicaSyncError(
        "invalid-frame",
        "Replication frame must be binary.",
      );
    if (message.byteLength > this.maxMessageBytes) {
      const isUpdate =
        message.byteLength > FRAME_PREFIX.byteLength &&
        FRAME_PREFIX.every((value, index) => message[index] === value) &&
        message[FRAME_PREFIX.byteLength] === UPDATE_FRAME;
      throw new ReplicaSyncError(
        isUpdate ? "update-too-large" : "message-too-large",
        `Replication frame exceeds the ${this.maxMessageBytes}-byte transport limit.`,
      );
    }
    if (
      message.byteLength < FRAME_HEADER_BYTES ||
      !FRAME_PREFIX.every((value, index) => message[index] === value)
    )
      throw new ReplicaSyncError(
        "invalid-frame",
        "Replication frame header is invalid.",
      );

    const session = this.authorizeSession();
    const kind = message[FRAME_PREFIX.byteLength];
    const payload = message.subarray(FRAME_HEADER_BYTES);
    if (kind === STATE_VECTOR_FRAME) {
      if (payload.byteLength === 0)
        throw new ReplicaSyncError("invalid-frame", "State vector is empty.");
      let update: Uint8Array;
      try {
        update = this.replica.encodeUpdate(payload);
      } catch (cause) {
        if (cause instanceof CrdtOperationError) throw cause;
        throw new ReplicaSyncError(
          "invalid-frame",
          "State vector could not be decoded.",
          { cause },
        );
      }
      if (!isEmptyUpdate(update)) {
        if (
          this.authorization.role === "client" &&
          session.access !== "read-write"
        )
          throw new ReplicaSyncError(
            "unauthorized-peer",
            "This member cannot publish replica updates.",
          );
        await this.sendFrame(UPDATE_FRAME, update);
      }
      if (!this.repliedToStateVector) {
        this.repliedToStateVector = true;
        await this.sendFrame(
          STATE_VECTOR_FRAME,
          this.replica.encodeStateVector(),
        );
      }
      return;
    }
    if (kind === UPDATE_FRAME) {
      if (this.authorization.role === "host" && session.access !== "read-write")
        throw new ReplicaSyncError(
          "unauthorized-peer",
          "The authenticated member is not authorized to publish replica updates.",
        );
      if (payload.byteLength === 0)
        throw new ReplicaSyncError("invalid-frame", "CRDT update is empty.");
      if (payload.byteLength > this.maxMessageBytes - FRAME_HEADER_BYTES)
        throw new ReplicaSyncError(
          "update-too-large",
          "CRDT update exceeds the available transport payload bound.",
        );
      this.replica.applyUpdate(payload, REMOTE_UPDATE_ORIGIN);
      return;
    }
    throw new ReplicaSyncError(
      "invalid-frame",
      "Replication frame type is unsupported.",
    );
  }

  private authorizeSession(): AuthenticatedPeerSession {
    let session: AuthenticatedPeerSession;
    try {
      session = this.authorization.authorize();
    } catch (cause) {
      throw new ReplicaSyncError(
        "unauthorized-peer",
        "The authenticated replication membership is no longer valid.",
        { cause },
      );
    }
    const identityMatches =
      this.authorization.role === "host"
        ? session.hostId === this.authorization.localPeerId &&
          session.clientId === this.authorization.remotePeerId
        : session.clientId === this.authorization.localPeerId &&
          session.hostId === this.authorization.remotePeerId;
    if (
      session.engineId !== "crdt" ||
      session.instanceId !== this.authorization.replicaId ||
      !identityMatches ||
      (session.expiresAt !== undefined && session.expiresAt <= Date.now())
    )
      throw new ReplicaSyncError(
        "wrong-replica",
        "Authenticated peer identity or replica scope does not match this session.",
      );
    return session;
  }

  private async sendFrame(kind: number, payload: Uint8Array): Promise<void> {
    if (payload.byteLength === 0)
      throw new ReplicaSyncError(
        "invalid-frame",
        "Replication payload is empty.",
      );
    const framedLength = FRAME_HEADER_BYTES + payload.byteLength;
    if (framedLength > this.maxMessageBytes)
      throw new ReplicaSyncError(
        kind === UPDATE_FRAME ? "update-too-large" : "message-too-large",
        `Replication frame is ${framedLength} bytes; limit is ${this.maxMessageBytes}.`,
      );
    const frame = new Uint8Array(framedLength);
    frame.set(FRAME_PREFIX);
    frame[FRAME_PREFIX.byteLength] = kind;
    frame.set(payload, FRAME_HEADER_BYTES);
    await this.connection.send(frame);
  }

  private toReplicaSyncError(cause: unknown): ReplicaSyncError {
    if (cause instanceof ReplicaSyncError) return cause;
    if (cause instanceof CrdtOperationError) {
      return new ReplicaSyncError(
        cause.code === "update-too-large"
          ? "update-too-large"
          : "invalid-frame",
        cause.message,
        { cause },
      );
    }
    return new ReplicaSyncError(
      "sync-failed",
      "Replica synchronization failed.",
      {
        cause,
      },
    );
  }

  private fail(error: ReplicaSyncError): void {
    if (this.currentState === "closed" || this.currentState === "failed")
      return;
    this.currentState = "failed";
    this.unsubscribeAll();
    this.options.onError?.(error);
    void this.connection.disconnect(`replication ${error.code}`);
  }

  private unsubscribeAll(): void {
    this.messageUnsubscribe?.();
    this.stateUnsubscribe?.();
    this.updateUnsubscribe?.();
    this.messageUnsubscribe = undefined;
    this.stateUnsubscribe = undefined;
    this.updateUnsubscribe = undefined;
  }
}

function isEmptyUpdate(update: Uint8Array): boolean {
  return update.byteLength === 2 && update[0] === 0 && update[1] === 0;
}
