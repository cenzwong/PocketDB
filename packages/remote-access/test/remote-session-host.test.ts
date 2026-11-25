import { describe, expect, it } from "vitest";
import {
  decodeEnvelope,
  encodeEnvelope,
  type AuthenticatedPeerSession,
  type ProtocolEnvelope,
} from "@pocketdb/protocol";
import {
  type EngineAdapter,
  type EngineConfig,
  type EngineHealth,
  type EngineInstance,
  type EngineRequest,
  type EngineResponse,
  type EngineSession,
  type SessionContext,
  WorkerEngineAdapter,
  type WorkerLike,
  DatabaseRuntime as Runtime,
} from "@pocketdb/runtime";
import { KeyValueEngineAdapter } from "@pocketdb/engine-kv";
import { createInProcessTransportPair } from "@pocketdb/transport";
import { RemoteSessionHost } from "../src";
import type {
  WorkerReplyMessage,
  WorkerRequestMessage,
} from "../../runtime/src/worker-protocol";

const authSession: AuthenticatedPeerSession = {
  sessionId: "authenticated-peer-session",
  roomId: "room-1",
  instanceId: "instance-1",
  engineId: "kv",
  hostId: "host-key-id",
  clientId: "client-key-id",
  access: "read-write",
};

describe("RemoteSessionHost", () => {
  it("routes an authenticated in-process peer through capabilities, heartbeat, sessions and structured results", async () => {
    const runtime = new Runtime();
    runtime.registerAdapter(new KeyValueEngineAdapter());
    await runtime.startInstance("kv", authSession.instanceId);
    const pair = createInProcessTransportPair();
    const host = new RemoteSessionHost(runtime, pair.right, {
      authorize: () => authSession,
    });
    const client = new ProtocolPeer(pair.left);

    const hello = await client.exchange({
      version: 1,
      type: "hello",
      id: "hello-1",
      supportedVersions: [1],
    });
    expect(hello).toMatchObject({
      type: "hello-ack",
      id: "hello-1",
      selectedVersion: 1,
      engines: [
        {
          id: "kv",
          capabilities: { readOnlyOperations: expect.arrayContaining(["GET"]) },
        },
      ],
    });

    const heartbeat = await client.exchange({
      version: 1,
      type: "heartbeat",
      sequence: 9,
    });
    expect(heartbeat).toEqual({ version: 1, type: "heartbeat", sequence: 9 });

    const opened = await client.exchange({
      version: 1,
      type: "open-session",
      id: "open-1",
      sessionId: "engine-session-1",
      instanceId: authSession.instanceId,
      engineId: "kv",
      access: "read-write",
    });
    expect(opened).toMatchObject({
      type: "response",
      id: "open-1",
      sessionId: "engine-session-1",
      payload: { opened: true },
    });

    await expect(
      client.exchange({
        version: 1,
        type: "request",
        id: "set-1",
        sessionId: "engine-session-1",
        instanceId: authSession.instanceId,
        engineId: "kv",
        operation: "SET",
        payload: ["greeting", "hello"],
      }),
    ).resolves.toMatchObject({ type: "response", id: "set-1", payload: "OK" });
    await expect(
      client.exchange({
        version: 1,
        type: "request",
        id: "get-1",
        sessionId: "engine-session-1",
        instanceId: authSession.instanceId,
        engineId: "kv",
        operation: "GET",
        payload: ["greeting"],
      }),
    ).resolves.toMatchObject({
      type: "response",
      id: "get-1",
      payload: new TextEncoder().encode("hello"),
    });

    const increment: ProtocolEnvelope = {
      version: 1,
      type: "request",
      id: "increment-once",
      sessionId: "engine-session-1",
      instanceId: authSession.instanceId,
      engineId: "kv",
      operation: "INCR",
      payload: ["counter"],
    };
    const incremented = await client.exchange(increment);
    expect(incremented).toMatchObject({ type: "response", payload: 1n });
    expect(await client.exchange(increment)).toEqual(incremented);
    await expect(
      client.exchange({ ...increment, payload: ["other-counter"] }),
    ).resolves.toMatchObject({
      type: "error",
      error: { code: "request-id-conflict", outcome: "not-started" },
    });

    const failed = await client.exchange({
      version: 1,
      type: "request",
      id: "failed-1",
      sessionId: "engine-session-1",
      instanceId: authSession.instanceId,
      engineId: "kv",
      operation: "UNKNOWN",
      payload: [],
    });
    expect(failed).toMatchObject({
      type: "error",
      id: "failed-1",
      error: { code: "key-value-unknown-command", outcome: "failed" },
    });

    const closed = await client.exchange({
      version: 1,
      type: "close-session",
      id: "close-1",
      sessionId: "engine-session-1",
    });
    expect(closed).toMatchObject({
      type: "response",
      id: "close-1",
      payload: { closed: true },
    });
    await host.close();
    await runtime.stopInstance(authSession.instanceId);
  });

  it("rejects requested access that exceeds the authenticated invitation and refuses cross-session routing", async () => {
    const runtime = new Runtime();
    runtime.registerAdapter(new KeyValueEngineAdapter());
    await runtime.startInstance("kv", authSession.instanceId);
    const pair = createInProcessTransportPair();
    const readOnlyAuth = { ...authSession, access: "read-only" as const };
    const host = new RemoteSessionHost(runtime, pair.right, {
      authorize: () => readOnlyAuth,
    });
    const client = new ProtocolPeer(pair.left);
    await negotiate(client, "denial-hello");

    const denied = await client.exchange({
      version: 1,
      type: "open-session",
      id: "open-denied",
      sessionId: "session-denied",
      instanceId: authSession.instanceId,
      engineId: "kv",
      access: "read-write",
    });
    expect(denied).toMatchObject({
      type: "error",
      error: { code: "permission-denied", outcome: "not-started" },
    });
    const crossSession = await client.exchange({
      version: 1,
      type: "request",
      id: "request-denied",
      sessionId: "some-other-session",
      instanceId: authSession.instanceId,
      engineId: "kv",
      operation: "GET",
      payload: ["secret"],
    });
    expect(crossSession).toMatchObject({
      type: "error",
      error: { code: "session-not-found", outcome: "not-started" },
    });
    await host.close();
    await runtime.stopInstance(authSession.instanceId);
  });

  it("closes the authenticated peer's engine sessions on transport disconnect", async () => {
    const runtime = new Runtime();
    runtime.registerAdapter(new KeyValueEngineAdapter());
    await runtime.startInstance("kv", authSession.instanceId);
    const pair = createInProcessTransportPair();
    const host = new RemoteSessionHost(runtime, pair.right, {
      authorize: () => authSession,
    });
    const client = new ProtocolPeer(pair.left);
    await negotiate(client, "disconnect-hello");
    await client.exchange({
      version: 1,
      type: "open-session",
      id: "disconnect-open",
      sessionId: "disconnect-session",
      instanceId: authSession.instanceId,
      engineId: "kv",
      access: "read-write",
    });
    await pair.left.disconnect("client disconnected");
    await host.close();
    await expect(
      runtime.execute("disconnect-session", {
        operation: "PING",
        payload: [],
      }),
    ).rejects.toMatchObject({ code: "session-not-found" });
    await runtime.stopInstance(authSession.instanceId);
  });

  it("deduplicates completed mutations and reports timed-out mutations as unknown without replay", async () => {
    const runtime = new Runtime();
    const slow = new SlowAdapter();
    runtime.registerAdapter(slow);
    await runtime.startInstance(slow.id, authSession.instanceId);
    const pair = createInProcessTransportPair();
    const host = new RemoteSessionHost(
      runtime,
      pair.right,
      { authorize: () => authSession },
      { requestTimeoutMs: 10 },
    );
    const client = new ProtocolPeer(pair.left);
    await negotiate(client, "slow-hello");
    await client.exchange({
      version: 1,
      type: "open-session",
      id: "slow-open",
      sessionId: "slow-session",
      instanceId: authSession.instanceId,
      engineId: slow.id,
      access: "read-write",
    });
    const request: ProtocolEnvelope = {
      version: 1,
      type: "request",
      id: "slow-request",
      sessionId: "slow-session",
      instanceId: authSession.instanceId,
      engineId: slow.id,
      operation: "increment",
      payload: null,
    };
    const unknown = await client.exchange(request);
    expect(unknown).toMatchObject({
      type: "error",
      id: "slow-request",
      error: { code: "request-timeout", outcome: "unknown", retryable: false },
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(slow.executions).toBe(1);
    expect(await client.exchange(request)).toEqual(unknown);
    expect(slow.executions).toBe(1);
    await host.close();
    await runtime.stopInstance(authSession.instanceId);
  });

  it("enforces per-peer session and request-rate bounds with not-started errors", async () => {
    const runtime = new Runtime();
    runtime.registerAdapter(new KeyValueEngineAdapter());
    await runtime.startInstance("kv", authSession.instanceId);
    const pair = createInProcessTransportPair();
    const host = new RemoteSessionHost(
      runtime,
      pair.right,
      { authorize: () => authSession },
      {
        maxOpenSessions: 1,
        maxRequestsPerWindow: 1,
        rateLimitWindowMs: 60_000,
      },
    );
    const client = new ProtocolPeer(pair.left);
    await negotiate(client, "bounds-hello");
    const open = (id: string, sessionId: string) =>
      client.exchange({
        version: 1,
        type: "open-session",
        id,
        sessionId,
        instanceId: authSession.instanceId,
        engineId: authSession.engineId,
        access: "read-write",
      });
    await open("bounds-open-1", "bounds-session-1");
    await expect(
      open("bounds-open-2", "bounds-session-2"),
    ).resolves.toMatchObject({
      type: "error",
      error: { code: "session-limit-reached", outcome: "not-started" },
    });

    const firstRequest: ProtocolEnvelope = {
      version: 1,
      type: "request",
      id: "bounded-first-request",
      sessionId: "bounds-session-1",
      instanceId: authSession.instanceId,
      engineId: authSession.engineId,
      operation: "PING",
      payload: [],
    };
    const firstResponse = await client.exchange(firstRequest);
    expect(firstResponse).toMatchObject({ type: "response", payload: "PONG" });
    await expect(client.exchange(firstRequest)).resolves.toEqual(firstResponse);
    await expect(
      client.exchange({ ...firstRequest, id: "bounded-second-request" }),
    ).resolves.toMatchObject({
      type: "error",
      error: { code: "request-rate-limit", outcome: "not-started" },
    });
    await host.close();
    await runtime.stopInstance(authSession.instanceId);
  });

  it("rejects oversized requests before dispatch and reports oversized completed results as unknown", async () => {
    const requestRuntime = new Runtime();
    requestRuntime.registerAdapter(new KeyValueEngineAdapter());
    await requestRuntime.startInstance("kv", authSession.instanceId);
    const requestPair = createInProcessTransportPair();
    Object.defineProperty(requestPair.right, "maxMessageBytes", {
      value: 1024,
    });
    const requestHost = new RemoteSessionHost(
      requestRuntime,
      requestPair.right,
      { authorize: () => authSession },
    );
    const requestClient = new ProtocolPeer(requestPair.left);
    await negotiate(requestClient, "size-hello");
    const oversizedReply = requestClient.receive();
    await requestClient.sendRaw(new Uint8Array(1025));
    await expect(oversizedReply).resolves.toMatchObject({
      type: "error",
      id: "resource-limit",
      error: { code: "request-too-large", outcome: "not-started" },
    });
    expect(requestPair.right.state).toBe("disconnected");
    await requestHost.close();
    await requestRuntime.stopInstance(authSession.instanceId);

    const resultRuntime = new Runtime();
    resultRuntime.registerAdapter(new KeyValueEngineAdapter());
    await resultRuntime.startInstance("kv", authSession.instanceId);
    const resultPair = createInProcessTransportPair();
    const resultHost = new RemoteSessionHost(
      resultRuntime,
      resultPair.right,
      { authorize: () => authSession },
      { maxResultBytes: 256 },
    );
    const resultClient = new ProtocolPeer(resultPair.left);
    await negotiate(resultClient, "result-size-hello");
    await resultClient.exchange({
      version: 1,
      type: "open-session",
      id: "result-size-open",
      sessionId: "result-size-session",
      instanceId: authSession.instanceId,
      engineId: authSession.engineId,
      access: "read-write",
    });
    await resultClient.exchange({
      version: 1,
      type: "request",
      id: "result-size-set",
      sessionId: "result-size-session",
      instanceId: authSession.instanceId,
      engineId: authSession.engineId,
      operation: "SET",
      payload: ["large", new Uint8Array(512)],
    });
    await expect(
      resultClient.exchange({
        version: 1,
        type: "request",
        id: "result-size-get",
        sessionId: "result-size-session",
        instanceId: authSession.instanceId,
        engineId: authSession.engineId,
        operation: "GET",
        payload: ["large"],
      }),
    ).resolves.toMatchObject({
      type: "error",
      id: "result-size-get",
      error: { code: "result-too-large", outcome: "unknown" },
    });
    expect(resultPair.right.state).toBe("connected");
    await resultHost.close();
    await resultRuntime.stopInstance(authSession.instanceId);
  });

  it("rejects work beyond the active request bound without queueing it", async () => {
    const runtime = new Runtime();
    const slow = new SlowAdapter();
    runtime.registerAdapter(slow);
    await runtime.startInstance(slow.id, authSession.instanceId);
    const pair = createInProcessTransportPair();
    const host = new RemoteSessionHost(
      runtime,
      pair.right,
      { authorize: () => authSession },
      { maxActiveRequests: 1, requestTimeoutMs: 500 },
    );
    const client = new ProtocolPeer(pair.left);
    await negotiate(client, "active-hello");
    await client.exchange({
      version: 1,
      type: "open-session",
      id: "active-open",
      sessionId: "active-session",
      instanceId: authSession.instanceId,
      engineId: slow.id,
      access: "read-write",
    });
    const request = (id: string): ProtocolEnvelope => ({
      version: 1,
      type: "request",
      id,
      sessionId: "active-session",
      instanceId: authSession.instanceId,
      engineId: slow.id,
      operation: "increment",
      payload: null,
    });
    const first = client.exchange(request("active-first"));
    await expect(
      client.exchange(request("active-second")),
    ).resolves.toMatchObject({
      type: "error",
      error: { code: "request-limit-reached", outcome: "not-started" },
    });
    await expect(first).resolves.toMatchObject({
      type: "response",
      id: "active-first",
      payload: 1,
    });
    expect(slow.executions).toBe(1);
    await host.close();
    await runtime.stopInstance(authSession.instanceId);
  });

  it("preserves an unknown remote outcome and terminates a hung worker at its deadline", async () => {
    const worker = new HungExecutionWorker();
    const runtime = new Runtime();
    runtime.registerAdapter(
      new WorkerEngineAdapter(
        "kv",
        { operations: ["INCR"], features: {} },
        () => worker,
        { maxPendingRequests: 4, requestTimeoutMs: 60 },
      ),
    );
    await runtime.startInstance("kv", authSession.instanceId);
    const pair = createInProcessTransportPair();
    const host = new RemoteSessionHost(
      runtime,
      pair.right,
      { authorize: () => authSession },
      { requestTimeoutMs: 10 },
    );
    const client = new ProtocolPeer(pair.left);
    await negotiate(client, "hung-worker-hello");
    await client.exchange({
      version: 1,
      type: "open-session",
      id: "hung-worker-open",
      sessionId: "hung-worker-session",
      instanceId: authSession.instanceId,
      engineId: authSession.engineId,
      access: "read-write",
    });
    const request: ProtocolEnvelope = {
      version: 1,
      type: "request",
      id: "hung-worker-request",
      sessionId: "hung-worker-session",
      instanceId: authSession.instanceId,
      engineId: authSession.engineId,
      operation: "INCR",
      payload: ["counter"],
    };
    const result = await client.exchange(request);
    expect(result).toMatchObject({
      type: "error",
      id: "hung-worker-request",
      error: { code: "request-timeout", outcome: "unknown" },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(worker.executionCount).toBe(1);
    expect(worker.terminateCount).toBe(1);
    await expect(client.exchange(request)).resolves.toEqual(result);
    expect(worker.executionCount).toBe(1);
    await host.close();
  });
});

class ProtocolPeer {
  constructor(
    private readonly connection: ReturnType<
      typeof createInProcessTransportPair
    >["left"],
  ) {}

  async exchange(envelope: ProtocolEnvelope): Promise<ProtocolEnvelope> {
    const matches = (candidate: ProtocolEnvelope) => {
      if (envelope.type === "heartbeat")
        return (
          candidate.type === "heartbeat" &&
          candidate.sequence === envelope.sequence
        );
      return (
        "id" in candidate && "id" in envelope && candidate.id === envelope.id
      );
    };
    const response = this.receive(matches);
    await this.send(envelope);
    return response;
  }

  receive(
    matches: (candidate: ProtocolEnvelope) => boolean = () => true,
  ): Promise<ProtocolEnvelope> {
    return new Promise<ProtocolEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("No matching protocol reply."));
      }, 1_000);
      const unsubscribe = this.connection.onMessage((bytes) => {
        const candidate = decodeEnvelope(bytes);
        if (!matches(candidate)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(candidate);
      });
    });
  }

  async send(envelope: ProtocolEnvelope): Promise<void> {
    await this.sendRaw(new TextEncoder().encode(encodeEnvelope(envelope)));
  }

  async sendRaw(bytes: Uint8Array): Promise<void> {
    await this.connection.send(bytes);
  }
}

async function negotiate(client: ProtocolPeer, id: string): Promise<void> {
  const response = await client.exchange({
    version: 1,
    type: "hello",
    id,
    supportedVersions: [1],
  });
  expect(response).toMatchObject({ type: "hello-ack", id, selectedVersion: 1 });
}

class SlowAdapter implements EngineAdapter {
  readonly id = "kv";
  executions = 0;

  capabilities() {
    return { operations: ["increment"], features: {} };
  }

  createInstance(_config: EngineConfig, instanceId: string): EngineInstance {
    return {
      id: instanceId,
      engineId: this.id,
      start: async () => undefined,
      openSession: async (context: SessionContext): Promise<EngineSession> =>
        Object.freeze({
          id: context.sessionId,
          instanceId,
          access: context.access,
        }),
      execute: async (
        _session: EngineSession,
        _request: EngineRequest,
      ): Promise<EngineResponse> => {
        this.executions += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { value: this.executions };
      },
      closeSession: async (_session: EngineSession) => undefined,
      health: async (): Promise<EngineHealth> => ({ status: "healthy" }),
      stop: async () => undefined,
    };
  }
}

class HungExecutionWorker implements WorkerLike {
  terminateCount = 0;
  executionCount = 0;
  private readonly messageListeners: ((
    event: MessageEvent<WorkerReplyMessage>,
  ) => void)[] = [];

  postMessage(message: WorkerRequestMessage): void {
    if (message.type !== "call") return;
    if (message.method === "execute") {
      this.executionCount += 1;
      return;
    }
    const result =
      message.method === "open-session" && message.context
        ? {
            id: message.context.sessionId,
            instanceId: message.instanceId,
            access: message.context.access,
          }
        : undefined;
    queueMicrotask(() => {
      const reply: WorkerReplyMessage = {
        type: "reply",
        id: message.id,
        ok: true,
        result,
      };
      for (const listener of this.messageListeners) {
        listener({ data: reply } as MessageEvent<WorkerReplyMessage>);
      }
    });
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerReplyMessage>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "messageerror",
    listener: (event: MessageEvent) => void,
  ): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener:
      | ((event: MessageEvent<WorkerReplyMessage>) => void)
      | ((event: ErrorEvent) => void)
      | ((event: MessageEvent) => void),
  ): void {
    if (type === "message") {
      this.messageListeners.push(
        listener as (event: MessageEvent<WorkerReplyMessage>) => void,
      );
    }
  }
}
