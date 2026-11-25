import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
  optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
  server: { host: "127.0.0.1", port: 0 },
});

try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/test`;
  const fixture = await withBrowser(async (browser) => {
    const page = await browser.page(`${base}/duckdb-fixture.html`);
    let outcome;
    try {
      outcome = await page.wait("window.__duckdbFixture", {
        timeoutMs: 120_000,
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
  assert.equal(fixture.outcome.ok, true, JSON.stringify(fixture));
  const parquet = encodeURIComponent(fixture.outcome.base64);
  const url = `${base}/duckdb-harness.html?parquet=${parquet}`;
  const result = await withBrowser(async (browser) => {
    const page = await browser.page(url);
    let outcome;
    try {
      outcome = await page.wait("window.__duckdbResult", {
        timeoutMs: 120_000,
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
  assert.equal(result.outcome.ok, true, JSON.stringify(result));
  const { boundedResult, ...outcome } = result.outcome;
  const bounded = boundedResult;
  const summarized = {
    measuredAt: new Date().toISOString(),
    host: process.platform,
    architecture: process.arch,
    node: process.version,
    fixtureGeneratorBrowser: fixture.browser,
    browser: result.browser,
    outcome: {
      ...outcome,
      boundedResult:
        typeof bounded === "object" && bounded !== null
          ? {
              columns: bounded.columns,
              rowCount: bounded.rowCount,
              truncated: bounded.truncated,
              firstRow: Array.isArray(bounded.rows) ? bounded.rows[0] : null,
              lastRow: Array.isArray(bounded.rows) ? bounded.rows.at(-1) : null,
            }
          : bounded,
    },
  };
  const artifactDirectory = resolve(root, "artifacts/task-057-duckdb-adapter");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(
    resolve(artifactDirectory, "results.json"),
    `${JSON.stringify(summarized, null, 2)}\n`,
  );
  console.log(JSON.stringify(summarized, null, 2));
} finally {
  await server.close();
}
