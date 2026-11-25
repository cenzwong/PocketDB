import { describe, expect, it } from "vitest";
import type { TransportPair } from "../src/contracts";

export interface TransportContractFixture extends TransportPair {
  failNextSend(fromPeerId: string, cause?: Error): void;
}

export function defineTransportContract(
  name: string,
  createPair: () => TransportContractFixture,
): void {
  describe(`${name} transport contract`, () => {
    it("exchanges binary messages without sharing mutable buffers", async () => {
      const pair = createPair();
      let received: Uint8Array | undefined;
      pair.right.onMessage((message) => (received = message));
      const sent = new Uint8Array([0, 127, 128, 255]);

      await pair.left.send(sent);
      sent[0] = 42;

      expect(received).toEqual(new Uint8Array([0, 127, 128, 255]));
      expect(received?.buffer).not.toBe(sent.buffer);
    });

    it("propagates disconnect state to both peers exactly once", async () => {
      const pair = createPair();
      const leftEvents: string[] = [];
      const rightEvents: string[] = [];
      pair.left.onStateChange((event) => leftEvents.push(event.state));
      pair.right.onStateChange((event) => rightEvents.push(event.state));

      await pair.left.disconnect("test complete");
      await pair.left.disconnect("duplicate close");

      expect(pair.left.state).toBe("disconnected");
      expect(pair.right.state).toBe("disconnected");
      expect(leftEvents).toEqual(["disconnected"]);
      expect(rightEvents).toEqual(["disconnected"]);
    });

    it("removes message and state handlers when unsubscribed", async () => {
      const pair = createPair();
      let messageCount = 0;
      let stateCount = 0;
      const removeMessage = pair.right.onMessage(() => messageCount++);
      const removeState = pair.right.onStateChange(() => stateCount++);
      removeMessage();
      removeState();

      await pair.left.send(new Uint8Array([1]));
      await pair.left.disconnect();

      expect(messageCount).toBe(0);
      expect(stateCount).toBe(0);
    });

    it("reports send failure and permits a later send", async () => {
      const pair = createPair();
      let receivedCount = 0;
      pair.right.onMessage(() => receivedCount++);
      pair.failNextSend("client");

      await expect(pair.left.send(new Uint8Array([1]))).rejects.toMatchObject({
        name: "TransportError",
        code: "send-failed",
      });
      await pair.left.send(new Uint8Array([2]));

      expect(receivedCount).toBe(1);
      expect(pair.left.state).toBe("connected");
      expect(pair.right.state).toBe("connected");
    });

    it("rejects sends after disconnect", async () => {
      const pair = createPair();
      await pair.right.disconnect();

      await expect(pair.left.send(new Uint8Array([1]))).rejects.toMatchObject({
        name: "TransportError",
        code: "not-connected",
      });
    });
  });
}
