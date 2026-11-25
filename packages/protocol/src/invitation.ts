export const INVITATION_VERSION = 1 as const;
export const INVITATION_CAPABILITY_BYTES = 32;
export const MAX_INVITATION_BYTES = 4_096;
export const MAX_INVITATION_URI_LENGTH = 16_384;

export type InvitationEngine =
  | "kv"
  | "postgresql"
  | "sqlite"
  | "duckdb"
  | "crdt";
export type InvitationAccess = "read-only" | "read-write";

export interface Invitation {
  readonly version: typeof INVITATION_VERSION;
  readonly roomId: string;
  readonly instanceId: string;
  readonly engineId: InvitationEngine;
  readonly expectedHostId: string;
  readonly access: InvitationAccess;
  readonly capability: string;
  readonly expiresAt?: number;
}

export interface CreateInvitationInput {
  readonly roomId: string;
  readonly instanceId: string;
  readonly engineId: InvitationEngine;
  readonly expectedHostId: string;
  readonly access: InvitationAccess;
  readonly expiresAt?: number;
}

export interface InvitationTarget {
  readonly roomId?: string;
  readonly instanceId?: string;
  readonly engineId?: InvitationEngine;
  readonly expectedHostId?: string;
}

export interface ParseInvitationOptions {
  readonly expectedTarget?: InvitationTarget;
}

export type InvitationErrorCode =
  | "invalid-invitation"
  | "unsupported-version"
  | "expired"
  | "wrong-target"
  | "query-not-allowed"
  | "insecure-origin"
  | "secure-random-unavailable";

export class InvitationError extends Error {
  constructor(
    readonly code: InvitationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

export interface BrowserInvitationLink {
  readonly url: string;
  readonly warning?: string;
}

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FRAGMENT_KEY = "invite";
const PRIVILEGED_WARNING =
  "This invitation grants read-write access. Share it only with people you trust.";

export function createInvitation(input: CreateInvitationInput): Invitation {
  validateScope(input);
  if (input.expiresAt !== undefined) {
    validateTimestamp(input.expiresAt);
    if (input.expiresAt <= Date.now()) {
      throw new InvitationError(
        "expired",
        "Invitation expiry must be in the future.",
      );
    }
  }
  const secureCrypto = globalThis.crypto;
  if (!secureCrypto?.getRandomValues) {
    throw new InvitationError(
      "secure-random-unavailable",
      "A cryptographically secure random source is required.",
    );
  }
  const random = secureCrypto.getRandomValues(
    new Uint8Array(INVITATION_CAPABILITY_BYTES),
  );
  return Object.freeze({
    version: INVITATION_VERSION,
    ...input,
    capability: encodeBase64Url(random),
  });
}

export function encodeInvitation(invitation: Invitation): string {
  validateInvitation(invitation);
  const json = JSON.stringify(invitation);
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > MAX_INVITATION_BYTES) {
    throw new InvitationError(
      "invalid-invitation",
      "Invitation payload is too large.",
    );
  }
  return encodeBase64Url(bytes);
}

export function createPocketDBInvitationUri(invitation: Invitation): string {
  const token = encodeInvitation(invitation);
  const routeEngine =
    invitation.engineId === "postgresql" ? "postgres" : invitation.engineId;
  return `pocketdb://${encodeURIComponent(invitation.roomId)}/${encodeURIComponent(routeEngine)}#${FRAGMENT_KEY}=${token}`;
}

export function createBrowserInvitationLink(
  baseUrl: string,
  invitation: Invitation,
): BrowserInvitationLink {
  validateInvitation(invitation);
  const url = parseUrl(baseUrl);
  validateBrowserOrigin(url);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = `${FRAGMENT_KEY}=${encodeInvitation(invitation)}`;
  return {
    url: url.toString(),
    ...(isPrivilegedInvitation(invitation)
      ? { warning: PRIVILEGED_WARNING }
      : {}),
  };
}

export function parseInvitation(
  value: string,
  options: ParseInvitationOptions = {},
): Invitation {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_INVITATION_URI_LENGTH
  ) {
    throw invalidInvitation();
  }
  const url = parseUrl(value);
  if (url.search !== "") {
    throw new InvitationError(
      "query-not-allowed",
      "Invitation URLs must not contain query parameters.",
    );
  }
  if (url.username || url.password) throw invalidInvitation();

  let route: { roomId: string; engineId: InvitationEngine } | undefined;
  if (url.protocol === "pocketdb:") {
    if (url.port !== "") throw invalidInvitation();
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) throw invalidInvitation();
    let engineId: string;
    try {
      engineId = decodeURIComponent(segments[0]);
    } catch {
      throw invalidInvitation();
    }
    const canonicalEngineId = engineId === "postgres" ? "postgresql" : engineId;
    if (!isInvitationEngine(canonicalEngineId)) throw invalidInvitation();
    route = { roomId: url.hostname, engineId: canonicalEngineId };
  } else {
    validateBrowserOrigin(url);
  }

  const fragment = new URLSearchParams(url.hash.slice(1));
  const tokenValues = fragment.getAll(FRAGMENT_KEY);
  if (tokenValues.length !== 1 || [...fragment.keys()].length !== 1) {
    throw invalidInvitation();
  }
  const invitation = decodeInvitation(tokenValues[0]);
  if (
    route &&
    (route.roomId !== invitation.roomId ||
      route.engineId !== invitation.engineId)
  ) {
    throw new InvitationError(
      "wrong-target",
      "Invitation route does not match its scoped payload.",
    );
  }
  if (
    invitation.expiresAt !== undefined &&
    invitation.expiresAt <= Date.now()
  ) {
    throw new InvitationError("expired", "Invitation has expired.");
  }
  if (
    options.expectedTarget &&
    !matchesTarget(invitation, options.expectedTarget)
  ) {
    throw new InvitationError(
      "wrong-target",
      "Invitation does not match the expected host or database target.",
    );
  }
  return invitation;
}

export function isPrivilegedInvitation(invitation: Invitation): boolean {
  return invitation.access === "read-write";
}

export function redactInvitationForLog(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = url.hash ? "#[REDACTED]" : "";
    return url.toString();
  } catch {
    return "[redacted invitation]";
  }
}

function decodeInvitation(token: string): Invitation {
  const bytes = decodeBase64Url(token);
  if (bytes.byteLength > MAX_INVITATION_BYTES) throw invalidInvitation();
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw invalidInvitation();
  }
  if (!isRecord(parsed)) throw invalidInvitation();
  if (parsed.version !== INVITATION_VERSION) {
    throw new InvitationError(
      "unsupported-version",
      "Invitation version is not supported.",
    );
  }
  validateInvitation(parsed as unknown as Invitation);
  return Object.freeze(parsed as unknown as Invitation);
}

function validateInvitation(value: Invitation): void {
  if (!isRecord(value)) throw invalidInvitation();
  const allowed = new Set([
    "version",
    "roomId",
    "instanceId",
    "engineId",
    "expectedHostId",
    "access",
    "capability",
    "expiresAt",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw invalidInvitation();
  if (value.version !== INVITATION_VERSION) {
    throw new InvitationError(
      "unsupported-version",
      "Invitation version is not supported.",
    );
  }
  validateScope(value);
  if (!isCanonicalRandom(value.capability)) throw invalidInvitation();
  if (value.expiresAt !== undefined) validateTimestamp(value.expiresAt);
}

function validateScope(
  value: Pick<
    Invitation,
    "roomId" | "instanceId" | "engineId" | "expectedHostId" | "access"
  >,
): void {
  if (
    !IDENTIFIER_PATTERN.test(value.roomId) ||
    !IDENTIFIER_PATTERN.test(value.instanceId) ||
    !isInvitationEngine(value.engineId) ||
    !isCanonicalDigest(value.expectedHostId) ||
    (value.access !== "read-only" && value.access !== "read-write")
  ) {
    throw invalidInvitation();
  }
}

function validateTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidInvitation();
}

function matchesTarget(
  invitation: Invitation,
  target: InvitationTarget,
): boolean {
  return (
    (target.roomId === undefined || target.roomId === invitation.roomId) &&
    (target.instanceId === undefined ||
      target.instanceId === invitation.instanceId) &&
    (target.engineId === undefined ||
      target.engineId === invitation.engineId) &&
    (target.expectedHostId === undefined ||
      target.expectedHostId === invitation.expectedHostId)
  );
}

function isInvitationEngine(value: unknown): value is InvitationEngine {
  return (
    value === "kv" ||
    value === "postgresql" ||
    value === "sqlite" ||
    value === "duckdb" ||
    value === "crdt"
  );
}

function isCanonicalRandom(value: unknown): value is string {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return false;
  try {
    return decodeBase64Url(value).byteLength === INVITATION_CAPABILITY_BYTES;
  } catch {
    return false;
  }
}

function isCanonicalDigest(value: unknown): value is string {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return false;
  try {
    return decodeBase64Url(value).byteLength === 32;
  } catch {
    return false;
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidInvitation();
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  let binary: string;
  try {
    binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    throw invalidInvitation();
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) throw invalidInvitation();
  return bytes;
}

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw invalidInvitation();
  }
}

function validateBrowserOrigin(url: URL): void {
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return;
  throw new InvitationError(
    "insecure-origin",
    "Browser invitations require HTTPS (HTTP is allowed only on loopback).",
  );
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidInvitation(): InvitationError {
  return new InvitationError(
    "invalid-invitation",
    "Invitation is malformed or invalid.",
  );
}
