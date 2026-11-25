import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withBrowser } from "../spike-support/chromium.mjs";
import { withSite } from "../spike-support/static.mjs";

const kind = process.argv[2] ?? "node-datachannel";
const dependencies = process.env.POCKETDB_NODE_MODULES;
const root = fileURLToPath(new URL("../task-003-webrtc/site", import.meta.url));
async function until(read, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function connectNative(onMessage) {
  const { PeerConnection, cleanup, getLibraryVersion } = await import(
    dependencies ? join(dependencies, "node-datachannel/dist/esm/lib/index.mjs") : "node-datachannel"
  );
  const peer = new PeerConnection("PocketDB probe", { iceServers: [] });
  const channel = peer.createDataChannel("pocketdb");
  channel.onMessage(onMessage);
  return {
    library: getLibraryVersion(),
    offer: () => until(() => peer.gatheringState() === "complete" && peer.localDescription(), "native offer"),
    answer: ({ sdp, type }) => peer.setRemoteDescription(sdp, type),
    open: () => channel.isOpen(),
    send: (message) => assert(channel.sendMessage(message)),
    state: () => [peer.state(), peer.iceState()],
    async close() {
      channel.close();
      peer.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      cleanup();
    },
  };
}

async function connectWerift(onMessage) {
  const { RTCPeerConnection } = await import(
    dependencies ? join(dependencies, "werift/lib/webrtc/src/index.js") : "werift"
  );
  const peer = new RTCPeerConnection({ iceServers: [], iceUseDefaultStunServer: false });
  const channel = peer.createDataChannel("pocketdb");
  channel.onMessage.subscribe(onMessage);
  return {
    async offer() {
      await peer.setLocalDescription(await peer.createOffer());
      return peer.localDescription;
    },
    answer: (answer) => peer.setRemoteDescription(answer),
    open: () => channel.readyState === "open",
    send: (message) => channel.send(message),
    state: () => [peer.connectionState, peer.iceConnectionState],
    close: () => peer.close(),
  };
}

assert(["node-datachannel", "werift"].includes(kind));
const responseById = new Map();
const peer = await (kind === "werift" ? connectWerift : connectNative)((message) => {
  const response = JSON.parse(message.toString());
  responseById.set(response.id, response);
});
try {
  const result = await withSite(root, (url) => withBrowser(async (browser) => {
    const page = await browser.page(url);
    await page.wait('document.querySelector("#result")?.textContent.includes("userAgent")');
    const offer = await peer.offer();
    const started = performance.now();
    await page.evaluate(`document.querySelector("#incoming").value = ${JSON.stringify(JSON.stringify(offer))};
      document.querySelector("#answer").click(); true`);
    const answer = JSON.parse(await page.wait('document.querySelector("#outgoing").value'));
    await peer.answer(answer);
    await until(peer.open, `data channel (states at SDP apply: ${peer.state().join(", ")})`);
    const openMs = performance.now() - started;
    const checks = [];
    const value = randomUUID();
    for (const [id, op, expected] of [[1, "set", "OK"], [2, "get", value]]) {
      const requestStarted = performance.now();
      peer.send(JSON.stringify({ id, op, key: "native", value }));
      const response = await until(() => responseById.get(id), `response ${id}`);
      assert.equal(response.value, expected);
      checks.push({ id, op, roundTripUpperBoundMs: performance.now() - requestStarted });
    }
    const host = await page.evaluate('JSON.parse(document.querySelector("#result").textContent)');
    return { browser: browser.version, openUpperBoundMs: openMs, checks, host };
  }));
  console.log(JSON.stringify({ kind, node: process.version, platform: process.platform,
    architecture: process.arch, napi: process.versions.napi, library: peer.library, ...result }, null, 2));
} finally {
  await peer.close();
}
