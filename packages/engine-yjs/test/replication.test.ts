import {
  PeerSessionAuthority,
  createInvitation,
  createPeerIdentity,
  getPeerIdentityId,
  respondToPeerChallenge,
} from "@pocketdb/protocol";
import { createInProcessTransportPair } from "@pocketdb/transport";
import { describe, expect, it } from "vitest";
import {
  ReplicaSyncSession,
  type ReplicaSyncAuthorization,
  type ReplicaSyncError,
} from "../src/replication";
import { YjsReplica } from "../src/replica";

const binding = {
  hostFingerprint: "sha-256 host test certificate",
  clientFingerprint: "sha-256 client test certificate",
};

describe("authenticated Yjs replica synchronization", () => {
  it("applies duplicate and out-of-order incremental updates idempotently", async () => {
    const host = new YjsReplica();
    const client = new YjsReplica();
    const hostIdentity = await createPeerIdentity();
    const clientIdentity = await createPeerIdentity();
    const updates: Uint8Array[] = [];
    const stopRecording = client.onUpdate((update) => updates.push(update));
    try {
      client.map<string>("items").set("first", "one");
      client.map<string>("items").set("second", "two");
      expect(updates).toHaveLength(2);

      const authenticated = await createAuthenticatedPair(
        hostIdentity,
        clientIdentity,
      );
      const hostSession = new ReplicaSyncSession(
        host,
        authenticated.pair.right,
        createAuthorization(authenticated, "host"),
      );
      await hostSession.start();
      await authenticated.pair.left.send(frame(2, updates[1]));
      await authenticated.pair.left.send(frame(2, updates[0]));
      await authenticated.pair.left.send(frame(2, updates[0]));
      await waitFor(() => sameValues(host, client));
      expect(host.map<string>("items").entries()).toEqual(
        client.map<string>("items").entries(),
      );
    } finally {
      stopRecording();
      host.destroy();
      client.destroy();
    }
  });

  it("forwards a connected peer's update to another connected peer", async () => {
    const host = new YjsReplica();
    const first = new YjsReplica();
    const second = new YjsReplica();
    const hostIdentity = await createPeerIdentity();
    const firstPair = await createAuthenticatedPair(
      hostIdentity,
      await createPeerIdentity(),
    );
    const secondPair = await createAuthenticatedPair(
      hostIdentity,
      await createPeerIdentity(),
    );
    const firstSessions = createSessions(host, first, firstPair);
    const secondSessions = createSessions(host, second, secondPair);
    try {
      await Promise.all([
        firstSessions.host.start(),
        firstSessions.client.start(),
        secondSessions.host.start(),
        secondSessions.client.start(),
      ]);
      first.map<string>("items").set("forwarded", "value");
      await waitFor(
        () => second.map<string>("items").get("forwarded") === "value",
      );
      expect(firstSessions.client.state).toBe("connected");
      expect(secondSessions.client.state).toBe("connected");
    } finally {
      await Promise.all([
        firstSessions.host.close(),
        firstSessions.client.close(),
        secondSessions.host.close(),
        secondSessions.client.close(),
      ]);
      host.destroy();
      first.destroy();
      second.destroy();
    }
  });

  it("exchanges offline state, streams edits and converges after reconnect", async () => {
    const hostIdentity = await createPeerIdentity();
    const clientIdentity = await createPeerIdentity();
    const host = new YjsReplica();
    const client = new YjsReplica();
    try {
      host.map<string>("items").set("host", "offline host write");
      client.map<string>("items").set("client", "offline client write");
      host.map<string>("items").set("status", "host offline value");
      client.map<string>("items").set("status", "client offline value");

      const first = await createAuthenticatedPair(hostIdentity, clientIdentity);
      const firstSessions = createSessions(host, client, first);
      await Promise.all([
        firstSessions.host.start(),
        firstSessions.client.start(),
      ]);
      await waitFor(() => sameValues(host, client));
      expect(host.map<string>("items").toJSON()).toEqual(
        client.map<string>("items").toJSON(),
      );
      expect(host.map<string>("items").get("status")).toBeDefined();

      client.array<string>("events").push("live client event");
      await waitFor(() =>
        host.array<string>("events").toArray().includes("live client event"),
      );

      await first.pair.left.disconnect("simulated network loss");
      host.map<string>("items").set("host-after-loss", "host stayed offline");
      client
        .map<string>("items")
        .set("client-after-loss", "client stayed offline");
      host.map<string>("items").set("status", "host reconnect value");
      client.map<string>("items").set("status", "client reconnect value");

      const second = await createAuthenticatedPair(
        hostIdentity,
        clientIdentity,
      );
      const secondSessions = createSessions(host, client, second);
      await Promise.all([
        secondSessions.host.start(),
        secondSessions.client.start(),
      ]);
      await waitFor(() => sameValues(host, client));
      expect(host.map<string>("items").toJSON()).toEqual(
        client.map<string>("items").toJSON(),
      );
      expect(host.encodeStateVector()).toEqual(client.encodeStateVector());
    } finally {
      host.destroy();
      client.destroy();
    }
  });

  it("rejects updates from read-only members and oversized update frames", async () => {
    const host = new YjsReplica();
    const client = new YjsReplica({ localWriteAccess: false });
    const hostIdentity = await createPeerIdentity();
    const clientIdentity = await createPeerIdentity();
    try {
      host.map<string>("items").set("existing", "host state");
      const authenticated = await createAuthenticatedPair(
        hostIdentity,
        clientIdentity,
        "read-only",
      );
      let hostError: ReplicaSyncError | undefined;
      const sessions = createSessions(host, client, authenticated, (error) => {
        hostError = error;
      });
      await Promise.all([sessions.host.start(), sessions.client.start()]);
      await waitFor(
        () => client.map<string>("items").get("existing") === "host state",
      );

      const rogue = new YjsReplica();
      rogue.map<string>("items").set("unauthorized", "must not be applied");
      await authenticated.pair.left.send(frame(2, rogue.encodeUpdate()));
      await waitFor(() => hostError?.code === "unauthorized-peer");
      expect(host.map<string>("items").get("unauthorized")).toBeUndefined();
      rogue.destroy();

      const oversizedPair = await createAuthenticatedPair(
        hostIdentity,
        clientIdentity,
        "read-only",
      );
      hostError = undefined;
      const oversizedSessions = createSessions(
        host,
        client,
        oversizedPair,
        (error) => {
          hostError = error;
        },
      );
      await Promise.all([
        oversizedSessions.host.start(),
        oversizedSessions.client.start(),
      ]);
      const oversized = new Uint8Array(16 * 1024 + 1);
      oversized.set([0x50, 0x44, 0x01, 0x02]);
      await oversizedPair.pair.left.send(oversized);
      await waitFor(() => hostError?.code === "update-too-large");
    } finally {
      host.destroy();
      client.destroy();
    }
  });

  it("rechecks membership on every message and rejects a revoked member", async () => {
    const host = new YjsReplica();
    const client = new YjsReplica();
    const hostIdentity = await createPeerIdentity();
    const clientIdentity = await createPeerIdentity();
    try {
      const authenticated = await createAuthenticatedPair(
        hostIdentity,
        clientIdentity,
        "read-write",
      );
      let hostError: ReplicaSyncError | undefined;
      const sessions = createSessions(host, client, authenticated, (error) => {
        hostError = error;
      });
      await Promise.all([sessions.host.start(), sessions.client.start()]);

      authenticated.authority.revoke();
      client.map<string>("items").set("after-revocation", "must be rejected");
      await waitFor(() => hostError?.code === "unauthorized-peer");
      expect(host.map<string>("items").get("after-revocation")).toBeUndefined();
      expect(sessions.host.state).toBe("failed");
    } finally {
      host.destroy();
      client.destroy();
    }
  });

  it("rejects malformed state vectors without leaking decoder errors", async () => {
    const host = new YjsReplica();
    const hostIdentity = await createPeerIdentity();
    const clientIdentity = await createPeerIdentity();
    try {
      const authenticated = await createAuthenticatedPair(
        hostIdentity,
        clientIdentity,
      );
      let hostError: ReplicaSyncError | undefined;
      const session = new ReplicaSyncSession(
        host,
        authenticated.pair.right,
        createAuthorization(authenticated, "host"),
        { onError: (error) => (hostError = error) },
      );
      await session.start();
      await authenticated.pair.left.send(frame(1, new Uint8Array([0xff])));
      await waitFor(() => hostError !== undefined);
      expect(hostError?.code).toBe("invalid-frame");
      expect(session.state).toBe("failed");
    } finally {
      host.destroy();
    }
  });

  it("rejects an authenticated peer presented for the wrong replica member", async () => {
    const host = new YjsReplica();
    const hostIdentity = await createPeerIdentity();
    const clientIdentity = await createPeerIdentity();
    try {
      const authenticated = await createAuthenticatedPair(
        hostIdentity,
        clientIdentity,
      );
      const authorization = {
        ...createAuthorization(authenticated, "host"),
        remotePeerId: "unauthorized-peer",
      } satisfies ReplicaSyncAuthorization;
      let hostError: ReplicaSyncError | undefined;
      const session = new ReplicaSyncSession(
        host,
        authenticated.pair.right,
        authorization,
        { onError: (error) => (hostError = error) },
      );
      await expect(session.start()).rejects.toMatchObject({
        code: "wrong-replica",
      });
      expect(hostError?.code).toBe("wrong-replica");
      expect(session.state).toBe("failed");
    } finally {
      host.destroy();
    }
  });
});

function createSessions(
  host: YjsReplica,
  client: YjsReplica,
  authenticated: Awaited<ReturnType<typeof createAuthenticatedPair>>,
  onHostError?: (error: ReplicaSyncError) => void,
) {
  const hostOptions = createAuthorization(authenticated, "host");
  const clientOptions = createAuthorization(authenticated, "client");
  return {
    host: new ReplicaSyncSession(host, authenticated.pair.right, hostOptions, {
      onError: onHostError,
    }),
    client: new ReplicaSyncSession(
      client,
      authenticated.pair.left,
      clientOptions,
    ),
  };
}

function createAuthorization(
  authenticated: Awaited<ReturnType<typeof createAuthenticatedPair>>,
  role: "host" | "client",
): ReplicaSyncAuthorization {
  return {
    replicaId: authenticated.invitation.instanceId,
    localPeerId:
      role === "host" ? authenticated.hostId : authenticated.clientId,
    remotePeerId:
      role === "host" ? authenticated.clientId : authenticated.hostId,
    role,
    authorize: () =>
      role === "host"
        ? authenticated.authority.authorize(
            authenticated.pair.right,
            authenticated.session.sessionId,
            binding,
          )
        : authenticated.session,
  };
}

async function createAuthenticatedPair(
  hostIdentity: CryptoKeyPair,
  clientIdentity: CryptoKeyPair,
  access: "read-only" | "read-write" = "read-write",
) {
  const hostId = await getPeerIdentityId(hostIdentity.publicKey);
  const clientId = await getPeerIdentityId(clientIdentity.publicKey);
  const pair = createInProcessTransportPair({
    leftPeerId: clientId,
    rightPeerId: hostId,
  });
  const invitation = createInvitation({
    roomId: `room-${crypto.randomUUID()}`,
    instanceId: "shared-crdt-replica",
    engineId: "crdt",
    expectedHostId: hostId,
    access,
  });
  const authority = await PeerSessionAuthority.create<object>(
    invitation,
    hostIdentity,
  );
  const challenge = await authority.challenge(
    pair.right,
    binding,
    clientIdentity.publicKey,
  );
  const proof = await respondToPeerChallenge(
    invitation,
    clientIdentity,
    binding,
    challenge,
  );
  const session = await authority.authenticate(pair.right, binding, proof);
  return {
    authority,
    clientId,
    hostId,
    invitation,
    pair,
    session,
  };
}

function frame(kind: number, payload: Uint8Array): Uint8Array {
  return new Uint8Array([0x50, 0x44, 0x01, kind, ...payload]);
}

function sameValues(left: YjsReplica, right: YjsReplica): boolean {
  const leftEntries = left
    .map("items")
    .entries()
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightEntries = right
    .map("items")
    .entries()
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for replica synchronization.");
}
