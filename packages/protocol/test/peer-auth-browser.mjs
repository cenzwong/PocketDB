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
  root,
  server: { host: "127.0.0.1", port: 0 },
});

try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/packages/protocol/test/peer-auth-browser.html`;
  const result = await withBrowser(async (browser) => {
    const page = await browser.page(url);
    let outcome;
    try {
      outcome = await page.wait("window.__peerAuthResult", {
        timeoutMs: 20_000,
      });
    } catch (error) {
      const details = await page.evaluate("document.body.innerText");
      throw new Error(
        `${error instanceof Error ? error.message : error}\n${details}`,
      );
    }
    await page.close();
    return { browser: browser.version, outcome };
  });
  assert.equal(result.outcome.ok, true, result.outcome.error);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await server.close();
}
