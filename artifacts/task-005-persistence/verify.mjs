import assert from "node:assert/strict";
import { X509Certificate, createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withBrowser } from "../spike-support/chromium.mjs";
import { withSite } from "../spike-support/static.mjs";

const [certPath, keyPath] = process.argv.slice(2);
const cert = await readFile(certPath);
const key = await readFile(keyPath);
const publicKey = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
const spki = createHash("sha256").update(publicKey).digest("base64");
const root = dirname(fileURLToPath(import.meta.url));
const stage = await mkdtemp(join(tmpdir(), "pocketdb-storage-"));
const marker = "parameterized ' value";

async function sample(browser, url) {
  const first = await browser.page(url);
  const second = await browser.page(url);
  for (const page of [first, second]) await page.wait("Boolean(globalThis.probe)");
  const before = await first.evaluate("probe.storage()");
  await first.evaluate('probe.database("open")');
  const ownership = await second.evaluate('probe.database("open").then(() => "unexpected owner", (error) => error.message)');
  assert.match(ownership, /already owned/);
  assert.equal(await first.evaluate(`probe.database("seed", ${JSON.stringify(marker)})`), true);
  await first.evaluate('probe.keyValue("readwrite", "persisted-kv")');
  const snapshot = await first.evaluate('probe.database("snapshot")');
  assert.equal(snapshot.value, marker);
  assert(snapshot.bytes > 0);
  await first.evaluate('probe.database("close")');
  await first.navigate();
  await first.wait("Boolean(globalThis.probe)");
  await first.evaluate('probe.database("open")');
  const sql = await first.evaluate('probe.database("read")');
  const keyValue = await first.evaluate('probe.keyValue("readonly")');
  assert.equal(sql, marker);
  assert.equal(keyValue, "persisted-kv");
  await first.evaluate('probe.database("close")');
  await second.evaluate('probe.database("open")');
  await second.evaluate('probe.database("close")');
  const after = await first.evaluate("probe.storage()");
  await Promise.all([first.close(), second.close()]);
  return { browser: browser.version, before, after, ownership, ownershipReleased: true, sql, keyValue, snapshot, citext: true };
}

try {
  await cp(join(root, "site"), stage, { recursive: true });
  await cp(process.env.POCKETDB_PGLITE_DIST ?? join(root, "node_modules/@electric-sql/pglite/dist"),
    join(stage, "vendor"), { recursive: true });
  const results = await withSite(stage, async (url) => {
    const args = [`--ignore-certificate-errors-spki-list=${spki}`];
    const regular = await withBrowser((browser) => sample(browser, url), args);
    const cappedQuota = await withBrowser(async (browser) => {
      const page = await browser.page(url);
      await page.wait("Boolean(globalThis.probe)");
      await page.command("Storage.overrideQuotaForOrigin", { origin: new URL(url).origin, quotaSize: 65_536 });
      const storage = await page.evaluate("probe.storage()");
      const write = await page.evaluate('probe.keyValue("readwrite", crypto.getRandomValues(new Uint8Array(65_536)).join(",")).then(() => "unexpected success", (error) => error.name)');
      assert.equal(write, "QuotaExceededError");
      return { configuredQuota: 65_536, reportedStorage: storage, exceededWrite: write };
    }, args);
    const privateResult = await withBrowser(async (browser) => {
      const active = await browser.privateContext((context) => sample(context, url));
      const clearedAfterClose = await browser.privateContext(async (context) => {
        const page = await context.page(url);
        await page.wait("Boolean(globalThis.probe)");
        return await page.evaluate('probe.keyValue("readonly").then((value) => value === undefined)');
      });
      assert.equal(clearedAfterClose, true);
      return { ...active, clearedAfterClose };
    }, args);
    return { url, regular, private: privateResult, cappedQuota };
  }, { prefix: "/PocketDB/", tls: { cert, key } });
  console.log(JSON.stringify(results, null, 2));
} finally {
  await rm(stage, { recursive: true, force: true });
}
