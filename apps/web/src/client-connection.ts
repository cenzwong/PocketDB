import {
  connect,
  PocketDBClientError,
  type PocketDBClient,
} from "@pocketdb/client";
import {
  createPeerIdentity,
  decodeEnvelope,
  encodeEnvelope,
  exportPeerPublicKey,
  getPeerIdentityId,
  readPeerBinding,
  respondToPeerChallenge,
  type ProtocolEnvelope,
} from "@pocketdb/protocol";
import {
  HttpRoomSignalingAdapter,
  WebRTCDiscoveryAdapter,
  type DiscoveredPeer,
  type SignalingAdapter,
} from "@pocketdb/transport";

export interface BrowserClientConnection {
  readonly client: PocketDBClient;
  close(): Promise<void>;
}

export interface BrowserClientConnectionOptions {
  readonly signalingFactory?: (endpoint: string) => SignalingAdapter;
}

/** Connects the browser SDK after authenticating the invitation over WebRTC. */
export async function connectBrowserClient(
  invitationUri: string,
  signalingEndpoint: string,
  options: BrowserClientConnectionOptions = {},
): Promise<BrowserClientConnection> {
  const signalingFactory =
    options.signalingFactory ??
    ((endpoint: string) => new HttpRoomSignalingAdapter({ endpoint }));
  let discovered: DiscoveredPeer | undefined;
  let client: PocketDBClient | undefined;
  try {
    client = await connect(invitationUri, {
      connectPeer: async (invitation, { signal }) => {
        await discovered?.close().catch(() => undefined);
        discovered = undefined;
        const identity = await createPeerIdentity();
        const clientId = await getPeerIdentityId(identity.publicKey);
        const signaling = signalingFactory(signalingEndpoint);
        discovered = await new WebRTCDiscoveryAdapter(signaling).connect({
          roomId: invitation.roomId,
          peerId: clientId,
          role: "answerer",
          signalingTimeoutMs: 120_000,
          signal,
        });
        const binding = await readPeerBinding(
          discovered.peerConnection,
          "client",
        );
        await authenticate(discovered, invitation, identity, binding, signal);
        return discovered.transport;
      },
    });
  } catch (error) {
    await discovered?.close().catch(() => undefined);
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  return {
    client,
    close() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        try {
          await client?.close();
        } finally {
          await discovered?.close();
        }
      })();
      return closePromise;
    },
  };
}

async function authenticate(
  peer: DiscoveredPeer,
  invitation: Parameters<typeof respondToPeerChallenge>[0],
  identity: CryptoKeyPair,
  binding: Awaited<ReturnType<typeof readPeerBinding>>,
  signal: AbortSignal,
): Promise<void> {
  const invitationId = `authenticate-${crypto.randomUUID()}`;
  const proofId = `proof-${crypto.randomUUID()}`;
  const publicKey = await exportPeerPublicKey(identity.publicKey);
  await send(peer, {
    version: 1,
    type: "authenticate",
    id: invitationId,
    invitation: {
      version: invitation.version,
      roomId: invitation.roomId,
      instanceId: invitation.instanceId,
      engineId: invitation.engineId,
      expectedHostId: invitation.expectedHostId,
      access: invitation.access,
      capability: invitation.capability,
      ...(invitation.expiresAt === undefined
        ? {}
        : { expiresAt: invitation.expiresAt }),
    },
    peerIdentity: publicKey,
  });
  const challenge = await waitFor(peer, invitationId, signal);
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
  await send(peer, {
    version: 1,
    type: "authentication-proof",
    id: proofId,
    ...proof,
  });
  const result = await waitFor(peer, proofId, signal);
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

async function send(
  peer: DiscoveredPeer,
  envelope: ProtocolEnvelope,
): Promise<void> {
  await peer.transport.send(new TextEncoder().encode(encodeEnvelope(envelope)));
}

function waitFor(
  peer: DiscoveredPeer,
  id: string,
  signal: AbortSignal,
): Promise<
  Extract<
    ProtocolEnvelope,
    { type: "error" | "authentication-challenge" | "authenticated" }
  >
> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      error: unknown,
      envelope?: Extract<
        ProtocolEnvelope,
        {
          type: "error" | "authentication-challenge" | "authenticated";
        }
      >,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribeMessage();
      unsubscribeState();
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else if (envelope) resolve(envelope);
      else reject(new Error("The authentication response was empty."));
    };
    const onAbort = (): void => {
      finish(
        new PocketDBClientError(
          "connection-aborted",
          "The connection was cancelled before authentication completed.",
          "not-started",
        ),
      );
    };
    const timer = setTimeout(
      () =>
        finish(
          new PocketDBClientError(
            "authentication-timeout",
            "The host did not complete authentication before the deadline.",
            "not-started",
          ),
        ),
      10_000,
    );
    const unsubscribeMessage = peer.transport.onMessage((bytes) => {
      let envelope: ProtocolEnvelope;
      try {
        envelope = decodeEnvelope(bytes);
      } catch {
        finish(
          new PocketDBClientError(
            "authentication-invalid-response",
            "The host returned an invalid authentication message.",
            "not-started",
          ),
        );
        return;
      }
      if (
        "id" in envelope &&
        envelope.id === id &&
        (envelope.type === "error" ||
          envelope.type === "authentication-challenge" ||
          envelope.type === "authenticated")
      ) {
        finish(undefined, envelope);
      }
    });
    const unsubscribeState = peer.transport.onStateChange((event) => {
      if (event.state !== "connected") {
        finish(
          new PocketDBClientError(
            "connection-lost",
            event.reason ?? "The host connection closed during authentication.",
            "not-started",
          ),
        );
      }
    });
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function remoteAuthenticationError(
  envelope: Extract<ProtocolEnvelope, { type: "error" }>,
): PocketDBClientError {
  return new PocketDBClientError(
    envelope.error.code,
    envelope.error.message,
    envelope.error.outcome ?? "not-started",
    envelope.error.retryable ?? false,
  );
}
