import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { withBrowser } from "../../../tests/support/chromium.mjs";
import { connectNode } from "../dist/index.js";

const repo = resolve(new URL("../../..", import.meta.url).pathname);
const webRoot = resolve(repo, "apps/web");
const viteModule = pathToFileURL(
  resolve(webRoot, "node_modules/vite/dist/node/index.js"),
);
const { createServer: createViteServer } = await import(viteModule.href);
const vite = await createViteServer({
  configFile: resolve(webRoot, "vite.config.ts"),
  root: webRoot,
  server: { host: "127.0.0.1", port: 0 },
});
const signaling = createSignalingServer();
const result = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
};

try {
  await Promise.all([
    new Promise((resolveListen) =>
      signaling.listen(0, "127.0.0.1", resolveListen),
    ),
    vite.listen(),
  ]);
  const signalAddress = signaling.address();
  const webAddress = vite.httpServer.address();
  assert(signalAddress && typeof signalAddress === "object");
  assert(webAddress && typeof webAddress === "object");
  const signalEndpoint = `http://127.0.0.1:${signalAddress.port}/api`;
  const webUrl = `http://127.0.0.1:${webAddress.port}/`;

  await withBrowser(async ({ page, version }) => {
    const host = await page(webUrl);
    await host.wait('Boolean(document.querySelector("#start-button"))');
    const kvInvitation = await startHost(host, "kv", signalEndpoint);
    const kv = await connectNode(kvInvitation, {
      signalingEndpoint: signalEndpoint,
      connectTimeoutMs: 60_000,
      signalingTimeoutMs: 30_000,
    });
    const key = "node-client-e2e";
    await kv.client.kv.set(key, "node-browser-roundtrip");
    const value = await kv.client.kv.get(key);
    assert.equal(
      new TextDecoder().decode(value ?? new Uint8Array()),
      "node-browser-roundtrip",
    );
    await kv.close();
    result.kv = {
      operation: "SET/GET",
      value: "node-browser-roundtrip",
      passed: true,
    };

    await host.evaluate('document.querySelector("#stop-button").click(); true');
    await host.wait(
      'document.querySelector("#runtime-status")?.dataset.state === "stopped"',
    );
    const sqlInvitation = await startHost(host, "postgresql", signalEndpoint);
    const sql = await connectNode(sqlInvitation, {
      signalingEndpoint: signalEndpoint,
      connectTimeoutMs: 60_000,
      signalingTimeoutMs: 30_000,
      requestTimeoutMs: 30_000,
    });
    const rows = await sql.client.query(
      "SELECT $1::text AS client, $2::text AS runtime",
      ["PocketDB Node SDK", process.version],
    );
    assert.deepEqual(rows.rows, [
      { client: "PocketDB Node SDK", runtime: process.version },
    ]);

    let timeout;
    try {
      await sql.client.query(
        "SELECT sum(i) AS total FROM generate_series(1, 10000000) AS series(i)",
        [],
        { timeoutMs: 1 },
      );
    } catch (error) {
      timeout = { code: error?.code, outcome: error?.outcome };
    }
    assert.equal(timeout?.outcome, "unknown");
    result.sql = { parameterizedQuery: rows, passed: true };
    result.timeout = timeout;

    const lost = new Promise((resolveLost, rejectLost) => {
      const timer = setTimeout(
        () => rejectLost(new Error("Host-loss event timed out.")),
        10_000,
      );
      sql.client.onStateChange?.((event) => {
        if (event.state !== "failed") return;
        clearTimeout(timer);
        resolveLost(event);
      });
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    await host.evaluate('document.querySelector("#stop-button").click(); true');
    await host.wait(
      'document.querySelector("#runtime-status")?.dataset.state === "stopped"',
      { timeoutMs: 30_000 },
    );
    const lossEvent = await lost;
    assert.equal(sql.client.state, "failed");
    await assert.rejects(
      sql.client.query("SELECT 1 AS unreachable"),
      (error) => error?.outcome === "not-started",
    );
    result.hostLoss = {
      state: lossEvent.state,
      laterOperation: "not-started",
      passed: true,
    };
    await sql.close();
    await host.close();
    result.browser = version;
  });
  const resultDirectory = resolve(repo, "test-results/task-044-node-client");
  await mkdir(resultDirectory, { recursive: true });
  await writeFile(
    resolve(resultDirectory, "results.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await vite.close();
  await new Promise((resolveClose) => signaling.close(resolveClose));
}

async function startHost(page, engine, endpoint) {
  await page.evaluate(
    `document.querySelector('[data-engine="${engine}"]').click(); document.querySelector("#start-button").click(); true`,
  );
  await page.wait(
    'document.querySelector("#runtime-status")?.dataset.state === "running"',
    { timeoutMs: 90_000 },
  );
  await page.evaluate(
    `document.querySelector("#signaling-endpoint").value = ${JSON.stringify(endpoint)}; document.querySelector("#invitation-access").value = "read-write"; document.querySelector("#create-invitation").click(); true`,
  );
  return page.wait(
    'document.querySelector("#invitation-list input")?.value || false',
    { timeoutMs: 15_000 },
  );
}

function createSignalingServer() {
  const descriptions = new Map();
  return createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const match = request.url?.match(
      /^\/api\/signal\/([A-Za-z0-9_-]+)\/(offer|answer)$/,
    );
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    const key = `${match[1]}/${match[2]}`;
    if (request.method === "POST") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 64 * 1024) {
          response.writeHead(413).end();
          return;
        }
      }
      descriptions.set(key, JSON.parse(body));
      response.writeHead(204).end();
      return;
    }
    const description = descriptions.get(key);
    if (!description) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(description));
  });
}
