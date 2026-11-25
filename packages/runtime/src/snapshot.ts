import { EngineOperationError } from "./contracts";

export const SNAPSHOT_FORMAT_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;

const MAGIC = new TextEncoder().encode("POCKETDB-SNAPSHOT\n");
const HEADER_LENGTH_BYTES = 4;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface SnapshotHeader {
  readonly formatVersion: number;
  readonly engineId: string;
  readonly createdAt: number;
  readonly payloadFormat: string;
  readonly payloadBytes: number;
  readonly engineVersion?: string;
}

export function encodeSnapshot(
  engineId: string,
  payloadFormat: string,
  payload: Uint8Array,
  createdAt = Date.now(),
  engineVersion?: string,
): Uint8Array {
  if (
    !engineId.trim() ||
    !payloadFormat.trim() ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0
  ) {
    throw invalidSnapshot("Snapshot metadata is invalid.");
  }
  if (payload.byteLength > MAX_SNAPSHOT_BYTES) {
    throw invalidSnapshot("Snapshot exceeds the supported size limit.");
  }
  const header = encoder.encode(
    JSON.stringify({
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      engineId,
      createdAt,
      payloadFormat,
      payloadBytes: payload.byteLength,
      ...(engineVersion ? { engineVersion } : {}),
    } satisfies SnapshotHeader),
  );
  const headerOffset = MAGIC.byteLength + HEADER_LENGTH_BYTES;
  const payloadOffset = headerOffset + header.byteLength;
  if (payloadOffset + payload.byteLength > MAX_SNAPSHOT_BYTES) {
    throw invalidSnapshot("Snapshot exceeds the supported size limit.");
  }
  const result = new Uint8Array(payloadOffset + payload.byteLength);
  result.set(MAGIC);
  new DataView(result.buffer).setUint32(MAGIC.byteLength, header.byteLength);
  result.set(header, headerOffset);
  result.set(payload, payloadOffset);
  return result;
}

export function decodeSnapshot(
  input: Uint8Array,
  expectedEngineId: string,
  expectedPayloadFormat: string,
  expectedEngineVersion?: string,
): { readonly header: SnapshotHeader; readonly payload: Uint8Array } {
  if (!(input instanceof Uint8Array) || input.byteLength > MAX_SNAPSHOT_BYTES) {
    throw invalidSnapshot(
      "Snapshot is missing or exceeds the supported size limit.",
    );
  }
  const minLength = MAGIC.byteLength + HEADER_LENGTH_BYTES;
  if (
    input.byteLength < minLength ||
    !bytesEqual(input.subarray(0, MAGIC.byteLength), MAGIC)
  ) {
    throw invalidSnapshot("Snapshot magic or header is invalid.");
  }

  const headerLength = new DataView(
    input.buffer,
    input.byteOffset,
    input.byteLength,
  ).getUint32(MAGIC.byteLength);
  const headerOffset = minLength;
  const payloadOffset = headerOffset + headerLength;
  if (headerLength === 0 || payloadOffset > input.byteLength) {
    throw invalidSnapshot("Snapshot header length is invalid.");
  }

  let value: unknown;
  try {
    value = JSON.parse(
      decoder.decode(input.subarray(headerOffset, payloadOffset)),
    );
  } catch (cause) {
    throw invalidSnapshot("Snapshot header is not valid UTF-8 JSON.", cause);
  }
  if (!isSnapshotHeader(value)) {
    throw invalidSnapshot("Snapshot header fields are invalid.");
  }
  if (
    value.formatVersion !== SNAPSHOT_FORMAT_VERSION ||
    value.engineId !== expectedEngineId ||
    value.payloadFormat !== expectedPayloadFormat ||
    (expectedEngineVersion !== undefined &&
      value.engineVersion !== expectedEngineVersion)
  ) {
    throw new EngineOperationError(
      "snapshot-incompatible",
      "Snapshot format, version or engine does not match this destination.",
    );
  }
  const payload = input.subarray(payloadOffset);
  if (payload.byteLength !== value.payloadBytes) {
    throw invalidSnapshot("Snapshot payload length does not match its header.");
  }
  return { header: value, payload: payload.slice() };
}

function isSnapshotHeader(value: unknown): value is SnapshotHeader {
  if (typeof value !== "object" || value === null) return false;
  const header = value as Partial<SnapshotHeader>;
  return (
    Number.isSafeInteger(header.formatVersion) &&
    typeof header.engineId === "string" &&
    Number.isSafeInteger(header.createdAt) &&
    (header.createdAt as number) >= 0 &&
    typeof header.payloadFormat === "string" &&
    (header.engineVersion === undefined ||
      typeof header.engineVersion === "string") &&
    Number.isSafeInteger(header.payloadBytes) &&
    (header.payloadBytes as number) >= 0
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function invalidSnapshot(
  message: string,
  cause?: unknown,
): EngineOperationError {
  return new EngineOperationError("snapshot-invalid", message, { cause });
}
