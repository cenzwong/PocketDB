import {
  TransportError,
  type StateHandler,
  type TransportAdapter,
  type TransportConnection,
  type TransportState,
  type TransportStateEvent,
  type Unsubscribe,
} from "./contracts";

export const DEFAULT_WEBRTC_MAX_MESSAGE_BYTES = 16 * 1024;
export const DEFAULT_WEBRTC_MAX_BUFFERED_BYTES = 64 * 1024;
export const DEFAULT_WEBRTC_MAX_PENDING_MESSAGES = 16;
export const DEFAULT_WEBRTC_CONNECT_TIMEOUT_MS = 15_000;

export interface WebRTCDataChannelConnectConfig {
  readonly peerId: string;
  readonly peerConnection: RTCPeerConnection;
  readonly channel: RTCDataChannel;
}

export interface WebRTCDataChannelOptions {
  readonly maxMessageBytes?: number;
  readonly maxBufferedBytes?: number;
  readonly maxPendingBytes?: number;
  readonly maxPendingMessages?: number;
  readonly connectTimeoutMs?: number;
}

export class WebRTCDataChannelAdapter
  implements TransportAdapter<WebRTCDataChannelConnectConfig>
{
  readonly id = "webrtc-data-channel";

  constructor(private readonly options: WebRTCDataChannelOptions = {}) {
    validateOptions(options);
  }

  async connect(
    config: WebRTCDataChannelConnectConfig,
  ): Promise<TransportConnection> {
    if (!config.peerId.trim()) {
      throw new TypeError("A non-empty peerId is required.");
    }
    const { channel, peerConnection } = config;
    if (
      !channel.ordered ||
      channel.maxRetransmits !== null ||
      channel.maxPacketLifeTime !== null
    ) {
      throw new TransportError(
        "unreliable-channel",
        "PocketDB requires an ordered, reliable RTCDataChannel.",
      );
    }
    await waitForOpen(
      channel,
      peerConnection,
      this.options.connectTimeoutMs ?? DEFAULT_WEBRTC_CONNECT_TIMEOUT_MS,
    );
    if (peerConnection.connectionState === "failed") {
      throw new TransportError(
        "connection-failed",
        "The WebRTC peer connection failed before the data channel opened.",
      );
    }
    const negotiatedLimit = peerConnection.sctp?.maxMessageSize ?? 65_536;
    const maxMessageBytes = Math.min(
      this.options.maxMessageBytes ?? DEFAULT_WEBRTC_MAX_MESSAGE_BYTES,
      negotiatedLimit,
    );
    const maxBufferedBytes =
      this.options.maxBufferedBytes ?? DEFAULT_WEBRTC_MAX_BUFFERED_BYTES;
    const maxPendingBytes = this.options.maxPendingBytes ?? maxBufferedBytes;
    const maxPendingMessages =
      this.options.maxPendingMessages ?? DEFAULT_WEBRTC_MAX_PENDING_MESSAGES;
    validateResolvedOptions({
      maxMessageBytes,
      maxBufferedBytes,
      maxPendingBytes,
      maxPendingMessages,
    });
    return new WebRTCDataChannelConnection(
      config.peerId,
      channel,
      peerConnection,
      {
        maxMessageBytes,
        maxBufferedBytes,
        maxPendingBytes,
        maxPendingMessages,
      },
    );
  }
}

interface ResolvedOptions {
  readonly maxMessageBytes: number;
  readonly maxBufferedBytes: number;
  readonly maxPendingBytes: number;
  readonly maxPendingMessages: number;
}

class WebRTCDataChannelConnection implements TransportConnection {
  private currentState: TransportState = "connected";
  private readonly messageHandlers = new Set<(message: Uint8Array) => void>();
  private readonly stateHandlers = new Set<StateHandler>();
  private pendingBytes = 0;
  private pendingMessages = 0;
  private sendTail: Promise<void> = Promise.resolve();
  private readonly lowThreshold: number;

  constructor(
    readonly peerId: string,
    private readonly channel: RTCDataChannel,
    private readonly peerConnection: RTCPeerConnection,
    private readonly options: ResolvedOptions,
  ) {
    this.maxMessageBytes = options.maxMessageBytes;
    this.lowThreshold = options.maxBufferedBytes - options.maxMessageBytes;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = this.lowThreshold;
    channel.addEventListener("message", this.handleMessage);
    channel.addEventListener("close", this.handleClose);
    channel.addEventListener("error", this.handleError);
    peerConnection.addEventListener(
      "connectionstatechange",
      this.handlePeerConnectionState,
    );
    if (channel.readyState === "closed") {
      this.transition({
        state: "disconnected",
        reason: "channel already closed",
      });
    }
  }

  readonly maxMessageBytes: number;

  get state(): TransportState {
    return this.currentState;
  }

  send(message: Uint8Array): Promise<void> {
    if (!(message instanceof Uint8Array)) {
      return Promise.reject(
        new TransportError(
          "invalid-message",
          "Transport messages must be Uint8Array values.",
        ),
      );
    }
    if (
      this.currentState !== "connected" ||
      this.channel.readyState !== "open"
    ) {
      return Promise.reject(this.notConnectedError());
    }
    if (message.byteLength > this.maxMessageBytes) {
      return Promise.reject(
        new TransportError(
          "message-too-large",
          `Message is ${message.byteLength} bytes; limit is ${this.maxMessageBytes}.`,
        ),
      );
    }
    if (
      this.pendingMessages + 1 > this.options.maxPendingMessages ||
      this.pendingBytes + message.byteLength > this.options.maxPendingBytes
    ) {
      return Promise.reject(
        new TransportError(
          "backpressure",
          "The bounded outbound queue is full.",
        ),
      );
    }

    const bytes = new Uint8Array(message);
    this.pendingBytes += bytes.byteLength;
    this.pendingMessages++;
    const operation = this.sendTail.then(async () => {
      this.requireConnected();
      await this.waitForBufferSpace(bytes.byteLength);
      this.requireConnected();
      try {
        this.channel.send(bytes.buffer);
      } catch (cause) {
        throw new TransportError(
          "send-failed",
          "The RTCDataChannel rejected the message.",
          { cause },
        );
      }
    });
    this.sendTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.finally(() => {
      this.pendingBytes -= bytes.byteLength;
      this.pendingMessages--;
    });
  }

  async disconnect(reason = "local disconnect"): Promise<void> {
    if (this.currentState !== "connected") return;
    this.transition({ state: "disconnected", reason });
    if (this.channel.readyState !== "closed") this.channel.close();
  }

  onMessage(handler: (message: Uint8Array) => void): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: StateHandler): Unsubscribe {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private readonly handleMessage = (event: MessageEvent): void => {
    if (!(event.data instanceof ArrayBuffer)) {
      this.fail("The peer sent a non-binary data-channel message.");
      return;
    }
    if (event.data.byteLength > this.maxMessageBytes) {
      this.fail(
        `The peer sent ${event.data.byteLength} bytes; limit is ${this.maxMessageBytes}.`,
      );
      return;
    }
    const message = new Uint8Array(event.data);
    for (const handler of this.messageHandlers) handler(message.slice());
  };

  private readonly handleClose = (): void => {
    this.transition({ state: "disconnected", reason: "data channel closed" });
  };

  private readonly handleError = (): void => {
    this.fail("The RTCDataChannel reported an error.");
  };

  private readonly handlePeerConnectionState = (): void => {
    if (this.peerConnection.connectionState === "failed") {
      this.fail("The WebRTC peer connection failed.");
    } else if (this.peerConnection.connectionState === "closed") {
      this.transition({
        state: "disconnected",
        reason: "peer connection closed",
      });
    }
  };

  private async waitForBufferSpace(messageBytes: number): Promise<void> {
    while (
      this.channel.bufferedAmount + messageBytes >
      this.options.maxBufferedBytes
    ) {
      this.requireConnected();
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          this.channel.removeEventListener("bufferedamountlow", onLow);
          this.channel.removeEventListener("close", onClose);
          this.channel.removeEventListener("error", onError);
        };
        const onLow = () => {
          cleanup();
          resolve();
        };
        const onClose = () => {
          cleanup();
          reject(this.notConnectedError());
        };
        const onError = () => {
          cleanup();
          reject(
            new TransportError(
              "connection-failed",
              "The RTCDataChannel failed while waiting for buffer capacity.",
            ),
          );
        };
        this.channel.addEventListener("bufferedamountlow", onLow, {
          once: true,
        });
        this.channel.addEventListener("close", onClose, { once: true });
        this.channel.addEventListener("error", onError, { once: true });
        if (
          this.channel.bufferedAmount + messageBytes <=
          this.options.maxBufferedBytes
        ) {
          cleanup();
          resolve();
        }
      });
    }
  }

  private requireConnected(): void {
    if (
      this.currentState !== "connected" ||
      this.channel.readyState !== "open"
    ) {
      throw this.notConnectedError();
    }
  }

  private notConnectedError(): TransportError {
    return new TransportError(
      "not-connected",
      `Cannot send while the data channel is ${this.channel.readyState}.`,
    );
  }

  private fail(reason: string): void {
    if (this.currentState !== "connected") return;
    this.transition({ state: "failed", reason });
    if (this.channel.readyState !== "closed") this.channel.close();
  }

  private transition(event: TransportStateEvent): void {
    if (this.currentState !== "connected") return;
    this.currentState = event.state;
    this.channel.removeEventListener("message", this.handleMessage);
    this.channel.removeEventListener("close", this.handleClose);
    this.channel.removeEventListener("error", this.handleError);
    this.peerConnection.removeEventListener(
      "connectionstatechange",
      this.handlePeerConnectionState,
    );
    for (const handler of this.stateHandlers) handler(event);
    this.stateHandlers.clear();
    this.messageHandlers.clear();
  }
}

async function waitForOpen(
  channel: RTCDataChannel,
  peerConnection: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  if (channel.readyState === "open") return;
  if (
    channel.readyState === "closed" ||
    peerConnection.connectionState === "closed"
  ) {
    throw new TransportError(
      "not-connected",
      "The RTCDataChannel or peer connection is already closed.",
    );
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("close", onClose);
      channel.removeEventListener("error", onError);
      peerConnection.removeEventListener("connectionstatechange", onPeerState);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(
        new TransportError(
          "connection-failed",
          "The RTCDataChannel closed before opening.",
        ),
      );
    };
    const onError = () => {
      cleanup();
      reject(
        new TransportError(
          "connection-failed",
          "The RTCDataChannel reported an error before opening.",
        ),
      );
    };
    const onPeerState = () => {
      if (
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "closed"
      ) {
        cleanup();
        reject(
          new TransportError(
            "connection-failed",
            `The WebRTC peer connection became ${peerConnection.connectionState}.`,
          ),
        );
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new TransportError(
          "connection-timeout",
          `The RTCDataChannel did not open within ${timeoutMs} ms.`,
        ),
      );
    }, timeoutMs);
    channel.addEventListener("open", onOpen, { once: true });
    channel.addEventListener("close", onClose, { once: true });
    channel.addEventListener("error", onError, { once: true });
    peerConnection.addEventListener("connectionstatechange", onPeerState);
    // readyState may have changed between the initial check and listener setup.
    if (channel.readyState === "open") onOpen();
    else onPeerState();
  });
}

function validateOptions(options: WebRTCDataChannelOptions): void {
  for (const [name, value] of Object.entries(options)) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  if (
    options.maxMessageBytes !== undefined &&
    options.maxBufferedBytes !== undefined &&
    options.maxMessageBytes > options.maxBufferedBytes
  ) {
    throw new RangeError("maxBufferedBytes must fit at least one message.");
  }
  if (
    options.maxMessageBytes !== undefined &&
    options.maxPendingBytes !== undefined &&
    options.maxMessageBytes > options.maxPendingBytes
  ) {
    throw new RangeError("maxPendingBytes must fit at least one message.");
  }
}

function validateResolvedOptions(options: ResolvedOptions): void {
  for (const [name, value] of Object.entries(options)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive finite number.`);
    }
  }
  if (
    options.maxMessageBytes > options.maxBufferedBytes ||
    options.maxMessageBytes > options.maxPendingBytes
  ) {
    throw new RangeError(
      "Buffer and pending limits must each fit one maximum-sized message.",
    );
  }
  if (!Number.isInteger(options.maxPendingMessages)) {
    throw new RangeError("maxPendingMessages must be an integer.");
  }
}
