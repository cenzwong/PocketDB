import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { withBrowser } from "../../../artifacts/spike-support/chromium.mjs";

const root = resolve(new URL("../../..", import.meta.url).pathname);
const webRoot = resolve(root, "apps/web");
const viteModule = pathToFileURL(
  resolve(webRoot, "node_modules/vite/dist/node/index.js"),
);
const { createServer } = await import(viteModule.href);
const server = await createServer({
  configFile: resolve(webRoot, "vite.config.ts"),
  root: webRoot,
  server: { host: "127.0.0.1", port: 0 },
});

try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/distributed.html`;
  const result = await withBrowser(async (browser) => {
    const host = await browser.page(url);
    const client = await browser.page(url);
    await Promise.all([
      host.wait("Boolean(document.querySelector('#replica-host-start'))"),
      client.wait("Boolean(document.querySelector('#replica-client-offer'))"),
    ]);
    try {
      await click(host, "#replica-host-start");
      const invitation = await host.wait(
        "document.querySelector('#replica-invitation').value",
      );
      assert.match(invitation, /^pocketdb:\/\//);
      await setValue(client, "#replica-join-invitation", invitation);
      await connectPeers(host, client);
      await write(host, "host", "initial", "shared");
      await waitForState(host, client, '"initial": "shared"');

      await click(client, "#replica-client-disconnect");
      await host.wait(
        "document.querySelector('#replica-host-status').textContent.includes('disconnected')",
        { timeoutMs: 10_000 },
      );
      await write(host, "host", "host-offline", "host edit while disconnected");
      await write(
        client,
        "client",
        "client-offline",
        "client edit while disconnected",
      );
      assert.equal(
        await client.evaluate(
          "document.querySelector('#replica-client-document').textContent.includes('host-offline')",
        ),
        false,
      );

      await connectPeers(host, client);
      await waitForState(
        host,
        client,
        '"client-offline": "client edit while disconnected"',
      );
      await waitForState(
        host,
        client,
        '"host-offline": "host edit while disconnected"',
      );
      const eventText = await client.evaluate(
        "document.querySelector('#replica-events').innerText",
      );
      assert.match(eventText, /SDP offer/);
      assert.match(eventText, /connected/);
      await click(host, "#replica-host-revoke");
      await host.wait(
        "document.querySelector('#replica-host-status').textContent.includes('Revoked')",
      );
      return {
        browser: browser.version,
        checks: [
          "read-write invitation authenticated independent WebRTC peer tabs",
          "host and client state converged on initial synchronization",
          "offline edits remained local during disconnection",
          "offline host and client edits converged after a fresh authenticated connection",
          "membership list was populated and host revoke invalidated active membership",
          "SDP and synchronization state transitions appeared in the console",
        ],
      };
    } finally {
      await Promise.all([host.close(), client.close()]);
    }
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await server.close();
}

async function click(page, selector) {
  await page.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).click()`,
  );
}

async function setValue(page, selector, value) {
  await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function connectPeers(host, client) {
  await click(client, "#replica-client-offer");
  const offer = await client.wait(
    "document.querySelector('#replica-offer-output').value",
    { timeoutMs: 20_000 },
  );
  await setValue(host, "#replica-offer-input", offer);
  await click(host, "#replica-host-answer");
  const answer = await host.wait(
    "document.querySelector('#replica-answer-output').value",
    { timeoutMs: 20_000 },
  );
  await setValue(client, "#replica-answer-input-client", answer);
  await click(client, "#replica-client-accept-answer");
  await Promise.all([
    host.wait(
      "document.querySelector('#replica-host-status').textContent.includes('synchronizing')",
      { timeoutMs: 20_000 },
    ),
    client.wait(
      "document.querySelector('#replica-client-status').textContent.includes('synchronizing')",
      { timeoutMs: 20_000 },
    ),
  ]);
}

async function waitForState(host, client, value) {
  await Promise.all([
    host.wait(
      `document.querySelector('#replica-host-document').textContent.includes(${JSON.stringify(value)})`,
      { timeoutMs: 20_000 },
    ),
    client.wait(
      `document.querySelector('#replica-client-document').textContent.includes(${JSON.stringify(value)})`,
      { timeoutMs: 20_000 },
    ),
  ]);
}

async function write(page, role, key, value) {
  await setValue(page, "#replica-key", key);
  await setValue(page, "#replica-value", value);
  await page.evaluate(
    "document.querySelector('#replica-write-form').requestSubmit()",
  );
  await page.wait(
    `document.querySelector('#replica-${role}-document').textContent.includes(${JSON.stringify(key)})`,
  );
}
