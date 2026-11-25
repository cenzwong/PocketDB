import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

async function runBrowser(browser, url) {
  const ownerPage = await browser.page(url);
  const secondTab = await browser.page(url);
  try {
    await Promise.all([
      ownerPage.wait("Boolean(window.__pglitePersistenceProbe)"),
      secondTab.wait("Boolean(window.__pglitePersistenceProbe)"),
    ]);
    const dataDir = `idb://pocketdb-cross-tab-${randomUUID().replaceAll("-", "")}`;
    await ownerPage.evaluate(
      `window.__pglitePersistenceProbe.holdOwner(${JSON.stringify(dataDir)})`,
    );
    const rejected = await secondTab.evaluate(
      `window.__pglitePersistenceProbe.tryOpenOwner(${JSON.stringify(dataDir)})`,
    );
    assert.deepEqual(rejected, {
      ok: false,
      code: "postgres-storage-already-owned",
    });
    const ownerRead = await ownerPage.evaluate(
      "window.__pglitePersistenceProbe.readOwner()",
    );
    assert.equal(ownerRead.rows[0].value, "held-value");
    await ownerPage.evaluate("window.__pglitePersistenceProbe.closeOwner()");
    const reopened = await secondTab.evaluate(
      `window.__pglitePersistenceProbe.tryOpenOwner(${JSON.stringify(dataDir)})`,
    );
    assert.deepEqual(reopened, { ok: true, value: "held-value" });

    const outcome = await ownerPage.evaluate(
      "window.__pglitePersistenceProbe.run()",
    );
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    return {
      browser: browser.version,
      outcome: {
        ...outcome,
        checks: [
          "cross-tab ownership rejection and release",
          ...outcome.checks,
        ],
      },
    };
  } finally {
    await Promise.all([ownerPage.close(), secondTab.close()]);
  }
}

try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/packages/engine-pglite/test/persistence-browser.html`;
  const matrix = await withBrowser((browser) => runBrowser(browser, url));
  const quota = await withBrowser(async (browser) => {
    const page = await browser.page(url);
    await page.wait("Boolean(window.__pglitePersistenceProbe)");
    await page.command("Storage.overrideQuotaForOrigin", {
      origin: new URL(url).origin,
      quotaSize: 65_536,
    });
    const outcome = await page.evaluate(
      "window.__pglitePersistenceProbe.runQuota()",
    );
    await page.close();
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    return { browser: browser.version, configuredQuotaBytes: 65_536, outcome };
  });
  const snapshots = await withBrowser(async (browser) => {
    const page = await browser.page(url);
    await page.wait("Boolean(window.__pglitePersistenceProbe)");
    const result = await page.evaluate(
      "window.__pglitePersistenceProbe.runSnapshots()",
    );
    await page.close();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.malformedCode, "snapshot-invalid");
    assert.equal(result.incompatibleCode, "snapshot-incompatible");
    assert.equal(result.occupiedCode, "snapshot-target-not-empty");
    return result;
  });
  console.log(JSON.stringify({ matrix, quota, snapshots }, null, 2));
} finally {
  await server.close();
}
