import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { withBrowser } from "../../../artifacts/spike-support/chromium.mjs";

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
  const outcome = await withBrowser(async (browser) => {
    const page = await browser.page(url);
    await page.wait("Boolean(document.querySelector('#setup-form'))");
    await page.wait(
      "document.querySelector('#capability-list').textContent.includes('query')",
    );

    const initial = await page.evaluate(`({
      status: document.querySelector('#runtime-status').textContent,
      selectedEngine: document.querySelector('[data-engine="postgresql"]').getAttribute('aria-pressed'),
      persistenceOptions: [...document.querySelector('#persistence-mode').options].map(option => option.value),
      operationCount: document.querySelectorAll('#capability-list li').length,
    })`);
    assert.equal(initial.status, "Stopped");
    assert.equal(initial.selectedEngine, "true");
    assert.deepEqual(initial.persistenceOptions, ["memory", "indexeddb"]);
    assert.ok(initial.operationCount > 0);

    await page.evaluate(
      "document.querySelector('#setup-form').requestSubmit()",
    );
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
    );
    await page.evaluate(`(() => {
      const editor = document.querySelector('#sql-input');
      editor.value = 'SELECT 1 AS ready;';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    })()`);
    await page.wait(
      "document.querySelector('#result-content tbody td')?.textContent === '1'",
    );
    await page.wait(
      "!document.querySelector('#diagnostics-panel').hidden && document.querySelector('#diagnostic-metrics').textContent.includes('Requests received')",
    );
    assert.match(
      await page.evaluate(
        "document.querySelector('#diagnostic-network').textContent",
      ),
      /No peer transport details are available yet/,
    );

    await page.evaluate(`(() => {
      const editor = document.querySelector('#sql-input');
      editor.value = 'SELECT FROM';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#run-query').click();
    })()`);
    await page.wait(
      "document.querySelector('#error-message').textContent.includes('postgres-sql-')",
    );
    await page.evaluate(`(() => {
      document.querySelector('#signaling-endpoint').value = 'https://127.0.0.1:1/api?token=do-not-export';
      document.querySelector('#invitation-access').value = 'read-write';
      document.querySelector('#create-invitation').focus();
    })()`);
    assert.equal(
      await page.evaluate(
        "document.querySelector('#create-invitation').disabled",
      ),
      false,
    );
    await page.command("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await page.command("Input.dispatchKeyEvent", {
      type: "char",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
    });
    await page.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await page.wait(
      "document.querySelector('#invitation-list input')?.value.includes('#invite=')",
    );
    const invitationState = await page.evaluate(`(() => {
      const link = document.querySelector('#invitation-list input').value;
      const credential = link.slice(link.indexOf('#') + 1);
      const statuses = [
        '#runtime-status', '#host-peer-count', '#activity-message', '#error-message',
        '#invitation-list .invitation-details',
      ].map(selector => document.querySelector(selector)?.textContent || '').join(' ');
      return {
        link: link,
        warning: document.querySelector('#invitation-warning').textContent,
        lifecycleWarning: document.querySelector('.lifecycle-warning').textContent,
        credentialHiddenFromStatus: !statuses.includes(credential),
      };
    })()`);
    assert.match(invitationState.warning, /read-write access/i);
    assert.match(invitationState.lifecycleWarning, /device awake/i);
    assert.equal(invitationState.credentialHiddenFromStatus, true);
    await page.wait(
      "document.querySelector('#diagnostic-events').textContent.includes('signaling-failed')",
    );
    await page.wait(
      "document.querySelector('#diagnostic-network').textContent.includes('check the signaling endpoint and network')",
    );
    assert.match(
      await page.evaluate(
        "document.querySelector('#diagnostic-network').textContent",
      ),
      /detailed transport information is unavailable/,
    );
    await page.evaluate(`(() => {
      window.__pocketdbDiagnosticExports = [];
      window.__pocketdbOriginalAnchorClick = HTMLAnchorElement.prototype.click;
      window.__pocketdbOriginalCreateObjectURL = URL.createObjectURL;
      HTMLAnchorElement.prototype.click = function() {
        if (this.download === 'pocketdb-diagnostics.json') {
          window.__pocketdbDiagnosticFilename = this.download;
        } else {
          window.__pocketdbOriginalAnchorClick.call(this);
        }
      };
      URL.createObjectURL = (blob) => {
        blob.text().then(text => window.__pocketdbDiagnosticExports.push(text));
        return window.__pocketdbOriginalCreateObjectURL.call(URL, blob);
      };
      document.querySelector('#export-diagnostics').click();
    })()`);
    await page.wait(
      "window.__pocketdbDiagnosticFilename === 'pocketdb-diagnostics.json' && window.__pocketdbDiagnosticExports.length === 1",
    );
    const exportedDiagnostics = await page.evaluate(`({
      filename: window.__pocketdbDiagnosticFilename,
      json: window.__pocketdbDiagnosticExports[0],
    })`);
    await page.evaluate(`(() => {
      HTMLAnchorElement.prototype.click = window.__pocketdbOriginalAnchorClick;
      URL.createObjectURL = window.__pocketdbOriginalCreateObjectURL;
    })()`);
    assert.equal(exportedDiagnostics.filename, "pocketdb-diagnostics.json");
    assert.ok(exportedDiagnostics.json);
    assert.doesNotMatch(
      exportedDiagnostics.json,
      /do-not-export|#invite=|capability=/i,
    );
    assert.doesNotMatch(exportedDiagnostics.json, /127\.0\.0\.1|SELECT FROM/i);
    assert.equal(JSON.parse(exportedDiagnostics.json).telemetry, "disabled");
    assert.ok(JSON.parse(exportedDiagnostics.json).events.length <= 100);
    await page.evaluate(
      "document.querySelector('#invitation-list .secondary-button').focus()",
    );
    await page.command("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await page.command("Input.dispatchKeyEvent", {
      type: "char",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
    });
    await page.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await page.wait(
      "document.querySelector('#error-message').textContent.includes('Invitation copied') || document.querySelector('#error-message').textContent.includes('Select and copy')",
    );
    await page.evaluate(
      "document.querySelector('#invitation-list .revoke-button').focus()",
    );
    await page.command("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await page.command("Input.dispatchKeyEvent", {
      type: "char",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
    });
    await page.command("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await page.wait(
      "document.querySelector('#invitation-list .invitation-details span')?.textContent.includes('Revoked · create a new invitation to reconnect')",
    );
    assert.equal(
      await page.evaluate(
        "document.querySelectorAll('#invitation-list input').length",
      ),
      0,
    );
    await page.evaluate("document.querySelector('#stop-button').click()");
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Stopped'",
    );
    const postgresqlInstanceName = await page.evaluate(`(() => {
      const name = 'console-persisted-' + crypto.randomUUID().replaceAll('-', '');
      document.querySelector('#instance-name').value = name;
      document.querySelector('#persistence-mode').value = 'indexeddb';
      return name;
    })()`);
    await page.evaluate(
      "document.querySelector('#setup-form').requestSubmit()",
    );
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
    );
    const postgresStorageWarning = await page.evaluate(`({
      status: document.querySelector('#storage-status').textContent,
      warning: document.querySelector('#storage-warning').textContent,
    })`);
    assert.match(postgresStorageWarning.status, /survives reloads/i);
    assert.match(postgresStorageWarning.warning, /cleared or evicted/i);
    await page.evaluate(`(() => {
      const editor = document.querySelector('#sql-input');
      editor.value = 'CREATE TABLE console_marker (value text);';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#run-query').click();
    })()`);
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('Running SQL query')",
    );
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('query completed')",
    );
    await page.evaluate(`(() => {
      const editor = document.querySelector('#sql-input');
      editor.value = "INSERT INTO console_marker VALUES ('reopened');";
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#run-query').click();
    })()`);
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('Running SQL query')",
    );
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('query completed')",
    );
    await page.evaluate("document.querySelector('#stop-button').click()");
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Stopped'",
    );
    await page.navigate(url);
    await page.wait("Boolean(document.querySelector('#setup-form'))");
    await page.evaluate(`(() => {
      document.querySelector('#instance-name').value = ${JSON.stringify(postgresqlInstanceName)};
      document.querySelector('#persistence-mode').value = 'indexeddb';
      document.querySelector('#setup-form').requestSubmit();
    })()`);
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
    );
    await page.evaluate(`(() => {
      const editor = document.querySelector('#sql-input');
      editor.value = 'SELECT value FROM console_marker;';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#run-query').click();
    })()`);
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('Running SQL query')",
    );
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('query completed') || document.querySelector('#activity-message').textContent.includes('query failed')",
    );
    const persistenceResult = await page.evaluate(`({
      activity: document.querySelector('#activity-message').textContent,
      error: document.querySelector('#error-message').textContent,
      result: document.querySelector('#result-content').textContent,
      value: document.querySelector('#result-content tbody td')?.textContent,
    })`);
    assert.equal(
      persistenceResult.value,
      "reopened",
      JSON.stringify(persistenceResult),
    );
    const persistentConsoleReopened = persistenceResult.value === "reopened";
    await page.evaluate("document.querySelector('#stop-button').click()");
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Stopped'",
    );

    await page.evaluate("document.querySelector('[data-engine=kv]').click()");
    await page.wait(
      "[...document.querySelectorAll('#capability-list li')].some(item => item.textContent === 'SCAN')",
    );
    const keyValueControls = await page.evaluate(`({
      available: [...document.querySelectorAll('#capability-list li')].map(item => item.textContent),
      commandOptions: [...document.querySelector('#command-name').options].map(option => option.value),
      commandEnabled: !document.querySelector('#command-name').disabled,
      argumentsEnabled: !document.querySelector('#command-arguments').disabled,
      persistenceVisible: !document.querySelector('#persistence-setting').hidden,
    })`);
    assert.deepEqual(
      keyValueControls.commandOptions,
      keyValueControls.available,
    );
    assert.equal(keyValueControls.commandEnabled, true);
    assert.equal(keyValueControls.argumentsEnabled, true);
    assert.equal(keyValueControls.persistenceVisible, true);
    const keyValueInstanceName = await page.evaluate(`(() => {
      const name = 'console-kv-' + crypto.randomUUID().replaceAll('-', '');
      document.querySelector('#instance-name').value = name;
      document.querySelector('#persistence-mode').value = 'indexeddb';
      return name;
    })()`);
    await page.evaluate(
      "document.querySelector('#setup-form').requestSubmit()",
    );
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
    );
    await page.evaluate(
      "document.querySelector('#command-form').requestSubmit()",
    );
    await page.wait(
      "document.querySelector('#result-content .structured-result')?.textContent === 'OK'",
    );
    await page.wait(
      "document.querySelector('#key-rows tr td')?.textContent === 'greeting'",
    );
    await page.wait(
      "document.querySelector('#key-rows tr td:nth-child(2)')?.textContent === 'hello'",
    );
    await page.evaluate("document.querySelector('#stop-button').click()");
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Stopped'",
    );
    await page.navigate(url);
    await page.wait("Boolean(document.querySelector('#setup-form'))");
    await page.evaluate("document.querySelector('[data-engine=kv]').click()");
    await page.wait(
      "[...document.querySelectorAll('#capability-list li')].some(item => item.textContent === 'SCAN')",
    );
    await page.evaluate(`(() => {
      document.querySelector('#instance-name').value = ${JSON.stringify(keyValueInstanceName)};
      document.querySelector('#persistence-mode').value = 'indexeddb';
      document.querySelector('#setup-form').requestSubmit();
    })()`);
    await page.wait(
      "document.querySelector('#runtime-status').textContent === 'Running'",
    );

    await page.evaluate(`(() => {
      document.querySelector('#command-name').value = 'GET';
      document.querySelector('#command-name').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#command-form').requestSubmit();
    })()`);
    await page.wait(
      "document.querySelector('#result-content .structured-result')?.textContent === 'hello'",
    );
    await page.evaluate(`(() => {
      const args = document.querySelector('#command-arguments');
      args.value = '[';
      document.querySelector('#command-form').requestSubmit();
    })()`);
    await page.wait(
      "document.querySelector('#error-message').textContent.includes('valid JSON')",
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
      document.querySelector('#export-snapshot').click();
    })()`);
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('Snapshot exported')",
    );
    const snapshot = await page.evaluate(
      "({ bytes: window.__snapshotBlob.size, name: window.__downloads.at(-1) })",
    );
    assert.ok(snapshot.bytes > 0);
    assert.match(snapshot.name, /\.pdb$/);
    await page.evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['invalid'], 'invalid.pdb'));
      const input = document.querySelector('#import-snapshot');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await page.wait(
      "document.querySelector('#activity-message').textContent.includes('active database is unchanged')",
    );
    await page.wait(
      "document.querySelector('#run-command').disabled === false",
    );
    await page.evaluate(`(() => {
      document.querySelector('#command-name').value = 'GET';
      document.querySelector('#command-name').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#command-form').requestSubmit();
    })()`);
    await page.wait(
      "document.querySelector('#result-content .structured-result')?.textContent === 'hello'",
    );
    await page.evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([window.__snapshotBlob], 'restored.pdb'));
      const input = document.querySelector('#import-snapshot');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await page.wait(
      "document.querySelector('#error-message').textContent.includes('Snapshot restored')",
    );
    await page.wait(
      "document.querySelector('#run-command').disabled === false",
    );
    await page.evaluate(`(() => {
      document.querySelector('#command-name').value = 'GET';
      document.querySelector('#command-name').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#command-form').requestSubmit();
    })()`);
    await page.wait(
      "document.querySelector('#result-content .structured-result')?.textContent === 'hello'",
    );
    const keyValueSnapshotRestored = await page.evaluate(
      "document.querySelector('#result-content .structured-result')?.textContent === 'hello'",
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

    const result = await page.evaluate(`({
      browser: navigator.userAgent,
      keyValueReadResult: ${keyValueSnapshotRestored},
      persistentConsoleReopened: ${persistentConsoleReopened},
      kvSelected: document.querySelector('[data-engine="kv"]').getAttribute('aria-pressed'),
      keyCount: document.querySelectorAll('#key-rows tr').length,
      keyboardHint: document.body.textContent.includes('Ctrl'),
      finalStatus: document.querySelector('#runtime-status').textContent,
    })`);
    assert.equal(result.kvSelected, "true");
    assert.equal(result.keyCount, 1);
    assert.equal(result.keyboardHint, true);
    assert.equal(result.finalStatus, "Stopped");
    assert.equal(result.keyValueReadResult, true);
    assert.equal(result.persistentConsoleReopened, true);
    await page.close();
    return { browser: browser.version, outcome: result };
  });
  assert.equal(outcome.outcome.finalStatus, "Stopped");
  console.log(JSON.stringify(outcome, null, 2));
} finally {
  await server.close();
}
