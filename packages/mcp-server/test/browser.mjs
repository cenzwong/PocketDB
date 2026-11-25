import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { withBrowser } from "../../../artifacts/spike-support/chromium.mjs";

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
const mcpClient = new Client({
  name: "pocketdb-mcp-browser-test",
  version: "1",
});
const mcpTransport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(repo, "packages/mcp-server/dist/stdio.js")],
});

try {
  await Promise.all([
    new Promise((resolveListen) =>
      signaling.listen(0, "127.0.0.1", resolveListen),
    ),
    vite.listen(),
  ]);
  await mcpClient.connect(mcpTransport);
  const signalAddress = signaling.address();
  const webAddress = vite.httpServer.address();
  assert(signalAddress && typeof signalAddress === "object");
  assert(webAddress && typeof webAddress === "object");
  const signalingEndpoint = `http://127.0.0.1:${signalAddress.port}/api`;
  const webUrl = `http://127.0.0.1:${webAddress.port}/`;

  const result = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
  await withBrowser(async ({ page, version }) => {
    const host = await page(webUrl);
    await host.wait('Boolean(document.querySelector("#start-button"))');
    const invitationUri = await startReadOnlyHost(host, signalingEndpoint);
    const connected = await mcpClient.callTool({
      name: "pocketdb_connect",
      arguments: { invitationUri, signalingEndpoint },
    });
    assert.equal(Boolean(connected.isError), false);
    const data = connected.structuredContent;
    assert(data && typeof data === "object" && "data" in data);
    const connectionId = data.data.connectionId;

    const ping = await mcpClient.callTool({
      name: "pocketdb_key_value",
      arguments: { connectionId, command: "PING" },
    });
    assert.deepEqual(ping.structuredContent, { ok: true, data: "PONG" });

    const denied = await mcpClient.callTool({
      name: "pocketdb_key_value",
      arguments: {
        connectionId,
        command: "SET",
        key: "mcp-auth-check",
        value: "forbidden",
      },
    });
    assert.equal(denied.isError, true);
    assert.match(
      JSON.stringify(denied.structuredContent),
      /unsupported-operation|not-authorized|permission|read-only/i,
    );

    const inspect = await mcpClient.callTool({
      name: "pocketdb_inspect",
      arguments: { connectionId },
    });
    assert.equal(Boolean(inspect.isError), false);
    assert.match(JSON.stringify(inspect.structuredContent), /PING|GET/);

    const closed = await mcpClient.callTool({
      name: "pocketdb_disconnect",
      arguments: { connectionId },
    });
    assert.deepEqual(closed.structuredContent, {
      ok: true,
      data: { disconnected: true },
    });
    await host.close();
    result.browser = version;
    result.engine = "kv";
    result.mcpTransport = "stdio subprocess";
    result.agentClient = "MCP Client SDK";
    result.authorizedOperation = "PING";
    result.unauthorizedOperation = "SET denied by read-only invitation";
    result.connectionLifecycle = "connect, inspect, disconnect";
    result.passed = true;
  });
  const artifactDirectory = resolve(repo, "artifacts/task-061-mcp-operations");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    resolve(artifactDirectory, "results.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await mcpClient.close().catch(() => undefined);
  await vite.close();
  await new Promise((resolveClose) => signaling.close(resolveClose));
}

async function startReadOnlyHost(page, endpoint) {
  await page.evaluate(
    'document.querySelector(\'[data-engine="kv"]\').click(); document.querySelector("#start-button").click(); true',
  );
  await page.wait(
    'document.querySelector("#runtime-status")?.dataset.state === "running"',
    { timeoutMs: 90_000 },
  );
  await page.evaluate(
    `document.querySelector("#signaling-endpoint").value = ${JSON.stringify(endpoint)}; document.querySelector("#invitation-access").value = "read-only"; document.querySelector("#create-invitation").click(); true`,
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
    if (request.method === "OPTIONS") return response.writeHead(204).end();
    const match = request.url?.match(
      /^\/api\/signal\/([A-Za-z0-9_-]+)\/(offer|answer)$/,
    );
    if (!match) return response.writeHead(404).end();
    const key = `${match[1]}/${match[2]}`;
    if (request.method === "POST") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 64 * 1024)
          return response.writeHead(413).end();
      }
      descriptions.set(key, JSON.parse(body));
      return response.writeHead(204).end();
    }
    const description = descriptions.get(key);
    if (!description) return response.writeHead(404).end();
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(description));
  });
}
