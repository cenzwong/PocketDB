import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { withBrowser } from "../../../tests/support/chromium.mjs";

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
  const url = `http://127.0.0.1:${address.port}/packages/engine-yjs/test/persistence-browser.html`;
  const result = await withBrowser(async (browser) => {
    const owner = await browser.page(url);
    const contender = await browser.page(url);
    await Promise.all([
      owner.wait("Boolean(window.__crdtPersistenceProbe)"),
      contender.wait("Boolean(window.__crdtPersistenceProbe)"),
    ]);
    const replicaId = `crdt-${randomUUID()}`;
    try {
      await owner.evaluate(
        `window.__crdtPersistenceProbe.start(${JSON.stringify(replicaId)})`,
      );
      await owner.evaluate(
        "window.__crdtPersistenceProbe.set('persisted', 'after-reload')",
      );
      await owner.evaluate("window.__crdtPersistenceProbe.flush()");
      assert.deepEqual(
        await contender.evaluate(
          `window.__crdtPersistenceProbe.tryStart(${JSON.stringify(replicaId)})`,
        ),
        { ok: false, code: "storage-already-owned" },
      );
      const snapshot = await owner.evaluate(
        "window.__crdtPersistenceProbe.snapshot()",
      );
      await owner.evaluate("window.__crdtPersistenceProbe.close()");

      await owner.navigate(url);
      await owner.wait("Boolean(window.__crdtPersistenceProbe)");
      await owner.evaluate(
        `window.__crdtPersistenceProbe.start(${JSON.stringify(replicaId)})`,
      );
      assert.deepEqual(
        await owner.evaluate("window.__crdtPersistenceProbe.entries()"),
        [["persisted", "after-reload"]],
      );

      await owner.evaluate(
        "window.__crdtPersistenceProbe.set('local-only', 'retained')",
      );
      const merged = await owner.evaluate(
        `window.__crdtPersistenceProbe.mergeAndRead(${JSON.stringify(snapshot)})`,
      );
      assert.deepEqual(sortEntries(merged.entries), [
        ["local-only", "retained"],
        ["persisted", "after-reload"],
      ]);
      assert.deepEqual(
        await owner.evaluate(
          `window.__crdtPersistenceProbe.restoreEntries(${JSON.stringify(snapshot)})`,
        ),
        [["persisted", "after-reload"]],
      );

      const malformed = await owner.evaluate(
        "window.__crdtPersistenceProbe.malformedRestore()",
      );
      assert.equal(malformed.code, "snapshot-invalid");
      assert.deepEqual(malformed.entries, merged.entries);
      assert.deepEqual(
        await owner.evaluate(
          "window.__crdtPersistenceProbe.incompatibleRestore()",
        ),
        { code: "snapshot-incompatible" },
      );
      await owner.evaluate("window.__crdtPersistenceProbe.close()");
      await contender.evaluate(
        `window.__crdtPersistenceProbe.start(${JSON.stringify(replicaId)})`,
      );
      assert.deepEqual(
        sortEntries(
          await contender.evaluate("window.__crdtPersistenceProbe.entries()"),
        ),
        sortEntries(merged.entries),
      );
      await contender.evaluate("window.__crdtPersistenceProbe.close()");
      return {
        browser: browser.version,
        checks: [
          "IndexedDB replica state survives page reload",
          "Web Lock prevents concurrent same-replica ownership and releases on close",
          "isolated snapshot restore preserves only exported state",
          "snapshot merge retains local and imported state",
          "malformed and incompatible snapshots are rejected without changing destination state",
          "reopened replica state agrees across browser tabs",
        ],
      };
    } finally {
      await Promise.all([
        owner
          .evaluate("window.__crdtPersistenceProbe.close()")
          .catch(() => undefined),
        contender
          .evaluate("window.__crdtPersistenceProbe.close()")
          .catch(() => undefined),
        owner.close(),
        contender.close(),
      ]);
    }
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await server.close();
}

function sortEntries(entries) {
  return entries.toSorted(([left], [right]) => left.localeCompare(right));
}
