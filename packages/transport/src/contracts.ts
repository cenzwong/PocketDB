export type TransportState = "connected" | "disconnected" | "failed";

export interface TransportStateEvent {
  readonly state: TransportState;
  readonly reason?: string;
}

export type Unsubscribe = () => void;
export type MessageHandler = (message: Uint8Array) => void;
export type StateHandler = (event: TransportStateEvent) => void;

export interface TransportConnection {
  readonly peerId: string;
  readonly state: TransportState;
  readonly maxMessageBytes?: number;
  send(message: Uint8Array): Promise<void>;
  disconnect(reason?: string): Promise<void>;
  onMessage(handler: MessageHandler): Unsubscribe;
  onStateChange(handler: StateHandler): Unsubscribe;
}

export interface TransportPair {
  readonly left: TransportConnection;
  readonly right: TransportConnection;
}

export interface TransportAdapter<TConfig = unknown> {
  readonly id: string;
  connect(config: TConfig): Promise<TransportConnection>;
}

export type TransportErrorCode =
  | "backpressure"
  | "connection-failed"
  | "connection-timeout"
  | "invalid-message"
  | "message-too-large"
  | "not-connected"
  | "unreliable-channel"
  | "send-failed";

export class TransportError extends Error {
  constructor(
    readonly code: TransportErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TransportError";
  }
}
