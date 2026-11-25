import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readCommand } from "../src/resp-bridge.mjs";

const sample = Buffer.from("*2\r\n$3\r\nGET\r\n$1\r\nx\r\n");

describe("RESP2 command framing", () => {
  it("waits for fragmented input and consumes coalesced frames", () => {
    for (let length = 0; length < sample.length; length += 1) {
      assert.equal(readCommand(sample.subarray(0, length)), null);
    }
    const combined = Buffer.concat([sample, sample]);
    const first = readCommand(combined);
    assert.deepEqual(
      first.values.map((value) => value.toString()),
      ["GET", "x"],
    );
    assert.equal(first.consumed, sample.length);
    assert.equal(
      readCommand(combined.subarray(first.consumed)).consumed,
      sample.length,
    );
  });

  it("rejects invalid, oversized and malformed commands", () => {
    assert.throws(() => readCommand(Buffer.from("*1\r\n$4097\r\n")), /limit/);
    assert.throws(
      () => readCommand(Buffer.from("*1\r\n$1\r\nx00")),
      /terminator/,
    );
    assert.throws(() => readCommand(Buffer.from("*999999\r\n")), /RESP length/);
    assert.throws(() => readCommand(Buffer.from("?1\r\n")), /Expected RESP/);
  });
});
