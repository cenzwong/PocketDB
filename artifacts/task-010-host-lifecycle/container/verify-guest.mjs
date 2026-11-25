import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { withBrowser } from "./chromium.mjs";

const profile = "/fixture/profile";
await mkdir(profile, { recursive: true });
for (const name of ["SingletonCookie", "SingletonLock", "SingletonSocket"]) {
  await rm(join(profile, name), { force: true });
}
const content = new Set(["index.html", "page.js", "peer-rpc.js", "worker.js"]);
const site = createServer(async (request, response) => {
  const file = request.url === "/" ? "index.html" : request.url.slice(1);
  if (!content.has(file)) return response.writeHead(404).end();
  const data = await readFile(join("/fixture/site", file));
  response.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : "text/html" }).end(data);
});
site.listen(9460, "127.0.0.1");
await once(site, "listening");

await withBrowser(async (browser) => {
  const page = await browser.page("http://127.0.0.1:9460/");
  await page.wait("Boolean(globalThis.probePeer)");
  async function click(name, signal) {
    if (signal) await page.evaluate(`document.querySelector("#incoming").value = ${JSON.stringify(signal)}`);
    await page.evaluate(`document.querySelector("#${name}").click()`);
  }
  const output = 'document.querySelector("#outgoing").value';
  const journal = () => page.evaluate("hostJournal()");
  const actions = {
    info: () => ({ browser: browser.version, platform: process.platform, arch: process.arch, hostname: process.env.HOSTNAME }),
    async offer() {
      await click("offer");
      return page.wait(output);
    },
    async answer(signal) {
      await click("answer", signal);
      return page.wait(output);
    },
    async connect(signal) {
      await click("connect", signal);
      await page.wait('hostJournal().some(e => e.event === "open")');
      return true;
    },
    async reset() {
      const documentId = await page.evaluate("hostDocumentId");
      await page.command("Page.reload", {});
      return page.wait(`Boolean(globalThis.hostDocumentId && globalThis.hostDocumentId !== ${JSON.stringify(documentId)})`);
    },
    async seed() { return sample("seed"); },
    async read() { return sample("sample"); },
    journal,
  };
  async function sample(name) {
    const before = (await journal()).length;
    await click(name);
    const event = await page.wait(`hostJournal().slice(${before}).find(e => ["reply", "timeout", "error"].includes(e.event))`);
    return event;
  }
  const control = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 32_768) throw new Error("Request exceeds fixture limit");
      }
      const { action, signal } = JSON.parse(body);
      if (!Object.hasOwn(actions, action)) throw new Error("Unknown fixture action");
      const result = await actions[action](signal);
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(500).end(JSON.stringify({ error: String(error) }));
    }
  });
  control.listen(9461, "127.0.0.1");
  await once(control, "listening");
  console.log("fixture ready");
  await new Promise((resolve) => process.once("SIGTERM", resolve));
  control.closeAllConnections();
  await new Promise((resolve) => control.close(resolve));
}, ["--no-sandbox", "--disable-dev-shm-usage", "--disable-features=WebRtcHideLocalIpsWithMdns"], { profilePath: profile });
site.close();
