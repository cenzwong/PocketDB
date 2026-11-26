import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { withBrowser } from "../support/chromium.mjs";

const root = resolve(new URL("../../", import.meta.url).pathname);
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
  const url = `http://127.0.0.1:${address.port}/`;
  await withBrowser(async (browser) => {
    const page = await browser.page(url);
    await page.wait("Boolean(document.querySelector('#setup-form'))");
    const engines = {};
    for (const engine of ["kv", "postgresql"]) {
      await page.evaluate(
        `document.querySelector('[data-engine="${engine}"]').click()`,
      );
      const cold = await start(page);
      await stop(page);
      const warm = [];
      const sampleCount = engine === "kv" ? 5 : 3;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        warm.push(await start(page));
        await stop(page);
      }
      engines[engine] = {
        coldMs: cold,
        warmMs: warm,
        warmP50Ms: percentile(warm, 0.5),
        warmP95Ms: percentile(warm, 0.95),
      };
    }
    console.log(
      JSON.stringify(
        {
          browser: browser.version,
          environment: {
            platform: process.platform,
            arch: process.arch,
            node: process.version,
          },
          engines,
        },
        null,
        2,
      ),
    );
    await page.close();
  });
} finally {
  await server.close();
}

async function start(page) {
  await page.evaluate(`(() => {
    window.__pocketdbStartupStarted = performance.now();
    document.querySelector('#setup-form').requestSubmit();
  })()`);
  await page.wait(
    "document.querySelector('#runtime-status').textContent === 'Running' && !document.querySelector('#create-invitation').disabled",
    { timeoutMs: 60_000 },
  );
  return page.evaluate("performance.now() - window.__pocketdbStartupStarted");
}

async function stop(page) {
  await page.evaluate("document.querySelector('#stop-button').click()");
  await page.wait(
    "document.querySelector('#runtime-status').textContent === 'Stopped'",
  );
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
