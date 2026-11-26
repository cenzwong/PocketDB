import {
  createBrowserInvitationLink,
  parseInvitation,
  type Invitation,
} from "@pocketdb/protocol";
import { KeyValueEngineAdapter } from "@pocketdb/engine-kv";
import { DatabaseRuntime } from "@pocketdb/runtime";
import { InProcessSignalingAdapter } from "../../../packages/transport/testing/in-process-signaling";
import { HostAdministration } from "../src/host-administration";
import { connectBrowserClient } from "../src/client-connection";

export async function runHostAdministrationProbe(): Promise<unknown> {
  const runtime = new DatabaseRuntime();
  runtime.registerAdapter(new KeyValueEngineAdapter());
  const instanceId = crypto.randomUUID();
  const ownerSessionId = crypto.randomUUID();
  const signaling = new InProcessSignalingAdapter();
  const signalingFactory = () => signaling;
  const requestMetrics: Array<{
    outcome: string;
    requestBytes: number;
    responseBytes: number;
  }> = [];
  const peerStates: string[] = [];
  const host = new HostAdministration(runtime, instanceId, "kv", {
    signalingFactory,
    onRequestComplete: (event) => requestMetrics.push(event),
    onPeerState: (event) => peerStates.push(event.state),
  });
  await runtime.startInstance("kv", instanceId);
  await runtime.openSession(instanceId, {
    instanceId,
    sessionId: ownerSessionId,
    access: "owner",
  });

  try {
    const invitationLink = await host.createInvitation(
      "read-write",
      "http://localhost:9464",
      window.location.href,
    );
    const connection = await connectBrowserClient(
      invitationLink.link,
      "http://localhost:9464",
      { signalingFactory },
    );
    if (connection.client.engineId !== "kv") {
      throw new Error(
        "The key-value invitation selected the wrong client API.",
      );
    }
    await connection.client.kv.set("client-probe", "typed-result");
    const value = await connection.client.kv.get("client-probe");
    const readValue = value ? new TextDecoder().decode(value) : null;
    if (readValue !== "typed-result") {
      throw new Error(
        "The remote key-value result did not preserve its value.",
      );
    }

    await waitUntil(() => host.listInvitations()[0]?.state === "connected");
    const connected = host.listInvitations()[0];
    if (!connected?.peer) throw new Error("Authenticated peer was not listed.");
    if (connected.peer.access !== "read-write") {
      throw new Error("Peer access did not match its invitation.");
    }
    if (connected.peer.clientFingerprint.length < 32) {
      throw new Error("Client fingerprint was not recorded.");
    }
    const networkDiagnostics = await host.networkDiagnostics();
    if (
      networkDiagnostics.length !== 1 ||
      !networkDiagnostics[0]?.detailsAvailable ||
      networkDiagnostics[0].transportState !== "connected"
    ) {
      throw new Error("Connected peer diagnostics were not available.");
    }

    await host.disconnectPeer(connected.peer.id);
    await waitUntil(() => host.listInvitations()[0]?.state === "revoked");
    await waitUntil(() => connection.client.state === "failed");
    const staleSessionError = await connection.client.kv.ping().then(
      () => "unexpected-success",
      (error: unknown) =>
        error instanceof Error && "outcome" in error
          ? `${String(error.code)}:${String(error.outcome)}`
          : "unknown-error",
    );
    if (staleSessionError !== "connection-lost:not-started") {
      throw new Error(`Unexpected stale-session result: ${staleSessionError}`);
    }
    if (!peerStates.includes("disconnected")) {
      throw new Error("Host transport loss was absent from local diagnostics.");
    }
    if (
      requestMetrics.length === 0 ||
      requestMetrics.some(
        ({ outcome, requestBytes, responseBytes }) =>
          outcome !== "success" || requestBytes <= 0 || responseBytes <= 0,
      )
    ) {
      throw new Error("Remote request metrics were not recorded safely.");
    }
    if (host.getInvitationLink(invitationLink.id) !== undefined) {
      throw new Error("Disconnect left its invitation capability retrievable.");
    }

    const recoveryInvitation = await host.createInvitation(
      "read-write",
      "http://localhost:9464",
      window.location.href,
    );
    const recoveredConnection = await connectBrowserClient(
      recoveryInvitation.link,
      "http://localhost:9464",
      { signalingFactory },
    );
    if (recoveredConnection.client.engineId !== "kv") {
      throw new Error(
        "The recovered invitation selected the wrong client API.",
      );
    }
    if (recoveredConnection.client.sessionId === connection.client.sessionId) {
      throw new Error("Reauthentication restored an ended session identifier.");
    }
    const recoveredValue =
      await recoveredConnection.client.kv.get("client-probe");
    if (
      !recoveredValue ||
      new TextDecoder().decode(recoveredValue) !== "typed-result"
    ) {
      throw new Error(
        "The new authenticated session did not recover host data.",
      );
    }
    await recoveredConnection.close();

    const validInvitationLink = await host.createInvitation(
      "read-write",
      "http://localhost:9464",
      window.location.href,
    );
    const validInvitation = parseInvitation(validInvitationLink.link);
    const corrupted = corruptCapability(validInvitation);
    const invalidLink = createBrowserInvitationLink(
      window.location.href,
      corrupted,
    );
    const authenticationFailure = await connectBrowserClient(
      invalidLink.url,
      "http://localhost:9464",
      { signalingFactory },
    ).then(
      () => undefined,
      (error: unknown) =>
        error instanceof Error && "code" in error
          ? String(error.code)
          : "unknown-error",
    );
    if (authenticationFailure !== "authentication-invalid-identity") {
      throw new Error(
        `Unexpected invalid-capability result: ${authenticationFailure}`,
      );
    }
    await waitUntil(
      () =>
        host.listInvitations().find(({ id }) => id === validInvitationLink.id)
          ?.state === "revoked",
    );
    return {
      ok: true,
      engine: connection.client.engineId,
      access: connected.peer.access,
      fingerprintRecorded: connected.peer.clientFingerprint.length >= 32,
      keyValueResult: readValue,
      staleSessionError,
      reauthenticatedNewSession:
        recoveredConnection.client.sessionId !== connection.client.sessionId,
      recoveredValue: recoveredValue
        ? new TextDecoder().decode(recoveredValue)
        : null,
      networkPath: networkDiagnostics[0]?.path ?? "unknown",
      networkDiagnosticsAvailable:
        networkDiagnostics[0]?.detailsAvailable ?? false,
      remoteRequestsMeasured: requestMetrics.length,
      transportFailureLogged: peerStates.includes("disconnected"),
      disconnectRevokesLink:
        host.getInvitationLink(invitationLink.id) === undefined,
      authenticationFailure,
      invalidCapabilityRevoked:
        host.getInvitationLink(validInvitationLink.id) === undefined,
    };
  } finally {
    await host.close();
    await runtime.stopInstance(instanceId);
  }
}

function corruptCapability(invitation: Invitation): Invitation {
  const first = invitation.capability[0] === "A" ? "B" : "A";
  return {
    ...invitation,
    capability: `${first}${invitation.capability.slice(1)}`,
  };
}

async function waitUntil(condition: () => boolean | undefined): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Host administration state did not settle.");
}
