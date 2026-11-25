import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withBrowser } from "../spike-support/chromium.mjs";
import { withSite } from "../spike-support/static.mjs";

const dependencies = process.env.POCKETDB_NODE_MODULES;
const { default: Turn } = await import(dependencies ? join(dependencies, "node-turn/lib/server.js") : "node-turn");
const directory = fileURLToPath(new URL(".", import.meta.url));
const messages = new Map();
const rooms = new Set();
async function route(path, request, response) {
  const parts = /^\/signal\/([a-f0-9]+)\/(offer|answer)$/.exec(path);
  if (!parts) return false;
  if (!rooms.has(parts[1])) {
    response.writeHead(404).end();
    return true;
  }
  if (request.method === "POST") {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 65_536) {
        response.writeHead(413).end();
        return true;
      }
    }
    messages.set(path, body);
    response.writeHead(204).end();
  } else if (request.method === "GET" && messages.has(path)) {
    response.writeHead(200, { "Content-Type": "application/json" }).end(messages.get(path));
  } else {
    response.writeHead(404).end();
  }
  return true;
}

const relayPort = Number(process.env.POCKETDB_TURN_PORT ?? 34791);
const credential = randomBytes(24).toString("hex");
const turnActivity = { listenerReady: false, receivedBinding: false, receivedAllocate: false };
let listening;
let failed;
const started = new Promise((resolve, reject) => {
  listening = resolve;
  failed = reject;
});
const listenerTimer = setTimeout(() => failed(new Error("TURN listener did not start")), 5000);
const turn = new Turn({
  listeningIps: ["127.0.0.1"], relayIps: ["127.0.0.1"], listeningPort: relayPort,
  minPort: 55000, maxPort: 55100, authMech: "long-term", credentials: { probe: credential },
  debugLevel: "ALL",
  debug(_level, message) {
    if (message instanceof Error && !turnActivity.listenerReady) failed(message);
    if (typeof message !== "string") return;
    if (message.includes("Server is listening")) {
      turnActivity.listenerReady = true;
      listening();
    }
  },
});
turn.on("binding", () => { turnActivity.receivedBinding = true; });
turn.on("allocate", () => { turnActivity.receivedAllocate = true; });
turn.start();

try {
  await started;
  clearTimeout(listenerTimer);
  const results = await withSite(directory, (url) => withBrowser(async (browser) => {
    async function sample(name, configuration, automatic) {
      const room = randomBytes(16).toString("hex");
      rooms.add(room);
      const [host, client] = await Promise.all([browser.page(url), browser.page(url)]);
      for (const [role, page] of [["host", host], ["client", client]]) {
        await page.wait("Boolean(globalThis.createPeer)");
        await page.evaluate(`globalThis.probe = createPeer(${JSON.stringify(role)}, ${JSON.stringify(configuration)}); true`);
      }

      let exchange = false;
      let error;
      const start = performance.now();
      try {
        if (automatic) {
          await Promise.all([host, client].map((page) => page.evaluate(`probe.automatic("${room}")`)));
        } else {
          const offer = await client.evaluate("probe.makeOffer()");
          const answer = await host.evaluate(`probe.makeAnswer(${JSON.stringify(offer)})`);
          await client.evaluate(`probe.acceptAnswer(${JSON.stringify(answer)})`);
        }
        exchange = await client.evaluate("probe.check()");
      } catch (failure) {
        error = failure.message.split("\n")[0];
      }
      const ms = Math.round(performance.now() - start);
      const peers = await Promise.all([host, client].map((page) => page.evaluate("probe.diagnostics()")));
      for (const page of [host, client]) {
        await page.evaluate("probe.close()");
        await page.close();
      }
      rooms.delete(room);
      for (const role of ["offer", "answer"]) messages.delete(`/signal/${room}/${role}`);
      return { name, exchange, ms, peers, ...(error ? { error } : {}) };
    }

    const manual = await sample("manual direct", { iceServers: [] }, false);
    const discovery = await sample("HTTP room direct", { iceServers: [] }, true);
    const stun = await sample("HTTP room with local STUN", {
      iceServers: [{ urls: `stun:127.0.0.1:${relayPort}` }],
    }, true);
    const restricted = await sample("relay required without TURN", {
      iceServers: [], iceTransportPolicy: "relay",
    }, true);
    const relay = await sample("relay required with local TURN", {
      iceTransportPolicy: "relay",
      iceServers: [{ urls: `turn:127.0.0.1:${relayPort}?transport=udp`, username: "probe", credential }],
    }, true);

    assert(manual.exchange && discovery.exchange && stun.exchange && !restricted.exchange);
    if (relay.exchange) assert(relay.peers.every((peer) => peer.selected?.local === "relay"));
    return { browser: browser.version, cases: [manual, discovery, stun, restricted, relay] };
  }), { route });
  const report = JSON.stringify({ ...results, turnActivity, externalIceServicesConfigured: false }, null, 2);
  await new Promise((resolve, reject) => process.stdout.write(report + "\n", (error) => error ? reject(error) : resolve()));
} finally {
  clearTimeout(listenerTimer);
  if (turnActivity.listenerReady) turn.stop();
}
// The fixture process owns the relay. node-turn leaves allocation timers alive after stop().
process.exit(0);
