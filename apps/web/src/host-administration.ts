import {
  createBrowserInvitationLink,
  createInvitation,
  createPeerIdentity,
  decodeEnvelope,
  encodeEnvelope,
  importPeerPublicKey,
  getPeerIdentityId,
  PeerSessionAuthority,
  readPeerBinding,
  type Invitation,
  type InvitationAccess,
  type PeerBinding,
  type ProtocolEnvelope,
} from "@pocketdb/protocol";
import {
  RemoteSessionHost,
  type RemoteRequestMetric,
} from "@pocketdb/remote-access";
import type { DatabaseRuntime } from "@pocketdb/runtime";
import {
  HttpRoomSignalingAdapter,
  WebRTCDiscoveryAdapter,
  type DiscoveredPeer,
  type SignalingAdapter,
} from "@pocketdb/transport";
import type { TransportStateEvent } from "@pocketdb/transport";

export type HostInvitationState =
  | "waiting"
  | "connected"
  | "revoked"
  | "failed";

export interface HostInvitationSummary {
  readonly id: string;
  readonly access: InvitationAccess;
  readonly state: HostInvitationState;
  readonly peer?: HostPeerSummary;
  readonly message?: string;
}

export interface HostPeerSummary {
  readonly id: string;
  readonly invitationId: string;
  readonly clientFingerprint: string;
  readonly access: InvitationAccess;
  readonly connectedAt: number;
  readonly state: "connected" | "disconnected";
}

export interface HostPeerNetworkDiagnostic {
  readonly invitationState: HostInvitationState;
  readonly transportState?: string;
  readonly peerConnectionState?: string;
  readonly iceConnectionState?: string;
  readonly path: "direct" | "relay" | "unknown";
  readonly candidateTypes: readonly string[];
  readonly iceErrorCodes: readonly number[];
  readonly currentRoundTripTimeMs?: number;
  readonly dataChannelBytesSent?: number;
  readonly dataChannelBytesReceived?: number;
  readonly dataChannelBufferedBytes?: number;
  readonly detailsAvailable: boolean;
}

export interface CreateHostInvitationResult {
  readonly id: string;
  readonly link: string;
  readonly warning?: string;
}

export interface HostAdministrationOptions {
  readonly signalingFactory?: (endpoint: string) => SignalingAdapter;
  readonly onChange?: () => void;
  readonly onError?: (message: string) => void;
  readonly onRequestComplete?: (event: RemoteRequestMetric) => void;
  readonly onPeerState?: (event: TransportStateEvent) => void;
}

interface ManagedInvitation {
  readonly invitation: Invitation;
  readonly authority: PeerSessionAuthority<DiscoveredPeer["transport"]>;
  readonly link: string;
  readonly controller: AbortController;
  state: HostInvitationState;
  message?: string;
  peer?: ManagedPeer;
  pending?: DiscoveredPeer;
  pendingUnsubscribe?: () => void;
}

interface ManagedPeer {
  readonly id: string;
  readonly invitationId: string;
  readonly discovered: DiscoveredPeer;
  readonly binding: PeerBinding;
  readonly sessionId: string;
  summary: HostPeerSummary;
  remoteHost?: RemoteSessionHost;
  closed: boolean;
}

/** Owns short-lived invitations and authenticated peers for one running host instance. */
export class HostAdministration {
  private readonly invitations = new Map<string, ManagedInvitation>();
  private readonly hostIdentityPromise = createPeerIdentity();
  private readonly signalingFactory: (endpoint: string) => SignalingAdapter;
  private disposed = false;

  constructor(
    private readonly runtime: DatabaseRuntime,
    private readonly instanceId: string,
    private readonly engineId: "kv" | "postgresql" | "sqlite" | "duckdb",
    private readonly options: HostAdministrationOptions = {},
  ) {
    this.signalingFactory =
      options.signalingFactory ??
      ((endpoint) => new HttpRoomSignalingAdapter({ endpoint }));
  }

  async createInvitation(
    access: InvitationAccess,
    endpoint: string,
    baseUrl: string,
  ): Promise<CreateHostInvitationResult> {
    if (this.disposed) throw new Error("This database host has stopped.");
    const hostIdentity = await this.hostIdentityPromise;
    const expectedHostId = await getPeerIdentityId(hostIdentity.publicKey);
    const invitation = createInvitation({
      roomId: crypto.randomUUID(),
      instanceId: this.instanceId,
      engineId: this.engineId,
      expectedHostId,
      access,
    });
    const browserLink = createBrowserInvitationLink(baseUrl, invitation);
    const authority = await PeerSessionAuthority.create<
      DiscoveredPeer["transport"]
    >(invitation, hostIdentity, { maxActiveSessions: 1 });
    const record: ManagedInvitation = {
      invitation,
      authority,
      link: browserLink.url,
      controller: new AbortController(),
      state: "waiting",
    };
    this.invitations.set(invitation.roomId, record);
    this.notify();
    void this.acceptOnePeer(record, endpoint);
    return {
      id: invitation.roomId,
      link: browserLink.url,
      ...(browserLink.warning ? { warning: browserLink.warning } : {}),
    };
  }

  listInvitations(): readonly HostInvitationSummary[] {
    return [...this.invitations.values()].map((record) => ({
      id: record.invitation.roomId,
      access: record.invitation.access,
      state: record.state,
      ...(record.peer ? { peer: record.peer.summary } : {}),
      ...(record.message ? { message: record.message } : {}),
    }));
  }

  async networkDiagnostics(): Promise<readonly HostPeerNetworkDiagnostic[]> {
    const peers = [...this.invitations.values()];
    return Promise.all(
      peers.map(async (record): Promise<HostPeerNetworkDiagnostic> => {
        const peer = record.peer;
        if (!peer || peer.closed) {
          return {
            invitationState: record.state,
            path: "unknown",
            candidateTypes: [],
            iceErrorCodes: [],
            detailsAvailable: false,
          };
        }
        try {
          const details = await peer.discovered.diagnostics();
          const { localCandidateType, remoteCandidateType } =
            details.selectedPair ?? {};
          const path =
            localCandidateType === "relay" || remoteCandidateType === "relay"
              ? "relay"
              : localCandidateType && remoteCandidateType
                ? "direct"
                : "unknown";
          return {
            invitationState: record.state,
            transportState: peer.discovered.transport.state,
            peerConnectionState: details.connectionState,
            iceConnectionState: details.iceConnectionState,
            path,
            candidateTypes: [...details.candidateTypes],
            iceErrorCodes: [...details.iceErrorCodes],
            ...(details.currentRoundTripTimeMs === undefined
              ? {}
              : { currentRoundTripTimeMs: details.currentRoundTripTimeMs }),
            ...(details.dataChannelBytesSent === undefined
              ? {}
              : { dataChannelBytesSent: details.dataChannelBytesSent }),
            ...(details.dataChannelBytesReceived === undefined
              ? {}
              : { dataChannelBytesReceived: details.dataChannelBytesReceived }),
            ...(details.dataChannelBufferedBytes === undefined
              ? {}
              : { dataChannelBufferedBytes: details.dataChannelBufferedBytes }),
            detailsAvailable: true,
          };
        } catch {
          return {
            invitationState: record.state,
            transportState: peer.discovered.transport.state,
            path: "unknown",
            candidateTypes: [],
            iceErrorCodes: [],
            detailsAvailable: false,
          };
        }
      }),
    );
  }

  getInvitationLink(id: string): string | undefined {
    const record = this.invitations.get(id);
    return record && record.state !== "revoked" ? record.link : undefined;
  }

  async revokeInvitation(id: string): Promise<void> {
    const record = this.invitations.get(id);
    if (!record || record.state === "revoked") return;
    record.state = "revoked";
    record.controller.abort();
    record.authority.revoke();
    record.pendingUnsubscribe?.();
    record.pendingUnsubscribe = undefined;
    const pending = record.pending;
    record.pending = undefined;
    if (pending) await pending.close().catch(() => undefined);
    if (record.peer) await this.closePeer(record.peer);
    this.notify();
  }

  async disconnectPeer(id: string): Promise<void> {
    for (const record of this.invitations.values()) {
      if (record.peer?.id === id) {
        await this.revokeInvitation(record.invitation.roomId);
        return;
      }
    }
  }

  async close(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all(
      [...this.invitations.keys()].map((id) => this.revokeInvitation(id)),
    );
  }

  private async acceptOnePeer(
    record: ManagedInvitation,
    endpoint: string,
  ): Promise<void> {
    let discovered: DiscoveredPeer | undefined;
    try {
      const signaling = this.signalingFactory(endpoint);
      discovered = await new WebRTCDiscoveryAdapter(signaling).connect({
        roomId: record.invitation.roomId,
        peerId: `host:${record.invitation.roomId}`,
        role: "offerer",
        signalingTimeoutMs: 120_000,
        signal: record.controller.signal,
      });
      if (record.controller.signal.aborted || this.disposed) {
        await discovered.close();
        return;
      }
      record.pending = discovered;
      const connectedPeer = discovered;
      const binding = await readPeerBinding(
        connectedPeer.peerConnection,
        "host",
      );
      if (record.controller.signal.aborted || this.disposed) return;
      const unsubscribe = connectedPeer.transport.onMessage((bytes) => {
        void this.handleAuthenticationMessage(
          bytes,
          record,
          connectedPeer,
          binding,
          unsubscribe,
        );
      });
      record.pendingUnsubscribe = unsubscribe;
      connectedPeer.transport.onStateChange((event) => {
        this.options.onPeerState?.(event);
        if (record.peer) {
          void this.revokeInvitation(record.invitation.roomId);
        }
      });
    } catch (error) {
      if (record.controller.signal.aborted || record.state === "revoked")
        return;
      record.state = "failed";
      record.message = safeError(error);
      this.options.onError?.(record.message);
      record.pendingUnsubscribe?.();
      record.pendingUnsubscribe = undefined;
      record.pending = undefined;
      if (discovered) await discovered.close().catch(() => undefined);
      this.notify();
    }
  }

  private async handleAuthenticationMessage(
    bytes: Uint8Array,
    record: ManagedInvitation,
    discovered: DiscoveredPeer,
    binding: PeerBinding,
    unsubscribe: () => void,
  ): Promise<void> {
    if (record.state === "revoked" || record.peer) return;
    let responseId = "host-auth";
    try {
      const envelope = decodeEnvelope(bytes);
      if ("id" in envelope) responseId = envelope.id;
      if (envelope.type === "authenticate") {
        if (!sameInvitation(envelope.invitation, record.invitation)) {
          await sendError(discovered, envelope.id, "authentication-failed");
          await this.revokeInvitation(record.invitation.roomId);
          return;
        }
        const clientKey = await importPeerPublicKey(envelope.peerIdentity);
        const challenge = await record.authority.challenge(
          discovered.transport,
          binding,
          clientKey,
        );
        await sendEnvelope(discovered, {
          version: 1,
          type: "authentication-challenge",
          id: envelope.id,
          ...challenge,
        });
        return;
      }
      if (envelope.type !== "authentication-proof") {
        await sendError(discovered, "host-auth", "authentication-failed");
        await discovered.transport.disconnect(
          "unexpected authentication message",
        );
        return;
      }
      const session = await record.authority.authenticate(
        discovered.transport,
        binding,
        envelope,
      );
      if (record.controller.signal.aborted || this.disposed) return;
      unsubscribe();
      record.pendingUnsubscribe = undefined;
      record.pending = undefined;
      const summary: HostPeerSummary = {
        id: session.sessionId,
        invitationId: record.invitation.roomId,
        clientFingerprint: session.clientId,
        access: session.access,
        connectedAt: Date.now(),
        state: "connected",
      };
      const peer: ManagedPeer = {
        id: session.sessionId,
        invitationId: record.invitation.roomId,
        discovered,
        binding,
        sessionId: session.sessionId,
        summary,
        closed: false,
      };
      peer.remoteHost = new RemoteSessionHost(
        this.runtime,
        discovered.transport,
        {
          authorize: () =>
            record.authority.authorize(
              discovered.transport,
              session.sessionId,
              binding,
            ),
        },
        { onRequestComplete: this.options.onRequestComplete },
      );
      record.peer = peer;
      record.state = "connected";
      this.notify();
      await sendEnvelope(discovered, {
        version: 1,
        type: "authenticated",
        id: envelope.id,
        sessionId: session.sessionId,
        instanceId: session.instanceId,
        engineId: session.engineId,
      });
    } catch (error) {
      await sendError(discovered, responseId, errorCode(error)).catch(
        () => undefined,
      );
      await this.revokeInvitation(record.invitation.roomId);
    }
  }

  private async closePeer(peer: ManagedPeer): Promise<void> {
    if (peer.closed) return;
    peer.closed = true;
    peer.summary = { ...peer.summary, state: "disconnected" };
    await peer.remoteHost?.close();
    await peer.discovered.close().catch(() => undefined);
    const record = this.invitations.get(peer.invitationId);
    if (record?.peer === peer && record.state !== "revoked") {
      record.state = "waiting";
      record.peer = undefined;
    }
  }

  private notify(): void {
    this.options.onChange?.();
  }
}

async function sendEnvelope(
  peer: DiscoveredPeer,
  envelope: ProtocolEnvelope,
): Promise<void> {
  await peer.transport.send(new TextEncoder().encode(encodeEnvelope(envelope)));
}

async function sendError(
  peer: DiscoveredPeer,
  id: string,
  code: string,
): Promise<void> {
  await sendEnvelope(peer, {
    version: 1,
    type: "error",
    id,
    error: {
      code,
      message: "Peer authentication failed.",
      outcome: "not-started",
    },
  });
}

function sameInvitation(value: unknown, expected: Invitation): boolean {
  if (typeof value !== "object" || value === null) return false;
  const invitation = value as Partial<Invitation>;
  return (
    invitation.version === expected.version &&
    invitation.roomId === expected.roomId &&
    invitation.instanceId === expected.instanceId &&
    invitation.engineId === expected.engineId &&
    invitation.expectedHostId === expected.expectedHostId &&
    invitation.access === expected.access &&
    invitation.capability === expected.capability &&
    invitation.expiresAt === expected.expiresAt
  );
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "authentication-failed";
}

function safeError(error: unknown): string {
  if (error instanceof Error && "code" in error) {
    return "The signaling connection failed. Check the endpoint and network, then create a new invitation.";
  }
  return "The peer could not connect. Check that the invitation is current and the signaling provider is reachable.";
}
