import { WebRTCDiscoveryAdapter } from "../src";
import { InProcessSignalingAdapter } from "../testing/in-process-signaling";

declare global {
  interface Window {
    __discoveryResult?: {
      ok: boolean;
      browser: string;
      signalingAdapter?: string;
      hostState?: string;
      clientState?: string;
      selectedPair?: unknown;
      roundTrip?: boolean;
      error?: string;
    };
  }
}

async function run(): Promise<void> {
  const discovery = new WebRTCDiscoveryAdapter(new InProcessSignalingAdapter());
  let host: Awaited<ReturnType<typeof discovery.connect>> | undefined;
  let client: Awaited<ReturnType<typeof discovery.connect>> | undefined;
  try {
    [client, host] = await Promise.all([
      discovery.connect({
        roomId: "discovery-browser-room",
        peerId: "browser-host",
        role: "offerer",
        iceServers: [],
        signalingTimeoutMs: 10_000,
      }),
      discovery.connect({
        roomId: "discovery-browser-room",
        peerId: "browser-client",
        role: "answerer",
        iceServers: [],
        signalingTimeoutMs: 10_000,
      }),
    ]);
    const received = new Promise<Uint8Array>((resolve) => {
      host?.transport.onMessage(resolve);
    });
    await client.transport.send(new TextEncoder().encode("discovered"));
    const message = await received;
    const [hostDiagnostics, clientDiagnostics] = await Promise.all([
      host.diagnostics(),
      client.diagnostics(),
    ]);
    window.__discoveryResult = {
      ok:
        new TextDecoder().decode(message) === "discovered" &&
        hostDiagnostics.connectionState === "connected" &&
        clientDiagnostics.connectionState === "connected",
      browser: navigator.userAgent,
      signalingAdapter: "in-process-signaling",
      hostState: hostDiagnostics.connectionState,
      clientState: clientDiagnostics.connectionState,
      selectedPair: clientDiagnostics.selectedPair,
      roundTrip: new TextDecoder().decode(message) === "discovered",
    };
  } catch (error) {
    window.__discoveryResult = {
      ok: false,
      browser: navigator.userAgent,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await Promise.all([host?.close(), client?.close()]);
    const output = document.querySelector("#result");
    if (output) output.textContent = JSON.stringify(window.__discoveryResult);
  }
}

void run();
