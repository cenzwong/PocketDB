import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
function launch(binary) {
  const profile = mkdtempSync("/tmp/pocketdb-rtc-browser.");
  const child = spawn(binary, [
    "--headless", "--no-first-run", "--disable-background-networking",
    "--disable-component-update", "--disable-sync", "--remote-debugging-pipe",
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", process.stderr, "pipe", "pipe"] });
  let id = 0;
  const pending = new Map();
  let input = "";
  child.stdio[4].setEncoding("utf8");
  child.stdio[4].on("data", (chunk) => {
    input += chunk;
    let end;
    while ((end = input.indexOf("\0")) >= 0) {
      const message = JSON.parse(input.slice(0, end));
      input = input.slice(end + 1);
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      }
    }
  });
  function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 10000);
      pending.set(requestId, { resolve, reject, timer });
      child.stdio[3].write(JSON.stringify({ id: requestId, method, params, sessionId }) + "\0");
    });
  }
  return { call, child };
}

const url = process.argv[2] ?? "http://localhost:9444/";
const browsers = [
  launch("/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"),
  launch("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
];

async function connect(browser) {
  const version = await browser.call("Browser.getVersion");
  const { targetId } = await browser.call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.call("Target.attachToTarget", { targetId, flatten: true });
  const result = await browser.call("Page.navigate", { url }, sessionId);
  if (result.errorText) throw new Error(result.errorText);
  const get = async (expression) => {
    const value = await browser.call("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
    return value.result.value;
  };
  const wait = async (expression) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const value = await get(expression);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${expression}; report: ${await get('document.querySelector("#result")?.textContent')}`);
  };
  await wait('document.querySelector("#result")?.textContent.includes("userAgent")');
  return { version, wait, get };
}

const click = (page, id) => page.get(`document.getElementById(${JSON.stringify(id)}).click()`);
const signal = (page) => page.wait('document.querySelector("#outgoing").value');
const paste = (page, value) => page.get(`document.querySelector("#incoming").value = ${JSON.stringify(value)}`);
const report = (page) => page.get('JSON.parse(document.querySelector("#result").textContent)');

try {
  const [host, client] = await Promise.all(browsers.map(connect));
  await click(client, "offer");
  await paste(host, await signal(client));
  await click(host, "answer");
  await paste(client, await signal(host));
  await click(client, "connect");
  await client.wait('!document.querySelector("#run").disabled');
  await click(client, "run");
  await client.wait('document.querySelector("#result").textContent.includes("checks-complete")');
  const beforeClose = performance.now();
  await click(host, "disconnect");
  await client.wait('document.querySelector("#result").textContent.includes("channel-close")');
  const closeObservedMs = performance.now() - beforeClose;
  const clientReport = await report(client);
  const hostReport = await report(host);
  console.log(JSON.stringify({
    environment: "Same Mac, loopback HTTP, separate headless browser profiles. SDP exchanged by the test driver.",
    hostVersion: host.version.product,
    clientVersion: client.version.product,
    host: hostReport, client: clientReport, closeObservedMs,
  }, null, 2));
  if (clientReport.checks.some((check) => !check.ok && !check.skipped)) process.exitCode = 1;
} finally {
  for (const browser of browsers) browser.child.kill();
}
