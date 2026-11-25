import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createServer } from "node:https";
import { createHash, X509Certificate } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { withBrowser } from "../spike-support/chromium.mjs";
import { build } from "vite";

const [certPath, keyPath] = process.argv.slice(2);
assert(certPath && keyPath, "Usage: node verify.mjs <cert.pem> <key.pem>");
const root = fileURLToPath(new URL(".", import.meta.url));
const dist = resolve(root, "dist");
const cert = await readFile(certPath);
const key = await readFile(keyPath);
const publicKey = new X509Certificate(cert).publicKey.export({
  type: "spki",
  format: "der",
});
const spki = createHash("sha256").update(publicKey).digest("base64");
const requests = [];
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

await build({ configFile: join(root, "vite.config.js") });

async function listAssets(directory, relative = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listAssets(path, name)));
    else if (/\.(?:js|wasm)$/.test(entry.name)) {
      const bytes = await readFile(path);
      files.push({ path: name, bytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength });
    }
  }
  return files;
}

const server = createServer({ cert, key }, async (request, response) => {
  try {
    const pathname = new URL(request.url, "https://localhost").pathname;
    const isolated = pathname.startsWith("/isolated/PocketDB/");
    const prefix = isolated ? "/isolated/PocketDB/" : "/PocketDB/";
    if (!pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    const relative = decodeURIComponent(pathname.slice(prefix.length) || "index.html");
    const file = resolve(dist, relative);
    if (!file.startsWith(`${dist}${sep}`)) {
      response.writeHead(404).end();
      return;
    }
    const contents = await readFile(file);
    const headers = {
      "Content-Type": mimeTypes.get(extname(file)) ?? "application/octet-stream",
      "Cache-Control": "no-store",
    };
    if (isolated) {
      headers["Cross-Origin-Opener-Policy"] = "same-origin";
      headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    }
    requests.push({ path: pathname, status: 200, ...headers });
    response.writeHead(200, headers).end(contents);
  } catch {
    requests.push({ path: request.url, status: 404 });
    response.writeHead(404).end();
  }
});

await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolvePromise);
});
const port = server.address().port;
const base = `https://localhost:${port}`;
const args = [`--ignore-certificate-errors-spki-list=${spki}`];

try {
  const results = await withBrowser(async (browser) => {
    const profiles = [];
    for (const profile of [
      { name: "Pages-style baseline", url: `${base}/PocketDB/` },
      { name: "isolated control", url: `${base}/isolated/PocketDB/` },
    ]) {
      const page = await browser.page(profile.url);
      const outcome = await page.wait(
        "window.__probeResult",
        { timeoutMs: 180_000 },
      );
      assert.equal(outcome.ok, true, JSON.stringify({ profile, outcome }));
      profiles.push({ name: profile.name, url: profile.url, outcome });
      await page.close();
    }
    return { browser: browser.version, profiles };
  }, args);

  const output = {
    measuredAt: new Date().toISOString(),
    host: process.platform,
    architecture: process.arch,
    node: process.version,
    packages: {
      sqliteWasm: "3.54.1-build1",
      duckdbWasm: "1.32.0",
      duckdbCore: results.profiles[0].outcome.duckdb.version,
    },
    buildAssets: await listAssets(dist),
    evidenceBoundary: "Local TLS preview, not a GitHub Pages deployment.",
    requests,
    ...results,
  };
  await writeFile(join(root, "results.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
