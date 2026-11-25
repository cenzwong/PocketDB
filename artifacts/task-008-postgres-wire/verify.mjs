import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withBrowser } from "../spike-support/chromium.mjs";
import { withSite } from "../spike-support/static.mjs";
import { withFixture } from "../spike-support/stage.mjs";
import { connectPeer } from "../spike-support/native-peer.mjs";
import { openBridge } from "./bridge.mjs";

const dir = fileURLToPath(new URL(".", import.meta.url));
const dependencies = process.env.POCKETDB_NODE_MODULES ?? join(dir, "node_modules");
const native = await import(join(dependencies, "node-datachannel/dist/esm/lib/index.mjs"));
const { default: pg } = await import(join(dependencies, "pg/lib/index.js"));
const pglite = join(dependencies, "@electric-sql/pglite/dist");

const result = await withFixture(join(dir, "site"), (stage) => withSite(stage, (url) => withBrowser(async (browser) => {
  const page = await browser.page(url);
  const remote = await connectPeer(page, native);
  const bridge = await openBridge(remote);
  const client = new pg.Client({
    host: "127.0.0.1", port: bridge.port, user: "probe", database: "probe",
    connectionTimeoutMillis: 5000, query_timeout: 5000, ssl: false,
  });
  client.on("error", () => {});
  try {
    await client.connect();
    assert.equal((await client.query("select $1::text as value", ["a ' parameter"])).rows[0].value, "a ' parameter");
    await client.query("begin");
    await client.query("insert into wire_probe values ($1, $2)", [1, "commit"]);
    await client.query("commit");
    await client.query("begin");
    await client.query("insert into wire_probe values ($1, $2)", [2, "rollback"]);
    await client.query("rollback");
    const cancellation = createConnection({ host: "127.0.0.1", port: bridge.port });
    await once(cancellation, "connect");
    const cancel = Buffer.alloc(16);
    cancel.writeInt32BE(16, 0);
    cancel.writeInt32BE(80877102, 4);
    cancellation.end(cancel);
    await once(cancellation, "close");
    assert.equal((await client.query("select 1 as alive")).rows[0].alive, 1);
    await client.query("begin");
    await client.query("insert into wire_probe values ($1, $2)", [3, "abandoned"]);
    await client.end();
    for (let attempt = 0; attempt < 100 && !bridge.trace.includes("cleanup rollback"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(bridge.trace.includes("cleanup rollback"));
    const browserRows = await page.evaluate("probeInspection()");
    assert.deepEqual(browserRows, [{ id: 1, value: "commit" }]);
    for (const type of ["P", "B", "D", "E", "S", "CancelRequest unsupported", "Terminate handled locally"]) {
      assert(bridge.trace.includes(type));
    }
    return { browser: browser.version, browserRows, trace: bridge.trace, parameterized: true,
      cancellation: "Separate CancelRequest closed without forwarding. Subsequent query passed." };
  } finally {
    await client.end().catch(() => {});
    await bridge.close();
    remote.close();
  }
})), pglite);
native.cleanup();
console.log(JSON.stringify({ node: process.version, driver: "pg 8.23.1", pglite: "0.6.0", ...result }, null, 2));
