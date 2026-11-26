import type { Invitation } from "./invitation";
import { encodeInvitation } from "./invitation";

const SIGNATURE_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;
const CHALLENGE_LIFETIME_MS = 10_000;
const DEFAULT_MAX_PENDING_CHALLENGES = 256;

export type AuthenticationFailureCode =
  | "authentication-failed"
  | "authentication-expired"
  | "authentication-invalid-challenge"
  | "authentication-invalid-identity"
  | "authentication-invalid-peer-binding"
  | "authentication-invalid-session"
  | "authentication-revoked"
  | "authentication-state-full";

export interface PeerBinding {
  readonly hostFingerprint: string;
  readonly clientFingerprint: string;
}

export interface PeerAuthenticationChallenge {
  readonly nonce: string;
  readonly clientIdentity: string;
  readonly hostPublicKey: string;
  readonly expiresAt: number;
  readonly signature: string;
}

export interface PeerAuthenticationProof {
  readonly nonce: string;
  readonly identityProof: string;
  readonly capabilityProof: string;
}

export interface AuthenticatedPeerSession {
  readonly sessionId: string;
  readonly roomId: string;
  readonly instanceId: string;
  readonly engineId: Invitation["engineId"];
  readonly hostId: string;
  readonly clientId: string;
  readonly access: Invitation["access"];
  readonly expiresAt?: number;
}

export interface AuthenticationRejectionLog {
  readonly event: "authentication-rejected";
  readonly code: AuthenticationFailureCode;
}

export interface PeerSessionAuthorityOptions {
  readonly maxPendingChallenges?: number;
  readonly maxActiveSessions?: number;
  readonly onRejected?: (event: AuthenticationRejectionLog) => void;
}

export class PeerAuthenticationError extends Error {
  constructor(readonly code: AuthenticationFailureCode) {
    super(authenticationMessage(code));
    this.name = "PeerAuthenticationError";
  }
}

export async function createPeerIdentity(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
}

export async function exportPeerPublicKey(
  publicKey: CryptoKey,
): Promise<string> {
  return encodeBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("spki", publicKey)),
  );
}

export async function importPeerPublicKey(
  encodedPublicKey: string,
): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      "spki",
      decodeBase64Url(encodedPublicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
  } catch {
    throw new PeerAuthenticationError("authentication-invalid-identity");
  }
}

export async function getPeerIdentityId(publicKey: CryptoKey): Promise<string> {
  const encoded = await crypto.subtle.exportKey("spki", publicKey);
  return encodeBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)),
  );
}

export async function readPeerBinding(
  peerConnection: RTCPeerConnection,
  role: "host" | "client",
): Promise<PeerBinding> {
  if (peerConnection.connectionState !== "connected")
    throw new PeerAuthenticationError("authentication-invalid-peer-binding");
  const reports = await peerConnection.getStats();
  for (const report of reports.values()) {
    const transport = report as RTCStats & {
      dtlsState?: string;
      localCertificateId?: string;
      remoteCertificateId?: string;
    };
    if (
      transport.type !== "transport" ||
      transport.dtlsState !== "connected" ||
      !transport.localCertificateId ||
      !transport.remoteCertificateId
    ) {
      continue;
    }
    const local = reports.get(transport.localCertificateId) as
      | (RTCStats & {
          fingerprint?: string;
          fingerprintAlgorithm?: string;
        })
      | undefined;
    const remote = reports.get(transport.remoteCertificateId) as
      | (RTCStats & {
          fingerprint?: string;
          fingerprintAlgorithm?: string;
        })
      | undefined;
    if (!local || !remote) continue;
    const localFingerprint = certificateFingerprint(local);
    const remoteFingerprint = certificateFingerprint(remote);
    return role === "host"
      ? {
          hostFingerprint: localFingerprint,
          clientFingerprint: remoteFingerprint,
        }
      : {
          hostFingerprint: remoteFingerprint,
          clientFingerprint: localFingerprint,
        };
  }
  throw new PeerAuthenticationError("authentication-invalid-peer-binding");
}

export async function respondToPeerChallenge(
  invitation: Invitation,
  clientIdentity: CryptoKeyPair,
  binding: PeerBinding,
  challenge: PeerAuthenticationChallenge,
  now = Date.now(),
): Promise<PeerAuthenticationProof> {
  try {
    encodeInvitation(invitation);
    validateBinding(binding);
    checkInvitation(invitation, now);
    if (now >= challenge.expiresAt)
      throw new PeerAuthenticationError("authentication-expired");

    const [hostKey, clientId, hostId] = await Promise.all([
      crypto.subtle.importKey(
        "spki",
        decodeBase64Url(challenge.hostPublicKey),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      ),
      getPeerIdentityId(clientIdentity.publicKey),
      digestIdentity(challenge.hostPublicKey),
    ]);
    if (
      hostId !== invitation.expectedHostId ||
      clientId !== challenge.clientIdentity
    )
      throw new PeerAuthenticationError("authentication-invalid-identity");

    const fields = transcript(invitation, binding, challenge);
    const validHostProof = await crypto.subtle.verify(
      SIGNATURE_ALGORITHM,
      hostKey,
      decodeBase64Url(challenge.signature),
      encodeFields(["host", ...fields]),
    );
    if (!validHostProof)
      throw new PeerAuthenticationError("authentication-invalid-peer-binding");

    const [identityProof, capabilityKey] = await Promise.all([
      crypto.subtle.sign(
        SIGNATURE_ALGORITHM,
        clientIdentity.privateKey,
        encodeFields(["client", ...fields]),
      ),
      crypto.subtle.importKey(
        "raw",
        decodeBase64Url(invitation.capability),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    ]);
    const capabilityProof = await crypto.subtle.sign(
      "HMAC",
      capabilityKey,
      encodeFields(["capability", ...fields]),
    );
    return Object.freeze({
      nonce: challenge.nonce,
      identityProof: encodeBase64Url(new Uint8Array(identityProof)),
      capabilityProof: encodeBase64Url(new Uint8Array(capabilityProof)),
    });
  } catch (error) {
    if (error instanceof PeerAuthenticationError) throw error;
    throw new PeerAuthenticationError("authentication-failed");
  }
}

export class PeerSessionAuthority<Connection extends object = object> {
  private readonly challenges = new Map<Connection, PendingChallenge>();
  private readonly sessions = new Map<string, SessionRecord<Connection>>();
  private revoked = false;
  private challengeTail: Promise<void> = Promise.resolve();
  private challengeJobs = 0;
  private readonly maxPendingChallenges: number;
  private readonly maxActiveSessions: number;

  private constructor(
    private readonly invitation: Invitation,
    private readonly hostIdentity: CryptoKeyPair,
    private readonly hostPublicKey: string,
    private readonly options: PeerSessionAuthorityOptions,
  ) {
    this.maxPendingChallenges =
      options.maxPendingChallenges ?? DEFAULT_MAX_PENDING_CHALLENGES;
    this.maxActiveSessions = options.maxActiveSessions ?? 1_000;
  }

  static async create<Connection extends object = object>(
    invitation: Invitation,
    hostIdentity: CryptoKeyPair,
    options: PeerSessionAuthorityOptions = {},
  ): Promise<PeerSessionAuthority<Connection>> {
    encodeInvitation(invitation);
    const hostId = await getPeerIdentityId(hostIdentity.publicKey);
    if (hostId !== invitation.expectedHostId)
      throw new PeerAuthenticationError("authentication-invalid-identity");
    const maximum =
      options.maxPendingChallenges ?? DEFAULT_MAX_PENDING_CHALLENGES;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10_000)
      throw new RangeError("maxPendingChallenges must be between 1 and 10000.");
    const maxActiveSessions = options.maxActiveSessions ?? 1_000;
    if (
      !Number.isSafeInteger(maxActiveSessions) ||
      maxActiveSessions < 1 ||
      maxActiveSessions > 100_000
    ) {
      throw new RangeError("maxActiveSessions must be between 1 and 100000.");
    }
    return new PeerSessionAuthority(
      Object.freeze({ ...invitation }),
      hostIdentity,
      await exportPeerPublicKey(hostIdentity.publicKey),
      options,
    );
  }

  challenge(
    connection: Connection,
    binding: PeerBinding,
    clientPublicKey: CryptoKey,
    now = Date.now(),
  ): Promise<PeerAuthenticationChallenge> {
    if (this.challengeJobs >= this.maxPendingChallenges)
      return Promise.reject(this.rejection("authentication-state-full"));
    this.challengeJobs += 1;
    const pending = this.challengeTail.then(
      () => this.issueChallenge(connection, binding, clientPublicKey, now),
      () => this.issueChallenge(connection, binding, clientPublicKey, now),
    );
    const result = pending.finally(() => {
      this.challengeJobs -= 1;
    });
    this.challengeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async issueChallenge(
    connection: Connection,
    binding: PeerBinding,
    clientPublicKey: CryptoKey,
    now: number,
  ): Promise<PeerAuthenticationChallenge> {
    this.checkActive(now);
    try {
      validateBinding(binding);
    } catch {
      return this.reject("authentication-invalid-peer-binding");
    }
    this.pruneChallenges(now);
    if (
      !this.challenges.has(connection) &&
      this.challenges.size >= this.maxPendingChallenges
    )
      return this.reject("authentication-state-full");

    const nonce = randomToken();
    const clientIdentity = await getPeerIdentityId(clientPublicKey);
    const expiresAt = Math.min(
      now + CHALLENGE_LIFETIME_MS,
      this.invitation.expiresAt ?? Number.MAX_SAFE_INTEGER,
    );
    const challenge: PeerAuthenticationChallenge = Object.freeze({
      nonce,
      clientIdentity,
      hostPublicKey: this.hostPublicKey,
      expiresAt,
      signature: "",
    });
    const fields = transcript(this.invitation, binding, challenge);
    const signature = await crypto.subtle.sign(
      SIGNATURE_ALGORITHM,
      this.hostIdentity.privateKey,
      encodeFields(["host", ...fields]),
    );
    this.checkActive(now);
    const signedChallenge = Object.freeze({
      ...challenge,
      signature: encodeBase64Url(new Uint8Array(signature)),
    });
    this.challenges.set(connection, {
      binding: canonicalBinding(binding),
      clientPublicKey,
      challenge: signedChallenge,
    });
    return signedChallenge;
  }

  async authenticate(
    connection: Connection,
    binding: PeerBinding,
    proof: PeerAuthenticationProof,
    now = Date.now(),
  ): Promise<AuthenticatedPeerSession> {
    const pending = this.challenges.get(connection);
    this.challenges.delete(connection);
    this.checkActive(now);
    if (
      !pending ||
      now >= pending.challenge.expiresAt ||
      proof.nonce !== pending.challenge.nonce
    )
      return this.reject("authentication-invalid-challenge");
    if (!sameBinding(pending.binding, binding))
      return this.reject("authentication-invalid-peer-binding");

    let validIdentity: boolean;
    let validCapability: boolean;
    try {
      const fields = transcript(this.invitation, binding, pending.challenge);
      validIdentity = await crypto.subtle.verify(
        SIGNATURE_ALGORITHM,
        pending.clientPublicKey,
        decodeBase64Url(proof.identityProof),
        encodeFields(["client", ...fields]),
      );
      const capabilityKey = await crypto.subtle.importKey(
        "raw",
        decodeBase64Url(this.invitation.capability),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      validCapability = await crypto.subtle.verify(
        "HMAC",
        capabilityKey,
        decodeBase64Url(proof.capabilityProof),
        encodeFields(["capability", ...fields]),
      );
    } catch {
      return this.reject("authentication-invalid-identity");
    }
    this.checkActive(now);
    if (!validIdentity || !validCapability)
      return this.reject("authentication-invalid-identity");
    if (this.sessions.size >= this.maxActiveSessions)
      return this.reject("authentication-state-full");

    const session: AuthenticatedPeerSession = Object.freeze({
      sessionId: randomToken(),
      roomId: this.invitation.roomId,
      instanceId: this.invitation.instanceId,
      engineId: this.invitation.engineId,
      hostId: this.invitation.expectedHostId,
      clientId: pending.challenge.clientIdentity,
      access: this.invitation.access,
      ...(this.invitation.expiresAt === undefined
        ? {}
        : { expiresAt: this.invitation.expiresAt }),
    });
    this.sessions.set(session.sessionId, {
      connection,
      binding: pending.binding,
      session,
    });
    return session;
  }

  authorize(
    connection: Connection,
    sessionId: string,
    binding: PeerBinding,
    now = Date.now(),
  ): AuthenticatedPeerSession {
    this.checkActive(now);
    const record = this.sessions.get(sessionId);
    if (!record || record.connection !== connection)
      return this.reject("authentication-invalid-session");
    if (!sameBinding(record.binding, binding))
      return this.reject("authentication-invalid-peer-binding");
    return record.session;
  }

  async runAuthorized<T>(
    connection: Connection,
    sessionId: string,
    binding: PeerBinding,
    handler: (session: AuthenticatedPeerSession) => T | Promise<T>,
    now = Date.now(),
  ): Promise<T> {
    const session = this.authorize(connection, sessionId, binding, now);
    return handler(session);
  }

  closeSession(connection: Connection, sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || record.connection !== connection) return false;
    this.sessions.delete(sessionId);
    return true;
  }

  revoke(): readonly AuthenticatedPeerSession[] {
    if (this.revoked) return [];
    this.revoked = true;
    this.challenges.clear();
    const active = [...this.sessions.values()].map(({ session }) => session);
    this.sessions.clear();
    return Object.freeze(active);
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }

  get pendingChallengeCount(): number {
    return this.challenges.size;
  }

  private checkActive(now: number): void {
    if (this.revoked) this.reject("authentication-revoked");
    if (
      this.invitation.expiresAt !== undefined &&
      now >= this.invitation.expiresAt
    )
      this.reject("authentication-expired");
  }

  private pruneChallenges(now: number): void {
    for (const [connection, pending] of this.challenges) {
      if (pending.challenge.expiresAt <= now)
        this.challenges.delete(connection);
    }
  }

  private reject(code: AuthenticationFailureCode): never {
    throw this.rejection(code);
  }

  private rejection(code: AuthenticationFailureCode): PeerAuthenticationError {
    try {
      this.options.onRejected?.({ event: "authentication-rejected", code });
    } catch {
      // Diagnostics must not change authentication outcomes.
    }
    return new PeerAuthenticationError(code);
  }
}

interface PendingChallenge {
  readonly binding: PeerBinding;
  readonly clientPublicKey: CryptoKey;
  readonly challenge: PeerAuthenticationChallenge;
}

interface SessionRecord<Connection extends object> {
  readonly connection: Connection;
  readonly binding: PeerBinding;
  readonly session: AuthenticatedPeerSession;
}

function checkInvitation(invitation: Invitation, now: number): void {
  if (invitation.expiresAt !== undefined && now >= invitation.expiresAt)
    throw new PeerAuthenticationError("authentication-expired");
}

function transcript(
  invitation: Invitation,
  binding: PeerBinding,
  challenge: PeerAuthenticationChallenge,
): readonly (string | number | null)[] {
  const normalized = canonicalBinding(binding);
  return [
    1,
    invitation.roomId,
    invitation.instanceId,
    invitation.engineId,
    invitation.access,
    invitation.expectedHostId,
    invitation.expiresAt ?? null,
    normalized.hostFingerprint,
    normalized.clientFingerprint,
    challenge.expiresAt,
    challenge.nonce,
    challenge.clientIdentity,
  ];
}

function canonicalBinding(binding: PeerBinding): PeerBinding {
  return {
    hostFingerprint: binding.hostFingerprint.trim().toLowerCase(),
    clientFingerprint: binding.clientFingerprint.trim().toLowerCase(),
  };
}

function validateBinding(binding: PeerBinding): void {
  for (const value of [binding.hostFingerprint, binding.clientFingerprint]) {
    if (typeof value !== "string" || value.trim() === "" || value.length > 256)
      throw new PeerAuthenticationError("authentication-invalid-peer-binding");
  }
}

function certificateFingerprint(
  certificate: RTCStats & {
    fingerprint?: string;
    fingerprintAlgorithm?: string;
  },
): string {
  const fingerprint = certificate.fingerprint
    ?.replaceAll(":", "")
    .toLowerCase();
  if (
    certificate.fingerprintAlgorithm?.toLowerCase().replaceAll("_", "-") !==
      "sha-256" ||
    !fingerprint ||
    !/^[0-9a-f]{64}$/.test(fingerprint)
  ) {
    throw new PeerAuthenticationError("authentication-invalid-peer-binding");
  }
  return `sha-256 ${fingerprint.match(/.{2}/g)?.join(":")}`;
}

function sameBinding(left: PeerBinding, right: PeerBinding): boolean {
  try {
    validateBinding(right);
    const normalized = canonicalBinding(right);
    return (
      left.hostFingerprint === normalized.hostFingerprint &&
      left.clientFingerprint === normalized.clientFingerprint
    );
  } catch {
    return false;
  }
}

function encodeFields(fields: readonly unknown[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(JSON.stringify(fields)));
}

function randomToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function digestIdentity(encodedPublicKey: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    decodeBase64Url(encodedPublicKey),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new PeerAuthenticationError("authentication-failed");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function authenticationMessage(code: AuthenticationFailureCode): string {
  switch (code) {
    case "authentication-expired":
      return "The invitation or authentication challenge has expired.";
    case "authentication-invalid-challenge":
      return "The authentication challenge is missing, expired, or already used.";
    case "authentication-invalid-identity":
      return "Peer identity or capability proof is invalid.";
    case "authentication-invalid-peer-binding":
      return "Authentication is bound to a different peer connection.";
    case "authentication-invalid-session":
      return "The authenticated session is not valid for this connection.";
    case "authentication-revoked":
      return "Access to this invitation has been revoked.";
    case "authentication-state-full":
      return "The host has reached its pending authentication limit.";
    default:
      return "Peer authentication failed.";
  }
}
