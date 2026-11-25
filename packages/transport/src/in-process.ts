import {
  TransportError,
  type MessageHandler,
  type StateHandler,
  type TransportConnection,
  type TransportPair,
  type TransportState,
  type TransportStateEvent,
  type Unsubscribe,
} from "./contracts";

export interface InProcessTransportOptions {
  readonly leftPeerId?: string;
  readonly rightPeerId?: string;
}

export interface InProcessTransportPair extends TransportPair {
  /** Reject the next send from the named peer with a stable transport error. */
  failNextSend(fromPeerId: string, cause?: Error): void;
}

export function createInProcessTransportPair(
  options: InProcessTransportOptions = {},
): InProcessTransportPair {
  const leftId = options.leftPeerId ?? "in-process-left";
  const rightId = options.rightPeerId ?? "in-process-right";
  if (!leftId || !rightId || leftId === rightId) {
    throw new TypeError("In-process peers must have distinct non-empty IDs.");
  }

  let nextFailure:
    | { readonly peerId: string; readonly cause: Error }
    | undefined;
  const left = new InProcessConnection(rightId, deliverFromLeft);
  const right = new InProcessConnection(leftId, deliverFromRight);
  left.link(right);
  right.link(left);

  return {
    left,
    right,
    failNextSend(fromPeerId, cause = new Error("Injected send failure.")) {
      if (fromPeerId !== leftId && fromPeerId !== rightId) {
        throw new RangeError(`Unknown in-process peer '${fromPeerId}'.`);
      }
      nextFailure = { peerId: fromPeerId, cause };
    },
  };

  function deliverFromLeft(message: Uint8Array): void {
    deliver(leftId, right, message);
  }

  function deliverFromRight(message: Uint8Array): void {
    deliver(rightId, left, message);
  }

  function deliver(
    fromPeerId: string,
    recipient: InProcessConnection,
    message: Uint8Array,
  ): void {
    if (nextFailure?.peerId === fromPeerId) {
      const failure = nextFailure.cause;
      nextFailure = undefined;
      throw new TransportError(
        "send-failed",
        "Injected transport send failure.",
        {
          cause: failure,
        },
      );
    }
    recipient.receive(message);
  }
}

class InProcessConnection implements TransportConnection {
  private currentState: TransportState = "connected";
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly stateHandlers = new Set<StateHandler>();
  private peer?: InProcessConnection;

  constructor(
    readonly peerId: string,
    private readonly deliver: (message: Uint8Array) => void,
  ) {}

  get state(): TransportState {
    return this.currentState;
  }

  link(peer: InProcessConnection): void {
    this.peer = peer;
  }

  async send(message: Uint8Array): Promise<void> {
    if (!(message instanceof Uint8Array)) {
      throw new TransportError(
        "invalid-message",
        "Transport messages must be Uint8Array values.",
      );
    }
    if (this.currentState !== "connected") {
      throw new TransportError(
        "not-connected",
        `Cannot send while transport is ${this.currentState}.`,
      );
    }
    const copy = message.slice();
    this.deliver(copy);
  }

  async disconnect(reason = "local disconnect"): Promise<void> {
    if (this.currentState !== "connected") return;
    this.transition({ state: "disconnected", reason });
    this.peer?.transition({
      state: "disconnected",
      reason: "peer disconnected",
    });
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: StateHandler): Unsubscribe {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  receive(message: Uint8Array): void {
    if (this.currentState !== "connected") return;
    const copy = message.slice();
    for (const handler of this.messageHandlers) handler(copy.slice());
  }

  transition(event: TransportStateEvent): void {
    if (this.currentState !== "connected") return;
    this.currentState = event.state;
    for (const handler of this.stateHandlers) handler(event);
    this.messageHandlers.clear();
    this.stateHandlers.clear();
  }
}
