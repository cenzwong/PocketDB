export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_MAX_MESSAGE_BYTES = 256 * 1024;

export type ProtocolValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | bigint
  | ArrayBufferView
  | ArrayBuffer
  | readonly ProtocolValue[]
  | { readonly [key: string]: ProtocolValue };

export interface ProtocolError {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly outcome?: "not-started" | "failed" | "unknown";
}

interface EnvelopeBase {
  readonly version: typeof PROTOCOL_VERSION;
}

export type ProtocolEnvelope =
  | (EnvelopeBase & {
      readonly type: "hello";
      readonly id: string;
      readonly supportedVersions: readonly number[];
    })
  | (EnvelopeBase & {
      readonly type: "hello-ack";
      readonly id: string;
      readonly selectedVersion: number;
      readonly engines: ProtocolValue;
    })
  | (EnvelopeBase & {
      readonly type: "authenticate";
      readonly id: string;
      readonly invitation: ProtocolValue;
      readonly peerIdentity: string;
    })
  | (EnvelopeBase & {
      readonly type: "authentication-challenge";
      readonly id: string;
      readonly nonce: string;
      readonly clientIdentity: string;
      readonly hostPublicKey: string;
      readonly expiresAt: number;
      readonly signature: string;
    })
  | (EnvelopeBase & {
      readonly type: "authentication-proof";
      readonly id: string;
      readonly nonce: string;
      readonly identityProof: string;
      readonly capabilityProof: string;
    })
  | (EnvelopeBase & {
      readonly type: "authenticated";
      readonly id: string;
      readonly sessionId: string;
      readonly instanceId: string;
      readonly engineId: string;
    })
  | (EnvelopeBase & {
      readonly type: "open-session";
      readonly id: string;
      readonly sessionId: string;
      readonly instanceId: string;
      readonly engineId: string;
      readonly access: "read-only" | "read-write";
    })
  | (EnvelopeBase & {
      readonly type: "close-session";
      readonly id: string;
      readonly sessionId: string;
    })
  | (EnvelopeBase & {
      readonly type: "request";
      readonly id: string;
      readonly sessionId: string;
      readonly instanceId: string;
      readonly engineId: string;
      readonly operation: string;
      readonly payload: ProtocolValue;
    })
  | (EnvelopeBase & {
      readonly type: "response";
      readonly id: string;
      readonly sessionId: string;
      readonly payload: ProtocolValue;
    })
  | (EnvelopeBase & {
      readonly type: "error";
      readonly id: string;
      readonly sessionId?: string;
      readonly error: ProtocolError;
    })
  | (EnvelopeBase & {
      readonly type: "heartbeat";
      readonly sequence: number;
    })
  | (EnvelopeBase & {
      readonly type: "disconnect";
      readonly reason?: string;
    });

export type ProtocolCodecErrorCode =
  | "invalid-envelope"
  | "unsupported-version"
  | "message-too-large"
  | "invalid-value"
  | "value-too-deep"
  | "too-many-values"
  | "malformed-json"
  | "invalid-utf8";

export class ProtocolCodecError extends Error {
  constructor(
    readonly code: ProtocolCodecErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProtocolCodecError";
  }
}

export interface CodecLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}

const DEFAULT_LIMITS: CodecLimits = {
  maxBytes: DEFAULT_MAX_MESSAGE_BYTES,
  maxDepth: 32,
  maxNodes: 10_000,
};

type WireValue =
  | null
  | boolean
  | string
  | { readonly $pdb: "undefined" }
  | { readonly $pdb: "number"; readonly value: string }
  | { readonly $pdb: "bigint"; readonly value: string }
  | { readonly $pdb: "bytes"; readonly value: string }
  | { readonly $pdb: "array"; readonly value: readonly WireValue[] }
  | {
      readonly $pdb: "object";
      readonly value: readonly (readonly [string, WireValue])[];
    };

interface WalkState {
  readonly limits: CodecLimits;
  nodes: number;
  readonly active: Set<object>;
}

export function encodeEnvelope(
  envelope: ProtocolEnvelope,
  limits?: Partial<CodecLimits>,
): string {
  const effectiveLimits = resolveLimits(limits);
  const state: WalkState = {
    limits: effectiveLimits,
    nodes: 0,
    active: new Set(),
  };
  validateEnvelope(envelope);
  const wire = toWireEnvelope(envelope, state);
  checkWireStructure(wire, effectiveLimits);
  let encoded: string;
  try {
    encoded = JSON.stringify(wire);
  } catch (cause) {
    throw codecError(
      "invalid-envelope",
      "The protocol envelope could not be encoded.",
      cause,
    );
  }
  const encodedBytes = new TextEncoder().encode(encoded).byteLength;
  if (encodedBytes > effectiveLimits.maxBytes) {
    throw codecError(
      "message-too-large",
      `Encoded message is ${encodedBytes} bytes; limit is ${effectiveLimits.maxBytes}.`,
    );
  }
  return encoded;
}

export function decodeEnvelope(
  input: string | Uint8Array,
  limits?: Partial<CodecLimits>,
): ProtocolEnvelope {
  const effectiveLimits = resolveLimits(limits);
  let source: string;
  let byteLength: number;
  if (typeof input === "string") {
    byteLength = new TextEncoder().encode(input).byteLength;
    source = input;
  } else {
    byteLength = input.byteLength;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch (cause) {
      throw codecError(
        "invalid-utf8",
        "Message bytes are not valid UTF-8.",
        cause,
      );
    }
  }
  if (byteLength > effectiveLimits.maxBytes) {
    throw codecError(
      "message-too-large",
      `Message is ${byteLength} bytes; limit is ${effectiveLimits.maxBytes}.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (cause) {
    throw codecError("malformed-json", "Message is not valid JSON.", cause);
  }
  checkWireStructure(parsed, effectiveLimits);
  validateEnvelope(parsed);
  const state: WalkState = {
    limits: effectiveLimits,
    nodes: 0,
    active: new Set(),
  };
  const decoded = fromWireEnvelope(parsed, state);
  validateEnvelope(decoded);
  return decoded;
}

function toWireEnvelope(envelope: ProtocolEnvelope, state: WalkState): unknown {
  if ("payload" in envelope) {
    return { ...envelope, payload: encodeValue(envelope.payload, state, 0) };
  }
  if (envelope.type === "authenticate") {
    return {
      ...envelope,
      invitation: encodeValue(envelope.invitation, state, 0),
    };
  }
  if (envelope.type === "hello-ack") {
    return { ...envelope, engines: encodeValue(envelope.engines, state, 0) };
  }
  return envelope;
}

function fromWireEnvelope(input: unknown, state: WalkState): unknown {
  if (!isRecord(input))
    throw codecError("invalid-envelope", "Envelope must be a JSON object.");
  const type = input.type;
  let decoded: Record<string, unknown> = { ...input };
  if (type === "request" || type === "response") {
    decoded = { ...input, payload: decodeValue(input.payload, state, 0) };
  } else if (type === "authenticate" && "invitation" in input) {
    decoded = { ...input, invitation: decodeValue(input.invitation, state, 0) };
  } else if (type === "hello-ack" && "engines" in input) {
    decoded = { ...input, engines: decodeValue(input.engines, state, 0) };
  }
  return decoded;
}

function validateEnvelope(input: unknown): asserts input is ProtocolEnvelope {
  if (!isRecord(input))
    throw codecError("invalid-envelope", "Envelope must be an object.");
  if (input.version !== PROTOCOL_VERSION) {
    throw codecError(
      "unsupported-version",
      `Protocol version '${String(input.version)}' is not supported.`,
    );
  }
  const type = input.type;
  switch (type) {
    case "hello":
      exactKeys(input, ["version", "type", "id", "supportedVersions"]);
      validId(input.id);
      if (
        !Array.isArray(input.supportedVersions) ||
        input.supportedVersions.length === 0 ||
        input.supportedVersions.some((version) => !positiveInteger(version)) ||
        new Set(input.supportedVersions).size !== input.supportedVersions.length
      ) {
        throw codecError(
          "invalid-envelope",
          "hello.supportedVersions must contain unique positive integers.",
        );
      }
      break;
    case "hello-ack":
      exactKeys(input, ["version", "type", "id", "selectedVersion", "engines"]);
      validId(input.id);
      if (input.selectedVersion !== PROTOCOL_VERSION) {
        throw codecError(
          "unsupported-version",
          "The selected protocol version is not supported.",
        );
      }
      break;
    case "authenticate":
      exactKeys(input, ["version", "type", "id", "invitation", "peerIdentity"]);
      validId(input.id);
      validString(input.peerIdentity, "peerIdentity");
      break;
    case "authentication-challenge":
      exactKeys(input, [
        "version",
        "type",
        "id",
        "nonce",
        "clientIdentity",
        "hostPublicKey",
        "expiresAt",
        "signature",
      ]);
      validId(input.id);
      validString(input.nonce, "nonce");
      validString(input.clientIdentity, "clientIdentity");
      validString(input.hostPublicKey, "hostPublicKey");
      validString(input.signature, "signature");
      if (!positiveInteger(input.expiresAt))
        throw codecError("invalid-envelope", "challenge.expiresAt is invalid.");
      break;
    case "authentication-proof":
      exactKeys(input, [
        "version",
        "type",
        "id",
        "nonce",
        "identityProof",
        "capabilityProof",
      ]);
      validId(input.id);
      validString(input.nonce, "nonce");
      validString(input.identityProof, "identityProof");
      validString(input.capabilityProof, "capabilityProof");
      break;
    case "authenticated":
      exactKeys(input, [
        "version",
        "type",
        "id",
        "sessionId",
        "instanceId",
        "engineId",
      ]);
      validId(input.id);
      validString(input.sessionId, "sessionId");
      validString(input.instanceId, "instanceId");
      validString(input.engineId, "engineId");
      break;
    case "open-session":
      exactKeys(input, [
        "version",
        "type",
        "id",
        "sessionId",
        "instanceId",
        "engineId",
        "access",
      ]);
      validId(input.id);
      validString(input.sessionId, "sessionId");
      validString(input.instanceId, "instanceId");
      validString(input.engineId, "engineId");
      if (input.access !== "read-only" && input.access !== "read-write") {
        throw codecError("invalid-envelope", "open-session.access is invalid.");
      }
      break;
    case "close-session":
      exactKeys(input, ["version", "type", "id", "sessionId"]);
      validId(input.id);
      validString(input.sessionId, "sessionId");
      break;
    case "request":
      exactKeys(input, [
        "version",
        "type",
        "id",
        "sessionId",
        "instanceId",
        "engineId",
        "operation",
        "payload",
      ]);
      validId(input.id);
      validString(input.sessionId, "sessionId");
      validString(input.instanceId, "instanceId");
      validString(input.engineId, "engineId");
      validString(input.operation, "operation");
      break;
    case "response":
      exactKeys(input, ["version", "type", "id", "sessionId", "payload"]);
      validId(input.id);
      validString(input.sessionId, "sessionId");
      break;
    case "error":
      exactKeys(input, ["version", "type", "id", "error"], ["sessionId"]);
      validId(input.id);
      if (input.sessionId !== undefined)
        validString(input.sessionId, "sessionId");
      validateError(input.error);
      break;
    case "heartbeat":
      exactKeys(input, ["version", "type", "sequence"]);
      if (
        !Number.isSafeInteger(input.sequence) ||
        (input.sequence as number) < 0
      ) {
        throw codecError(
          "invalid-envelope",
          "heartbeat.sequence must be a non-negative safe integer.",
        );
      }
      break;
    case "disconnect":
      exactKeys(input, ["version", "type"], ["reason"]);
      if (input.reason !== undefined) validString(input.reason, "reason");
      break;
    default:
      throw codecError(
        "invalid-envelope",
        `Unknown protocol message type '${String(type)}'.`,
      );
  }
}

function validateError(value: unknown): void {
  if (!isRecord(value))
    throw codecError("invalid-envelope", "error must be an object.");
  exactKeys(value, ["code", "message"], ["retryable", "outcome"]);
  validString(value.code, "error.code");
  validString(value.message, "error.message");
  if (value.retryable !== undefined && typeof value.retryable !== "boolean") {
    throw codecError("invalid-envelope", "error.retryable must be a boolean.");
  }
  if (
    value.outcome !== undefined &&
    !["not-started", "failed", "unknown"].includes(String(value.outcome))
  ) {
    throw codecError("invalid-envelope", "error.outcome is invalid.");
  }
}

function encodeValue(
  value: unknown,
  state: WalkState,
  depth: number,
): WireValue {
  visitNode(state, depth);
  if (value === undefined) return { $pdb: "undefined" };
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw codecError("invalid-value", "Only finite numbers are supported.");
    return {
      $pdb: "number",
      value: Object.is(value, -0) ? "-0" : value.toString(),
    };
  }
  if (typeof value === "bigint")
    return { $pdb: "bigint", value: value.toString(10) };
  if (value instanceof ArrayBuffer) {
    return { $pdb: "bytes", value: bytesToBase64(new Uint8Array(value)) };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      $pdb: "bytes",
      value: bytesToBase64(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    };
  }
  if (Array.isArray(value)) {
    return withCycleCheck(value, state, () => ({
      $pdb: "array",
      value: value.map((item) => encodeValue(item, state, depth + 1)),
    }));
  }
  if (isPlainRecord(value)) {
    return withCycleCheck(value, state, () => {
      const entries: (readonly [string, WireValue])[] = [];
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string")
          throw codecError(
            "invalid-value",
            "Object symbol keys are not supported.",
          );
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw codecError(
            "invalid-value",
            "Only enumerable data properties are supported.",
          );
        }
        entries.push([key, encodeValue(descriptor.value, state, depth + 1)]);
      }
      return { $pdb: "object", value: entries };
    });
  }
  throw codecError(
    "invalid-value",
    `Unsupported protocol value type '${typeof value}'.`,
  );
}

function decodeValue(
  value: unknown,
  state: WalkState,
  depth: number,
): ProtocolValue {
  visitNode(state, depth);
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (!isRecord(value) || typeof value.$pdb !== "string") {
    throw codecError(
      "invalid-value",
      "Encoded composite values must use a PocketDB value tag.",
    );
  }
  if (value.$pdb === "undefined") {
    exactKeys(value, ["$pdb"]);
    return undefined;
  }
  exactKeys(value, ["$pdb", "value"]);
  switch (value.$pdb) {
    case "number": {
      if (typeof value.value !== "string") break;
      const decoded = value.value === "-0" ? -0 : Number(value.value);
      if (
        Number.isFinite(decoded) &&
        (decoded.toString() === value.value || value.value === "-0")
      )
        return decoded;
      break;
    }
    case "bigint":
      if (
        typeof value.value === "string" &&
        /^-?(0|[1-9]\d*)$/.test(value.value)
      ) {
        const decoded = BigInt(value.value);
        if (decoded.toString(10) === value.value) return decoded;
      }
      break;
    case "bytes":
      if (typeof value.value === "string") return base64ToBytes(value.value);
      break;
    case "array":
      if (Array.isArray(value.value))
        return value.value.map((item) => decodeValue(item, state, depth + 1));
      break;
    case "object": {
      if (!Array.isArray(value.value)) break;
      const decoded: Record<string, ProtocolValue> = {};
      for (const entry of value.value) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== "string"
        ) {
          throw codecError(
            "invalid-value",
            "Encoded object entries must be [string, value] pairs.",
          );
        }
        if (Object.hasOwn(decoded, entry[0]))
          throw codecError(
            "invalid-value",
            "Encoded object contains a duplicate key.",
          );
        Object.defineProperty(decoded, entry[0], {
          value: decodeValue(entry[1], state, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return decoded;
    }
  }
  throw codecError(
    "invalid-value",
    `Invalid '${value.$pdb}' protocol value tag.`,
  );
}

function visitNode(state: WalkState, depth: number): void {
  if (depth > state.limits.maxDepth)
    throw codecError(
      "value-too-deep",
      `Value depth exceeds ${state.limits.maxDepth}.`,
    );
  state.nodes += 1;
  if (state.nodes > state.limits.maxNodes)
    throw codecError(
      "too-many-values",
      `Value node count exceeds ${state.limits.maxNodes}.`,
    );
}

function checkWireStructure(value: unknown, limits: CodecLimits): void {
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (depth > limits.maxDepth)
      throw codecError(
        "value-too-deep",
        `Value depth exceeds ${limits.maxDepth}.`,
      );
    nodes += 1;
    if (nodes > limits.maxNodes)
      throw codecError(
        "too-many-values",
        `Value node count exceeds ${limits.maxNodes}.`,
      );
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
    } else if (isRecord(item)) {
      for (const [key, child] of Object.entries(item)) {
        visit(key, depth + 1);
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
}

function withCycleCheck<T>(
  value: object,
  state: WalkState,
  action: () => T,
): T {
  if (state.active.has(value))
    throw codecError("invalid-value", "Cyclic values are not supported.");
  state.active.add(value);
  try {
    return action();
  } finally {
    state.active.delete(value);
  }
}

function resolveLimits(limits?: Partial<CodecLimits>): CodecLimits {
  const result = { ...DEFAULT_LIMITS, ...limits };
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw codecError(
        "invalid-envelope",
        `Codec limit '${key}' must be a positive safe integer.`,
      );
    }
  }
  return result;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key))
      throw codecError("invalid-envelope", `Missing required field '${key}'.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw codecError("invalid-envelope", `Unexpected field '${key}'.`);
  }
}

function validId(value: unknown): void {
  validString(value, "id");
}

function validString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw codecError(
      "invalid-envelope",
      `${field} must be a non-empty string of at most 512 characters.`,
    );
  }
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    if (bytesToBase64(bytes) !== value) throw new Error("non-canonical base64");
    return bytes;
  } catch (cause) {
    throw codecError(
      "invalid-value",
      "Encoded bytes are not canonical base64.",
      cause,
    );
  }
}

function codecError(
  code: ProtocolCodecErrorCode,
  message: string,
  cause?: unknown,
): ProtocolCodecError {
  return new ProtocolCodecError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
