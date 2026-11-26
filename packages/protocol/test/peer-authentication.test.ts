import { beforeEach, describe, expect, it } from "vitest";
import {
  createInvitation,
  getPeerIdentityId,
  createPeerIdentity,
  PeerAuthenticationError,
  PeerSessionAuthority,
  respondToPeerChallenge,
  type PeerBinding,
} from "../src";

const binding: PeerBinding = {
  hostFingerprint: "sha-256 AA:BB:CC:DD",
  clientFingerprint: "sha-256 11:22:33:44",
};

describe("peer-bound authentication and revocation", () => {
  let now: number;
  let hostIdentity: CryptoKeyPair;
  let clientIdentity: CryptoKeyPair;
  let invitation: ReturnType<typeof createInvitation>;
  let authority: PeerSessionAuthority<object>;
  let connection: object;
  let rejections: { readonly event: string; readonly code: string }[];

  beforeEach(async () => {
    now = Date.now();
    hostIdentity = await createPeerIdentity();
    clientIdentity = await createPeerIdentity();
    invitation = createInvitation({
      roomId: "auth-room",
      instanceId: "auth-instance",
      engineId: "kv",
      expectedHostId: await getPeerIdentityId(hostIdentity.publicKey),
      access: "read-write",
      expiresAt: now + 60_000,
    });
    rejections = [];
    authority = await PeerSessionAuthority.create(invitation, hostIdentity, {
      onRejected: (event) => rejections.push(event),
    });
    connection = {};
  });

  it("authenticates a scoped peer and gates handlers on the live connection", async () => {
    const challenge = await authority.challenge(
      connection,
      binding,
      clientIdentity.publicKey,
      now,
    );
    const proof = await respondToPeerChallenge(
      invitation,
      clientIdentity,
      binding,
      challenge,
      now,
    );
    const session = await authority.authenticate(
      connection,
      binding,
      proof,
      now,
    );
    expect(session).toMatchObject({
      roomId: "auth-room",
      instanceId: "auth-instance",
      engineId: "kv",
      access: "read-write",
      hostId: invitation.expectedHostId,
    });

    let handlerCalls = 0;
    await expect(
      authority.runAuthorized(
        connection,
        session.sessionId,
        binding,
        (grant) => {
          handlerCalls += 1;
          return grant.instanceId;
        },
      ),
    ).resolves.toBe("auth-instance");
    expect(handlerCalls).toBe(1);
    await expect(
      authority.runAuthorized({}, session.sessionId, binding, () => {
        handlerCalls += 1;
      }),
    ).rejects.toMatchObject({ code: "authentication-invalid-session" });
    expect(handlerCalls).toBe(1);
  });

  it("rejects altered fingerprints and proof reuse on another peer", async () => {
    const challenge = await authority.challenge(
      connection,
      binding,
      clientIdentity.publicKey,
      now,
    );
    const changedBinding = { ...binding, hostFingerprint: "sha-256 00:00" };
    await expect(
      respondToPeerChallenge(
        invitation,
        clientIdentity,
        changedBinding,
        challenge,
        now,
      ),
    ).rejects.toMatchObject({ code: "authentication-invalid-peer-binding" });

    const proof = await respondToPeerChallenge(
      invitation,
      clientIdentity,
      binding,
      challenge,
      now,
    );
    await expect(
      authority.authenticate({}, binding, proof, now),
    ).rejects.toMatchObject({ code: "authentication-invalid-challenge" });
    await expect(
      authority.authenticate(connection, changedBinding, proof, now),
    ).rejects.toMatchObject({ code: "authentication-invalid-peer-binding" });
  });

  it("rejects altered capability and client identity proofs", async () => {
    const challenge = await authority.challenge(
      connection,
      binding,
      clientIdentity.publicKey,
      now,
    );
    const wrongSecret = createInvitation({
      ...invitation,
      expectedHostId: invitation.expectedHostId,
      access: invitation.access,
    });
    const wrongProof = await respondToPeerChallenge(
      wrongSecret,
      clientIdentity,
      binding,
      challenge,
      now,
    );
    await expect(
      authority.authenticate(connection, binding, wrongProof, now),
    ).rejects.toMatchObject({ code: "authentication-invalid-identity" });

    const next = await authority.challenge(
      connection,
      binding,
      clientIdentity.publicKey,
      now,
    );
    const validProof = await respondToPeerChallenge(
      invitation,
      clientIdentity,
      binding,
      next,
      now,
    );
    await expect(
      authority.authenticate(
        connection,
        binding,
        { ...validProof, identityProof: validProof.capabilityProof },
        now,
      ),
    ).rejects.toMatchObject({ code: "authentication-invalid-identity" });
  });

  it("rejects expired invitations and challenges", async () => {
    const challenge = await authority.challenge(
      connection,
      binding,
      clientIdentity.publicKey,
      now,
    );
    const proof = await respondToPeerChallenge(
      invitation,
      clientIdentity,
      binding,
      challenge,
      now,
    );
    await expect(
      authority.authenticate(connection, binding, proof, invitation.expiresAt),
    ).rejects.toMatchObject({ code: "authentication-expired" });
    await expect(
      respondToPeerChallenge(
        invitation,
        clientIdentity,
        binding,
        challenge,
        challenge.expiresAt,
      ),
    ).rejects.toMatchObject({ code: "authentication-expired" });

    const withoutExpiry = createInvitation({
      roomId: "challenge-room",
      instanceId: "challenge-instance",
      engineId: "kv",
      expectedHostId: await getPeerIdentityId(hostIdentity.publicKey),
      access: "read-only",
    });
    const bounded = await PeerSessionAuthority.create(
      withoutExpiry,
      hostIdentity,
    );
    const expiringConnection = {};
    const expiringChallenge = await bounded.challenge(
      expiringConnection,
      binding,
      clientIdentity.publicKey,
      now,
    );
    const expiredProof = await respondToPeerChallenge(
      withoutExpiry,
      clientIdentity,
      binding,
      expiringChallenge,
      now,
    );
    await expect(
      bounded.authenticate(
        expiringConnection,
        binding,
        expiredProof,
        expiringChallenge.expiresAt,
      ),
    ).rejects.toMatchObject({ code: "authentication-invalid-challenge" });
  });

  it("rejects an active session after its invitation expires", async () => {
    const challenge = await authority.challenge(
      connection,
      binding,
      clientIdentity.publicKey,
      now,
    );
    const proof = await respondToPeerChallenge(
      invitation,
      clientIdentity,
      binding,
      challenge,
      now,
    );
    const session = await authority.authenticate(
      connection,
      binding,
      proof,
      now,
    );
    expect(() =>
      authority.authorize(
        connection,
        session.sessionId,
        binding,
        invitation.expiresAt,
      ),
    ).toThrow(expect.objectContaining({ code: "authentication-expired" }));
  });

  it("revokes active sessions before handlers can execute", async () => {
    const challenge = await authority.challenge(
      connection,
      binding,
      clientIdentity.publicKey,
      now,
    );
    const proof = await respondToPeerChallenge(
      invitation,
      clientIdentity,
      binding,
      challenge,
      now,
    );
    const session = await authority.authenticate(
      connection,
      binding,
      proof,
      now,
    );
    expect(authority.revoke()).toEqual([session]);
    expect(authority.activeSessionCount).toBe(0);
    let handlerCalls = 0;
    await expect(
      authority.runAuthorized(connection, session.sessionId, binding, () => {
        handlerCalls += 1;
      }),
    ).rejects.toMatchObject({ code: "authentication-revoked" });
    await expect(
      authority.challenge({}, binding, clientIdentity.publicKey, now),
    ).rejects.toMatchObject({ code: "authentication-revoked" });
    expect(handlerCalls).toBe(0);
  });

  it("bounds pending challenges and emits rejection logs without secrets", async () => {
    const limited = await PeerSessionAuthority.create(
      invitation,
      hostIdentity,
      {
        maxPendingChallenges: 1,
        onRejected: (event) => rejections.push(event),
      },
    );
    await limited.challenge({}, binding, clientIdentity.publicKey, now);
    await expect(
      limited.challenge(
        { other: true },
        binding,
        clientIdentity.publicKey,
        now,
      ),
    ).rejects.toMatchObject({ code: "authentication-state-full" });
    expect(JSON.stringify(rejections)).not.toContain(invitation.capability);
    expect(JSON.stringify(rejections)).not.toContain("identityProof");
    expect(rejections.at(-1)).toEqual({
      event: "authentication-rejected",
      code: "authentication-state-full",
    });
  });

  it("bounds active authenticated sessions", async () => {
    const limited = await PeerSessionAuthority.create(
      invitation,
      hostIdentity,
      {
        maxActiveSessions: 1,
      },
    );
    const firstConnection = {};
    const firstChallenge = await limited.challenge(
      firstConnection,
      binding,
      clientIdentity.publicKey,
      now,
    );
    const firstProof = await respondToPeerChallenge(
      invitation,
      clientIdentity,
      binding,
      firstChallenge,
      now,
    );
    await limited.authenticate(firstConnection, binding, firstProof, now);

    const secondConnection = {};
    const secondChallenge = await limited.challenge(
      secondConnection,
      binding,
      clientIdentity.publicKey,
      now,
    );
    const secondProof = await respondToPeerChallenge(
      invitation,
      clientIdentity,
      binding,
      secondChallenge,
      now,
    );
    await expect(
      limited.authenticate(secondConnection, binding, secondProof, now),
    ).rejects.toMatchObject({ code: "authentication-state-full" });
    expect(limited.activeSessionCount).toBe(1);
  });

  it("rejects a host identity that does not match the invitation", async () => {
    await expect(
      PeerSessionAuthority.create(invitation, await createPeerIdentity()),
    ).rejects.toBeInstanceOf(PeerAuthenticationError);
  });
});
