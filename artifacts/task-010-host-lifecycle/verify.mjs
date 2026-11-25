import assert from "node:assert/strict";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { withBrowser } from "../spike-support/chromium.mjs";
import { withSite } from "../spike-support/static.mjs";
import { withFixture } from "../spike-support/stage.mjs";
import { connectPeer } from "../spike-support/native-peer.mjs";

const dir = fileURLToPath(new URL(".", import.meta.url));
const dependencies = process.env.POCKETDB_NODE_MODULES ?? join(dir, "node_modules");
const native = await import(join(dependencies, "node-datachannel/dist/esm/lib/index.mjs"));
const timeline = [];
const headless = process.env.POCKETDB_HEADFUL !== "1";
function record(event, started, fields = {}) {
  timeline.push({ event, elapsedMs: Math.round(performance.now() - started), ...fields });
}
async function tryRead(connection, wait = 350) {
  try {
    return { result: await connection.request({}, wait) };
  } catch (error) {
    return { error: error.message };
  }
}

const report = await withFixture(join(dir, "site"), (stage) => withSite(stage, (url) => withBrowser(async (browser) => {
  let host = await browser.page(url);
  let peer = await connectPeer(host, native);
  const began = performance.now();
  try {
    const before = await peer.request({ value: "lifecycle-marker" });
    record("foreground seeded", began, before);

    const other = await browser.page("about:blank");
    await other.command("Page.bringToFront", {});
    await delay(300);
    const background = await host.evaluate("document.visibilityState");
    record("background sample", began, { visibility: background, ...await tryRead(peer) });
    await host.command("Page.bringToFront", {});
    await other.close();

    let frozen = false;
    try {
      await host.command("Page.setWebLifecycleState", { state: "frozen" });
      frozen = true;
      const during = await tryRead(peer);
      record("DevTools freeze", began, during);
    } catch (error) {
      record("DevTools freeze unavailable", began, { error: error.message });
    } finally {
      if (frozen) await host.command("Page.setWebLifecycleState", { state: "active" });
    }
    let recovered = await tryRead(peer, 1500);
    if (!recovered.result) {
      peer.close();
      await host.evaluate("resetPeer()");
      peer = await connectPeer(host, native);
      recovered = await tryRead(peer, 1500);
    }
    assert.equal(recovered.result.value, before.value);
    const journal = await host.evaluate("hostJournal()");
    record("post-freeze read", began, { ...recovered, lifecycleEvents: journal.map((event) => event.event) });

    const oldDocument = await host.evaluate("hostDocumentId");
    const reloading = performance.now();
    await host.command("Page.reload", {});
    await host.wait(`Boolean(globalThis.hostDocumentId && globalThis.hostDocumentId !== ${JSON.stringify(oldDocument)})`);
    const reloadOld = await tryRead(peer);
    record("reload old peer", began, reloadOld);
    assert(reloadOld.error);
    peer.close();
    peer = await connectPeer(host, native);
    const afterReload = await peer.request({});
    assert.notEqual(afterReload.boot, before.boot);
    assert.equal(afterReload.value, before.value);
    record("reload fresh peer", began, { ...afterReload, recoveryMs: Math.round(performance.now() - reloading) });

    const closing = performance.now();
    await host.close();
    let closeOld = await tryRead(peer);
    for (let attempt = 0; attempt < 10 && closeOld.result; attempt++) {
      await delay(100);
      closeOld = await tryRead(peer);
    }
    record("close old peer", began, closeOld);
    assert(closeOld.error);
    peer.close();
    host = await browser.page(url);
    peer = await connectPeer(host, native);
    const afterClose = await peer.request({});
    assert.notEqual(afterClose.boot, afterReload.boot);
    assert.equal(afterClose.value, before.value);
    record("reopen fresh peer", began, { ...afterClose, recoveryMs: Math.round(performance.now() - closing) });
    return { browser: browser.version, platform: process.platform, arch: process.arch, headless,
      systemSleep: "not observed", timeline };
  } finally {
    peer.close();
  }
}, [], { headless })));
native.cleanup();
console.log(JSON.stringify(report, null, 2));
