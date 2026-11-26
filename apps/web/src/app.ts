import {
  DatabaseRuntime,
  WorkerEngineAdapter,
  type EngineCapabilities,
  type WorkerLike,
} from "@pocketdb/runtime";
import { HostAdministration } from "./host-administration";
import {
  connectBrowserClient,
  type BrowserClientConnection,
} from "./client-connection";
import type { ProtocolValue } from "@pocketdb/protocol";
import { LocalObservability, MAX_DIAGNOSTIC_EVENTS } from "./diagnostics";

type EngineChoice = "postgresql" | "sqlite" | "duckdb" | "kv";
type PersistenceChoice = "memory" | "indexeddb";

interface EngineModule {
  readonly id: EngineChoice;
  capabilities(): EngineCapabilities;
}

interface ActiveDatabase {
  readonly runtime: DatabaseRuntime;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly engine: EngineChoice;
  readonly instanceName: string;
  readonly persistence: PersistenceChoice;
  readonly dataDir: string;
  readonly capabilities: EngineCapabilities;
}

export interface AppOptions {
  readonly connectClient?: (
    invitation: string,
    endpoint: string,
  ) => Promise<BrowserClientConnection>;
}

const ENGINE_LABELS: Record<EngineChoice, string> = {
  postgresql: "PostgreSQL",
  sqlite: "SQLite",
  duckdb: "DuckDB",
  kv: "Key-value",
};

const ENGINE_MODULES = new Map<EngineChoice, Promise<EngineModule>>();
export function createAppMarkup(): string {
  return `
    <div class="app-shell">
      <aside class="sidebar" aria-label="Database selection">
        <a class="brand" href="#" aria-label="PocketDB home">PocketDB</a>
        <h2 class="sidebar-heading" data-host-only>Databases</h2>
        <div class="engine-list" data-host-only role="group" aria-label="Choose a database engine">
          <button class="engine-choice is-selected" type="button" data-engine="postgresql" aria-pressed="true">
            <svg class="database-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><ellipse cx="10" cy="4.5" rx="6" ry="2.5" /><path d="M4 4.5v10.8c0 1.35 2.69 2.45 6 2.45s6-1.1 6-2.45V4.5M4 9.9c0 1.35 2.69 2.45 6 2.45s6-1.1 6-2.45" /></svg><span>Local PostgreSQL</span>
          </button>
          <button class="engine-choice" type="button" data-engine="sqlite" aria-pressed="false">
            <svg class="database-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><ellipse cx="10" cy="4.5" rx="6" ry="2.5" /><path d="M4 4.5v10.8c0 1.35 2.69 2.45 6 2.45s6-1.1 6-2.45V4.5M4 9.9c0 1.35 2.69 2.45 6 2.45s6-1.1 6-2.45" /></svg><span>Local SQLite</span>
          </button>
          <button class="engine-choice" type="button" data-engine="duckdb" aria-pressed="false">
            <svg class="database-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><ellipse cx="10" cy="4.5" rx="6" ry="2.5" /><path d="M4 4.5v10.8c0 1.35 2.69 2.45 6 2.45s6-1.1 6-2.45V4.5M4 9.9c0 1.35 2.69 2.45 6 2.45s6-1.1 6-2.45" /></svg><span>Local DuckDB</span>
          </button>
          <button class="engine-choice" type="button" data-engine="kv" aria-pressed="false">
            <svg class="database-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><ellipse cx="10" cy="4.5" rx="6" ry="2.5" /><path d="M4 4.5v10.8c0 1.35 2.69 2.45 6 2.45s6-1.1 6-2.45V4.5M4 9.9c0 1.35 2.69 2.45 6 2.45s6-1.1 6-2.45" /></svg><span>Local Key-value</span>
          </button>
        </div>
        <p class="sidebar-note" data-host-only>Runs in this browser.<br />This page is the host.<br /><a href="./distributed.html">Open Distributed Mode</a></p>
      </aside>

      <main class="workspace">
        <header class="page-heading">
          <div class="title-row">
            <h1>Local database</h1>
            <span id="runtime-status" class="status-pill" role="status" aria-live="polite">Stopped</span>
          </div>
          <p id="engine-description" class="muted">A PostgreSQL database running locally in a dedicated worker.</p>
        </header>

        <div class="mode-switch" role="group" aria-label="Choose host or client mode">
          <button id="host-mode-button" class="mode-button is-selected" type="button" aria-pressed="true">Host a database</button>
          <button id="client-mode-button" class="mode-button" type="button" aria-pressed="false">Connect as a client</button>
        </div>

        <form id="setup-form" class="setup-row" data-host-only>
          <label class="name-field" for="instance-name">
            <span>Instance name</span>
            <input id="instance-name" name="instanceName" value="local-postgres" maxlength="48" autocomplete="off" required />
          </label>
          <div id="persistence-setting" class="persistence-setting">
            <label for="persistence-mode">Persistence</label>
            <select id="persistence-mode" name="persistence">
              <option value="memory">Memory (ephemeral)</option>
              <option value="indexeddb">IndexedDB (persists in this browser)</option>
            </select>
          </div>
          <button id="start-button" class="primary-button" type="submit">Start database</button>
          <button id="stop-button" class="secondary-button" type="button" hidden>Stop database</button>
        </form>

        <section id="data-management" class="data-management" data-host-only aria-labelledby="data-management-heading" hidden>
          <div class="section-heading">
            <div>
              <h2 id="data-management-heading">Data management</h2>
              <p id="storage-status" class="muted" role="status" aria-live="polite"></p>
            </div>
          </div>
          <p id="storage-warning" class="storage-warning" role="note"></p>
          <div class="data-management-actions">
            <button id="export-snapshot" class="secondary-button" type="button">Export snapshot</button>
            <button id="export-native-file" class="secondary-button" type="button" hidden>Export SQLite file</button>
            <button id="import-snapshot-button" class="secondary-button" type="button">Import and restore snapshot</button>
            <input id="import-snapshot" class="visually-hidden" type="file" accept=".pdb,application/octet-stream" aria-label="Choose a PocketDB snapshot to restore" />
            <input id="import-native-file" class="visually-hidden" type="file" accept=".sqlite,.db,application/vnd.sqlite3,application/octet-stream" aria-label="Choose a native SQLite database file to restore" />
            <button id="import-dataset-button" class="secondary-button" type="button" hidden>Import CSV, JSON or Parquet</button>
            <input id="import-dataset" class="visually-hidden" type="file" accept=".csv,.json,.parquet,text/csv,application/json,application/vnd.apache.parquet,application/octet-stream" aria-label="Choose a CSV, JSON or Parquet dataset" />
            <button id="import-native-file-button" class="secondary-button" type="button" hidden>Import SQLite file</button>
            <button id="reset-database" class="secondary-button" type="button">Reset database</button>
            <button id="delete-database" class="danger-button" type="button">Delete database</button>
          </div>
        </section>

        <section id="capabilities" class="capabilities" data-host-only aria-label="Available engine operations" hidden>
          <span class="capabilities-label">Available operations</span>
          <ul id="capability-list" class="capability-list"></ul>
        </section>

        <section id="host-administration" class="host-administration" data-host-only aria-labelledby="host-heading" hidden>
          <div class="section-heading">
            <div>
              <h2 id="host-heading">Share this database</h2>
              <p class="muted">Invitations grant the selected access to this running instance.</p>
            </div>
            <span id="host-peer-count" class="muted" role="status" aria-live="polite">No connected peers</span>
          </div>
          <p class="lifecycle-warning" role="note">Keep this tab open and your device awake while others are connected. Backgrounding, sleep, reload or closing this tab may interrupt access.</p>
          <div class="invitation-controls">
            <label for="signaling-endpoint">Signaling endpoint</label>
            <input id="signaling-endpoint" type="url" autocomplete="url" placeholder="https://signal.example/api" aria-describedby="signaling-help" />
            <label for="invitation-access">Access</label>
            <select id="invitation-access">
              <option value="read-only">Read only</option>
              <option value="read-write">Read and write</option>
            </select>
            <button id="create-invitation" class="primary-button" type="button" disabled>Create and copy invitation</button>
          </div>
          <p id="signaling-help" class="muted help-text">Use an HTTPS room-signaling service. HTTP is allowed only for localhost. PocketDB does not operate a signaling service.</p>
          <p id="invitation-warning" class="invitation-warning" role="status" aria-live="polite" hidden></p>
          <div id="invitation-list" class="invitation-list" aria-label="Invitations"></div>
          <div class="table-scroll peer-table-scroll">
            <table aria-label="Connected peers">
              <thead><tr><th scope="col">Client identity</th><th scope="col">Access</th><th scope="col">Status</th><th scope="col">Connected</th><th scope="col">Action</th></tr></thead>
              <tbody id="peer-rows"><tr><td colspan="5" class="empty-cell">No peers connected.</td></tr></tbody>
            </table>
          </div>
        </section>

        <section id="diagnostics-panel" class="diagnostics-panel" data-host-only aria-labelledby="diagnostics-heading" hidden>
          <div class="section-heading">
            <div>
              <h2 id="diagnostics-heading">Local diagnostics</h2>
              <p class="muted">Metrics and a bounded event log stay in this browser. No remote telemetry is sent.</p>
            </div>
            <div class="diagnostics-actions">
              <button id="refresh-diagnostics" class="secondary-button" type="button">Refresh</button>
              <button id="export-diagnostics" class="secondary-button" type="button">Export diagnostics</button>
            </div>
          </div>
          <dl id="diagnostic-metrics" class="diagnostic-metrics"></dl>
          <div class="diagnostic-network-block">
            <h3>Network</h3>
            <ul id="diagnostic-network" class="diagnostic-network"></ul>
          </div>
          <div class="diagnostic-log-block">
            <h3>Recent activity</h3>
            <ol id="diagnostic-events" class="diagnostic-events"></ol>
          </div>
          <p id="diagnostic-status" class="muted" role="status" aria-live="polite"></p>
        </section>

        <section id="sql-panel" class="console-panel" data-host-only aria-labelledby="sql-heading" hidden>
          <div class="section-heading">
            <h2 id="sql-heading">SQL editor</h2>
            <span class="muted">PostgreSQL · PGlite</span>
          </div>
          <label class="visually-hidden" for="sql-input">SQL query</label>
          <div class="sql-editor">
            <pre id="sql-line-numbers" class="line-numbers" aria-hidden="true">1</pre>
            <textarea id="sql-input" class="code-input" spellcheck="false" autocomplete="off" autocapitalize="off">SELECT 1 AS ready;</textarea>
          </div>
          <div class="editor-actions">
            <button id="run-query" class="primary-button" type="button" disabled>Run query</button>
            <span class="shortcut-hint"><kbd>⌘</kbd><span>or</span><kbd>Ctrl</kbd> <kbd>Enter</kbd></span>
          </div>
        </section>

        <section id="kv-panel" class="console-panel" data-host-only aria-labelledby="kv-heading" hidden>
          <div class="section-heading">
            <div>
              <h2 id="kv-heading">Key-value console</h2>
              <p id="kv-storage-note" class="muted">Values are ephemeral and reset when stopped.</p>
            </div>
          </div>
          <form id="command-form" class="command-row">
            <label for="command-name">Command</label>
            <select id="command-name" name="command" disabled></select>
            <label for="command-arguments">Arguments (JSON array)</label>
            <textarea id="command-arguments" rows="2" spellcheck="false" disabled>["greeting", "hello"]</textarea>
            <button id="run-command" class="primary-button" type="submit" disabled>Execute command</button>
            <span class="shortcut-hint"><kbd>⌘</kbd><span>or</span><kbd>Ctrl</kbd> <kbd>Enter</kbd></span>
          </form>
          <div id="key-browser" class="key-browser" hidden>
            <div class="section-heading compact-heading">
              <h3>Key browser</h3>
              <button id="refresh-keys" class="text-button" type="button">Refresh keys</button>
            </div>
            <div class="table-scroll">
              <table>
                <thead><tr><th scope="col">Key</th><th scope="col">Value</th><th scope="col">TTL</th></tr></thead>
                <tbody id="key-rows"><tr><td colspan="3" class="empty-cell">No keys yet.</td></tr></tbody>
              </table>
            </div>
            <button id="load-more-keys" class="text-button" type="button" hidden>Load more keys</button>
          </div>
        </section>

        <section id="results-panel" class="results-panel" data-host-only aria-labelledby="results-heading" aria-live="polite" hidden>
          <div class="section-heading">
            <h2 id="results-heading">Results</h2>
            <span id="result-summary" class="muted"></span>
          </div>
          <div id="result-content" class="result-content">
            <p class="empty-message">Run an operation to see its result.</p>
          </div>
        </section>

        <section id="client-workspace" class="client-workspace" aria-labelledby="client-heading" hidden>
          <div class="section-heading">
            <div>
              <h2 id="client-heading">Connect to a hosted database</h2>
              <p class="muted">Client operations run on the invited host and use the access granted by its link.</p>
            </div>
            <span id="client-status" role="status" aria-live="polite">Not connected</span>
          </div>
          <p id="client-reconnect-help" class="lifecycle-warning" role="note" hidden></p>
          <form id="client-connection-form" class="client-connect-form">
            <label for="client-invitation">Invitation link</label>
            <textarea id="client-invitation" rows="2" spellcheck="false" autocomplete="off" required aria-describedby="client-connection-help"></textarea>
            <label for="client-signaling-endpoint">Signaling endpoint</label>
            <input id="client-signaling-endpoint" type="url" autocomplete="url" placeholder="https://signal.example/api" required />
            <p id="client-connection-help" class="muted">Use the same signaling provider as the host. The invitation link is a bearer capability; keep it private.</p>
            <div class="client-connect-actions">
              <button id="client-connect-button" class="primary-button" type="submit">Connect</button>
              <button id="client-disconnect-button" class="secondary-button" type="button" hidden>Disconnect</button>
            </div>
          </form>
          <section id="client-operations" class="client-operations" aria-label="Remote database operations" hidden>
            <div class="capabilities" aria-label="Host capabilities">
              <span class="capabilities-label">Host operations</span>
              <ul id="client-capability-list" class="capability-list"></ul>
            </div>
            <section id="client-sql-panel" class="console-panel" aria-labelledby="client-sql-heading" hidden>
              <div class="section-heading"><h3 id="client-sql-heading">Remote SQL</h3><span id="client-sql-access" class="muted"></span></div>
              <label for="client-sql-input">SQL query</label>
              <textarea id="client-sql-input" class="client-code-input" spellcheck="false" autocomplete="off">SELECT 1 AS ready;</textarea>
              <label for="client-sql-params">Parameters (JSON array)</label>
              <textarea id="client-sql-params" rows="2" spellcheck="false">[]</textarea>
              <button id="client-run-query" class="primary-button" type="button">Run remote query</button>
            </section>
            <section id="client-kv-panel" class="console-panel" aria-labelledby="client-kv-heading" hidden>
              <div class="section-heading"><h3 id="client-kv-heading">Remote key-value</h3><span id="client-kv-access" class="muted"></span></div>
              <form id="client-kv-form" class="client-kv-form">
                <label for="client-kv-command">Command</label>
                <select id="client-kv-command"></select>
                <label for="client-kv-arguments">Arguments (JSON array)</label>
                <textarea id="client-kv-arguments" rows="2" spellcheck="false">["greeting"]</textarea>
                <button id="client-run-command" class="primary-button" type="submit">Run remote command</button>
              </form>
            </section>
            <section id="client-results-panel" class="results-panel" aria-labelledby="client-results-heading" aria-live="polite" hidden>
              <div class="section-heading"><h3 id="client-results-heading">Client results</h3><span id="client-result-summary" class="muted"></span></div>
              <div id="client-result-content" class="result-content"><p class="empty-message">Run a remote operation to see its result.</p></div>
            </section>
          </section>
        </section>

        <section class="feedback-row" aria-label="Runtime feedback">
          <div>
            <h2>Activity</h2>
            <p id="activity-message" class="activity-message"><span class="activity-dot" aria-hidden="true"></span><span>Choose an engine and start a database.</span></p>
          </div>
          <div class="error-region">
            <h2>Status / Error</h2>
            <div id="error-message" class="error-message" role="alert" aria-live="assertive">No errors.</div>
          </div>
        </section>
      </main>
    </div>
  `;
}

export function mountApp(root: HTMLElement, options: AppOptions = {}): void {
  root.innerHTML = createAppMarkup();
  const element = <T extends HTMLElement>(selector: string): T => {
    const result = root.querySelector<T>(selector);
    if (!result) throw new Error(`Missing app element: ${selector}`);
    return result;
  };

  const status = element<HTMLElement>("#runtime-status");
  const engineDescription = element<HTMLElement>("#engine-description");
  const nameInput = element<HTMLInputElement>("#instance-name");
  const persistenceMode = element<HTMLSelectElement>("#persistence-mode");
  const persistenceSetting = element<HTMLElement>("#persistence-setting");
  const startButton = element<HTMLButtonElement>("#start-button");
  const stopButton = element<HTMLButtonElement>("#stop-button");
  const dataManagement = element<HTMLElement>("#data-management");
  const storageStatus = element<HTMLElement>("#storage-status");
  const storageWarning = element<HTMLElement>("#storage-warning");
  const exportSnapshotButton = element<HTMLButtonElement>("#export-snapshot");
  const importSnapshotButton = element<HTMLButtonElement>(
    "#import-snapshot-button",
  );
  const importSnapshotInput = element<HTMLInputElement>("#import-snapshot");
  const exportNativeFileButton = element<HTMLButtonElement>(
    "#export-native-file",
  );
  const importNativeFileButton = element<HTMLButtonElement>(
    "#import-native-file-button",
  );
  const importNativeFileInput = element<HTMLInputElement>(
    "#import-native-file",
  );
  const importDatasetButton = element<HTMLButtonElement>(
    "#import-dataset-button",
  );
  const importDatasetInput = element<HTMLInputElement>("#import-dataset");
  const resetDatabaseButton = element<HTMLButtonElement>("#reset-database");
  const deleteDatabaseButton = element<HTMLButtonElement>("#delete-database");
  const sqlPanel = element<HTMLElement>("#sql-panel");
  const kvPanel = element<HTMLElement>("#kv-panel");
  const sqlInput = element<HTMLTextAreaElement>("#sql-input");
  const runQueryButton = element<HTMLButtonElement>("#run-query");
  const commandForm = element<HTMLFormElement>("#command-form");
  const commandName = element<HTMLSelectElement>("#command-name");
  const commandArguments = element<HTMLTextAreaElement>("#command-arguments");
  const runCommandButton = element<HTMLButtonElement>("#run-command");
  const refreshKeysButton = element<HTMLButtonElement>("#refresh-keys");
  const keyBrowser = element<HTMLElement>("#key-browser");
  const keyRows = element<HTMLTableSectionElement>("#key-rows");
  const loadMoreKeys = element<HTMLButtonElement>("#load-more-keys");
  const resultsPanel = element<HTMLElement>("#results-panel");
  const resultSummary = element<HTMLElement>("#result-summary");
  const resultContent = element<HTMLElement>("#result-content");
  const activity = element<HTMLElement>("#activity-message");
  const errorRegion = element<HTMLElement>("#error-message");
  const hostAdministrationPanel = element<HTMLElement>("#host-administration");
  const signalingEndpoint = element<HTMLInputElement>("#signaling-endpoint");
  const invitationAccess = element<HTMLSelectElement>("#invitation-access");
  const createInvitationButton =
    element<HTMLButtonElement>("#create-invitation");
  const invitationList = element<HTMLElement>("#invitation-list");
  const peerRows = element<HTMLTableSectionElement>("#peer-rows");
  const peerCount = element<HTMLElement>("#host-peer-count");
  const invitationWarning = element<HTMLElement>("#invitation-warning");
  const hostModeButton = element<HTMLButtonElement>("#host-mode-button");
  const clientModeButton = element<HTMLButtonElement>("#client-mode-button");
  element<HTMLButtonElement>("#refresh-diagnostics").addEventListener(
    "click",
    () => void renderDiagnostics(),
  );
  element<HTMLButtonElement>("#export-diagnostics").addEventListener(
    "click",
    () => void exportDiagnostics(),
  );
  const clientWorkspace = element<HTMLElement>("#client-workspace");
  const clientConnectionForm = element<HTMLFormElement>(
    "#client-connection-form",
  );
  const clientInvitation = element<HTMLTextAreaElement>("#client-invitation");
  const clientSignalingEndpoint = element<HTMLInputElement>(
    "#client-signaling-endpoint",
  );
  const clientConnectButton = element<HTMLButtonElement>(
    "#client-connect-button",
  );
  const clientDisconnectButton = element<HTMLButtonElement>(
    "#client-disconnect-button",
  );
  const clientStatus = element<HTMLElement>("#client-status");
  const clientOperations = element<HTMLElement>("#client-operations");
  const clientCapabilityList = element<HTMLUListElement>(
    "#client-capability-list",
  );
  const clientSqlPanel = element<HTMLElement>("#client-sql-panel");
  const clientSqlInput = element<HTMLTextAreaElement>("#client-sql-input");
  const clientSqlParams = element<HTMLTextAreaElement>("#client-sql-params");
  const clientRunQuery = element<HTMLButtonElement>("#client-run-query");
  const clientKvPanel = element<HTMLElement>("#client-kv-panel");
  const clientKvForm = element<HTMLFormElement>("#client-kv-form");
  const clientKvCommand = element<HTMLSelectElement>("#client-kv-command");
  const clientKvArguments = element<HTMLTextAreaElement>(
    "#client-kv-arguments",
  );
  const clientRunCommand = element<HTMLButtonElement>("#client-run-command");
  const clientResultsPanel = element<HTMLElement>("#client-results-panel");
  const clientResultSummary = element<HTMLElement>("#client-result-summary");
  const clientResultContent = element<HTMLElement>("#client-result-content");
  const diagnosticsPanel = element<HTMLElement>("#diagnostics-panel");
  const diagnosticMetrics = element<HTMLElement>("#diagnostic-metrics");
  const diagnosticNetwork = element<HTMLUListElement>("#diagnostic-network");
  const diagnosticEvents = element<HTMLOListElement>("#diagnostic-events");
  const diagnosticStatus = element<HTMLElement>("#diagnostic-status");
  const observability = new LocalObservability();

  let selectedEngine: EngineChoice = "postgresql";
  let active: ActiveDatabase | undefined;
  let hostAdministration: HostAdministration | undefined;
  let clientConnection: BrowserClientConnection | undefined;
  let clientStateUnsubscribe: (() => void) | undefined;
  let scanCursor = "0";
  let busy = false;
  let clientBusy = false;

  function setFeedback(message: string, isError = false): void {
    errorRegion.replaceChildren(document.createTextNode(message));
    errorRegion.classList.toggle("has-error", isError);
  }

  function setActivity(message: string, working = false): void {
    activity.replaceChildren();
    const dot = document.createElement("span");
    dot.className = `activity-dot${working ? " is-working" : ""}`;
    dot.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = message;
    activity.append(dot, text);
  }

  function setBusy(value: boolean): void {
    busy = value;
    startButton.hidden = Boolean(active);
    stopButton.hidden = !active;
    startButton.disabled = value || Boolean(active);
    stopButton.disabled = value;
    runQueryButton.disabled = value || !active || !isSqlEngine(selectedEngine);
    runCommandButton.disabled = value || !active || selectedEngine !== "kv";
    commandName.disabled = value;
    commandArguments.disabled = value;
    refreshKeysButton.disabled = value || !active;
    loadMoreKeys.disabled = value || !active;
    persistenceMode.disabled = value || Boolean(active);
    nameInput.disabled = value || Boolean(active);
    exportSnapshotButton.disabled = value || !active;
    exportNativeFileButton.disabled = value || !active;
    importSnapshotButton.disabled = value || !active;
    importSnapshotInput.disabled = value || !active;
    importNativeFileButton.disabled = value || !active;
    importNativeFileInput.disabled = value || !active;
    importDatasetButton.disabled = value || !active;
    importDatasetInput.disabled = value || !active;
    resetDatabaseButton.disabled = value || !active;
    deleteDatabaseButton.disabled = value || !active;
    createInvitationButton.disabled =
      value || !active || active.capabilities.operations.length === 0;
    signalingEndpoint.disabled = value || !active;
    invitationAccess.disabled = value || !active;
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-engine]",
    )) {
      button.disabled = value || Boolean(active);
    }
  }

  function showStatus(
    value: "Stopped" | "Starting" | "Running" | "Stopping",
  ): void {
    status.textContent = value;
    status.dataset.state = value.toLowerCase();
    void renderDiagnostics();
  }

  async function buildDiagnosticsExport() {
    const storage = await navigator.storage?.estimate().catch(() => undefined);
    const invitations = hostAdministration?.listInvitations() ?? [];
    return observability.export({
      status:
        (status.dataset.state as
          | "stopped"
          | "starting"
          | "running"
          | "stopping") ?? "stopped",
      ...(active ? { engine: active.engine } : {}),
      activePeers: invitations.filter(
        (invitation) => invitation.state === "connected",
      ).length,
      network:
        (await hostAdministration?.networkDiagnostics().catch(() => [])) ?? [],
      ...(typeof storage?.usage === "number"
        ? { storageUsageBytes: storage.usage }
        : {}),
      ...(typeof storage?.quota === "number"
        ? { storageQuotaBytes: storage.quota }
        : {}),
    });
  }

  async function renderDiagnostics(): Promise<void> {
    if (!diagnosticsPanel || !diagnosticMetrics) return;
    diagnosticsPanel.hidden = !active;
    const payload = await buildDiagnosticsExport();
    diagnosticMetrics.replaceChildren();
    const metrics: ReadonlyArray<readonly [string, string]> = [
      ["Runtime", payload.runtime.status],
      ["Uptime", formatDuration(payload.runtime.uptimeMs)],
      ["Connected peers", String(payload.runtime.activePeers)],
      ["Requests received", String(payload.runtime.requestsReceived)],
      ["Successful requests", String(payload.runtime.successfulRequests)],
      ["Failed requests", String(payload.runtime.failedRequests)],
      ["Unknown outcomes", String(payload.runtime.unknownOutcomes)],
      [
        "Average request handling",
        `${payload.runtime.averageRequestDurationMs} ms`,
      ],
      [
        "Average engine execution",
        `${payload.runtime.averageExecutionDurationMs} ms`,
      ],
      ["Operation bytes received", formatBytes(payload.runtime.requestBytes)],
      ["Operation bytes sent", formatBytes(payload.runtime.responseBytes)],
      ["Active requests", String(payload.runtime.activeRequests)],
      [
        "Browser storage",
        payload.browserStorage.usageBytes === undefined
          ? "Unavailable"
          : `${formatBytes(payload.browserStorage.usageBytes)} used of ${formatBytes(payload.browserStorage.quotaBytes ?? 0)}`,
      ],
    ];
    for (const [label, value] of metrics) {
      const term = document.createElement("dt");
      term.textContent = label;
      const definition = document.createElement("dd");
      definition.textContent = value;
      diagnosticMetrics.append(term, definition);
    }

    diagnosticNetwork.replaceChildren();
    if (payload.network.length === 0) {
      const item = document.createElement("li");
      item.textContent = "No peer transport details are available yet.";
      diagnosticNetwork.append(item);
    } else {
      for (const peer of payload.network) {
        const item = document.createElement("li");
        const nextStep =
          peer.invitationState === "failed"
            ? "; check the signaling endpoint and network, then create a new invitation"
            : peer.invitationState === "revoked"
              ? "; create a fresh invitation to reconnect"
              : "";
        item.textContent = peer.detailsAvailable
          ? `Signalling ${peer.invitationState}; transport ${peer.transportState ?? "unknown"}; ICE ${peer.iceConnectionState ?? "unknown"}; ${peer.path} path${peer.candidateTypes.length === 0 ? "" : `; candidates ${peer.candidateTypes.join("/")}`}${peer.currentRoundTripTimeMs === undefined ? "" : `; ${Math.round(peer.currentRoundTripTimeMs)} ms RTT`}${peer.dataChannelBytesSent === undefined ? "" : `; ${formatBytes(peer.dataChannelBytesSent)} sent`}${peer.dataChannelBytesReceived === undefined ? "" : `; ${formatBytes(peer.dataChannelBytesReceived)} received`}${peer.dataChannelBufferedBytes === undefined ? "" : `; ${formatBytes(peer.dataChannelBufferedBytes)} queued`}${nextStep}`
          : `Signalling ${peer.invitationState}; detailed transport information is unavailable${nextStep}.`;
        diagnosticNetwork.append(item);
      }
    }

    diagnosticEvents.replaceChildren();
    for (const event of payload.events.slice(-10).reverse()) {
      const item = document.createElement("li");
      const code = event.code ? ` · ${event.code}` : "";
      item.textContent = `+${formatDuration(event.elapsedMs)} · ${event.event}${code}`;
      item.dataset.level = event.level;
      diagnosticEvents.append(item);
    }
    diagnosticStatus.textContent = `Showing the latest ${payload.events.length} of at most ${MAX_DIAGNOSTIC_EVENTS} local events. Invitation links, signaling URLs and operation parameters are not included.`;
  }

  async function exportDiagnostics(): Promise<void> {
    try {
      const payload = await buildDiagnosticsExport();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "pocketdb-diagnostics.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setFeedback("Local diagnostics exported. No telemetry was sent.");
    } catch {
      setFeedback("Local diagnostics could not be exported.", true);
    }
  }

  function showResult(
    value: unknown,
    panel = resultsPanel,
    summaryElement = resultSummary,
    contentElement = resultContent,
  ): void {
    panel.hidden = false;
    contentElement.replaceChildren();
    const result = isRecord(value) ? value : undefined;
    const rows = result && Array.isArray(result.rows) ? result.rows : undefined;
    if (result && rows) {
      const rowObjects = rows.filter(isRecord);
      const columns = rowObjects.length > 0 ? Object.keys(rowObjects[0]) : [];
      const summary =
        typeof result.rowCount === "number"
          ? `${result.rowCount} row${result.rowCount === 1 ? "" : "s"}`
          : `${rows.length} row${rows.length === 1 ? "" : "s"}`;
      summaryElement.textContent =
        result.truncated === true
          ? `${summary} — results truncated; additional rows are omitted.`
          : summary;
      if (columns.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent =
          rows.length === 0
            ? "Query completed with no rows."
            : "Query completed.";
        contentElement.append(empty);
        return;
      }
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const column of columns) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = column;
        headerRow.append(th);
      }
      head.append(headerRow);
      const body = document.createElement("tbody");
      for (const row of rowObjects) {
        const tr = document.createElement("tr");
        for (const column of columns) {
          const td = document.createElement("td");
          td.textContent = formatValue(row[column]);
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(head, body);
      const wrapper = document.createElement("div");
      wrapper.className = "table-scroll";
      wrapper.append(table);
      contentElement.append(wrapper);
      return;
    }

    summaryElement.textContent = "Structured result";
    const pre = document.createElement("pre");
    pre.className = "structured-result";
    pre.textContent = formatValue(value);
    contentElement.append(pre);
  }

  function showCapabilities(capabilities: EngineCapabilities): void {
    const list = element<HTMLUListElement>("#capability-list");
    list.replaceChildren();
    for (const operation of capabilities.operations) {
      const item = document.createElement("li");
      item.textContent = operation;
      list.append(item);
    }
    element<HTMLElement>("#capabilities").hidden =
      capabilities.operations.length === 0;

    if (selectedEngine === "kv") {
      commandName.replaceChildren();
      for (const operation of capabilities.operations) {
        const option = document.createElement("option");
        option.value = operation;
        option.textContent = operation;
        commandName.append(option);
      }
      commandName.value = capabilities.operations.includes("SET")
        ? "SET"
        : (capabilities.operations[0] ?? "");
      commandArguments.value = defaultArguments(commandName.value);
      keyBrowser.hidden = !capabilities.operations.includes("SCAN");
      element<HTMLElement>("#kv-storage-note").textContent =
        persistenceMode.value === "indexeddb"
          ? "Values persist in this browser. IndexedDB can be cleared or evicted by the browser."
          : typeof capabilities.features.memoryBudgetBytes === "number"
            ? `Values are ephemeral and reset when stopped. Logical memory budget: ${Math.floor(Number(capabilities.features.memoryBudgetBytes) / (1024 * 1024))} MiB.`
            : "Values are ephemeral and reset when stopped.";
    }
    persistenceSetting.hidden =
      capabilities.features.persistentDataDir !== true;
    exportSnapshotButton.hidden =
      capabilities.features.portableSnapshots !== true;
    importSnapshotButton.hidden =
      capabilities.features.portableSnapshots !== true;
    importDatasetButton.hidden =
      capabilities.features.localDatasetIngestion !== true;
  }

  async function loadEngine(engine: EngineChoice): Promise<EngineModule> {
    let promise = ENGINE_MODULES.get(engine);
    if (!promise) {
      promise =
        engine === "postgresql"
          ? import("@pocketdb/engine-pglite").then(
              (module) => new module.PGliteEngineAdapter(),
            )
          : engine === "sqlite"
            ? import("@pocketdb/engine-sqlite").then(
                (module) => new module.SqliteEngineAdapter(),
              )
            : engine === "duckdb"
              ? import("@pocketdb/engine-duckdb").then(
                  (module) => new module.DuckDBEngineAdapter(),
                )
              : import("@pocketdb/engine-kv").then(
                  (module) => new module.KeyValueEngineAdapter(),
                );
      ENGINE_MODULES.set(engine, promise);
    }
    return promise;
  }

  function selectEngine(engine: EngineChoice): void {
    selectedEngine = engine;
    const sqlEngine = isSqlEngine(engine);
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-engine]",
    )) {
      const selected = button.dataset.engine === engine;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    nameInput.value =
      engine === "postgresql"
        ? "local-postgres"
        : engine === "sqlite"
          ? "local-sqlite"
          : engine === "duckdb"
            ? "local-duckdb"
            : "local-kv";
    persistenceSetting.hidden = true;
    sqlPanel.hidden = !sqlEngine;
    kvPanel.hidden = sqlEngine;
    exportNativeFileButton.hidden = engine !== "sqlite";
    importNativeFileButton.hidden = engine !== "sqlite";
    importDatasetButton.hidden = engine !== "duckdb";
    const persistenceOption = persistenceMode.querySelector<HTMLOptionElement>(
      'option[value="indexeddb"]',
    );
    if (persistenceOption)
      persistenceOption.textContent =
        engine === "sqlite"
          ? "OPFS (persists in this browser)"
          : engine === "duckdb"
            ? "Memory (temporary)"
            : "IndexedDB (persists in this browser)";
    element<HTMLElement>("#capabilities").hidden = true;
    resultsPanel.hidden = true;
    engineDescription.textContent =
      engine === "postgresql"
        ? "A PostgreSQL database running locally in a dedicated worker."
        : engine === "sqlite"
          ? "A SQLite database running locally in a dedicated worker. OPFS persistence requires a secure browser context and allows one owner at a time."
          : engine === "duckdb"
            ? "A DuckDB analytical database running locally in a dedicated worker. Its large single-threaded WASM bundle loads only when selected; data lasts for this session."
            : "A key-value database running locally in a dedicated worker.";
    if (!active) {
      showStatus("Stopped");
      setActivity("Choose settings and start this database.");
      setFeedback("No errors.");
    }
    setBusy(busy);
    void loadEngine(engine)
      .then((module) => {
        if (selectedEngine === engine) showCapabilities(module.capabilities());
      })
      .catch((error: unknown) => setFeedback(actionableError(error), true));
  }

  async function createDatabase(
    engine: EngineChoice,
    instanceName: string,
    persistence: PersistenceChoice,
    snapshot?: Uint8Array,
    databaseFile?: Uint8Array,
  ): Promise<ActiveDatabase> {
    const module = await loadEngine(engine);
    const capabilities = module.capabilities();
    const workerAdapter = new WorkerEngineAdapter(
      engine,
      capabilities,
      () => createEngineWorker(engine),
      { maxPendingRequests: 16, requestTimeoutMs: 30_000 },
    );
    const runtime = new DatabaseRuntime();
    runtime.registerAdapter(workerAdapter);
    const instanceId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const effectivePersistence =
      capabilities.features.persistentDataDir === true ? persistence : "memory";
    const dataDir =
      capabilities.features.persistentDataDir === true
        ? getDataDirectory(instanceName, effectivePersistence, engine)
        : "memory://";
    const config = {
      ...(capabilities.features.persistentDataDir === true ? { dataDir } : {}),
      ...(snapshot ? { snapshot } : {}),
      ...(databaseFile ? { databaseFile } : {}),
    };
    await runtime.startInstance(engine, instanceId, config);
    try {
      await runtime.openSession(instanceId, {
        instanceId,
        sessionId,
        access: "owner",
      });
    } catch (error) {
      await runtime.stopInstance(instanceId).catch(() => undefined);
      throw error;
    }
    return {
      runtime,
      instanceId,
      sessionId,
      engine,
      instanceName,
      persistence: effectivePersistence,
      dataDir,
      capabilities,
    };
  }

  function createHostAdministration(
    database: ActiveDatabase,
  ): HostAdministration {
    return new HostAdministration(
      database.runtime,
      database.instanceId,
      database.engine,
      {
        onChange: () => {
          renderHostAdministration();
          void renderDiagnostics();
        },
        onError: (message) => {
          observability.record({
            level: "error",
            category: "signaling",
            event: "signaling-failed",
          });
          setFeedback(message, true);
          void renderDiagnostics();
        },
        onPeerState: (event) => {
          observability.record({
            level: event.state === "connected" ? "info" : "warning",
            category: "peer",
            event: `transport-${event.state}`,
          });
          void renderDiagnostics();
        },
        onRequestComplete: (event) => {
          observability.recordRequest(event);
          void renderDiagnostics();
        },
      },
    );
  }

  function showActiveDatabase(): void {
    const database = active;
    dataManagement.hidden = !database;
    if (!database) return;
    nameInput.value = database.instanceName;
    storageStatus.textContent =
      database.persistence === "indexeddb"
        ? database.engine === "sqlite"
          ? `Stored in this browser’s OPFS as “${database.instanceName}”. Only one tab or worker can own it.`
          : `Stored in this browser’s IndexedDB as “${database.instanceName}”. It normally survives reloads in this browser.`
        : "Stored in memory for this session; stopping or reloading discards the data.";
    storageWarning.textContent =
      database.persistence === "indexeddb"
        ? database.engine === "sqlite"
          ? "OPFS can be cleared or evicted by the browser. Export a .sqlite file or PocketDB snapshot for a portable backup."
          : database.engine === "duckdb"
            ? "OPFS can be cleared or evicted. Export query results with DuckDB COPY before removing this database."
            : "Browser storage can be cleared or evicted, and private browsing may discard it. Export a snapshot for a portable backup."
        : database.engine === "duckdb"
          ? "Memory storage is temporary. Export data with DuckDB COPY before stopping."
          : "Memory storage is temporary. Export a snapshot before stopping if you need to keep this data.";
  }

  function makeReplacementName(action: "restore" | "reset"): string {
    const base = active?.instanceName ?? "database";
    const suffix = `-${action}-${crypto.randomUUID().slice(0, 8)}`;
    return `${base.slice(0, 48 - suffix.length)}${suffix}`;
  }

  async function switchToDatabase(
    replacement: ActiveDatabase,
    previous: ActiveDatabase,
  ): Promise<boolean> {
    await hostAdministration?.close();
    hostAdministration = undefined;
    renderHostAdministration();
    await previous.runtime.stopInstance(previous.instanceId);
    active = replacement;
    selectedEngine = replacement.engine;
    observability.reset();
    hostAdministration = createHostAdministration(replacement);
    hostAdministrationPanel.hidden = false;
    diagnosticsPanel.hidden = false;
    showActiveDatabase();
    showCapabilities(replacement.capabilities);
    resultsPanel.hidden = false;
    resultSummary.textContent = "";
    resultContent.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = isSqlEngine(replacement.engine)
      ? "Run a SQL query to see its result."
      : "Run a key-value command to see its result.";
    resultContent.append(empty);
    showStatus("Running");
    setActivity(`${ENGINE_LABELS[replacement.engine]} is running.`);
    if (replacement.engine === "kv") await refreshKeys(0);
    try {
      await deleteDatabaseStorage(previous);
      return true;
    } catch (error) {
      setFeedback(
        `The new database is active, but old browser storage could not be deleted: ${actionableError(error)}`,
        true,
      );
      return false;
    }
  }

  async function deleteDatabaseStorage(
    database: ActiveDatabase,
  ): Promise<void> {
    if (database.persistence !== "indexeddb") return;
    if (database.engine === "sqlite" || database.engine === "duckdb") {
      const directory = database.dataDir.slice("opfs://".length);
      const root = await navigator.storage.getDirectory();
      await root
        .removeEntry(
          database.engine === "sqlite" ? `pocketdb-${directory}` : directory,
          { recursive: database.engine === "sqlite" },
        )
        .catch((error: unknown) => {
          if (
            !(error instanceof DOMException) ||
            error.name !== "NotFoundError"
          )
            throw error;
        });
      return;
    }
    const directory = database.dataDir.slice("idb://".length);
    const databaseName =
      database.engine === "kv" ? `pocketdb-kv-${directory}` : directory;
    await deleteIndexedDatabase(databaseName);
  }

  async function exportSnapshot(): Promise<void> {
    const database = active;
    if (!database || busy) return;
    setBusy(true);
    setActivity("Preparing a portable snapshot…", true);
    try {
      const snapshot = await database.runtime.exportSnapshot(
        database.instanceId,
      );
      const url = URL.createObjectURL(
        new Blob(
          [
            snapshot.buffer.slice(
              snapshot.byteOffset,
              snapshot.byteOffset + snapshot.byteLength,
            ) as ArrayBuffer,
          ],
          { type: "application/octet-stream" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${database.instanceName}.pdb`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setActivity("Snapshot exported.");
      setFeedback("Snapshot is unencrypted. Store it somewhere private.");
    } catch (error) {
      setActivity("Snapshot export failed.");
      setFeedback(actionableError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function exportNativeFile(): Promise<void> {
    const database = active;
    if (database?.engine !== "sqlite" || busy) return;
    setBusy(true);
    setActivity("Preparing a native SQLite file…", true);
    try {
      const bytes = await database.runtime.exportNativeFile(
        database.instanceId,
      );
      const url = URL.createObjectURL(
        new Blob([bytes.slice().buffer as ArrayBuffer], {
          type: "application/vnd.sqlite3",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${database.instanceName}.sqlite`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setActivity("SQLite file exported.");
      setFeedback(
        "The native SQLite file is unencrypted. Store it somewhere private.",
      );
    } catch (error) {
      setActivity("SQLite file export failed.");
      setFeedback(actionableError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function importNativeFile(file: File): Promise<void> {
    const previous = active;
    if (previous?.engine !== "sqlite" || busy) return;
    setBusy(true);
    setActivity("Validating and importing the SQLite file…", true);
    setFeedback("No errors.");
    let replacement: ActiveDatabase | undefined;
    try {
      replacement = await createDatabase(
        "sqlite",
        makeReplacementName("restore"),
        previous.persistence,
        undefined,
        new Uint8Array(await file.arrayBuffer()),
      );
      const oldStorageDeleted = await switchToDatabase(replacement, previous);
      setFeedback(
        oldStorageDeleted
          ? "SQLite file imported. The previous browser copy was removed."
          : "SQLite file imported. The previous browser copy remains saved.",
      );
    } catch (error) {
      if (replacement) {
        await replacement.runtime
          .stopInstance(replacement.instanceId)
          .catch(() => undefined);
        await deleteDatabaseStorage(replacement).catch(() => undefined);
      }
      setActivity("SQLite import failed; the active database is unchanged.");
      setFeedback(actionableError(error), true);
    } finally {
      importNativeFileInput.value = "";
      setBusy(false);
    }
  }

  async function importDataset(file: File): Promise<void> {
    const database = active;
    if (database?.engine !== "duckdb" || busy) return;
    if (file.size === 0 || file.size > 32 * 1024 * 1024) {
      setFeedback(
        "Choose a non-empty CSV, JSON or Parquet file up to 32 MiB.",
        true,
      );
      importDatasetInput.value = "";
      return;
    }
    setBusy(true);
    setActivity("Importing a local analytical dataset…", true);
    setFeedback("No errors.");
    try {
      const result = await database.runtime.importDataset(
        database.instanceId,
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      setActivity("Dataset imported.");
      setFeedback(
        `Imported ${result.rowCount.toLocaleString()} rows from ${result.format.toUpperCase()} into “${result.tableName}”.`,
      );
      showStatus("Running");
    } catch (error) {
      setActivity("Dataset import failed.");
      setFeedback(actionableError(error), true);
    } finally {
      importDatasetInput.value = "";
      setBusy(false);
    }
  }

  async function importSnapshot(file: File): Promise<void> {
    const previous = active;
    if (!previous || busy) return;
    setBusy(true);
    setActivity("Validating and restoring the snapshot…", true);
    setFeedback("No errors.");
    let replacement: ActiveDatabase | undefined;
    try {
      const snapshot = new Uint8Array(await file.arrayBuffer());
      replacement = await createDatabase(
        previous.engine,
        makeReplacementName("restore"),
        previous.persistence,
        snapshot,
      );
      const oldStorageDeleted = await switchToDatabase(replacement, previous);
      if (oldStorageDeleted)
        setFeedback(
          "Snapshot restored. The previous browser copy was removed.",
        );
      else
        setActivity(
          "Snapshot restored. The previous browser copy remains saved.",
        );
    } catch (error) {
      if (replacement) {
        await replacement.runtime
          .stopInstance(replacement.instanceId)
          .catch(() => undefined);
        await deleteDatabaseStorage(replacement).catch(() => undefined);
      }
      setActivity("Snapshot restore failed; the active database is unchanged.");
      setFeedback(actionableError(error), true);
    } finally {
      importSnapshotInput.value = "";
      setBusy(false);
    }
  }

  async function resetDatabase(): Promise<void> {
    const previous = active;
    if (!previous || busy) return;
    if (
      !window.confirm(`Reset “${previous.instanceName}” and discard its data?`)
    )
      return;
    setBusy(true);
    setActivity("Creating an empty database…", true);
    let replacement: ActiveDatabase | undefined;
    try {
      replacement = await createDatabase(
        previous.engine,
        makeReplacementName("reset"),
        previous.persistence,
      );
      const oldStorageDeleted = await switchToDatabase(replacement, previous);
      if (oldStorageDeleted)
        setFeedback("Database reset. Previous data was removed.");
      else
        setActivity("Database reset. The previous browser copy remains saved.");
    } catch (error) {
      if (replacement) {
        await replacement.runtime
          .stopInstance(replacement.instanceId)
          .catch(() => undefined);
        await deleteDatabaseStorage(replacement).catch(() => undefined);
      }
      setActivity("Reset failed; the active database is unchanged.");
      setFeedback(actionableError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function deleteActiveDatabase(): Promise<void> {
    const database = active;
    if (!database || busy) return;
    if (
      !window.confirm(`Delete “${database.instanceName}” and all stored data?`)
    )
      return;
    setBusy(true);
    setActivity("Closing and deleting the database…", true);
    try {
      await hostAdministration?.close();
      hostAdministration = undefined;
      await database.runtime.stopInstance(database.instanceId);
      active = undefined;
      dataManagement.hidden = true;
      await deleteDatabaseStorage(database);
      hostAdministrationPanel.hidden = true;
      resultsPanel.hidden = true;
      element<HTMLElement>("#capabilities").hidden = true;
      sqlPanel.hidden = true;
      kvPanel.hidden = true;
      keyBrowser.hidden = true;
      showStatus("Stopped");
      setActivity("Database and stored data deleted.");
      setFeedback("No errors.");
    } catch (error) {
      dataManagement.hidden = true;
      hostAdministrationPanel.hidden = true;
      showStatus("Stopped");
      setFeedback(actionableError(error), true);
      setActivity("Database deletion did not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function startDatabase(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || active) return;
    const instanceName = nameInput.value.trim();
    if (!instanceName) {
      nameInput.focus();
      setFeedback("Enter an instance name before starting the database.", true);
      return;
    }
    setBusy(true);
    showStatus("Starting");
    setActivity("Loading engine and starting its worker…", true);
    setFeedback("No errors.");
    try {
      active = await createDatabase(
        selectedEngine,
        instanceName,
        persistenceMode.value as PersistenceChoice,
      );
      observability.reset();
      hostAdministration = createHostAdministration(active);
      hostAdministrationPanel.hidden = false;
      diagnosticsPanel.hidden = false;
      showActiveDatabase();
      showStatus("Running");
      showCapabilities(active.capabilities);
      setActivity(
        `${ENGINE_LABELS[selectedEngine]} is running in a dedicated worker.`,
      );
      setFeedback("No errors.");
      resultsPanel.hidden = false;
      resultSummary.textContent = "";
      resultContent.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "empty-message";
      empty.textContent = isSqlEngine(selectedEngine)
        ? "Run a SQL query to see its result."
        : "Run a key-value command to see its result.";
      resultContent.append(empty);
      if (selectedEngine === "kv") await refreshKeys(0);
    } catch (error) {
      active = undefined;
      showStatus("Stopped");
      setActivity("The database could not be started.");
      setFeedback(actionableError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function stopDatabase(): Promise<void> {
    if (!active || busy) return;
    const database = active;
    setBusy(true);
    showStatus("Stopping");
    setActivity("Closing the worker and releasing database resources…", true);
    setFeedback("No errors.");
    try {
      await hostAdministration?.close();
      hostAdministration = undefined;
      renderHostAdministration();
      await database.runtime.stopInstance(database.instanceId);
      active = undefined;
      dataManagement.hidden = true;
      diagnosticsPanel.hidden = true;
      showStatus("Stopped");
      setActivity(
        database.persistence === "memory"
          ? "Database stopped. Memory-mode data was discarded."
          : "Database stopped. IndexedDB data remains available on reload.",
      );
      resultsPanel.hidden = true;
      element<HTMLElement>("#capabilities").hidden = true;
      keyBrowser.hidden = true;
      hostAdministrationPanel.hidden = true;
      diagnosticsPanel.hidden = true;
    } catch (error) {
      active = undefined;
      hostAdministration = undefined;
      dataManagement.hidden = true;
      hostAdministrationPanel.hidden = true;
      diagnosticsPanel.hidden = true;
      showStatus("Stopped");
      setActivity("Database stopped with a cleanup error.");
      setFeedback(actionableError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function runSql(): Promise<void> {
    if (!active || !isSqlEngine(selectedEngine) || busy) return;
    const sql = sqlInput.value.trim();
    if (!sql) {
      setFeedback("Enter a SQL statement before running the query.", true);
      sqlInput.focus();
      return;
    }
    await executeOperation("query", { sql }, "Running SQL query…");
  }

  async function runCommand(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!active || selectedEngine !== "kv" || busy) return;
    let args: unknown;
    try {
      args = JSON.parse(commandArguments.value);
    } catch {
      setFeedback(
        'Arguments must be valid JSON. Enter an array such as ["greeting"] or ["greeting", "hello"].',
        true,
      );
      commandArguments.focus();
      return;
    }
    if (!Array.isArray(args)) {
      setFeedback("Command arguments must be a JSON array.", true);
      commandArguments.focus();
      return;
    }
    await executeOperation(
      commandName.value,
      args,
      `Running ${commandName.value}…`,
    );
    if (
      ["SET", "MSET", "DEL", "INCR", "DECR", "EXPIRE", "PERSIST"].includes(
        commandName.value,
      )
    ) {
      await refreshKeys(0);
    }
  }

  async function executeOperation(
    operation: string,
    payload: unknown,
    message: string,
  ): Promise<void> {
    const database = active;
    if (!database) return;
    setBusy(true);
    setActivity(message, true);
    setFeedback("No errors.");
    try {
      const response = await database.runtime.execute(database.sessionId, {
        operation,
        payload,
      });
      showResult(response.value);
      setActivity(`${operation} completed.`);
    } catch (error) {
      setActivity(`${operation} failed.`);
      setFeedback(actionableError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function refreshKeys(cursor: number): Promise<void> {
    const database = active;
    if (
      !database ||
      selectedEngine !== "kv" ||
      !database.capabilities.operations.includes("SCAN")
    )
      return;
    if (busy && cursor !== 0) return;
    const wasBusy = busy;
    setBusy(true);
    if (!wasBusy) setActivity("Loading keys…", true);
    try {
      const scan = await database.runtime.execute(database.sessionId, {
        operation: "SCAN",
        payload: [String(cursor), "COUNT", 20],
      });
      const value = scan.value as [string, string[]];
      scanCursor = value[0];
      const keys = value[1];
      const values =
        keys.length === 0
          ? []
          : ((
              await database.runtime.execute(database.sessionId, {
                operation: "MGET",
                payload: keys,
              })
            ).value as unknown[]);
      const rows: HTMLTableRowElement[] = [];
      for (let index = 0; index < keys.length; index += 1) {
        const ttl = (
          await database.runtime.execute(database.sessionId, {
            operation: "TTL",
            payload: [keys[index]],
          })
        ).value;
        const row = document.createElement("tr");
        for (const cellValue of [
          keys[index],
          values[index],
          typeof ttl === "number" && ttl >= 0 ? `${ttl}s` : "—",
        ]) {
          const cell = document.createElement("td");
          cell.textContent = formatValue(cellValue);
          row.append(cell);
        }
        rows.push(row);
      }
      if (cursor === 0) keyRows.replaceChildren();
      if (rows.length > 0) keyRows.append(...rows);
      else if (cursor === 0) {
        const empty = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 3;
        cell.className = "empty-cell";
        cell.textContent = "No keys yet.";
        empty.append(cell);
        keyRows.append(empty);
      }
      loadMoreKeys.hidden = scanCursor === "0";
      if (!wasBusy)
        setActivity(
          `${keys.length} key${keys.length === 1 ? "" : "s"} loaded.`,
        );
    } catch (error) {
      setFeedback(actionableError(error), true);
    } finally {
      setBusy(wasBusy);
    }
  }

  async function createAndCopyInvitation(): Promise<void> {
    if (!active || !hostAdministration || createInvitationButton.disabled)
      return;
    const endpoint = signalingEndpoint.value.trim();
    if (!endpoint) {
      setFeedback(
        "Enter a signaling endpoint before creating an invitation.",
        true,
      );
      signalingEndpoint.focus();
      return;
    }
    createInvitationButton.disabled = true;
    setActivity("Creating a scoped invitation…", true);
    invitationWarning.hidden = true;
    try {
      const invitation = await hostAdministration.createInvitation(
        invitationAccess.value as "read-only" | "read-write",
        endpoint,
        window.location.href,
      );
      renderHostAdministration();
      if (invitation.warning) {
        invitationWarning.textContent = invitation.warning;
        invitationWarning.hidden = false;
        setActivity("Read the access warning before copying this invitation.");
        setFeedback(
          "Review the read-write warning, then copy the invitation when ready.",
        );
        return;
      }
      try {
        await navigator.clipboard.writeText(invitation.link);
        setActivity(
          "Invitation copied. Share it only with its intended recipient.",
        );
        setFeedback("Invitation copied to the clipboard.");
      } catch {
        setActivity(
          "Invitation created. Select its link and copy it to share.",
        );
        setFeedback(
          "Clipboard access was unavailable. The invitation link is ready below.",
          true,
        );
      }
    } catch (error) {
      setActivity("The invitation could not be created.");
      setFeedback(actionableError(error), true);
    } finally {
      setBusy(busy);
    }
  }

  function renderHostAdministration(): void {
    if (!hostAdministration) {
      invitationList.replaceChildren();
      peerRows.replaceChildren();
      const empty = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "empty-cell";
      cell.textContent = "No peers connected.";
      empty.append(cell);
      peerRows.append(empty);
      peerCount.textContent = "No connected peers";
      return;
    }

    const invitations = hostAdministration.listInvitations();
    invitationList.replaceChildren();
    const peers: NonNullable<(typeof invitations)[number]["peer"]>[] = [];
    for (const invitation of invitations) {
      if (
        invitation.state === "connected" &&
        invitation.peer?.state === "connected"
      ) {
        peers.push(invitation.peer);
      }
      const card = document.createElement("article");
      card.className = "invitation-card";
      const details = document.createElement("div");
      details.className = "invitation-details";
      const title = document.createElement("strong");
      title.textContent = `${invitation.access === "read-only" ? "Read-only" : "Read and write"} invitation`;
      const state = document.createElement("span");
      state.className = "muted";
      state.textContent =
        invitation.state === "waiting"
          ? "Waiting for one client"
          : invitation.state === "connected"
            ? "Client connected"
            : invitation.state === "revoked"
              ? "Revoked · create a new invitation to reconnect"
              : `Connection failed${invitation.message ? `: ${invitation.message}` : ""}`;
      details.append(title, state);
      card.append(details);
      if (invitation.state !== "revoked") {
        const link = document.createElement("input");
        link.type = "url";
        link.readOnly = true;
        link.setAttribute(
          "aria-label",
          "Invitation link. This link contains the access capability.",
        );
        link.value = hostAdministration.getInvitationLink(invitation.id) ?? "";
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "secondary-button";
        copy.textContent = "Copy link";
        copy.addEventListener("click", () => {
          void navigator.clipboard.writeText(link.value).then(
            () => setFeedback("Invitation copied to the clipboard."),
            () => {
              link.focus();
              link.select();
              setFeedback("Select and copy the invitation link.");
            },
          );
        });
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "text-button revoke-button";
        revoke.textContent = "Revoke";
        revoke.addEventListener("click", () => {
          void hostAdministration?.revokeInvitation(invitation.id);
        });
        card.append(link, copy, revoke);
      }
      invitationList.append(card);
    }

    peerRows.replaceChildren();
    if (peers.length === 0) {
      const empty = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "empty-cell";
      cell.textContent = "No peers connected.";
      empty.append(cell);
      peerRows.append(empty);
    } else {
      for (const peer of peers) {
        const row = document.createElement("tr");
        const identity = document.createElement("td");
        identity.textContent = peer.clientFingerprint;
        identity.title =
          "Public-key fingerprint; no invitation capability is shown.";
        const access = document.createElement("td");
        access.textContent = peer.access;
        const peerState = document.createElement("td");
        peerState.textContent = "Connected";
        const connectedAt = document.createElement("td");
        connectedAt.textContent = new Date(
          peer.connectedAt,
        ).toLocaleTimeString();
        const action = document.createElement("td");
        const disconnect = document.createElement("button");
        disconnect.type = "button";
        disconnect.className = "text-button";
        disconnect.textContent = "Disconnect";
        disconnect.setAttribute(
          "aria-label",
          `Disconnect client ${peer.clientFingerprint}`,
        );
        disconnect.addEventListener("click", () => {
          void hostAdministration?.disconnectPeer(peer.id);
        });
        action.append(disconnect);
        row.append(identity, access, peerState, connectedAt, action);
        peerRows.append(row);
      }
    }
    peerCount.textContent =
      peers.length === 1
        ? "1 connected peer"
        : `${peers.length} connected peers`;
    createInvitationButton.disabled =
      busy || !active || active.capabilities.operations.length === 0;
  }

  function setWorkspaceMode(mode: "host" | "client"): void {
    for (const surface of root.querySelectorAll<HTMLElement>(
      "[data-host-only]",
    )) {
      surface.hidden = mode !== "host";
    }
    clientWorkspace.hidden = mode !== "client";
    hostModeButton.classList.toggle("is-selected", mode === "host");
    clientModeButton.classList.toggle("is-selected", mode === "client");
    hostModeButton.setAttribute("aria-pressed", String(mode === "host"));
    clientModeButton.setAttribute("aria-pressed", String(mode === "client"));
    element<HTMLHeadingElement>(".page-heading h1").textContent =
      mode === "host" ? "Local database host" : "PocketDB client";
    engineDescription.textContent =
      mode === "client"
        ? "Connect with an invitation and run operations on the host database."
        : `A ${ENGINE_LABELS[selectedEngine]} database running locally in a dedicated worker.`;
    if (mode === "client") clientInvitation.focus();
    else if (!active) nameInput.focus();
  }

  function updateClientControls(): void {
    const connectionState = clientConnection?.client.state;
    const ended = connectionState === "failed" || connectionState === "closed";
    const connected = connectionState === "connected";
    clientConnectButton.textContent = ended
      ? "Connect with new invitation"
      : "Connect";
    clientConnectButton.disabled =
      clientBusy || (Boolean(clientConnection) && !ended);
    clientInvitation.disabled =
      clientBusy || (Boolean(clientConnection) && !ended);
    clientSignalingEndpoint.disabled =
      clientBusy || (Boolean(clientConnection) && !ended);
    clientDisconnectButton.hidden = !clientConnection;
    clientDisconnectButton.disabled = clientBusy || !clientConnection;
    element<HTMLElement>("#client-reconnect-help").hidden = !ended;
    clientRunQuery.disabled =
      clientBusy ||
      !connected ||
      !isSqlEngine(clientConnection?.client.engineId ?? "");
    clientRunCommand.disabled =
      clientBusy || !connected || clientConnection?.client.engineId !== "kv";
    clientKvCommand.disabled = clientBusy || !connected;
    clientKvArguments.disabled = clientBusy || !connected;
    clientSqlInput.disabled = clientBusy || !connected;
    clientSqlParams.disabled = clientBusy || !connected;
  }

  async function connectClient(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (
      clientBusy ||
      (clientConnection &&
        clientConnection.client.state !== "failed" &&
        clientConnection.client.state !== "closed")
    )
      return;
    const invitationUri = clientInvitation.value.trim();
    const endpoint = clientSignalingEndpoint.value.trim();
    if (!invitationUri || !endpoint) {
      setFeedback(
        "Enter both an invitation link and its signaling endpoint.",
        true,
      );
      if (!invitationUri) clientInvitation.focus();
      else clientSignalingEndpoint.focus();
      return;
    }
    clientBusy = true;
    updateClientControls();
    if (clientConnection) {
      clientStateUnsubscribe?.();
      clientStateUnsubscribe = undefined;
      await clientConnection.close().catch(() => undefined);
      clientConnection = undefined;
    }
    clientStatus.textContent = "Connecting and authenticating…";
    clientOperations.hidden = true;
    clientResultsPanel.hidden = true;
    setActivity("Connecting as a client and authenticating the host…", true);
    setFeedback("No errors.");
    try {
      clientConnection = await (options.connectClient ?? connectBrowserClient)(
        invitationUri,
        endpoint,
      );
      const client = clientConnection.client;
      clientStateUnsubscribe = client.onStateChange?.((event) => {
        if (!clientConnection || clientConnection.client !== client) return;
        if (event.state === "failed") {
          clientStatus.textContent = "Connection ended";
          element<HTMLElement>("#client-reconnect-help").textContent =
            "This session has ended. Ask the host for a fresh invitation, paste it above, and reconnect. Operations with unknown outcomes were not retried.";
          clientOperations.hidden = true;
          clientResultsPanel.hidden = true;
          setActivity("The host connection ended.");
          if (event.error) setFeedback(event.error.message, true);
        } else if (event.state === "closed") {
          clientStatus.textContent = "Not connected";
        }
        updateClientControls();
      });
      const capabilities = client.capabilities;
      const allowedOperations =
        client.access === "read-only"
          ? (capabilities.readOnlyOperations ?? [])
          : capabilities.operations;
      clientCapabilityList.replaceChildren();
      for (const operation of allowedOperations) {
        const item = document.createElement("li");
        item.textContent = operation;
        clientCapabilityList.append(item);
      }
      clientSqlPanel.hidden =
        !isSqlEngine(client.engineId) || !allowedOperations.includes("query");
      clientKvPanel.hidden = client.engineId !== "kv";
      element<HTMLElement>("#client-sql-access").textContent = client.access;
      element<HTMLElement>("#client-kv-access").textContent = client.access;
      clientKvCommand.replaceChildren();
      if (client.engineId === "kv") {
        for (const operation of ["PING", "GET", "SET", "DEL"]) {
          if (!allowedOperations.includes(operation)) continue;
          const option = document.createElement("option");
          option.value = operation;
          option.textContent = operation;
          clientKvCommand.append(option);
        }
        clientKvCommand.value = allowedOperations.includes("SET")
          ? "SET"
          : (clientKvCommand.options[0]?.value ?? "");
        clientKvArguments.value = defaultClientArguments(clientKvCommand.value);
      }
      clientOperations.hidden = false;
      clientResultsPanel.hidden = false;
      element<HTMLElement>("#client-reconnect-help").hidden = true;
      clientStatus.textContent = `Connected · ${ENGINE_LABELS[client.engineId]} · ${client.access}`;
      setActivity(
        "Connected as a client. Operations execute on the invited host.",
      );
      setFeedback("No errors.");
    } catch (error) {
      clientStatus.textContent = "Connection failed";
      await clientConnection?.close().catch(() => undefined);
      clientConnection = undefined;
      clientStateUnsubscribe?.();
      clientStateUnsubscribe = undefined;
      clientOperations.hidden = true;
      setActivity("The client could not connect to the invited database.");
      setFeedback(actionableError(error), true);
    } finally {
      clientBusy = false;
      updateClientControls();
    }
  }

  async function disconnectClient(): Promise<void> {
    if (!clientConnection || clientBusy) return;
    clientBusy = true;
    updateClientControls();
    clientStatus.textContent = "Disconnecting…";
    try {
      await clientConnection.close();
      clientConnection = undefined;
      clientStateUnsubscribe?.();
      clientStateUnsubscribe = undefined;
      element<HTMLElement>("#client-reconnect-help").hidden = true;
      clientOperations.hidden = true;
      clientResultsPanel.hidden = true;
      clientStatus.textContent = "Not connected";
      setActivity("Client disconnected.");
      setFeedback("No errors.");
    } catch (error) {
      setFeedback(actionableError(error), true);
      clientStatus.textContent = "Disconnected with a close error";
      clientConnection = undefined;
      clientStateUnsubscribe?.();
      clientStateUnsubscribe = undefined;
    } finally {
      clientBusy = false;
      updateClientControls();
    }
  }

  async function runClientSql(): Promise<void> {
    const connection = clientConnection;
    if (!connection || !("query" in connection.client) || clientBusy) return;
    const sql = clientSqlInput.value.trim();
    if (!sql) {
      setFeedback(
        "Enter a SQL statement before running the remote query.",
        true,
      );
      clientSqlInput.focus();
      return;
    }
    let params: unknown;
    try {
      params = JSON.parse(clientSqlParams.value);
    } catch {
      setFeedback("SQL parameters must be a valid JSON array.", true);
      clientSqlParams.focus();
      return;
    }
    if (!Array.isArray(params)) {
      setFeedback("SQL parameters must be a JSON array.", true);
      clientSqlParams.focus();
      return;
    }
    clientBusy = true;
    updateClientControls();
    setActivity("Running a query on the invited host…", true);
    setFeedback("No errors.");
    try {
      const result = await connection.client.query(
        sql,
        params as ProtocolValue[],
      );
      showResult(
        result,
        clientResultsPanel,
        clientResultSummary,
        clientResultContent,
      );
      clientStatus.textContent = "Connected";
      setActivity("Remote SQL query completed.");
    } catch (error) {
      clientStatus.textContent =
        connection.client.state === "connected"
          ? "Connected · query failed"
          : "Connection ended";
      setActivity("The remote SQL query failed.");
      setFeedback(actionableError(error), true);
    } finally {
      clientBusy = false;
      updateClientControls();
    }
  }

  async function runClientKeyValue(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const connection = clientConnection;
    if (connection?.client.engineId !== "kv" || clientBusy) return;
    let args: unknown;
    try {
      args = JSON.parse(clientKvArguments.value);
    } catch {
      setFeedback("Command arguments must be a valid JSON array.", true);
      clientKvArguments.focus();
      return;
    }
    if (!Array.isArray(args)) {
      setFeedback("Command arguments must be a JSON array.", true);
      clientKvArguments.focus();
      return;
    }
    clientBusy = true;
    updateClientControls();
    const operation = clientKvCommand.value;
    setActivity(`Running ${operation} on the invited host…`, true);
    setFeedback("No errors.");
    try {
      let result: unknown;
      const keyValue = connection.client.kv;
      if (operation === "PING") result = await keyValue.ping();
      else if (operation === "GET") {
        if (typeof args[0] !== "string")
          throw new Error("GET requires a string key.");
        result = await keyValue.get(args[0]);
      } else if (operation === "SET") {
        if (typeof args[0] !== "string" || typeof args[1] !== "string") {
          throw new Error("SET requires a string key and string value.");
        }
        result = await keyValue.set(args[0], args[1]);
      } else if (operation === "DEL") {
        if (args.some((value) => typeof value !== "string")) {
          throw new Error("DEL requires string keys.");
        }
        result = await keyValue.delete(args as string[]);
      } else {
        throw new Error("Choose a supported key-value command.");
      }
      showResult(
        result,
        clientResultsPanel,
        clientResultSummary,
        clientResultContent,
      );
      clientStatus.textContent = "Connected";
      setActivity(`Remote ${operation} completed.`);
    } catch (error) {
      clientStatus.textContent =
        connection.client.state === "connected"
          ? "Connected · operation failed"
          : "Connection ended";
      setActivity(`Remote ${operation} failed.`);
      setFeedback(actionableError(error), true);
    } finally {
      clientBusy = false;
      updateClientControls();
    }
  }

  root
    .querySelectorAll<HTMLButtonElement>("[data-engine]")
    .forEach((button) => {
      button.addEventListener("click", () =>
        selectEngine(button.dataset.engine as EngineChoice),
      );
    });
  hostModeButton.addEventListener("click", () => setWorkspaceMode("host"));
  clientModeButton.addEventListener("click", () => setWorkspaceMode("client"));
  clientConnectionForm.addEventListener("submit", (event) => {
    void connectClient(event);
  });
  clientDisconnectButton.addEventListener("click", () => {
    void disconnectClient();
  });
  clientRunQuery.addEventListener("click", () => {
    void runClientSql();
  });
  clientKvForm.addEventListener("submit", (event) => {
    void runClientKeyValue(event);
  });
  clientKvCommand.addEventListener("change", () => {
    clientKvArguments.value = defaultClientArguments(clientKvCommand.value);
  });
  clientSqlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void runClientSql();
    }
  });
  element<HTMLFormElement>("#setup-form").addEventListener(
    "submit",
    (event) => {
      void startDatabase(event);
    },
  );
  stopButton.addEventListener("click", () => {
    void stopDatabase();
  });
  exportSnapshotButton.addEventListener("click", () => {
    void exportSnapshot();
  });
  exportNativeFileButton.addEventListener("click", () => {
    void exportNativeFile();
  });
  importNativeFileButton.addEventListener("click", () =>
    importNativeFileInput.click(),
  );
  importNativeFileInput.addEventListener("change", () => {
    const file = importNativeFileInput.files?.[0];
    if (file) void importNativeFile(file);
  });
  importDatasetButton.addEventListener("click", () =>
    importDatasetInput.click(),
  );
  importDatasetInput.addEventListener("change", () => {
    const file = importDatasetInput.files?.[0];
    if (file) void importDataset(file);
  });
  importSnapshotButton.addEventListener("click", () => {
    importSnapshotInput.click();
  });
  importSnapshotInput.addEventListener("change", () => {
    const file = importSnapshotInput.files?.[0];
    if (file) void importSnapshot(file);
  });
  resetDatabaseButton.addEventListener("click", () => {
    void resetDatabase();
  });
  deleteDatabaseButton.addEventListener("click", () => {
    void deleteActiveDatabase();
  });
  createInvitationButton.addEventListener("click", () => {
    void createAndCopyInvitation();
  });
  runQueryButton.addEventListener("click", () => {
    void runSql();
  });
  commandForm.addEventListener("submit", (event) => {
    void runCommand(event);
  });
  element<HTMLButtonElement>("#refresh-keys").addEventListener("click", () => {
    void refreshKeys(0);
  });
  loadMoreKeys.addEventListener("click", () => {
    void refreshKeys(Number(scanCursor));
  });
  commandName.addEventListener("change", () => {
    commandArguments.value = defaultArguments(commandName.value);
  });
  const lineNumbers = element<HTMLElement>("#sql-line-numbers");
  const updateLineNumbers = (): void => {
    const count = sqlInput.value.split("\n").length;
    lineNumbers.textContent = Array.from({ length: count }, (_, index) =>
      String(index + 1),
    ).join("\n");
  };
  sqlInput.addEventListener("input", updateLineNumbers);
  sqlInput.addEventListener("scroll", () => {
    lineNumbers.scrollTop = sqlInput.scrollTop;
  });
  for (const editor of [sqlInput, commandArguments]) {
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (isSqlEngine(selectedEngine)) void runSql();
        else commandForm.requestSubmit();
      }
    });
  }

  selectEngine("postgresql");
  updateClientControls();
  if (window.location.hash.startsWith("#invite=")) {
    clientInvitation.value = window.location.href;
    setWorkspaceMode("client");
    setActivity("Invitation loaded. Enter its signaling endpoint to connect.");
    setFeedback("The invitation stays in this browser tab. Keep it private.");
  }
}

function createEngineWorker(engine: EngineChoice): WorkerLike {
  const worker =
    engine === "postgresql"
      ? new Worker(new URL("./workers/pglite.worker.ts", import.meta.url), {
          type: "module",
        })
      : engine === "sqlite"
        ? new Worker(new URL("./workers/sqlite.worker.ts", import.meta.url), {
            type: "module",
          })
        : engine === "duckdb"
          ? new Worker(new URL("./workers/duckdb.worker.ts", import.meta.url), {
              type: "module",
            })
          : new Worker(
              new URL("./workers/key-value.worker.ts", import.meta.url),
              {
                type: "module",
              },
            );
  return worker as unknown as WorkerLike;
}

function getDataDirectory(
  name: string,
  persistence: PersistenceChoice,
  engine: EngineChoice,
): string {
  if (persistence === "memory") return "memory://";
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const prefix = engine === "kv" ? "pocketdb-kv" : "pocketdb";
  if (engine === "sqlite") return `opfs://${slug || "database"}`;
  if (engine === "duckdb")
    return `opfs://pocketdb-${slug || "database"}.duckdb`;
  return `idb://${prefix}-${slug || "database"}`;
}

function isSqlEngine(
  engine: string,
): engine is "postgresql" | "sqlite" | "duckdb" {
  return engine === "postgresql" || engine === "sqlite" || engine === "duckdb";
}

function deleteIndexedDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("Storage deletion failed."));
    request.onblocked = () =>
      reject(
        new Error("Close other tabs using this database, then try again."),
      );
  });
}

function defaultArguments(command: string): string {
  if (["SET", "MSET"].includes(command)) return '["greeting", "hello"]';
  if (command === "PING" || command === "DBSIZE") return "[]";
  if (command === "SCAN") return '["0", "COUNT", 20]';
  if (command === "EXPIRE") return '["greeting", 60]';
  if (command === "MGET" || command === "DEL" || command === "EXISTS")
    return '["greeting"]';
  return '["greeting"]';
}

function defaultClientArguments(command: string): string {
  if (command === "PING") return "[]";
  if (command === "SET") return '["greeting", "hello"]';
  return '["greeting"]';
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined)
    return value === null ? "NULL" : "—";
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (Array.isArray(value) || isRecord(value)) {
    try {
      return JSON.stringify(
        value,
        (_key, nested) =>
          nested instanceof Uint8Array
            ? new TextDecoder().decode(nested)
            : nested,
        2,
      );
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function actionableError(error: unknown): string {
  const { code, message } = errorDetails(error);
  const suggestions: Record<string, string> = {
    "postgres-storage-already-owned":
      "Close the other tab or worker using this stored database, then try again.",
    "postgres-storage-unavailable":
      "Choose Memory storage, or use a browser context that allows IndexedDB and Web Locks.",
    "postgres-storage-quota-exceeded":
      "Choose Memory storage or free browser storage, then retry. The failed write was not confirmed.",
    "sqlite-storage-already-owned":
      "Close the other tab or worker using this SQLite database, then try again.",
    "sqlite-storage-unavailable":
      "Choose Memory storage, or use a secure browser context that supports OPFS and Web Locks.",
    "duckdb-storage-already-owned":
      "Close the other tab or worker using this DuckDB database, then try again.",
    "duckdb-storage-unavailable":
      "Choose Memory storage, or use a secure browser context that supports OPFS and Web Locks.",
    "duckdb-dataset-too-large":
      "Choose a non-empty dataset file no larger than 32 MiB.",
    "duckdb-unsupported-dataset-format":
      "Choose a .csv, .json or .parquet dataset.",
    "key-value-storage-already-owned":
      "Close the other tab or worker using this stored database, then try again.",
    "key-value-storage-unavailable":
      "Choose Memory storage, or use a browser context that allows IndexedDB and Web Locks.",
    "key-value-storage-quota-exceeded":
      "Choose Memory storage or free browser storage, then retry. The failed write was not confirmed.",
    "key-value-memory-limit":
      "Delete keys or reduce their values before writing more data.",
    "key-value-invalid-command":
      "Choose a command listed in Available operations and check its argument order.",
  };
  return `${code ? `${code}: ` : ""}${message}${code && suggestions[code] ? ` ${suggestions[code]}` : ""}`;
}

function errorDetails(error: unknown): { code?: string; message: string } {
  let current = error;
  let code: string | undefined;
  const seen = new Set<unknown>();
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    if (typeof current.code === "string") code = current.code;
    const cause = current.cause;
    if (!cause) {
      return {
        ...(code ? { code } : {}),
        message:
          typeof current.message === "string"
            ? current.message
            : "The operation failed.",
      };
    }
    current = cause;
  }
  return {
    ...(code ? { code } : {}),
    message: error instanceof Error ? error.message : String(error),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
