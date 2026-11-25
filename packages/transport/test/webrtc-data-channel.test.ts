import { describe, expect, it } from "vitest";
import { WebRTCDataChannelAdapter } from "../src";

describe("WebRTC data-channel transport", () => {
  it("waits for open and caps messages at the negotiated SCTP size", async () => {
    const channel = new FakeDataChannel("connecting");
    const peer = new FakePeerConnection(12);
    const connecting = new WebRTCDataChannelAdapter({
      maxMessageBytes: 16,
      connectTimeoutMs: 100,
    }).connect({
      peerId: "peer",
      peerConnection: peer.asNative(),
      channel: channel.asNative(),
    });

    channel.open();
    const connection = await connecting;

    expect(connection.state).toBe("connected");
    expect(connection.maxMessageBytes).toBe(12);
    await connection.disconnect();
  });

  it("rejects unreliable or unordered channels", async () => {
    const unordered = new FakeDataChannel("open");
    unordered.ordered = false;
    await expect(
      new WebRTCDataChannelAdapter().connect({
        peerId: "peer",
        peerConnection: new FakePeerConnection(64).asNative(),
        channel: unordered.asNative(),
      }),
    ).rejects.toMatchObject({ code: "unreliable-channel" });

    const retransmitting = new FakeDataChannel("open");
    retransmitting.maxRetransmits = 2;
    await expect(
      new WebRTCDataChannelAdapter().connect({
        peerId: "peer",
        peerConnection: new FakePeerConnection(64).asNative(),
        channel: retransmitting.asNative(),
      }),
    ).rejects.toMatchObject({ code: "unreliable-channel" });
  });

  it("enforces message, queue and buffered-amount bounds", async () => {
    const channel = new FakeDataChannel("open");
    const connection = await new WebRTCDataChannelAdapter({
      maxMessageBytes: 16,
      maxBufferedBytes: 32,
      maxPendingBytes: 32,
      maxPendingMessages: 2,
    }).connect({
      peerId: "peer",
      peerConnection: new FakePeerConnection(64).asNative(),
      channel: channel.asNative(),
    });
    const first = connection.send(new Uint8Array(16).fill(1));
    const second = connection.send(new Uint8Array(16).fill(2));
    await expect(connection.send(new Uint8Array([3]))).rejects.toMatchObject({
      code: "backpressure",
    });
    await Promise.all([first, second]);
    expect(channel.sent.map((bytes) => bytes[0])).toEqual([1, 2]);
    await expect(connection.send(new Uint8Array(17))).rejects.toMatchObject({
      code: "message-too-large",
    });
    await connection.disconnect();
  });

  it("waits for bufferedamountlow and recovers from send failure", async () => {
    const channel = new FakeDataChannel("open");
    channel.bufferedAmount = 32;
    const connection = await new WebRTCDataChannelAdapter({
      maxMessageBytes: 16,
      maxBufferedBytes: 32,
      maxPendingBytes: 32,
    }).connect({
      peerId: "peer",
      peerConnection: new FakePeerConnection(64).asNative(),
      channel: channel.asNative(),
    });
    const sending = connection.send(new Uint8Array([1]));
    channel.drain(16);
    await sending;

    channel.failNextSend = true;
    await expect(connection.send(new Uint8Array([2]))).rejects.toMatchObject({
      code: "send-failed",
    });
    await connection.send(new Uint8Array([3]));
    expect(channel.sent.map((bytes) => bytes[0])).toEqual([1, 3]);
    expect(connection.state).toBe("connected");
    await connection.disconnect();
  });

  it("copies incoming bytes and removes message listeners on disconnect", async () => {
    const channel = new FakeDataChannel("open");
    const connection = await new WebRTCDataChannelAdapter().connect({
      peerId: "peer",
      peerConnection: new FakePeerConnection(64).asNative(),
      channel: channel.asNative(),
    });
    const received: Uint8Array[] = [];
    connection.onMessage((message) => received.push(message));
    const source = new Uint8Array([0, 255]);
    channel.receive(source);
    source[0] = 9;
    expect(received[0]).toEqual(new Uint8Array([0, 255]));

    const states: string[] = [];
    connection.onStateChange((event) => states.push(event.state));
    await connection.disconnect("test close");
    channel.receive(new Uint8Array([3]));
    expect(received).toHaveLength(1);
    expect(states).toEqual(["disconnected"]);
    await expect(connection.send(new Uint8Array([4]))).rejects.toMatchObject({
      code: "not-connected",
    });
  });

  it("fails the connection when the peer sends non-binary data", async () => {
    const channel = new FakeDataChannel("open");
    const connection = await new WebRTCDataChannelAdapter().connect({
      peerId: "peer",
      peerConnection: new FakePeerConnection(64).asNative(),
      channel: channel.asNative(),
    });
    const state = new Promise<string>((resolve) =>
      connection.onStateChange((event) => resolve(event.state)),
    );
    channel.dispatchEvent(new MessageEvent("message", { data: "not bytes" }));
    expect(await state).toBe("failed");
    expect(connection.state).toBe("failed");
  });
});

class FakePeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState = "connected";
  readonly sctp: RTCSctpTransport;

  constructor(maxMessageSize: number) {
    super();
    this.sctp = { maxMessageSize } as RTCSctpTransport;
  }

  asNative(): RTCPeerConnection {
    return this as unknown as RTCPeerConnection;
  }
}

class FakeDataChannel extends EventTarget {
  ordered = true;
  maxRetransmits: number | null = null;
  maxPacketLifeTime: number | null = null;
  binaryType: BinaryType = "arraybuffer";
  bufferedAmountLowThreshold = 0;
  bufferedAmount = 0;
  failNextSend = false;
  readonly sent: Uint8Array[] = [];

  constructor(public readyState: RTCDataChannelState) {
    super();
  }

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error("Injected RTCDataChannel failure.");
    }
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.sent.push(bytes.slice());
    this.bufferedAmount += bytes.byteLength;
    queueMicrotask(() => this.drain(bytes.byteLength));
  }

  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  }

  open(): void {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }

  drain(bytes: number): void {
    const previous = this.bufferedAmount;
    this.bufferedAmount = Math.max(0, previous - bytes);
    if (
      previous > this.bufferedAmountLowThreshold &&
      this.bufferedAmount <= this.bufferedAmountLowThreshold
    ) {
      this.dispatchEvent(new Event("bufferedamountlow"));
    }
  }

  receive(bytes: Uint8Array): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: new Uint8Array(bytes).buffer }),
    );
  }

  asNative(): RTCDataChannel {
    return this as unknown as RTCDataChannel;
  }
}
