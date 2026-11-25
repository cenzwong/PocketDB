import { mountApp } from "../src/app";
import type { BrowserClientConnection } from "../src/client-connection";
import type { ClientStateEvent, SqlClient } from "@pocketdb/client";

export async function runClientConsoleProbe(): Promise<unknown> {
  const root = document.createElement("div");
  document.body.append(root);
  let closed = false;
  let clientState: "connected" | "failed" | "closed" = "connected";
  const stateListeners = new Set<(event: ClientStateEvent) => void>();
  const client = {
    engineId: "postgresql" as const,
    peerId: "probe-client",
    sessionId: "probe-session",
    access: "read-only" as const,
    get state() {
      return clientState;
    },
    capabilities: {
      operations: ["query"],
      readOnlyOperations: ["query"],
      features: {},
    },
    async query() {
      return { rows: [{ id: 17, label: "remote" }], rowCount: 1 };
    },
    async close() {
      closed = true;
      clientState = "closed";
    },
    onStateChange(listener: (event: ClientStateEvent) => void) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  } satisfies SqlClient;
  const connection: BrowserClientConnection = {
    client,
    async close() {
      await client.close();
    },
  };
  mountApp(root, {
    connectClient: async () => {
      clientState = "connected";
      return connection;
    },
  });
  try {
    const clientModeButton = root.querySelector<HTMLButtonElement>(
      "#client-mode-button",
    );
    clientModeButton?.click();
    const hostSurface = root.querySelector<HTMLElement>("#setup-form");
    const clientSurface = root.querySelector<HTMLElement>("#client-workspace");
    if (!hostSurface?.hidden || clientSurface?.hidden) {
      throw new Error("Host and client modes were not clearly separated.");
    }
    const invitation =
      root.querySelector<HTMLTextAreaElement>("#client-invitation");
    const endpoint = root.querySelector<HTMLInputElement>(
      "#client-signaling-endpoint",
    );
    if (!invitation || !endpoint)
      throw new Error("Client connection fields are missing.");
    invitation.value = "https://example.invalid/#invite=sample";
    endpoint.value = "https://signal.example/api";
    root
      .querySelector<HTMLFormElement>("#client-connection-form")
      ?.requestSubmit();
    await waitUntil(() =>
      root
        .querySelector<HTMLElement>("#client-status")
        ?.textContent?.startsWith("Connected"),
    );
    const query = root.querySelector<HTMLTextAreaElement>("#client-sql-input");
    if (!query) throw new Error("The SQL client editor is missing.");
    query.value = "SELECT 17 AS id, 'remote' AS label;";
    query.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    await waitUntil(
      () =>
        root.querySelector("#client-result-content tbody td")?.textContent ===
        "17",
    );
    const rendered = {
      modeSeparated: hostSurface.hidden && !clientSurface.hidden,
      sqlResult: root.querySelector("#client-result-content").textContent,
      capability: root.querySelector("#client-capability-list").textContent,
      statusDoesNotShowInvitation: !root
        .querySelector("#client-status")
        .textContent.includes("sample"),
    };
    clientState = "failed";
    for (const listener of stateListeners) {
      listener({
        state: "failed",
        error: { code: "connection-lost", message: "Host disconnected." },
      });
    }
    await waitUntil(
      () =>
        root.querySelector<HTMLElement>("#client-status")?.textContent ===
        "Connection ended",
    );
    const retryState = {
      help: root.querySelector<HTMLElement>("#client-reconnect-help")
        ?.textContent,
      invitationEnabled: !invitation.disabled,
      connectLabel: root.querySelector<HTMLButtonElement>(
        "#client-connect-button",
      )?.textContent,
      operationsHidden:
        root.querySelector<HTMLElement>("#client-operations")?.hidden,
    };
    if (!retryState.invitationEnabled || !retryState.operationsHidden) {
      throw new Error("A lost client session remained active in the console.");
    }
    invitation.value = "https://example.invalid/#invite=fresh";
    root
      .querySelector<HTMLFormElement>("#client-connection-form")
      ?.requestSubmit();
    await waitUntil(() =>
      root
        .querySelector<HTMLElement>("#client-status")
        ?.textContent?.startsWith("Connected"),
    );
    const reauthenticated = clientState === "connected";
    root.querySelector<HTMLButtonElement>("#client-disconnect-button")?.click();
    await waitUntil(
      () =>
        root.querySelector<HTMLElement>("#client-status")?.textContent ===
        "Not connected",
    );
    if (!closed)
      throw new Error("Client disconnect did not close the SDK session.");
    return {
      ok: true,
      ...rendered,
      retryState,
      reauthenticated,
      disconnected: closed,
    };
  } finally {
    root.remove();
  }
}

async function waitUntil(condition: () => boolean | undefined): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Client console state did not settle.");
}
