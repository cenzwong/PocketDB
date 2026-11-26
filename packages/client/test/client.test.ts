import { describe, expect, it } from "vitest";
import {
  createInvitation,
  createPocketDBInvitationUri,
  type AuthenticatedPeerSession,
} from "@pocketdb/protocol";
import { KeyValueEngineAdapter } from "@pocketdb/engine-kv";
import {
  EngineOperationError,
  EngineRuntimeError,
  type EngineAdapter,
  type EngineConfig,
  type EngineHealth,
  type EngineInstance,
  type EngineRequest,
  type EngineResponse,
  type EngineSession,
  type SessionContext,
  DatabaseRuntime,
} from "@pocketdb/runtime";
import { createInProcessTransportPair } from "@pocketdb/transport";
import { RemoteSessionHost } from "@pocketdb/remote-access";
import { connect, type ConnectPeer } from "@pocketdb/client";

const hostId = "A".repeat(43);

describe("@pocketdb/client", () => {
  it("connects independently of the web app and preserves key-value bytes", async () => {
    const invitation = createInvitation({
      roomId: "client-room",
      instanceId: "client-kv-instance",
      engineId: "kv",
      expectedHostId: hostId,
      access: "read-write",
    });
    const uri = createPocketDBInvitationUri(invitation);
    const runtime = new DatabaseRuntime();
    runtime.registerAdapter(new KeyValueEngineAdapter());
    await runtime.startInstance("kv", invitation.instanceId);
    const pair = createInProcessTransportPair();
    const host = new RemoteSessionHost(runtime, pair.right, {
      authorize: () =>
        authSession(invitation.roomId, invitation.instanceId, "kv"),
    });
    const client = await connect(uri, {
      connectPeer: async () => pair.left,
      expectedTarget: { engineId: "kv", instanceId: invitation.instanceId },
    });
    expect(client.engineId).toBe("kv");
    expect(client.capabilities.operations).toContain("GET");
    if (client.engineId !== "kv") throw new Error("Expected a KV client.");

    const source = new Uint8Array([0, 1, 127, 128, 255]);
    await expect(client.kv.set("binary-key", source)).resolves.toBe("OK");
    const result = await client.kv.get("binary-key");
    expect(result).toEqual(source);
    expect(await client.kv.get("missing-key")).toBeNull();
    await client.close();
    await client.close();
    expect(client.state).toBe("closed");
    await expect(client.kv.ping()).rejects.toMatchObject({
      code: "connection-closed",
      outcome: "not-started",
    });
    await host.close();
    await runtime.stopInstance(invitation.instanceId);
  });

  it("returns structured remote failures and unknown outcomes after request timeout", async () => {
    const invitation = createInvitation({
      roomId: "timeout-room",
      instanceId: "timeout-instance",
      engineId: "kv",
      expectedHostId: hostId,
      access: "read-write",
    });
    const runtime = new DatabaseRuntime();
    const adapter = new DelayedKeyValueAdapter();
    runtime.registerAdapter(adapter);
    await runtime.startInstance("kv", invitation.instanceId);
    const pair = createInProcessTransportPair();
    const host = new RemoteSessionHost(
      runtime,
      pair.right,
      {
        authorize: () =>
          authSession(invitation.roomId, invitation.instanceId, "kv"),
      },
      { requestTimeoutMs: 1_000 },
    );
    const client = await connect(createPocketDBInvitationUri(invitation), {
      connectPeer: async () => pair.left,
      requestTimeoutMs: 10,
    });
    if (client.engineId !== "kv") throw new Error("Expected a KV client.");

    const timeout = client.kv.get("hang");
    await expect(timeout).rejects.toMatchObject({
      code: "request-timeout",
      outcome: "unknown",
    });
    await client.close();
    await host.close();
    expect(adapter.executionCount).toBe(1);
  });

  it("applies the connection deadline and disconnects a late transport", async () => {
    const invitation = createInvitation({
      roomId: "late-room",
      instanceId: "late-instance",
      engineId: "kv",
      expectedHostId: hostId,
      access: "read-write",
    });
    let resolveConnection!: (
      connection: ReturnType<typeof createInProcessTransportPair>["left"],
    ) => void;
    const lateConnection = new Promise<
      ReturnType<typeof createInProcessTransportPair>["left"]
    >((resolve) => {
      resolveConnection = resolve;
    });
    const pendingConnect = connect(createPocketDBInvitationUri(invitation), {
      connectTimeoutMs: 5,
      connectPeer: () => lateConnection,
    });
    await expect(pendingConnect).rejects.toMatchObject({
      code: "connect-timeout",
      outcome: "not-started",
    });
    const pair = createInProcessTransportPair();
    resolveConnection(pair.left);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pair.left.state).toBe("disconnected");
  });

  it("applies the connection deadline to protocol negotiation", async () => {
    const invitation = createInvitation({
      roomId: "hello-timeout-room",
      instanceId: "hello-timeout-instance",
      engineId: "kv",
      expectedHostId: hostId,
      access: "read-only",
    });
    const pair = createInProcessTransportPair();
    await expect(
      connect(createPocketDBInvitationUri(invitation), {
        connectPeer: async () => pair.left,
        connectTimeoutMs: 15,
        requestTimeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "connect-timeout", outcome: "unknown" });
    expect(pair.left.state).toBe("disconnected");
  });

  it("recovers from bounded signaling interruptions and reports host loss without replay", async () => {
    const invitation = createInvitation({
      roomId: "recovery-room",
      instanceId: "recovery-instance",
      engineId: "kv",
      expectedHostId: hostId,
      access: "read-write",
    });
    const runtime = new DatabaseRuntime();
    runtime.registerAdapter(new KeyValueEngineAdapter());
    await runtime.startInstance("kv", invitation.instanceId);
    let attempts = 0;
    let activePair: ReturnType<typeof createInProcessTransportPair> | undefined;
    let activeHost: RemoteSessionHost | undefined;
    const client = await connect(createPocketDBInvitationUri(invitation), {
      connectRetry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
      connectPeer: async () => {
        attempts++;
        if (attempts < 3) {
          throw Object.assign(new Error("Signaling temporarily unavailable."), {
            code: "signaling-unavailable",
          });
        }
        activePair = createInProcessTransportPair();
        activeHost = new RemoteSessionHost(runtime, activePair.right, {
          authorize: () =>
            authSession(invitation.roomId, invitation.instanceId, "kv"),
        });
        return activePair.left;
      },
    });
    if (client.engineId !== "kv") throw new Error("Expected a KV client.");
    expect(attempts).toBe(3);
    await expect(client.kv.set("survives", "reconnect")).resolves.toBe("OK");

    const states: string[] = [];
    client.onStateChange?.(({ state }) => states.push(state));
    await activeHost?.close();
    await activePair?.right.disconnect("host disappeared");
    await waitFor(() => client.state === "failed");
    expect(states).toContain("failed");
    expect(attempts).toBe(3);
    await expect(client.kv.ping()).rejects.toMatchObject({
      code: "connection-lost",
      outcome: "not-started",
    });

    await client.close();
    await runtime.stopInstance(invitation.instanceId);
  });

  it("rejects an invitation that does not match the expected database", async () => {
    const invitation = createInvitation({
      roomId: "target-room",
      instanceId: "target-instance",
      engineId: "kv",
      expectedHostId: hostId,
      access: "read-only",
    });
    const connectPeer: ConnectPeer = async () => {
      throw new Error("must not connect");
    };
    await expect(
      connect(createPocketDBInvitationUri(invitation), {
        connectPeer,
        expectedTarget: { instanceId: "different-instance" },
      }),
    ).rejects.toMatchObject({ code: "wrong-target", outcome: "not-started" });
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Client state did not settle.");
}

function authSession(
  roomId: string,
  instanceId: string,
  engineId: "kv" | "postgresql",
): AuthenticatedPeerSession {
  return {
    sessionId: `auth-${roomId}`,
    roomId,
    instanceId,
    engineId,
    hostId,
    clientId: "client-test",
    access: "read-write",
  };
}

class DelayedKeyValueAdapter implements EngineAdapter {
  readonly id = "kv";
  executionCount = 0;
  capabilities() {
    return { operations: ["GET"], readOnlyOperations: ["GET"], features: {} };
  }
  createInstance(_config: EngineConfig, instanceId: string): EngineInstance {
    return {
      id: instanceId,
      engineId: this.id,
      start: async () => undefined,
      openSession: async (context: SessionContext): Promise<EngineSession> => ({
        id: context.sessionId,
        instanceId,
        access: context.access,
      }),
      execute: async (
        _session: EngineSession,
        request: EngineRequest,
      ): Promise<EngineResponse> => {
        this.executionCount += 1;
        if (request.operation !== "GET") {
          throw new EngineOperationError(
            "unsupported-operation",
            "Unsupported.",
          );
        }
        await new Promise<void>((_resolve, reject) => {
          request.signal?.addEventListener(
            "abort",
            () => reject(new EngineRuntimeError("request-aborted", "Aborted.")),
            { once: true },
          );
        });
        return { value: null };
      },
      closeSession: async (_session: EngineSession) => undefined,
      health: async (): Promise<EngineHealth> => ({ status: "healthy" }),
      stop: async () => undefined,
    };
  }
}
