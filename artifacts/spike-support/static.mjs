import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const types = new Map([
  [".html", "text/html"], [".js", "text/javascript"], [".mjs", "text/javascript"],
  [".wasm", "application/wasm"],
]);

export async function withSite(root, action, { prefix = "/", tls, route } = {}) {
  async function serve(request, response) {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (route && await route(pathname, request, response)) return;
    const relative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
    if (relative === null || !/^[\w./-]*$/.test(relative) ||
        relative.split("/").some((part) => part === ".." || part === ".")) {
      response.writeHead(404).end();
      return;
    }
    const file = join(root, relative || "index.html");
    try {
      const contents = await readFile(file);
      response.writeHead(200, { "Content-Type": types.get(extname(file)) ?? "application/octet-stream" }).end(contents);
    } catch {
      response.writeHead(404).end();
    }
  }
  function handle(request, response) {
    serve(request, response).catch(() => response.writeHead(500).end());
  }
  const server = tls ? createHttpsServer(tls, handle) : createServer(handle);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    return await action(`${tls ? "https" : "http"}://127.0.0.1:${server.address().port}${prefix}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
