import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connectNode } from "../dist/index.js";

assert.equal(typeof connectNode, "function");
console.log("@pocketdb/node-client package import passed");

// The offering peer is unavailable. Only the signaling deadline should run.
const server = createServer(() => {});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const token = Buffer.from(
    JSON.stringify({
      version: 1,
      roomId: "pending-offer",
      instanceId: "test-instance",
      engineId: "kv",
      expectedHostId: "A".repeat(43),
      capability: "A".repeat(43),
      access: "read-only",
    }),
  ).toString("base64url");
  const uri = `pocketdb://pending-offer/kv#invite=${token}`;
  await assert.rejects(
    connectNode(uri, {
      signalingEndpoint: `http://127.0.0.1:${server.address().port}`,
      signalingTimeoutMs: 100,
      channelTimeoutMs: 5,
      connectTimeoutMs: 1000,
    }),
    /signaling/i,
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
