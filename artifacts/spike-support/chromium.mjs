import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withBrowser(action, args = [], { headless = true, profilePath } = {}) {
  const profile = profilePath ?? mkdtempSync(join(tmpdir(), "pocketdb-spike-"));
  const binary = process.env.POCKETDB_CHROMIUM ??
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary";
  const child = spawn(binary, [
    ...(headless ? ["--headless"] : []), "--no-proxy-server", "--no-first-run", "--disable-background-networking",
    "--disable-component-update", "--disable-sync", "--remote-debugging-pipe", `--user-data-dir=${profile}`, ...args, "about:blank",
  ], { stdio: ["ignore", "ignore", process.stderr, "pipe", "pipe"] });
  const exited = once(child, "exit");
  child.on("error", () => {});
  let sequence = 0;
  let buffer = "";
  const pending = new Map();
  child.stdio[3].on("error", () => {});
  child.stdio[4].setEncoding("utf8");
  child.stdio[4].on("data", (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf("\0"); end >= 0; end = buffer.indexOf("\0")) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  });
  function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      pending.set(id, { timer, resolve, reject });
      child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    });
  }
  async function page(url, browserContextId) {
    const { targetId } = await call("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const navigate = async () => {
      const result = await call("Page.navigate", { url }, sessionId);
      if (result.errorText) throw new Error(result.errorText);
    };
    await navigate();
    async function evaluate(expression) {
      const value = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
      return value.result.value;
    }
    async function wait(expression, { timeoutMs = 10_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await evaluate(expression);
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 125));
      }
      throw new Error(`Page condition timed out: ${expression}`);
    }
    return {
      evaluate, wait, navigate,
      command: (method, params) => call(method, params, sessionId),
      async close() {
        const result = await call("Target.closeTarget", { targetId });
        if (!result.success) throw new Error("Browser rejected tab close");
        for (let attempt = 0; attempt < 80; attempt++) {
          const { targetInfos } = await call("Target.getTargets");
          if (targetInfos.every((target) => target.targetId !== targetId)) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("Tab did not close");
      },
    };
  }
  try {
    const version = await call("Browser.getVersion");
    return await action({
      page,
      async privateContext(use) {
        const { browserContextId } = await call("Target.createBrowserContext");
        try {
          return await use({ page: (url) => page(url, browserContextId), version: version.product });
        } finally {
          await call("Target.disposeBrowserContext", { browserContextId });
        }
      },
      version: version.product,
    });
  } finally {
    child.kill();
    await exited.catch(() => {});
    if (!profilePath) rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
