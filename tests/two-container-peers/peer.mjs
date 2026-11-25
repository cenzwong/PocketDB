import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { withBrowser } from "../support/chromium.mjs";

const role = process.env.POCKETDB_PEER_ROLE;
const shared = process.env.POCKETDB_SHARED ?? "/shared";
const root = resolve(new URL("../../", import.meta.url).pathname);
const webRoot = resolve(root, "apps/web");
const viteModule = pathToFileURL(
  resolve(webRoot, "node_modules/vite/dist/node/index.js"),
);
const { createServer: createViteServer } = await import(viteModule.href);
const vite = await createViteServer({
  configFile: resolve(webRoot, "vite.config.ts"),
  root: webRoot,
  server: { host: "127.0.0.1", port: 0 },
});
let signaling;

if (role === "host") signaling = startSignalingServer();
await vite.listen();
const address = vite.httpServer.address();
assert(address && typeof address === "object");
const appUrl = `http://127.0.0.1:${address.port}/`;

try {
  await withBrowser(
    async (browser) => {
      const page = await browser.page(appUrl, undefined);
      await page.wait("Boolean(document.querySelector('#setup-form'))");
      if (role === "host") await runHost(page);
      else if (role === "client") await runClient(page, browser.version);
      else throw new Error("POCKETDB_PEER_ROLE must be host or client.");
      await page.close();
    },
    [
      "--ignore-certificate-errors",
      "--disable-features=WebRtcHideLocalIpsWithMdns",
    ],
  );
} finally {
  await vite.close();
  signaling?.close();
}

async function runHost(page) {
  for (const scenario of [
    { index: 1, engine: "kv", access: "read-write" },
    { index: 2, engine: "postgresql", access: "read-only" },
  ]) {
    if (scenario.index > 1) {
      await page.evaluate("document.querySelector('#stop-button').click()");
      await page.wait(
        "document.querySelector('#runtime-status').textContent === 'Stopped'",
      );
      await page.evaluate(
        `document.querySelector('[data-engine="${scenario.engine}"]').click()`,
      );
    } else {
      await page.evaluate(
        `document.querySelector('[data-engine="${scenario.engine}"]').click()`,
      );
    }
    await page.evaluate(
      "document.querySelector('#setup-form').requestSubmit()",
    );
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
      { timeoutMs: 60_000 },
    );
    await page.wait("!document.querySelector('#create-invitation').disabled");
    if (scenario.engine === "postgresql") {
      for (const sql of [
        "CREATE TABLE remote_proof(value text)",
        "INSERT INTO remote_proof(value) VALUES ('container-peer')",
      ]) {
        await page.evaluate(`(() => {
          const input = document.querySelector('#sql-input');
          input.value = ${JSON.stringify(sql)};
          document.querySelector('#run-query').click();
        })()`);
        await page.wait(
          "document.querySelector('#activity-message').textContent.includes('query completed') || document.querySelector('#error-message').textContent !== 'No errors.'",
        );
        const seedError = await page.evaluate(
          "document.querySelector('#error-message').textContent",
        );
        assert.equal(seedError, "No errors.", seedError);
      }
    }
    await page.evaluate(`(() => {
      const endpoint = document.querySelector('#signaling-endpoint');
      endpoint.value = 'https://pdb-host:8443/api';
      endpoint.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#invitation-access').value = '${scenario.access}';
      document.querySelector('#create-invitation').click();
    })()`);
    try {
      await page.wait(
        "document.querySelector('#invitation-list input')?.value.includes('#invite=')",
        { timeoutMs: 30_000 },
      );
    } catch (error) {
      const state = await page.evaluate(`({
        status: document.querySelector('#runtime-status')?.textContent,
        engine: document.querySelector('[data-engine].is-selected')?.dataset.engine,
        endpoint: document.querySelector('#signaling-endpoint')?.value,
        buttonDisabled: document.querySelector('#create-invitation')?.disabled,
        activity: document.querySelector('#activity-message')?.textContent,
        error: document.querySelector('#error-message')?.textContent,
        invitationCount: document.querySelectorAll('#invitation-list input').length,
      })`);
      throw new Error(
        `${error.message}; host page state: ${JSON.stringify(state)}`,
      );
    }
    const invitation = await page.evaluate(
      "document.querySelector('#invitation-list input').value",
    );
    await writeFile(`${shared}/invitation-${scenario.index}.txt`, invitation);
    await waitForFile(`${shared}/result-${scenario.index}.json`, 180_000);
    await page
      .wait(
        "document.querySelector('#host-peer-count').textContent.includes('No connected peers')",
        { timeoutMs: 20_000 },
      )
      .catch(() => undefined);
    if (scenario.index === 1) {
      await page.evaluate("document.querySelector('#stop-button').click()");
      await page.wait(
        "document.querySelector('#runtime-status').textContent === 'Stopped'",
      );
    }
  }
  await writeFile(`${shared}/host-complete`, "ok");
}

async function runClient(page, browserVersion) {
  for (const scenario of [1, 2]) {
    const invitation = await waitForText(
      `${shared}/invitation-${scenario}.txt`,
      180_000,
    );
    await page.evaluate(`(() => {
      document.querySelector('#client-mode-button').click();
      document.querySelector('#client-invitation').value = ${JSON.stringify(invitation)};
      document.querySelector('#client-signaling-endpoint').value = 'https://pdb-host:8443/api';
      document.querySelector('#client-connection-form').requestSubmit();
    })()`);
    try {
      await page.wait(
        "document.querySelector('#client-status').textContent.startsWith('Connected')",
        { timeoutMs: 150_000 },
      );
    } catch (error) {
      const state = await page.evaluate(`({
        status: document.querySelector('#client-status')?.textContent,
        activity: document.querySelector('#activity-message')?.textContent,
        error: document.querySelector('#error-message')?.textContent,
      })`);
      throw new Error(
        `${error.message}; client page state: ${JSON.stringify(state)}`,
      );
    }
    if (scenario === 1) {
      await clientKv(page, "SET", ["container-proof", "remote-value"]);
      const getLatencyMs = [await clientKv(page, "GET", ["container-proof"])];
      for (let sample = 1; sample < 20; sample += 1) {
        getLatencyMs.push(await clientKv(page, "GET", ["container-proof"]));
      }
      const value = await page.evaluate(
        "document.querySelector('#client-result-content').textContent",
      );
      assert.match(value, /remote-value/);
      const sorted = [...getLatencyMs].sort((left, right) => left - right);
      await writeFile(
        `${shared}/result-1.json`,
        JSON.stringify(
          {
            engine: "kv",
            browser: browserVersion,
            set: "passed",
            get: value,
            directGetLatencyMs: getLatencyMs,
            p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
            p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
          },
          null,
          2,
        ),
      );
    } else {
      await page.evaluate(`(() => {
        const sql = document.querySelector('#client-sql-input');
        sql.value = 'SELECT value FROM remote_proof WHERE value = $1';
        document.querySelector('#client-sql-params').value = '["container-peer"]';
        document.querySelector('#client-run-query').click();
      })()`);
      await page.wait(
        "document.querySelector('#activity-message').textContent.includes('Remote SQL query completed') || document.querySelector('#activity-message').textContent.includes('remote SQL query failed')",
      );
      const queryState = await page.evaluate(`({
        activity: document.querySelector('#activity-message').textContent,
        error: document.querySelector('#error-message').textContent,
        result: document.querySelector('#client-result-content').textContent,
      })`);
      assert.match(
        queryState.activity,
        /completed/i,
        JSON.stringify(queryState),
      );
      assert.match(
        queryState.result,
        /container-peer/,
        JSON.stringify(queryState),
      );
      await page.evaluate(`(() => {
        document.querySelector('#client-sql-input').value = 'CREATE TABLE unauthorized_probe(id integer)';
        document.querySelector('#client-sql-params').value = '[]';
        document.querySelector('#client-run-query').click();
      })()`);
      await page.wait(
        "document.querySelector('#error-message').textContent !== 'No errors.'",
      );
      const error = await page.evaluate(
        "document.querySelector('#error-message').textContent",
      );
      assert.match(error, /permission|read.only|denied|not allowed/i);
      await writeFile(
        `${shared}/result-2.json`,
        JSON.stringify({
          engine: "postgresql",
          browser: browserVersion,
          parameterizedQuery: "passed",
          unauthorized: error,
        }),
      );
    }
    await page.evaluate(
      "document.querySelector('#client-disconnect-button').click()",
    );
    await page.wait(
      "document.querySelector('#client-status').textContent === 'Not connected'",
    );
  }
}

async function clientKv(page, operation, args) {
  const elapsedMs =
    await page.evaluate(`(() => new Promise((resolve, reject) => {
    const started = performance.now();
    const observer = new MutationObserver(() => {
      if (document.querySelector('#activity-message').textContent.includes('Remote ${operation} completed.')) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(performance.now() - started);
      }
    });
    observer.observe(document.querySelector('#activity-message'), { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Remote ${operation} did not complete for the latency sample.'));
    }, 15_000);
    document.querySelector('#client-kv-command').value = '${operation}';
    document.querySelector('#client-kv-arguments').value = ${JSON.stringify(JSON.stringify(args))};
    document.querySelector('#client-kv-form').requestSubmit();
  }))()`);
  if (operation === "GET")
    await page.wait(
      "document.querySelector('#client-result-content').textContent.includes('remote-value')",
    );
  else
    await page.wait(
      "document.querySelector('#client-result-content').textContent.includes('OK')",
    );
  return elapsedMs;
}

function startSignalingServer() {
  const state = new Map();
  const server = createHttpsServer(
    {
      key: readFileSync(`${shared}/server-key.pem`),
      cert: readFileSync(`${shared}/server-cert.pem`),
    },
    (request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "content-type");
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
      const key = `${match[1]}:${match[2]}`;
      console.log(`${request.method} ${request.url}`);
      if (request.method === "POST") {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          state.set(key, body);
          response.writeHead(204).end();
        });
        return;
      }
      const body = state.get(key);
      if (!body) {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(body);
    },
  );
  server.listen(8443, "0.0.0.0");
  return server;
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForText(path, timeoutMs) {
  await waitForFile(path, timeoutMs);
  return (await readFile(path, "utf8")).trim();
}
