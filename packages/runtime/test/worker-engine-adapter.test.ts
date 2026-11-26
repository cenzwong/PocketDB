import { describe, expect, it } from "vitest";
import {
  WorkerEngineAdapter,
  type WorkerLike,
} from "../src/worker-engine-adapter";
import { EngineExecutionUncertainError } from "../src/contracts";
import type {
  WorkerReplyMessage,
  WorkerRequestMessage,
} from "../src/worker-protocol";

describe("WorkerEngineAdapter execution bounds", () => {
  it("exports snapshot bytes through the worker RPC boundary", async () => {
    const worker = new ControlledWorker();
    const adapter = new WorkerEngineAdapter(
      "snapshot-engine",
      { operations: [], features: { portableSnapshots: true } },
      () => worker,
    );
    const instance = adapter.createInstance({}, "snapshot-instance");
    await instance.start();
    await expect(
      (
        instance as typeof instance & {
          exportSnapshot(): Promise<Uint8Array>;
        }
      ).exportSnapshot(),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await instance.stop();
  });

  it("marks only dispatched execution uncertain when a worker times out", async () => {
    const worker = new ControlledWorker();
    const adapter = new WorkerEngineAdapter(
      "bounded-engine",
      { operations: ["slow"], features: {} },
      () => worker,
      { requestTimeoutMs: 10 },
    );
    const instance = adapter.createInstance({}, "bounded-instance");
    await instance.start();
    const session = await instance.openSession({
      sessionId: "session",
      instanceId: "bounded-instance",
      access: "read-write",
    });
    const results = await Promise.allSettled([
      instance.execute(session, { operation: "slow" }),
      instance.execute(session, { operation: "slow" }),
    ]);
    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: expect.any(EngineExecutionUncertainError),
    });
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { code: "worker-request-timeout" },
    });
    if (results[1].status === "rejected")
      expect(results[1].reason).not.toBeInstanceOf(
        EngineExecutionUncertainError,
      );
  });

  it("terminates the worker at the deadline and settles the active call", async () => {
    const worker = new ControlledWorker();
    const adapter = new WorkerEngineAdapter(
      "bounded-engine",
      { operations: ["slow"], features: {} },
      () => worker,
      { maxPendingRequests: 2, requestTimeoutMs: 10 },
    );
    const instance = adapter.createInstance({}, "bounded-instance");
    await instance.start();
    const session = await instance.openSession({
      sessionId: "bounded-session",
      instanceId: "bounded-instance",
      access: "read-write",
    });

    await expect(
      instance.execute(session, { operation: "slow" }),
    ).rejects.toMatchObject({ code: "worker-request-timeout" });
    expect(worker.terminateCount).toBe(1);
    expect(() => instance.health()).toThrow(/worker-request-timeout/);
  });
});

class ControlledWorker implements WorkerLike {
  terminateCount = 0;
  private readonly messageListeners: ((
    event: MessageEvent<WorkerReplyMessage>,
  ) => void)[] = [];

  postMessage(message: WorkerRequestMessage): void {
    if (message.type !== "call" || message.method === "execute") return;
    const result =
      message.method === "open-session" && message.context
        ? {
            id: message.context.sessionId,
            instanceId: message.instanceId,
            access: message.context.access,
          }
        : message.method === "export-snapshot"
          ? new Uint8Array([1, 2, 3])
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
