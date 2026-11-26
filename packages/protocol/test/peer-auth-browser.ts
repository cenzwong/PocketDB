import {
  createInvitation,
  createPeerIdentity,
  decodeEnvelope,
  encodeEnvelope,
  exportPeerPublicKey,
  getPeerIdentityId,
  importPeerPublicKey,
  PeerSessionAuthority,
  readPeerBinding,
  respondToPeerChallenge,
  PROTOCOL_VERSION,
  type PeerBinding,
  type ProtocolEnvelope,
} from "../src";

declare global {
  interface Window {
    __peerAuthResult?: {
      ok: boolean;
      browser: string;
      connectedFingerprints?: boolean;
      unauthenticatedHandlerBlocked?: boolean;
      validJoin?: boolean;
      mismatchedPeerBlocked?: boolean;
      revokedActiveSessionBlocked?: boolean;
      redactedRejections?: boolean;
      error?: string;
    };
  }
}

async function run(): Promise<void> {
  const clientPeer = new RTCPeerConnection({ iceServers: [] });
  const hostPeer = new RTCPeerConnection({ iceServers: [] });
  const clientChannel = clientPeer.createDataChannel("pocketdb-auth", {
    ordered: true,
  });
  let hostChannel: RTCDataChannel | undefined;
  let hostBinding: PeerBinding | undefined;
  let clientBinding: PeerBinding | undefined;
  let hostToken: object | undefined;
  let authority: PeerSessionAuthority<object> | undefined;
  let invitation: ReturnType<typeof createInvitation> | undefined;
  let clientIdentity: CryptoKeyPair | undefined;
  let stage = "peer connection setup";
  let authenticationError: string | undefined;
  let authenticatedSessionId: string | undefined;
  let handlerCalls = 0;
  const rejectionLogs: { event: string; code: string }[] = [];
  const pendingResponses = new Map<
    string,
    {
      resolve: (value: ProtocolEnvelope) => void;
      reject: (error: Error) => void;
    }
  >();

  const clientMessage = (message: ProtocolEnvelope): void => {
    if (clientChannel.readyState !== "open")
      throw new Error("Client authentication channel is closed.");
    clientChannel.send(encodeEnvelope(message));
  };
  const hostMessage = (message: ProtocolEnvelope): void => {
    if (hostChannel?.readyState !== "open")
      throw new Error("Host authentication channel is closed.");
    hostChannel.send(encodeEnvelope(message));
  };
  const waitForResponse = (id: string): Promise<ProtocolEnvelope> =>
    new Promise((resolve, reject) =>
      pendingResponses.set(id, { resolve, reject }),
    );
  const makeError = (
    id: string,
    sessionId: string | undefined,
    code: string,
    message: string,
  ): ProtocolEnvelope => ({
    version: PROTOCOL_VERSION,
    type: "error",
    id,
    ...(sessionId ? { sessionId } : {}),
    error: { code, message },
  });

  try {
    const hostIdentity = await createPeerIdentity();
    clientIdentity = await createPeerIdentity();
    invitation = createInvitation({
      roomId: "browser-auth-room",
      instanceId: "browser-auth-instance",
      engineId: "kv",
      expectedHostId: await getPeerIdentityId(hostIdentity.publicKey),
      access: "read-write",
      expiresAt: Date.now() + 60_000,
    });
    authority = await PeerSessionAuthority.create(invitation, hostIdentity, {
      onRejected: (event) => rejectionLogs.push(event),
    });
    hostToken = {};

    hostPeer.addEventListener(
      "datachannel",
      (event) => {
        hostChannel = event.channel;
        hostChannel.addEventListener("message", (messageEvent) => {
          void handleHostMessage(String(messageEvent.data));
        });
      },
      { once: true },
    );
    clientChannel.addEventListener("message", (event) => {
      void handleClientMessage(String(event.data));
    });

    const offer = await clientPeer.createOffer();
    await clientPeer.setLocalDescription(offer);
    await waitForIce(clientPeer);
    if (!clientPeer.localDescription)
      throw new Error("Client did not produce a local offer.");
    await hostPeer.setRemoteDescription(clientPeer.localDescription);
    const answer = await hostPeer.createAnswer();
    await hostPeer.setLocalDescription(answer);
    await waitForIce(hostPeer);
    if (!hostPeer.localDescription)
      throw new Error("Host did not produce a local answer.");
    await clientPeer.setRemoteDescription(hostPeer.localDescription);
    stage = "data-channel negotiation";
    await Promise.all([
      waitForChannelOpen(clientChannel),
      waitFor(() => Boolean(hostChannel)),
    ]);
    if (!hostChannel) throw new Error("Host did not receive a data channel.");
    await waitForChannelOpen(hostChannel);

    const [clientPeerBinding, hostPeerBinding] = await Promise.all([
      readPeerBinding(clientPeer, "client"),
      readPeerBinding(hostPeer, "host"),
    ]);
    if (JSON.stringify(clientPeerBinding) !== JSON.stringify(hostPeerBinding)) {
      throw new Error(
        "Connected DTLS fingerprints did not agree across peers.",
      );
    }
    clientBinding = clientPeerBinding;
    hostBinding = hostPeerBinding;

    stage = "unauthenticated request";
    const unauthenticated = waitForResponse("unauthenticated");
    stage = "authentication handshake";
    clientMessage({
      version: PROTOCOL_VERSION,
      type: "request",
      id: "unauthenticated",
      sessionId: "not-a-session",
      instanceId: invitation.instanceId,
      engineId: invitation.engineId,
      operation: "PING",
      payload: [],
    });
    const unauthenticatedResult = await unauthenticated;
    const unauthenticatedHandlerBlocked =
      unauthenticatedResult.type === "error" && handlerCalls === 0;

    clientMessage({
      version: PROTOCOL_VERSION,
      type: "authenticate",
      id: "authenticate-1",
      invitation: { ...invitation },
      peerIdentity: await exportPeerPublicKey(clientIdentity.publicKey),
    });
    stage = "authenticated session";
    await waitFor(() => Boolean(authenticatedSessionId || authenticationError));
    if (authenticationError) throw new Error(authenticationError);
    const validJoin = Boolean(authenticatedSessionId);
    const sessionId = authenticatedSessionId;
    if (!sessionId) throw new Error("The host did not create a session.");

    const validRequest = waitForResponse("valid-request");
    clientMessage({
      version: PROTOCOL_VERSION,
      type: "request",
      id: "valid-request",
      sessionId,
      instanceId: invitation.instanceId,
      engineId: invitation.engineId,
      operation: "PING",
      payload: [],
    });
    const validResponse = await validRequest;
    if (validResponse.type !== "response" || handlerCalls !== 1)
      throw new Error("Authenticated handler did not run exactly once.");

    const mismatchedPeer = waitForResponse("mismatched-peer");
    hostBinding = {
      ...hostBinding,
      clientFingerprint: "sha-256 00:00:00:00",
    };
    clientMessage({
      version: PROTOCOL_VERSION,
      type: "request",
      id: "mismatched-peer",
      sessionId,
      instanceId: invitation.instanceId,
      engineId: invitation.engineId,
      operation: "PING",
      payload: [],
    });
    const mismatchResponse = await mismatchedPeer;
    const mismatchedPeerBlocked =
      mismatchResponse.type === "error" && handlerCalls === 1;
    hostBinding = hostPeerBinding;

    const revokedSessions = authority.revoke();
    const revokedActiveSessionBlockedResult = waitForResponse("after-revoke");
    clientMessage({
      version: PROTOCOL_VERSION,
      type: "request",
      id: "after-revoke",
      sessionId,
      instanceId: invitation.instanceId,
      engineId: invitation.engineId,
      operation: "PING",
      payload: [],
    });
    const revokedResponse = await revokedActiveSessionBlockedResult;
    const revokedActiveSessionBlocked =
      revokedSessions.length === 1 &&
      revokedResponse.type === "error" &&
      handlerCalls === 1;
    const redactedRejections = !JSON.stringify(rejectionLogs).includes(
      invitation.capability,
    );
    window.__peerAuthResult = {
      ok:
        unauthenticatedHandlerBlocked &&
        validJoin &&
        mismatchedPeerBlocked &&
        revokedActiveSessionBlocked &&
        redactedRejections,
      browser: navigator.userAgent,
      connectedFingerprints:
        JSON.stringify(clientPeerBinding) === JSON.stringify(hostPeerBinding),
      unauthenticatedHandlerBlocked,
      validJoin,
      mismatchedPeerBlocked,
      revokedActiveSessionBlocked,
      redactedRejections,
    };
  } catch (error) {
    window.__peerAuthResult = {
      ok: false,
      browser: navigator.userAgent,
      error: `${stage}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    };
  } finally {
    clientPeer.close();
    hostPeer.close();
  }

  async function handleHostMessage(encoded: string): Promise<void> {
    const message = decodeEnvelope(encoded);
    if (!authority || !hostToken || !hostBinding || !invitation) return;
    if (message.type === "authenticate") {
      try {
        if (JSON.stringify(message.invitation) !== JSON.stringify(invitation)) {
          hostMessage(
            makeError(
              message.id,
              undefined,
              "authentication-failed",
              "Invitation is not valid for this host.",
            ),
          );
          return;
        }
        if (!message.peerIdentity)
          throw new Error("Client identity is required.");
        const clientKey = await importPeerPublicKey(message.peerIdentity);
        const challenge = await authority.challenge(
          hostToken,
          hostBinding,
          clientKey,
        );
        hostMessage({
          version: PROTOCOL_VERSION,
          type: "authentication-challenge",
          id: message.id,
          ...challenge,
        });
      } catch (error) {
        hostMessage(
          makeError(
            message.id,
            undefined,
            errorCode(error),
            safeMessage(error),
          ),
        );
      }
      return;
    }
    if (message.type === "authentication-proof") {
      try {
        const session = await authority.authenticate(
          hostToken,
          hostBinding,
          message,
        );
        authenticatedSessionId = session.sessionId;
        hostMessage({
          version: PROTOCOL_VERSION,
          type: "authenticated",
          id: message.id,
          sessionId: session.sessionId,
          instanceId: session.instanceId,
          engineId: session.engineId,
        });
      } catch (error) {
        hostMessage(
          makeError(
            message.id,
            undefined,
            errorCode(error),
            safeMessage(error),
          ),
        );
      }
      return;
    }
    if (message.type === "request") {
      try {
        const value = await authority.runAuthorized(
          hostToken,
          message.sessionId,
          hostBinding,
          () => {
            handlerCalls += 1;
            return "PONG";
          },
        );
        hostMessage({
          version: PROTOCOL_VERSION,
          type: "response",
          id: message.id,
          sessionId: message.sessionId,
          payload: value,
        });
      } catch (error) {
        hostMessage(
          makeError(
            message.id,
            message.sessionId,
            errorCode(error),
            safeMessage(error),
          ),
        );
      }
    }
  }

  async function handleClientMessage(encoded: string): Promise<void> {
    const message = decodeEnvelope(encoded);
    if (message.type === "authentication-challenge") {
      if (!invitation || !clientIdentity || !clientBinding) return;
      try {
        const proof = await respondToPeerChallenge(
          invitation,
          clientIdentity,
          clientBinding,
          message,
        );
        clientMessage({
          version: PROTOCOL_VERSION,
          type: "authentication-proof",
          id: "proof-1",
          ...proof,
        });
      } catch (error) {
        pendingResponses.get(message.id)?.reject(new Error(safeMessage(error)));
      }
      return;
    }
    if (message.type === "authenticated") {
      authenticatedSessionId = message.sessionId;
      return;
    }
    if (message.type === "response" || message.type === "error") {
      const pending = pendingResponses.get(message.id);
      if (pending) {
        pendingResponses.delete(message.id);
        pending.resolve(message);
      }
      if (
        message.type === "error" &&
        (message.id === "authenticate-1" || message.id === "proof-1")
      )
        authenticationError = `${message.error.code}: ${message.error.message}`;
    }
  }
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "authentication-failed";
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Peer authentication failed.";
}

function waitForIce(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const check = (): void => {
      if (peer.iceGatheringState !== "complete") return;
      peer.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", check);
    check();
  });
}

function waitForChannelOpen(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const close = (): void =>
      reject(new Error("Data channel closed before open."));
    channel.addEventListener("open", () => resolve(), { once: true });
    channel.addEventListener("close", close, { once: true });
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the peer authentication flow.");
}

void run();
