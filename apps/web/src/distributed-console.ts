import {
  PeerSessionAuthority,
  createInvitation,
  createPeerIdentity,
  createPocketDBInvitationUri,
  exportPeerPublicKey,
  getPeerIdentityId,
  importPeerPublicKey,
  parseInvitation,
  readPeerBinding,
  respondToPeerChallenge,
  type AuthenticatedPeerSession,
  type Invitation,
  type PeerAuthenticationChallenge,
  type PeerBinding,
} from "@pocketdb/protocol";
import {
  WebRTCDataChannelAdapter,
  type TransportConnection,
} from "@pocketdb/transport";
import { ReplicaSyncSession, YjsReplica } from "@pocketdb/engine-yjs";

interface HostPeer {
  readonly peer: RTCPeerConnection;
  readonly token: object;
  channel?: RTCDataChannel;
  binding?: PeerBinding;
  transport?: TransportConnection;
  sync?: ReplicaSyncSession;
  session?: AuthenticatedPeerSession;
}

interface ClientPeer {
  readonly peer: RTCPeerConnection;
  readonly identity: CryptoKeyPair;
  readonly invitation: Invitation;
  readonly replica: YjsReplica;
  readonly channel: RTCDataChannel;
  binding?: PeerBinding;
  transport?: TransportConnection;
  sync?: ReplicaSyncSession;
  session?: AuthenticatedPeerSession;
  updateUnsubscribe?: () => void;
}

export function mountDistributedConsole(root: HTMLElement): void {
  root.innerHTML = `
    <div class="distributed-shell">
      <nav class="distributed-nav" aria-label="PocketDB navigation">
        <a class="brand" href="./">PocketDB</a>
        <a href="./">Hosted database console</a>
      </nav>
      <header class="distributed-intro">
        <h1>Distributed replica console</h1>
        <p class="muted">Open this page in two browser tabs or devices. Host a replica, join with its invitation, then exchange the offer and answer manually. Edits stay local while disconnected and merge after reconnect.</p>
      </header>

      <div class="distributed-columns">
        <section class="distributed-card" aria-labelledby="replica-host-heading">
          <h2 id="replica-host-heading">Host a replica</h2>
          <label for="replica-name">Replica name</label>
          <input id="replica-name" value="shared-notes" maxlength="48" />
          <label for="replica-access">Member access</label>
          <select id="replica-access"><option value="read-write">Read and write</option><option value="read-only">Read only</option></select>
          <div class="distributed-actions">
            <button id="replica-host-start" class="primary-button" type="button">Start host</button>
            <button id="replica-host-revoke" class="danger-button" type="button" disabled>Revoke members</button>
          </div>
          <p id="replica-host-status" class="distributed-status" role="status" aria-live="polite" data-state="idle">Host stopped.</p>
          <label for="replica-invitation">Invitation</label>
          <textarea id="replica-invitation" readonly placeholder="Start the host to create a capability link."></textarea>
          <label for="replica-offer-input">Client offer (paste here)</label>
          <textarea id="replica-offer-input" placeholder="Paste the client's JSON offer."></textarea>
          <div class="distributed-actions">
            <button id="replica-host-answer" class="secondary-button" type="button" disabled>Accept offer and create answer</button>
          </div>
          <label for="replica-answer-output">Host answer (send to client)</label>
          <textarea id="replica-answer-output" readonly placeholder="The host answer appears here."></textarea>
          <div class="distributed-membership">
            <strong>Membership</strong>
            <ul id="replica-members"><li>No authenticated members.</li></ul>
          </div>
        </section>

        <section class="distributed-card" aria-labelledby="replica-join-heading">
          <h2 id="replica-join-heading">Join a replica</h2>
          <label for="replica-join-invitation">Host invitation</label>
          <textarea id="replica-join-invitation" placeholder="Paste the pocketdb:// invitation."></textarea>
          <div class="distributed-actions">
            <button id="replica-client-offer" class="primary-button" type="button">Create client offer</button>
            <button id="replica-client-disconnect" class="secondary-button" type="button" disabled>Disconnect</button>
          </div>
          <label for="replica-offer-output">Client offer (send to host)</label>
          <textarea id="replica-offer-output" readonly placeholder="Create an offer to begin or reconnect."></textarea>
          <label for="replica-answer-input-client">Host answer (paste here)</label>
          <textarea id="replica-answer-input-client" placeholder="Paste the host's JSON answer."></textarea>
          <div class="distributed-actions">
            <button id="replica-client-accept-answer" class="secondary-button" type="button" disabled>Accept host answer</button>
          </div>
          <p id="replica-client-status" class="distributed-status" role="status" aria-live="polite" data-state="idle">Client not connected.</p>
          <div class="distributed-membership">
            <strong>Replica membership</strong>
            <ul id="replica-client-members"><li>Join a host to see membership.</li></ul>
          </div>
        </section>
      </div>

      <section class="distributed-card distributed-documents" aria-labelledby="replica-doc-heading">
        <div class="section-heading"><div><h2 id="replica-doc-heading">Shared document</h2><p class="muted">Each side edits its own local Yjs replica. Concurrent values merge according to Yjs map semantics.</p></div></div>
        <form id="replica-write-form" class="distributed-write-form">
          <label>Key<input id="replica-key" maxlength="128" required /></label>
          <label>Value<input id="replica-value" maxlength="2048" required /></label>
          <button id="replica-write" class="primary-button" type="submit" disabled>Write locally</button>
        </form>
        <div class="distributed-columns">
          <div><strong>Host state</strong><pre id="replica-host-document" class="distributed-document">No replica loaded.</pre></div>
          <div><strong>Client state</strong><pre id="replica-client-document" class="distributed-document">No replica loaded.</pre></div>
        </div>
      </section>

      <section class="distributed-card distributed-events-card" aria-labelledby="replica-events-heading">
        <h2 id="replica-events-heading">Connection and sync history</h2>
        <ol id="replica-events" class="distributed-events"><li>Waiting for a host or client action.</li></ol>
      </section>
      <p class="distributed-note">This demonstration exchanges complete SDP offers and answers through copy and paste. Direct peer connectivity depends on the network's ICE path. There is no hosted signaling or TURN service here. Keep the host tab open; page closure ends its active session. Use read-only invitations to prevent client edits and revoke to invalidate every member session for this host.</p>
    </div>`;

  const hostStatus = query<HTMLElement>(root, "#replica-host-status");
  const clientStatus = query<HTMLElement>(root, "#replica-client-status");
  const hostInvitation = query<HTMLTextAreaElement>(
    root,
    "#replica-invitation",
  );
  const offerInput = query<HTMLTextAreaElement>(root, "#replica-offer-input");
  const hostAnswerOutput = query<HTMLTextAreaElement>(
    root,
    "#replica-answer-output",
  );
  const clientInvitationInput = query<HTMLTextAreaElement>(
    root,
    "#replica-join-invitation",
  );
  const offerOutput = query<HTMLTextAreaElement>(root, "#replica-offer-output");
  const clientAnswerInput = query<HTMLTextAreaElement>(
    root,
    "#replica-answer-input-client",
  );
  const members = query<HTMLUListElement>(root, "#replica-members");
  const clientMembers = query<HTMLUListElement>(
    root,
    "#replica-client-members",
  );
  const hostDocument = query<HTMLElement>(root, "#replica-host-document");
  const clientDocument = query<HTMLElement>(root, "#replica-client-document");
  const eventList = query<HTMLOListElement>(root, "#replica-events");
  const writeButton = query<HTMLButtonElement>(root, "#replica-write");
  const startButton = query<HTMLButtonElement>(root, "#replica-host-start");
  const answerButton = query<HTMLButtonElement>(root, "#replica-host-answer");
  const acceptAnswerButton = query<HTMLButtonElement>(
    root,
    "#replica-client-accept-answer",
  );
  const clientOfferButton = query<HTMLButtonElement>(
    root,
    "#replica-client-offer",
  );
  const clientDisconnectButton = query<HTMLButtonElement>(
    root,
    "#replica-client-disconnect",
  );
  const revokeButton = query<HTMLButtonElement>(root, "#replica-host-revoke");

  let hostIdentity: CryptoKeyPair | undefined;
  let invitation: Invitation | undefined;
  let authority: PeerSessionAuthority<object> | undefined;
  let hostReplica: YjsReplica | undefined;
  let hostUnsubscribe: (() => void) | undefined;
  let hostCurrent: HostPeer | undefined;
  let clientCurrent: ClientPeer | undefined;
  let hostRevoked = false;

  function event(message: string): void {
    const row = document.createElement("li");
    row.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
    if (
      eventList.firstElementChild?.textContent ===
      "Waiting for a host or client action."
    )
      eventList.replaceChildren(row);
    else eventList.prepend(row);
    while (eventList.children.length > 30) eventList.lastElementChild?.remove();
  }

  function status(element: HTMLElement, message: string, state: string): void {
    element.textContent = message;
    element.dataset.state = state;
  }

  function render(replica: YjsReplica | undefined, target: HTMLElement): void {
    target.textContent = replica
      ? JSON.stringify(
          Object.fromEntries(replica.map<string>("items").entries()),
          null,
          2,
        )
      : "No replica loaded.";
    writeButton.disabled =
      (!hostReplica && !clientCurrent?.replica) ||
      (clientCurrent?.invitation.access === "read-only" && !hostReplica);
  }

  function renderMembership(): void {
    const session = hostCurrent?.session;
    members.replaceChildren();
    if (!session) {
      members.innerHTML = "<li>No authenticated members.</li>";
      revokeButton.disabled = !authority || hostRevoked;
      return;
    }
    const row = document.createElement("li");
    row.textContent = `${session.clientId.slice(0, 14)}… · ${session.access} · connected`;
    members.append(row);
    revokeButton.disabled = hostRevoked;
  }

  function setSyncStatus(
    role: "host" | "client",
    message: string,
    state: string,
  ): void {
    status(role === "host" ? hostStatus : clientStatus, message, state);
    event(`${role}: ${message}`);
  }

  startButton.addEventListener("click", async () => {
    if (authority) return;
    try {
      hostIdentity = await createPeerIdentity();
      const hostId = await getPeerIdentityId(hostIdentity.publicKey);
      const instanceId = safeIdentifier(
        query<HTMLInputElement>(root, "#replica-name").value,
      );
      hostReplica = new YjsReplica();
      hostUnsubscribe = hostReplica.onUpdate(() =>
        render(hostReplica, hostDocument),
      );
      invitation = createInvitation({
        roomId: `room-${crypto.randomUUID()}`,
        instanceId,
        engineId: "crdt",
        expectedHostId: hostId,
        access: query<HTMLSelectElement>(root, "#replica-access").value as
          | "read-only"
          | "read-write",
      });
      authority = await PeerSessionAuthority.create(invitation, hostIdentity);
      hostInvitation.value = createPocketDBInvitationUri(invitation);
      startButton.disabled = true;
      answerButton.disabled = false;
      revokeButton.disabled = false;
      status(
        hostStatus,
        `Hosting ${instanceId}; waiting for an offer.`,
        "connected",
      );
      render(hostReplica, hostDocument);
      event(`host started ${instanceId} (${invitation.access})`);
    } catch (error) {
      status(hostStatus, safeError(error), "error");
    }
  });

  answerButton.addEventListener("click", async () => {
    if (!invitation || !authority || hostRevoked) return;
    try {
      hostAnswerOutput.value = "";
      await closeHostPeer();
      const remoteOffer = parseDescription(offerInput.value, "offer");
      const peer = new RTCPeerConnection({ iceServers: [] });
      const current: HostPeer = { peer, token: {} };
      hostCurrent = current;
      peer.addEventListener(
        "datachannel",
        (eventValue) => {
          current.channel = eventValue.channel;
          eventValue.channel.binaryType = "arraybuffer";
          eventValue.channel.addEventListener(
            "open",
            () => {
              void hostChannelOpened(current);
            },
            { once: true },
          );
        },
        { once: true },
      );
      peer.addEventListener("connectionstatechange", () => {
        if (
          peer.connectionState === "disconnected" ||
          peer.connectionState === "failed"
        ) {
          current.transport
            ?.disconnect("peer connection lost")
            .catch(() => undefined);
          if (current.session && authority)
            authority.closeSession(current.token, current.session.sessionId);
          current.session = undefined;
          setSyncStatus(
            "host",
            "member disconnected; local edits remain available",
            "offline",
          );
          renderMembership();
        }
      });
      await peer.setRemoteDescription(remoteOffer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIce(peer);
      if (!peer.localDescription)
        throw new Error("No local answer was created.");
      hostAnswerOutput.value = JSON.stringify(peer.localDescription);
      status(
        hostStatus,
        "Answer ready. Send it to the client, then wait for authentication.",
        "idle",
      );
      event("host produced SDP answer");
    } catch (error) {
      status(hostStatus, safeError(error), "error");
    }
  });

  clientOfferButton.addEventListener("click", async () => {
    try {
      offerOutput.value = "";
      await closeClientPeer(true);
      const parsed = parseInvitation(clientInvitationInput.value, {
        expectedTarget: { engineId: "crdt" },
      });
      const previous = clientCurrent;
      const identity = previous?.identity ?? (await createPeerIdentity());
      const replica =
        previous?.replica ??
        new YjsReplica({
          localWriteAccess: parsed.access === "read-write",
        });
      if (
        previous &&
        (previous.invitation.instanceId !== parsed.instanceId ||
          previous.invitation.expectedHostId !== parsed.expectedHostId)
      )
        throw new Error("Reconnect invitation targets a different replica.");
      const peer = new RTCPeerConnection({ iceServers: [] });
      const channel = peer.createDataChannel("pocketdb-crdt", {
        ordered: true,
      });
      channel.binaryType = "arraybuffer";
      const current: ClientPeer = {
        peer,
        identity,
        invitation: parsed,
        replica,
        channel,
        updateUnsubscribe:
          previous?.updateUnsubscribe ??
          replica.onUpdate(() => render(replica, clientDocument)),
      };
      clientCurrent = current;
      channel.addEventListener(
        "open",
        () => {
          void clientChannelOpened(current);
        },
        { once: true },
      );
      peer.addEventListener("connectionstatechange", () => {
        if (
          peer.connectionState === "disconnected" ||
          peer.connectionState === "failed"
        ) {
          current.transport
            ?.disconnect("peer connection lost")
            .catch(() => undefined);
          setSyncStatus(
            "client",
            "disconnected; local edits are retained for reconnect",
            "offline",
          );
          clientDisconnectButton.disabled = true;
          clientOfferButton.disabled = false;
        }
      });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIce(peer);
      if (!peer.localDescription)
        throw new Error("No local offer was created.");
      offerOutput.value = JSON.stringify(peer.localDescription);
      acceptAnswerButton.disabled = false;
      status(clientStatus, "Offer ready. Send it to the host.", "idle");
      event("client produced SDP offer");
      render(replica, clientDocument);
    } catch (error) {
      status(clientStatus, safeError(error), "error");
    }
  });

  acceptAnswerButton.addEventListener("click", async () => {
    if (!clientCurrent) return;
    try {
      await clientCurrent.peer.setRemoteDescription(
        parseDescription(clientAnswerInput.value, "answer"),
      );
      acceptAnswerButton.disabled = true;
      clientDisconnectButton.disabled = false;
      status(
        clientStatus,
        "Answer accepted; connecting and authenticating.",
        "idle",
      );
      event("client accepted host answer");
    } catch (error) {
      status(clientStatus, safeError(error), "error");
    }
  });

  clientDisconnectButton.addEventListener("click", async () => {
    await closeClientPeer(true);
    clientOfferButton.disabled = false;
    acceptAnswerButton.disabled = true;
    status(
      clientStatus,
      "Disconnected; local edits stay in this tab. Create a new offer to reconnect.",
      "offline",
    );
  });

  revokeButton.addEventListener("click", async () => {
    if (!authority || hostRevoked) return;
    const revoked = authority.revoke();
    hostRevoked = true;
    if (hostCurrent) hostCurrent.session = undefined;
    await closeHostPeer();
    revokeButton.disabled = true;
    answerButton.disabled = true;
    renderMembership();
    status(
      hostStatus,
      `Revoked ${revoked.length} active member session(s). Existing remote copies cannot be erased.`,
      "offline",
    );
    event("host revoked current invitation membership");
  });

  query<HTMLFormElement>(root, "#replica-write-form").addEventListener(
    "submit",
    (eventValue) => {
      eventValue.preventDefault();
      const replica = hostReplica ?? clientCurrent?.replica;
      if (!replica) return;
      try {
        const key = query<HTMLInputElement>(root, "#replica-key").value.trim();
        const value = query<HTMLInputElement>(root, "#replica-value").value;
        replica.map<string>("items").set(key, value);
        render(hostReplica, hostDocument);
        render(clientCurrent?.replica, clientDocument);
        event(`${hostReplica ? "host" : "client"} wrote key ${key} locally`);
      } catch (error) {
        status(
          hostReplica ? hostStatus : clientStatus,
          safeError(error),
          "error",
        );
      }
    },
  );

  async function hostChannelOpened(current: HostPeer): Promise<void> {
    const activeAuthority = authority;
    const activeInvitation = invitation;
    const activeReplica = hostReplica;
    const channel = current.channel;
    if (
      !activeAuthority ||
      !hostIdentity ||
      !activeInvitation ||
      !activeReplica ||
      !channel
    )
      return;
    try {
      let binding: PeerBinding | undefined;
      const handle = async (messageEvent: MessageEvent): Promise<void> => {
        if (typeof messageEvent.data !== "string") return;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(messageEvent.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.type === "authenticate") {
          try {
            if (!sameInvitation(message.invitation, activeInvitation))
              throw new Error("Invitation does not match this host.");
            if (typeof message.peerIdentity !== "string")
              throw new Error("Client identity is missing.");
            const publicKey = await importPeerPublicKey(message.peerIdentity);
            if (!binding)
              throw new Error("Peer certificate binding is not ready.");
            const challenge = await activeAuthority.challenge(
              current.token,
              binding,
              publicKey,
            );
            current.channel?.send(
              JSON.stringify({ type: "challenge", challenge }),
            );
          } catch (error) {
            current.channel?.send(
              JSON.stringify({
                type: "authentication-error",
                message: safeError(error),
              }),
            );
          }
          return;
        }
        if (message.type === "proof") {
          try {
            const proof = message.proof as Parameters<
              typeof activeAuthority.authenticate
            >[2];
            if (!binding)
              throw new Error("Peer certificate binding is not ready.");
            const session = await activeAuthority.authenticate(
              current.token,
              binding,
              proof,
            );
            current.session = session;
            channel.send(JSON.stringify({ type: "authenticated", session }));
            channel.removeEventListener("message", handle);
            current.transport = await new WebRTCDataChannelAdapter().connect({
              peerId: session.clientId,
              peerConnection: current.peer,
              channel,
            });
            current.sync = new ReplicaSyncSession(
              activeReplica,
              current.transport,
              {
                replicaId: activeInvitation.instanceId,
                localPeerId: session.hostId,
                remotePeerId: session.clientId,
                role: "host",
                authorize: () => {
                  if (!binding)
                    throw new Error(
                      "Host membership authority is unavailable.",
                    );
                  return activeAuthority.authorize(
                    current.token,
                    session.sessionId,
                    binding,
                  );
                },
              },
              {
                onError: (error) =>
                  setSyncStatus("host", `sync failed: ${error.code}`, "error"),
              },
            );
            await current.sync.start();
            renderMembership();
            setSyncStatus(
              "host",
              `connected · ${session.access} · synchronizing`,
              "connected",
            );
          } catch (error) {
            current.channel?.send(
              JSON.stringify({
                type: "authentication-error",
                message: safeError(error),
              }),
            );
            status(hostStatus, safeError(error), "error");
          }
        }
      };
      channel.addEventListener("message", handle);
      binding = await readPeerBinding(current.peer, "host");
      current.binding = binding;
      channel.send(JSON.stringify({ type: "host-ready" }));
      status(
        hostStatus,
        "Peer connected; waiting for authenticated identity.",
        "idle",
      );
    } catch (error) {
      status(hostStatus, safeError(error), "error");
    }
  }

  async function clientChannelOpened(current: ClientPeer): Promise<void> {
    try {
      const binding = readPeerBinding(current.peer, "client");
      const handle = async (messageEvent: MessageEvent): Promise<void> => {
        if (typeof messageEvent.data !== "string") return;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(messageEvent.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.type === "host-ready") {
          try {
            current.binding = await binding;
          } catch (error) {
            status(clientStatus, safeError(error), "error");
            return;
          }
          const { capability: _capability, ...invitationScope } =
            current.invitation;
          current.channel.send(
            JSON.stringify({
              type: "authenticate",
              invitation: invitationScope,
              peerIdentity: await exportPeerPublicKey(
                current.identity.publicKey,
              ),
            }),
          );
          status(
            clientStatus,
            "Host is ready; authenticating invitation membership.",
            "idle",
          );
          return;
        }
        if (message.type === "challenge") {
          try {
            const challenge = message.challenge as PeerAuthenticationChallenge;
            const proof = await respondToPeerChallenge(
              current.invitation,
              current.identity,
              current.binding as PeerBinding,
              challenge,
            );
            current.channel.send(JSON.stringify({ type: "proof", proof }));
          } catch (error) {
            status(clientStatus, safeError(error), "error");
          }
          return;
        }
        if (message.type === "authenticated") {
          const session = message.session as AuthenticatedPeerSession;
          current.session = session;
          current.channel.removeEventListener("message", handle);
          try {
            current.transport = await new WebRTCDataChannelAdapter().connect({
              peerId: session.hostId,
              peerConnection: current.peer,
              channel: current.channel,
            });
            current.sync = new ReplicaSyncSession(
              current.replica,
              current.transport,
              {
                replicaId: current.invitation.instanceId,
                localPeerId: session.clientId,
                remotePeerId: session.hostId,
                role: "client",
                authorize: () => current.session as AuthenticatedPeerSession,
              },
              {
                onError: (error) =>
                  setSyncStatus(
                    "client",
                    `sync failed: ${error.code}`,
                    "error",
                  ),
              },
            );
            await current.sync.start();
            clientDisconnectButton.disabled = false;
            clientOfferButton.disabled = true;
            clientMembers.replaceChildren();
            const row = document.createElement("li");
            row.textContent = `host ${session.hostId.slice(0, 14)}… · ${session.access} · connected`;
            clientMembers.append(row);
            setSyncStatus(
              "client",
              `connected · ${session.access} · synchronizing`,
              "connected",
            );
            render(current.replica, clientDocument);
          } catch (error) {
            status(clientStatus, safeError(error), "error");
          }
          return;
        }
        if (message.type === "authentication-error") {
          status(
            clientStatus,
            String(message.message ?? "Authentication failed."),
            "error",
          );
          return;
        }
      };
      current.channel.addEventListener("message", handle);
      void binding.catch((error: unknown) =>
        status(clientStatus, safeError(error), "error"),
      );
      status(
        clientStatus,
        "Peer channel open; waiting for host authentication.",
        "idle",
      );
    } catch (error) {
      status(clientStatus, safeError(error), "error");
    }
  }

  async function closeHostPeer(): Promise<void> {
    const current = hostCurrent;
    hostCurrent = undefined;
    if (!current) return;
    if (current.sync) await current.sync.close().catch(() => undefined);
    else
      await current.transport
        ?.disconnect("host changed peer")
        .catch(() => undefined);
    current.peer.close();
    if (current.session && authority)
      authority.closeSession(current.token, current.session.sessionId);
    renderMembership();
  }

  async function closeClientPeer(keepReplica: boolean): Promise<void> {
    const current = clientCurrent;
    if (!current) return;
    if (current.sync) await current.sync.close().catch(() => undefined);
    else
      await current.transport
        ?.disconnect("client disconnected")
        .catch(() => undefined);
    current.peer.close();
    clientCurrent = keepReplica
      ? {
          ...current,
          sync: undefined,
          transport: undefined,
          session: undefined,
        }
      : undefined;
  }

  window.addEventListener("beforeunload", () => {
    hostUnsubscribe?.();
    hostReplica?.destroy();
    clientCurrent?.updateUnsubscribe?.();
    clientCurrent?.replica.destroy();
    hostCurrent?.peer.close();
    clientCurrent?.peer.close();
  });

  render(undefined, hostDocument);
  render(undefined, clientDocument);
  writeButton.disabled = true;
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const result = root.querySelector<T>(selector);
  if (!result)
    throw new Error(`Missing distributed console control: ${selector}`);
  return result;
}

function safeIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  if (!normalized)
    throw new Error("Replica name must contain a letter or number.");
  return normalized.slice(0, 128);
}

function parseDescription(
  value: string,
  expectedType: RTCSdpType,
): RTCSessionDescriptionInit {
  let description: RTCSessionDescriptionInit;
  try {
    description = JSON.parse(value) as RTCSessionDescriptionInit;
  } catch (cause) {
    throw new Error(`The pasted WebRTC ${expectedType} is not valid JSON.`, {
      cause,
    });
  }
  if (
    description.type !== expectedType ||
    typeof description.sdp !== "string" ||
    description.sdp.length > 256_000
  )
    throw new Error(
      `The pasted WebRTC description must be a ${expectedType} below 256 KiB.`,
    );
  return description;
}

function sameInvitation(value: unknown, expected: Invitation): boolean {
  if (typeof value !== "object" || value === null) return false;
  const received = value as Partial<Invitation>;
  return (
    received.version === expected.version &&
    received.roomId === expected.roomId &&
    received.instanceId === expected.instanceId &&
    received.engineId === expected.engineId &&
    received.expectedHostId === expected.expectedHostId &&
    received.access === expected.access &&
    received.expiresAt === expected.expiresAt
  );
}

function waitForIce(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("ICE gathering timed out.")),
      15_000,
    );
    const check = (): void => {
      if (peer.iceGatheringState !== "complete") return;
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", check);
    check();
  });
}

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Distributed replica operation failed.";
}
