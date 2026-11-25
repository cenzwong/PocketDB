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

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/packages/engine-kv/test/persistence-browser.html`;
  const matrix = await withBrowser(async (browser) => {
    const owner = await browser.page(url);
    const contender = await browser.page(url);
    await Promise.all([
      owner.wait("Boolean(window.__keyValuePersistenceProbe)"),
      contender.wait("Boolean(window.__keyValuePersistenceProbe)"),
    ]);
    const seed = randomUUID().replaceAll("-", "");
    const dataDir = `idb://pocketdb-kv-${seed}-primary`;
    try {
      await owner.evaluate(
        `window.__keyValuePersistenceProbe.start(${JSON.stringify(dataDir)})`,
      );
      await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('SET', ['durable', 'saved'])",
      );
      await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('EXPIRE', ['durable', 20])",
      );
      const ttlBefore = await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('TTL', ['durable'])",
      );
      const ownership = await contender.evaluate(
        `window.__keyValuePersistenceProbe.tryStart(${JSON.stringify(dataDir)})`,
      );
      assert.deepEqual(ownership, {
        ok: false,
        code: "key-value-storage-already-owned",
      });
      await owner.evaluate("window.__keyValuePersistenceProbe.stop()");

      await owner.navigate(url);
      await owner.wait("Boolean(window.__keyValuePersistenceProbe)");
      await owner.evaluate(
        `window.__keyValuePersistenceProbe.start(${JSON.stringify(dataDir)})`,
      );
      const reopenedValue = await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('GET', ['durable'])",
      );
      const ttlAfter = await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('TTL', ['durable'])",
      );
      assert.equal(reopenedValue, "saved");
      assert.ok(ttlAfter <= ttlBefore && ttlAfter >= 0);
      await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('SET', ['expires', 'soon'])",
      );
      await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('EXPIRE', ['expires', 1])",
      );
      await owner.evaluate("window.__keyValuePersistenceProbe.stop()");
      await sleep(1_100);
      await owner.navigate(url);
      await owner.wait("Boolean(window.__keyValuePersistenceProbe)");
      await owner.evaluate(
        `window.__keyValuePersistenceProbe.start(${JSON.stringify(dataDir)})`,
      );
      const expiredValue = await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('GET', ['expires'])",
      );
      const expiredTtl = await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('TTL', ['expires'])",
      );
      assert.equal(expiredValue, null);
      assert.equal(expiredTtl, -2);
      await owner.evaluate("window.__keyValuePersistenceProbe.stop()");

      const separateDir = `idb://pocketdb-kv-${seed}-separate`;
      await owner.evaluate(
        `window.__keyValuePersistenceProbe.start(${JSON.stringify(separateDir)})`,
      );
      assert.equal(
        await owner.evaluate(
          "window.__keyValuePersistenceProbe.execute('GET', ['durable'])",
        ),
        null,
      );
      await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('SET', ['separate', 'only-here'])",
      );
      await owner.evaluate("window.__keyValuePersistenceProbe.stop()");
      await owner.evaluate(
        `window.__keyValuePersistenceProbe.start(${JSON.stringify(dataDir)})`,
      );
      assert.equal(
        await owner.evaluate(
          "window.__keyValuePersistenceProbe.execute('GET', ['separate'])",
        ),
        null,
      );
      await owner.evaluate("window.__keyValuePersistenceProbe.stop()");
      await owner.evaluate(
        "window.__keyValuePersistenceProbe.start('memory://')",
      );
      await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('SET', ['ephemeral', 'gone'])",
      );
      await owner.evaluate("window.__keyValuePersistenceProbe.stop()");
      await owner.evaluate(
        "window.__keyValuePersistenceProbe.start('memory://')",
      );
      const ephemeralValue = await owner.evaluate(
        "window.__keyValuePersistenceProbe.execute('GET', ['ephemeral'])",
      );
      assert.equal(ephemeralValue, null);
      await owner.evaluate("window.__keyValuePersistenceProbe.stop()");
      return {
        browser: browser.version,
        checks: [
          "persistent data survives page reload",
          "expiry timestamp survives reload without extension",
          "expired data remains expired after reload",
          "same-instance ownership rejection and release",
          "distinct IndexedDB directories isolate stored keys",
          "memory mode resets after termination",
        ],
      };
    } finally {
      await Promise.all([owner.close(), contender.close()]);
    }
  });

  const quota = await withBrowser(async (browser) => {
    const page = await browser.page(url);
    await page.wait("Boolean(window.__keyValuePersistenceProbe)");
    await page.command("Storage.overrideQuotaForOrigin", {
      origin: new URL(url).origin,
      quotaSize: 1_048_576,
    });
    const outcome = await page.evaluate(
      "window.__keyValuePersistenceProbe.runRollbackProbe()",
    );
    await page.close();
    assert.equal(outcome.importResult.ok, false, JSON.stringify(outcome));
    assert.equal(outcome.importResult.code, "key-value-storage-quota-exceeded");
    assert.equal(outcome.malformedResult.code, "snapshot-invalid");
    assert.equal(outcome.incompatibleResult.code, "snapshot-incompatible");
    assert.equal(outcome.preserved, "before-import");
    assert.equal(outcome.restoredValue, "fresh-idb");
    return {
      browser: browser.version,
      configuredQuotaBytes: 1_048_576,
      outcome,
    };
  });

  console.log(JSON.stringify({ matrix, quota }, null, 2));
} finally {
  await server.close();
}
