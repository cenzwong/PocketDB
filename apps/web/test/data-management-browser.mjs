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
  const postgresOutcome = await withBrowser(async (browser) => {
    const page = await browser.page(url);
    await page.wait("Boolean(document.querySelector('#setup-form'))");
    await page.wait(
      "document.querySelector('#capability-list').textContent.includes('query')",
    );
    await page.evaluate(`(() => {
      window.confirm = () => true;
      window.__downloads = [];
      URL.createObjectURL = (blob) => {
        window.__snapshotBlob = blob;
        return 'blob:pocketdb-probe';
      };
      HTMLAnchorElement.prototype.click = function() {
        window.__downloads.push(this.download);
      };
      document.querySelector('#setup-form').requestSubmit();
    })()`);
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
    );
    await page.wait(
      "document.querySelector('#data-management').hidden === false",
    );
    const initialStorage = await page.evaluate(`(() => {
      const importButton = document.querySelector('#import-snapshot-button');
      importButton.focus();
      return {
        warning: document.querySelector('#storage-warning').textContent,
        importButtonFocused: document.activeElement === importButton,
      };
    })()`);
    assert.match(initialStorage.warning, /temporary|reload/i);
    assert.equal(initialStorage.importButtonFocused, true);

    await runSql(page, "CREATE TABLE restore_marker (value text);");
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('query completed')",
    );
    await runSql(page, "INSERT INTO restore_marker VALUES ('kept');");
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('query completed')",
    );
    await runExport(page);
    const postgresDownload = await page.evaluate(
      "({ size: window.__snapshotBlob.size, name: window.__downloads.at(-1) })",
    );
    assert.ok(postgresDownload.size > 0);
    assert.match(postgresDownload.name, /\.pdb$/);
    await importBytes(page, "invalid-pg.pdb", "invalid");
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('active database is unchanged')",
    );
    await runSql(page, "SELECT value FROM restore_marker;");
    await page.wait(
      "document.querySelector('#result-content tbody td')?.textContent === 'kept'",
    );
    await importSavedSnapshot(page, "restored-pg.pdb");
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Running' && document.querySelector('#error-message').textContent.includes('Snapshot restored')",
    );
    await runSql(page, "SELECT value FROM restore_marker;");
    await page.wait(
      "document.querySelector('#result-content tbody td')?.textContent === 'kept'",
    );
    await page.evaluate("document.querySelector('#reset-database').click()");
    await page.wait(
      "document.querySelector('#error-message').textContent.includes('Database reset')",
    );
    await runSql(page, "CREATE TABLE restore_marker (value text);");
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('query completed')",
    );
    await page.evaluate("document.querySelector('#delete-database').click()");
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Stopped'",
    );
    assert.equal(
      await page.evaluate("document.querySelector('#data-management').hidden"),
      true,
    );

    await page.close();
    return {
      browser: browser.version,
      postgresExportBytes: postgresDownload.size,
      failedImportsPreservedActiveData: true,
      restoreResetDeletePassed: true,
      keyboardImportControlFocusable: initialStorage.importButtonFocused,
    };
  });
  const keyValueOutcome = await withBrowser(async (browser) => {
    const page = await browser.page(url);
    await page.wait("Boolean(document.querySelector('#setup-form'))");
    await page.evaluate(`(() => {
      window.confirm = () => true;
      window.__downloads = [];
      URL.createObjectURL = (blob) => {
        window.__snapshotBlob = blob;
        return 'blob:pocketdb-probe';
      };
      HTMLAnchorElement.prototype.click = function() {
        window.__downloads.push(this.download);
      };
      document.querySelector('[data-engine="kv"]').click();
    })()`);
    await page.wait(
      "document.querySelector('#capability-list').textContent.includes('SCAN')",
    );
    await page.evaluate(
      "document.querySelector('#setup-form').requestSubmit()",
    );
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
    );
    await page.wait(
      "document.querySelector('#run-command').disabled === false",
    );
    await runKv(page, "SET", '["restore-key", "kept"]');
    await page.wait(
      "document.querySelector('#result-content .structured-result')?.textContent === 'OK'",
    );
    await page.wait(
      "document.querySelector('#key-rows tr td')?.textContent === 'restore-key'",
    );
    await runExport(page);
    const snapshot = await page.evaluate(
      "({ bytes: window.__snapshotBlob.size, name: window.__downloads.at(-1) })",
    );
    assert.ok(snapshot.bytes > 0);
    assert.match(snapshot.name, /\.pdb$/);
    await importBytes(page, "invalid-kv.pdb", "invalid");
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('active database is unchanged')",
    );
    await page.wait(
      "document.querySelector('#run-command').disabled === false",
    );
    await runKv(page, "GET", '["restore-key"]');
    await page.wait(
      "document.querySelector('#result-content .structured-result')?.textContent === 'kept'",
    );
    await importSavedSnapshot(page, "restored-kv.pdb");
    await page.wait(
      "document.querySelector('#error-message').textContent.includes('Snapshot restored')",
    );
    await page.wait(
      "document.querySelector('#run-command').disabled === false",
    );
    await runKv(page, "GET", '["restore-key"]');
    await page.wait(
      "document.querySelector('#result-content .structured-result')?.textContent === 'kept'",
    );
    await page.evaluate("document.querySelector('#reset-database').click()");
    await page.wait(
      "document.querySelector('#error-message').textContent.includes('Database reset')",
    );
    await page.wait(
      "document.querySelector('#key-rows').textContent.includes('No keys yet')",
    );
    await page.evaluate("document.querySelector('#delete-database').click()");
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Stopped'",
    );
    await page.close();
    return { browser: browser.version, snapshotBytes: snapshot.bytes };
  });
  console.log(
    JSON.stringify(
      { postgres: postgresOutcome, keyValue: keyValueOutcome },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}

async function runExport(page) {
  await page.evaluate("document.querySelector('#export-snapshot').click()");
  await page.wait(
    "document.querySelector('#activity-message').textContent.includes('Snapshot exported')",
  );
}

async function runSql(page, sql) {
  await page.evaluate(`(() => {
    const editor = document.querySelector('#sql-input');
    editor.value = ${JSON.stringify(sql)};
    document.querySelector('#run-query').click();
  })()`);
}

async function runKv(page, command, args) {
  await page.evaluate(`(() => {
    document.querySelector('#command-name').value = ${JSON.stringify(command)};
    document.querySelector('#command-name').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#command-arguments').value = ${JSON.stringify(args)};
    document.querySelector('#command-form').requestSubmit();
  })()`);
}

async function importBytes(page, name, text) {
  await page.evaluate(`(() => {
    const input = document.querySelector('#import-snapshot');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function importSavedSnapshot(page, name) {
  await page.evaluate(`(() => {
    const input = document.querySelector('#import-snapshot');
    const transfer = new DataTransfer();
    transfer.items.add(new File([window.__snapshotBlob], ${JSON.stringify(name)}));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}
