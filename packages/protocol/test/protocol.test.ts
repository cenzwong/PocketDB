import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/v1-messages.json";
import {
  decodeEnvelope,
  encodeEnvelope,
  ProtocolCodecError,
  PROTOCOL_VERSION,
  type ProtocolEnvelope,
  type ProtocolValue,
} from "../src";

describe("PocketDB protocol v1 codec", () => {
  it.each(fixtures)("round-trips the $name fixture", ({ envelope }) => {
    const decoded = decodeEnvelope(JSON.stringify(envelope));
    expect(JSON.parse(encodeEnvelope(decoded))).toEqual(envelope);
  });

  it("preserves supported binary, SQL and JSON value types losslessly", () => {
    const value = {
      bytes: new Uint8Array([0, 255, 65]),
      view: new DataView(new Uint8Array([0, 128, 255]).buffer),
      exactInteger: 9_007_199_254_740_993n,
      negativeZero: -0,
      decimal: "12345678901234567890.0001",
      nested: [
        null,
        true,
        undefined,
        { $pdb: "bytes", value: "application data" },
      ],
    };
    const envelope: ProtocolEnvelope = {
      version: PROTOCOL_VERSION,
      type: "request",
      id: "r-1",
      sessionId: "s-1",
      instanceId: "i-1",
      engineId: "postgres",
      operation: "query",
      payload: value,
    };
    const decoded = decodeEnvelope(encodeEnvelope(envelope));
    expect(decoded.type).toBe("request");
    if (decoded.type !== "request")
      throw new Error("Expected request envelope.");
    expect(decoded.payload).toEqual({
      bytes: new Uint8Array([0, 255, 65]),
      view: new Uint8Array([0, 128, 255]),
      exactInteger: 9_007_199_254_740_993n,
      negativeZero: -0,
      decimal: "12345678901234567890.0001",
      nested: [
        null,
        true,
        undefined,
        { $pdb: "bytes", value: "application data" },
      ],
    });
    const payload = decoded.payload as { negativeZero: number };
    expect(Object.is(payload.negativeZero, -0)).toBe(true);
  });

  it("accepts a message exactly at its byte limit and rejects one byte less", () => {
    const envelope: ProtocolEnvelope = {
      version: PROTOCOL_VERSION,
      type: "hello",
      id: "h-1",
      supportedVersions: [1],
    };
    const encoded = encodeEnvelope(envelope);
    const byteLength = new TextEncoder().encode(encoded).byteLength;
    expect(decodeEnvelope(encoded, { maxBytes: byteLength }).type).toBe(
      "hello",
    );
    expect(() => decodeEnvelope(encoded, { maxBytes: byteLength - 1 })).toThrow(
      expect.objectContaining({ code: "message-too-large" }),
    );
    expect(() =>
      encodeEnvelope(envelope, { maxBytes: byteLength - 1 }),
    ).toThrow(expect.objectContaining({ code: "message-too-large" }));
  });

  it("round-trips the versioned authentication challenge and proof messages", () => {
    const messages: ProtocolEnvelope[] = [
      {
        version: PROTOCOL_VERSION,
        type: "authentication-challenge",
        id: "challenge-1",
        nonce: "nonce",
        clientIdentity: "client-key",
        hostPublicKey: "host-key",
        expiresAt: Date.now() + 10_000,
        signature: "signature",
      },
      {
        version: PROTOCOL_VERSION,
        type: "authentication-proof",
        id: "proof-1",
        nonce: "nonce",
        identityProof: "identity-proof",
        capabilityProof: "capability-proof",
      },
    ];
    for (const message of messages) {
      expect(decodeEnvelope(encodeEnvelope(message))).toEqual(message);
    }
  });

  it("rejects invalid UTF-8 and malformed JSON with structured errors", () => {
    expect(() => decodeEnvelope(new Uint8Array([0xff]))).toThrow(
      expect.objectContaining({ code: "invalid-utf8" }),
    );
    expect(() => decodeEnvelope("{")).toThrow(
      expect.objectContaining({ code: "malformed-json" }),
    );
  });

  it("rejects unsupported versions and malformed envelopes", () => {
    expect(() =>
      decodeEnvelope(
        '{"version":2,"type":"hello","id":"h","supportedVersions":[2]}',
      ),
    ).toThrow(expect.objectContaining({ code: "unsupported-version" }));
    expect(() =>
      decodeEnvelope('{"version":1,"type":"request","id":"r"}'),
    ).toThrow(expect.objectContaining({ code: "invalid-envelope" }));
  });

  it("bounds nesting and node counts before accepting payloads", () => {
    const envelope: ProtocolEnvelope = {
      version: PROTOCOL_VERSION,
      type: "response",
      id: "r-1",
      sessionId: "s-1",
      payload: [[[["too deep"]]]],
    };
    expect(() => encodeEnvelope(envelope, { maxDepth: 2 })).toThrow(
      expect.objectContaining({ code: "value-too-deep" }),
    );
    expect(() => encodeEnvelope(envelope, { maxNodes: 3 })).toThrow(
      expect.objectContaining({ code: "too-many-values" }),
    );
  });

  it("rejects cycles, non-finite numbers and untagged wire objects", () => {
    const cycle: Record<string, ProtocolValue> = {};
    cycle.self = cycle;
    const envelope: ProtocolEnvelope = {
      version: PROTOCOL_VERSION,
      type: "response",
      id: "r-1",
      sessionId: "s-1",
      payload: cycle,
    };
    expect(() => encodeEnvelope(envelope)).toThrow(
      expect.objectContaining({ code: "invalid-value" }),
    );
    const nonFiniteEnvelope: ProtocolEnvelope = {
      version: PROTOCOL_VERSION,
      type: "response",
      id: "r-2",
      sessionId: "s-1",
      payload: Number.NaN,
    };
    expect(() => encodeEnvelope(nonFiniteEnvelope)).toThrow(
      expect.objectContaining({ code: "invalid-value" }),
    );
    expect(() =>
      decodeEnvelope(
        '{"version":1,"type":"response","id":"r","sessionId":"s","payload":{"raw":"object"}}',
      ),
    ).toThrow(expect.objectContaining({ code: "invalid-value" }));
  });

  it("throws a typed error for codec failures", () => {
    try {
      decodeEnvelope("not json");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolCodecError);
      expect((error as ProtocolCodecError).code).toBe("malformed-json");
    }
  });
});
