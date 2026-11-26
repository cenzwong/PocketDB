import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { withBrowser } from "../../../tests/support/chromium.mjs";

const webRoot = resolve(new URL("..", import.meta.url).pathname);
const dist = resolve(webRoot, "dist");
const prefix = "/PocketDB/";
await stat(resolve(dist, "index.html"));
await stat(resolve(dist, "distributed.html"));

const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".data", "application/octet-stream"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
]);
const server = createServer(async (request, response) => {
  const requestPath = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "127.0.0.1"}`,
  ).pathname;
  if (requestPath === prefix.slice(0, -1)) {
    response.writeHead(308, { location: prefix }).end();
    return;
  }
  if (!requestPath.startsWith(prefix)) {
    response.writeHead(404).end("Not found");
    return;
  }
  let relativePath;
  try {
    relativePath = decodeURIComponent(requestPath.slice(prefix.length));
  } catch {
    response.writeHead(400).end("Invalid path");
    return;
  }
  const filePath = resolve(dist, relativePath || "index.html");
  if (filePath !== dist && !filePath.startsWith(`${dist}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const immutable = requestPath.includes("/assets/");
    response.writeHead(200, {
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "content-length": info.size,
      "content-type":
        types.get(extname(filePath)) ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolveListen) =>
  server.listen(0, "127.0.0.1", resolveListen),
);
const address = server.address();
assert(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}${prefix}`;

try {
  const outcome = await withBrowser(async ({ page, version }) => {
    const hostPage = await page(baseUrl);
    await hostPage.wait("Boolean(document.querySelector('#setup-form'))");
    assert.equal(await hostPage.evaluate("location.pathname"), prefix);
    const index = await fetch(baseUrl).then((response) => response.text());
    assert.match(index, /\.\/assets\//);

    await hostPage.evaluate(
      "document.querySelector('#setup-form').requestSubmit()",
    );
    await hostPage.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
    );
    await hostPage.evaluate(`(() => {
      const editor = document.querySelector('#sql-input');
      editor.value = "SELECT 'pages-postgres' AS marker;";
      document.querySelector('#run-query').click();
    })()`);
    await hostPage.wait(
      "document.querySelector('#result-content tbody td')?.textContent === 'pages-postgres'",
    );
    await hostPage.evaluate("document.querySelector('#stop-button').click()");
    await hostPage.wait(
      "document.querySelector('#runtime-status').textContent === 'Stopped'",
    );

    await hostPage.evaluate(`(() => {
      document.querySelector('[data-engine="duckdb"]').click();
      document.querySelector('#setup-form').requestSubmit();
    })()`);
    await hostPage.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
    );
    await hostPage.evaluate(`(() => {
      document.querySelector('#sql-input').value = "SELECT i FROM range(10001) AS values(i)";
      document.querySelector('#run-query').click();
    })()`);
    await hostPage.wait(
      "document.querySelector('#result-summary').textContent.includes('results truncated')",
    );
    await hostPage.evaluate("document.querySelector('#stop-button').click()");
    await hostPage.wait(
      "document.querySelector('#runtime-status').textContent === 'Stopped'",
    );

    await hostPage.evaluate(`(() => {
      document.querySelector('[data-engine="kv"]').click();
      document.querySelector('#setup-form').requestSubmit();
    })()`);
    await hostPage.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
    );
    await hostPage.evaluate(`(() => {
      document.querySelector('#command-name').value = 'SET';
      document.querySelector('#command-arguments').value = '["pages-key", "pages-value"]';
      document.querySelector('#command-form').requestSubmit();
    })()`);
    await hostPage.wait(
      "document.querySelector('#result-content').textContent.includes('OK')",
    );
    await hostPage.wait(
      "document.querySelector('#key-rows').textContent.includes('pages-value')",
    );

    await hostPage.evaluate(`(() => {
      document.querySelector('#signaling-endpoint').value = 'http://127.0.0.1:${address.port}/signal';
      document.querySelector('#create-invitation').click();
    })()`);
    await hostPage.wait(
      "document.querySelector('#invitation-list input')?.value.includes('#invite=')",
    );
    const invitationUrl = await hostPage.evaluate(
      "document.querySelector('#invitation-list input').value",
    );
    assert.equal(new URL(invitationUrl).pathname, prefix);

    const clientPage = await page(invitationUrl);
    await clientPage.wait(
      "document.querySelector('#client-workspace') && !document.querySelector('#client-workspace').hidden",
    );
    assert.equal(await clientPage.evaluate("location.pathname"), prefix);
    assert.equal(
      await clientPage.evaluate(
        "document.querySelector('#client-invitation').value",
      ),
      invitationUrl,
    );
    assert.equal(
      await clientPage.evaluate(
        "document.querySelector('#client-signaling-endpoint').value",
      ),
      "",
    );
    await clientPage.close();
    const distributedUrl = await hostPage.evaluate(
      `document.querySelector('a[href="./distributed.html"]').href`,
    );
    assert.equal(new URL(distributedUrl).pathname, `${prefix}distributed.html`);
    const distributedPage = await page(distributedUrl);
    await distributedPage.wait(
      "Boolean(document.querySelector('#replica-host-start'))",
    );
    const navigation = await distributedPage.evaluate(
      "[...document.querySelectorAll('.distributed-nav a')].map(link => new URL(link.href).pathname)",
    );
    assert.deepEqual(navigation, [prefix, prefix]);
    await distributedPage.close();
    await hostPage.close();
    return {
      browser: version,
      projectPath: prefix,
      postgresqlWorker: true,
      keyValueWorker: true,
      distributedConsole: true,
      directInvitationPath: new URL(invitationUrl).pathname,
    };
  });
  console.log(JSON.stringify(outcome, null, 2));
} finally {
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
}
