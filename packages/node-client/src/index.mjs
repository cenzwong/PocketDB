import { randomUUID } from "node:crypto";
import { connect, PocketDBClientError } from "@pocketdb/client";
import {
  createPeerIdentity,
  decodeEnvelope,
  encodeEnvelope,
  exportPeerPublicKey,
  getPeerIdentityId,
  readPeerBinding,
  respondToPeerChallenge,
} from "@pocketdb/protocol";
import { HttpRoomSignalingAdapter, TransportError } from "@pocketdb/transport";
import { RTCPeerConnection } from "werift";

const DEFAULT_CONNECT_TIMEOUT_MS = 120_000;
const DEFAULT_SIGNAL_TIMEOUT_MS = 120_000;
const DEFAULT_CHANNEL_TIMEOUT_MS = 15_000;
const DEFAULT_AUTH_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_BUFFERED_BYTES = 64 * 1024;
const MAX_PENDING_MESSAGES = 16;

/** Connect to a browser host through the configured PocketDB room signaling service. */
export async function connectNode(
  invitationUri,
  {
    signalingEndpoint,
    signalingTimeoutMs = DEFAULT_SIGNAL_TIMEOUT_MS,
    channelTimeoutMs = DEFAULT_CHANNEL_TIMEOUT_MS,
    authenticationTimeoutMs = DEFAULT_AUTH_TIMEOUT_MS,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    requestTimeoutMs,
    signal,
    iceConfig = {},
  } = {},
) {
  if (typeof signalingEndpoint !== "string" || signalingEndpoint.length === 0) {
    throw new TypeError("signalingEndpoint is required.");
  }
  const signaling = new HttpRoomSignalingAdapter({
    endpoint: signalingEndpoint,
  });
  let peerConnection;
  let transport;
  let client;
  try {
    client = await connect(invitationUri, {
      connectTimeoutMs,
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      ...(signal ? { signal } : {}),
      connectPeer: async (invitation, { signal: attemptSignal }) => {
        await closePeer(peerConnection, transport);
        peerConnection = undefined;
        transport = undefined;

        const identity = await createPeerIdentity();
        const peerId = await getPeerIdentityId(identity.publicKey);
        const currentPeer = new RTCPeerConnection({
          iceUseDefaultStunServer: false,
          ...iceConfig,
        });
        peerConnection = currentPeer;
        const channelPromise = waitForDataChannel(
          currentPeer,
          channelTimeoutMs,
          attemptSignal,
        );
        const offer = await signaling.receiveDescription(
          invitation.roomId,
          "offer",
          {
            timeoutMs: signalingTimeoutMs,
            signal: attemptSignal,
          },
        );
        await currentPeer.setRemoteDescription(offer);
        await currentPeer.setLocalDescription(await currentPeer.createAnswer());
        if (!currentPeer.localDescription) {
          throw new PocketDBClientError(
            "node-webrtc-negotiation-failed",
            "Werift did not create a local answer.",
            "not-started",
          );
        }
        await signaling.publishDescription(
          invitation.roomId,
          "answer",
          currentPeer.localDescription,
          attemptSignal,
        );
        const channel = await channelPromise;
        await waitForChannelOpen(
          channel,
          currentPeer,
          channelTimeoutMs,
          attemptSignal,
        );
        const binding = await readPeerBinding(currentPeer, "client");
        transport = new NodeDataChannelConnection(peerId, channel, currentPeer);
        await authenticate(
          transport,
          invitation,
          identity,
          binding,
          authenticationTimeoutMs,
          attemptSignal,
        );
        return transport;
      },
    });
  } catch (error) {
    await closePeer(peerConnection, transport).catch(() => undefined);
    throw error;
  }

  let closePromise;
  return {
    client,
    close() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        try {
          await client.close();
        } finally {
          await closePeer(peerConnection, transport);
        }
      })();
      return closePromise;
    },
  };
}

async function authenticate(
  transport,
  invitation,
  identity,
  binding,
  timeoutMs,
  signal,
) {
  const authenticateId = `authenticate-${randomUUID()}`;
  const proofId = `proof-${randomUUID()}`;
  await send(transport, {
    version: 1,
    type: "authenticate",
    id: authenticateId,
    invitation,
    peerIdentity: await exportPeerPublicKey(identity.publicKey),
  });
  const challenge = await waitForEnvelope(
    transport,
    authenticateId,
    timeoutMs,
    signal,
  );
  if (challenge.type === "error") throw remoteAuthenticationError(challenge);
  if (challenge.type !== "authentication-challenge") {
    throw new PocketDBClientError(
      "authentication-failed",
      "The host returned an unexpected authentication response.",
      "not-started",
    );
  }
  const proof = await respondToPeerChallenge(
    invitation,
    identity,
    binding,
    challenge,
  );
  await send(transport, {
    version: 1,
    type: "authentication-proof",
    id: proofId,
    ...proof,
  });
  const result = await waitForEnvelope(transport, proofId, timeoutMs, signal);
  if (result.type === "error") throw remoteAuthenticationError(result);
  if (
    result.type !== "authenticated" ||
    result.instanceId !== invitation.instanceId ||
    result.engineId !== invitation.engineId
  ) {
    throw new PocketDBClientError(
      "authentication-failed",
      "The host did not confirm the invited database session.",
      "not-started",
    );
  }
}

async function send(transport, envelope) {
  await transport.send(new TextEncoder().encode(encodeEnvelope(envelope)));
}

function waitForEnvelope(transport, id, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribeMessage();
      unsubscribeState();
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result);
    };
    const onAbort = () =>
      finish(new DOMException("Connection aborted.", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          new PocketDBClientError(
            "authentication-timeout",
            "The host did not complete authentication before the deadline.",
            "not-started",
          ),
        ),
      timeoutMs,
    );
    const unsubscribeMessage = transport.onMessage((bytes) => {
      try {
        const envelope = decodeEnvelope(new TextDecoder().decode(bytes));
        if ("id" in envelope && envelope.id === id) finish(undefined, envelope);
      } catch (error) {
        finish(error);
      }
    });
    const unsubscribeState = transport.onStateChange((event) => {
      if (event.state !== "connected") {
        finish(
          new PocketDBClientError(
            "host-disconnected",
            "The browser host disconnected during authentication.",
            "not-started",
          ),
        );
      }
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForDataChannel(peer, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error("Timed out waiting for the host data channel.")),
      timeoutMs,
    );
    const subscription = peer.onDataChannel.subscribe((channel) =>
      finish(undefined, channel),
    );
    const stateSubscription = peer.connectionStateChange.subscribe((state) => {
      if (state === "failed" || state === "closed")
        finish(new Error(`WebRTC connection ${state}.`));
    });
    const onAbort = () =>
      finish(new DOMException("Connection aborted.", "AbortError"));
    const finish = (error, channel) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.unSubscribe();
      stateSubscription.unSubscribe();
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(channel);
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForChannelOpen(channel, peer, timeoutMs, signal) {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () =>
        finish(new Error("Timed out waiting for the data channel to open.")),
      timeoutMs,
    );
    const channelState = channel.stateChange.subscribe((state) => {
      if (state === "open") finish();
      else if (state === "closed")
        finish(new Error("The browser host closed the data channel."));
    });
    const stateSubscription = peer.connectionStateChange.subscribe((state) => {
      if (state === "failed" || state === "closed")
        finish(new Error(`WebRTC connection ${state}.`));
    });
    const onAbort = () =>
      finish(new DOMException("Connection aborted.", "AbortError"));
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channelState.unSubscribe();
      stateSubscription.unSubscribe();
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function remoteAuthenticationError(envelope) {
  return new PocketDBClientError(
    envelope.error.code,
    envelope.error.message,
    "not-started",
  );
}

async function closePeer(peer, transport) {
  await transport?.disconnect("Node client closed").catch(() => undefined);
  if (peer) {
    try {
      await peer.close();
    } catch {
      // Closing an already-failed WebRTC peer is best effort.
    }
  }
}

class NodeDataChannelConnection {
  constructor(peerId, channel, peer) {
    this.peerId = peerId;
    this.channel = channel;
    this.peer = peer;
    this.state = "connected";
    this.messageHandlers = new Set();
    this.stateHandlers = new Set();
    this.pendingBytes = 0;
    this.pendingMessages = 0;
    this.messageSubscription = channel.onMessage.subscribe((message) => {
      const bytes =
        typeof message === "string"
          ? new TextEncoder().encode(message)
          : new Uint8Array(message);
      if (bytes.byteLength > MAX_MESSAGE_BYTES) {
        void this.fail(
          `Host sent a message larger than ${MAX_MESSAGE_BYTES} bytes.`,
        );
        return;
      }
      for (const handler of this.messageHandlers) handler(bytes.slice());
    });
    this.closeSubscription = channel.stateChange.subscribe((state) => {
      if (state === "closed")
        this.transition("disconnected", "data channel closed");
    });
    this.peerSubscription = peer.connectionStateChange.subscribe((state) => {
      if (state === "failed")
        this.transition("failed", "WebRTC connection failed");
      else if (state === "closed" || state === "disconnected") {
        this.transition("disconnected", "WebRTC connection closed");
      }
    });
  }

  maxMessageBytes = MAX_MESSAGE_BYTES;

  async send(message) {
    if (this.state !== "connected" || this.channel.readyState !== "open") {
      throw new TransportError(
        "not-connected",
        "Browser host is disconnected.",
      );
    }
    if (!(message instanceof Uint8Array)) {
      throw new TransportError(
        "invalid-message",
        "Messages must be Uint8Array values.",
      );
    }
    if (message.byteLength > MAX_MESSAGE_BYTES) {
      throw new TransportError(
        "message-too-large",
        "Message exceeds the 16 KiB limit.",
      );
    }
    if (
      this.pendingMessages + 1 > MAX_PENDING_MESSAGES ||
      this.channel.bufferedAmount + this.pendingBytes + message.byteLength >
        MAX_BUFFERED_BYTES
    ) {
      throw new TransportError(
        "backpressure",
        "The bounded Node WebRTC send queue is full.",
      );
    }
    this.pendingMessages += 1;
    this.pendingBytes += message.byteLength;
    try {
      this.channel.send(Buffer.from(message));
    } catch (cause) {
      throw new TransportError(
        "send-failed",
        "Werift rejected the data-channel message.",
        { cause },
      );
    } finally {
      this.pendingMessages -= 1;
      this.pendingBytes -= message.byteLength;
    }
  }

  async disconnect(reason = "local disconnect") {
    if (this.state !== "connected") return;
    this.transition("disconnected", reason);
    this.channel.close();
    this.messageSubscription.unSubscribe();
    this.closeSubscription.unSubscribe();
    this.peerSubscription.unSubscribe();
  }

  onMessage(handler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  async fail(reason) {
    if (this.state !== "connected") return;
    this.transition("failed", reason);
    this.channel.close();
  }

  transition(state, reason) {
    if (this.state !== "connected") return;
    this.state = state;
    for (const handler of this.stateHandlers) handler({ state, reason });
  }
}
