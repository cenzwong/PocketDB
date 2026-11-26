import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { withBrowser } from "../../../tests/support/chromium.mjs";

const root = resolve(new URL("../../..", import.meta.url).pathname);
const webRoot = resolve(root, "apps/web");
const viteModule = pathToFileURL(
  resolve(webRoot, "node_modules/vite/dist/node/index.js"),
);
const { createServer } = await import(viteModule.href);
const server = await createServer({
  configFile: resolve(webRoot, "vite.config.ts"),
  root: webRoot,
  server: { host: "127.0.0.1", port: 0 },
});

try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/`;
  const outcome = await withBrowser(async ({ page, version }) => {
    const probePage = await page(url);
    await probePage.wait("Boolean(document.querySelector('#app'))");
    await probePage.evaluate(`(() => {
      const signed = [];
      const originalSign = SubtleCrypto.prototype.sign;
      const originalVerify = SubtleCrypto.prototype.verify;
      window.__authDiagnostics = [];
      const fields = data => {
        try {
          const value = JSON.parse(new TextDecoder().decode(data));
          return Array.isArray(value) && value[0] === 'host' ? value : undefined;
        } catch { return undefined; }
      };
      SubtleCrypto.prototype.sign = async function(algorithm, key, data) {
        const result = await originalSign.call(this, algorithm, key, data);
        const transcript = fields(data);
        if (transcript) signed.push(transcript);
        return result;
      };
      SubtleCrypto.prototype.verify = async function(algorithm, key, signature, data) {
        const result = await originalVerify.call(this, algorithm, key, signature, data);
        const transcript = fields(data);
        if (transcript && !result) {
          const matching = signed.find(item => item[11] === transcript[11]);
          window.__authDiagnostics.push({ matchingChallenge: Boolean(matching), differingFields: matching ? transcript.map((value, index) => value === matching[index] ? -1 : index).filter(index => index >= 0) : [] });
        }
        return result;
      };
    })()`);
    const result = await probePage.evaluate(
      `import('/test/host-administration-probe.ts').then(module => module.runHostAdministrationProbe()).then(result => ({ result }), error => ({ error: error instanceof Error ? error.stack || error.message : String(error), diagnostics: window.__authDiagnostics }))`,
    );
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.result.ok, true, JSON.stringify(result));
    assert.equal(result.result.access, "read-write");
    assert.equal(result.result.fingerprintRecorded, true);
    assert.equal(result.result.keyValueResult, "typed-result");
    assert.equal(
      result.result.staleSessionError,
      "connection-lost:not-started",
    );
    assert.equal(result.result.reauthenticatedNewSession, true);
    assert.equal(result.result.recoveredValue, "typed-result");
    assert.equal(result.result.networkDiagnosticsAvailable, true);
    assert.equal(result.result.transportFailureLogged, true);
    assert.ok(result.result.remoteRequestsMeasured >= 2);
    assert.equal(result.result.disconnectRevokesLink, true);
    assert.equal(
      result.result.authenticationFailure,
      "authentication-invalid-identity",
    );
    assert.equal(result.result.invalidCapabilityRevoked, true);
    const clientConsole = await probePage.evaluate(
      `import('/test/client-console-probe.ts').then(module => module.runClientConsoleProbe()).then(result => ({ result }), error => ({ error: error instanceof Error ? error.stack || error.message : String(error) }))`,
    );
    assert.equal(clientConsole.error, undefined, JSON.stringify(clientConsole));
    assert.equal(clientConsole.result.ok, true, JSON.stringify(clientConsole));
    assert.equal(clientConsole.result.modeSeparated, true);
    assert.ok(clientConsole.result.sqlResult.includes("remote"));
    assert.equal(clientConsole.result.disconnected, true);
    await probePage.close();
    return {
      browser: version,
      result: result.result,
      clientConsole: clientConsole.result,
    };
  });
  console.log(JSON.stringify(outcome, null, 2));
} finally {
  await server.close();
}
