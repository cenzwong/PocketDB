import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withBrowser } from "../spike-support/chromium.mjs";
import { withSite } from "../spike-support/static.mjs";
import { withFixture } from "../spike-support/stage.mjs";
import { connectPeer } from "../spike-support/native-peer.mjs";
import { bridge, readCommand } from "./resp.mjs";

const directory = fileURLToPath(new URL("./site", import.meta.url));
const dependencies = process.env.POCKETDB_NODE_MODULES;
const native = await import(dependencies ? join(dependencies, "node-datachannel/dist/esm/lib/index.mjs") : "node-datachannel");
const { createClient, RESP_TYPES } = await import(dependencies ? join(dependencies, "redis/dist/index.js") : "redis");
const sample = Buffer.from("*2\r\n$3\r\nGET\r\n$1\r\nx\r\n");
for (let length = 0; length < sample.length; length++) assert.equal(readCommand(sample.subarray(0, length)), null);
assert.equal(readCommand(Buffer.concat([sample, sample])).consumed, sample.length);
assert.throws(() => readCommand(Buffer.from("*1\r\n$4097\r\n")), /limit/);
assert.throws(() => readCommand(Buffer.from("*1\r\n$1\r\nx00")), /terminator/);

const result = await withFixture(directory, (stage) => withSite(stage, (url) => withBrowser(async (browser) => {
  const page = await browser.page(url);
  const remote = await connectPeer(page, native);
  const commands = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    bridge(socket, remote, commands);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = createClient({
    url: `redis://127.0.0.1:${server.address().port}`, RESP: 2,
    socket: { reconnectStrategy: false },
  }).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
  client.on("error", () => {});
  try {
    await client.connect();
    assert.equal(await client.ping(), "PONG");
    const key = Buffer.from([255, 0, 75]);
    const value = Buffer.from([0, 255, 13, 10, 42]);
    assert.equal(await client.set(key, value), "OK");
    assert.deepEqual(await client.get(key), value);
    assert.equal(await client.get("missing"), null);
    assert.equal(await page.evaluate(`probeValue(${JSON.stringify(key.toString("base64"))})`), value.toString("base64"));
    await assert.rejects(client.sendCommand(["INCR", "missing"]), /unsupported command or arguments/);
    return { browser: browser.version, commands, binaryRoundTrip: true, missingIsNull: true,
      unsupported: "ERR unsupported command or arguments", browserOwnsValue: true,
      parser: { fragmented: true, coalesced: true, lengthBound: true, malformedTerminator: true } };
  } finally {
    if (client.isOpen) client.destroy();
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => server.close(resolve));
    remote.close();
  }
})));
native.cleanup();
console.log(JSON.stringify({ node: process.version, client: "node-redis 6.4.0", ...result }, null, 2));
