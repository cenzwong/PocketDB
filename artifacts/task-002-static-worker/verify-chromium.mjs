import { spawn } from "node:child_process";

const [binary, profile, spki, ...urls] = process.argv.slice(2);
const child = spawn(binary, [
  "--headless", "--no-first-run", "--disable-background-networking",
  "--disable-component-update", "--disable-sync", "--remote-debugging-pipe",
  `--user-data-dir=${profile}`, `--ignore-certificate-errors-spki-list=${spki}`, "about:blank",
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
try {
  const version = await call("Browser.getVersion");
  const results = [];
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  for (const url of urls) {
    const navigation = await call("Page.navigate", { url }, sessionId);
    if (navigation.errorText) throw new Error(navigation.errorText);
    let value;
    for (let count = 0; count < 100 && !value; count++) {
      const { result } = await call("Runtime.evaluate", {
        expression: `location.href === ${JSON.stringify(url)} && document.querySelector("#result[data-complete]")?.textContent`,
        returnByValue: true,
      }, sessionId);
      value = result.value;
      if (!value) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!value) throw new Error(`Probe did not finish: ${url}`);
    results.push(JSON.parse(value));
  }
  console.log(JSON.stringify({ version, results }, null, 2));
  await call("Browser.close").catch(() => {});
} finally {
  child.kill();
}
