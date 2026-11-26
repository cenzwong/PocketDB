import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpRoomSignalingAdapter,
  WebRTCDiscoveryAdapter,
  SignalingError,
  validateIceConfiguration,
} from "../src/discovery";

describe("HTTP room signaling adapter", () => {
  it("publishes SDP without credentials and polls until the peer description is available", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let reads = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (init?.method === "POST") return new Response(null, { status: 204 });
      reads += 1;
      if (reads === 1) return new Response(null, { status: 404 });
      return new Response(
        JSON.stringify({ type: "answer", sdp: "remote-sdp" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };
    const signaling = new HttpRoomSignalingAdapter({
      endpoint: "https://signal.example.test/api/",
      fetcher,
      pollIntervalMs: 1,
      requestTimeoutMs: 100,
    });
    await signaling.publishDescription("random-room-001", "offer", {
      type: "offer",
      sdp: "local-sdp",
    });
    await expect(
      signaling.receiveDescription("random-room-001", "answer"),
    ).resolves.toEqual({ type: "answer", sdp: "remote-sdp" });
    expect(calls[0].url).toBe(
      "https://signal.example.test/api/signal/random-room-001/offer",
    );
    expect(calls[0].init).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify({ type: "offer", sdp: "local-sdp" }),
    });
    expect(calls).toHaveLength(3);
  });

  it("reports an unavailable endpoint and a missing peer with distinct codes", async () => {
    const unavailable = new HttpRoomSignalingAdapter({
      endpoint: "https://signal.example.test",
      fetcher: async () => {
        throw new TypeError("network offline");
      },
    });
    await expect(
      unavailable.publishDescription("random-room-001", "offer", {
        type: "offer",
        sdp: "local",
      }),
    ).rejects.toMatchObject({ code: "signaling-unavailable" });

    const peerMissing = new HttpRoomSignalingAdapter({
      endpoint: "https://signal.example.test",
      fetcher: async () => new Response(null, { status: 404 }),
      pollIntervalMs: 1,
      requestTimeoutMs: 5,
    });
    await expect(
      peerMissing.receiveDescription("random-room-001", "answer"),
    ).rejects.toMatchObject({ code: "signaling-peer-timeout" });
  });

  it("rejects insecure endpoints, malformed rooms and uncredentialed TURN configuration", async () => {
    expect(
      () =>
        new HttpRoomSignalingAdapter({
          endpoint: "http://signal.example.test",
        }),
    ).toThrow(/HTTPS/);
    const signaling = new HttpRoomSignalingAdapter({
      endpoint: "http://localhost:8080",
    });
    await expect(
      signaling.publishDescription("room with spaces", "offer", {
        type: "offer",
        sdp: "local",
      }),
    ).rejects.toMatchObject({ code: "invalid-room" });
    expect(() =>
      validateIceConfiguration({
        iceServers: [{ urls: "turn:relay.example.test" }],
      }),
    ).toThrow(SignalingError);
    expect(() =>
      validateIceConfiguration({
        iceServers: [{ urls: "stun:stun.example.test" }],
      }),
    ).not.toThrow();
  });
});

describe("answerer data-channel discovery", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["timeout", "abort", "failed"] as const)(
    "closes the peer on %s",
    async (mode) => {
      let peer: FakePeer | undefined;
      class FakePeer extends EventTarget {
        connectionState = "new";
        iceGatheringState = "complete";
        localDescription = {
          type: "answer",
          sdp: "answer",
          toJSON: () => ({ type: "answer", sdp: "answer" }),
        };
        closed = false;
        constructor() {
          super();
          peer = this;
        }
        async setRemoteDescription() {}
        async createAnswer() {
          return this.localDescription;
        }
        async setLocalDescription() {}
        close() {
          this.closed = true;
        }
      }
      vi.stubGlobal("RTCPeerConnection", FakePeer);
      let markPublished = () => {};
      const published = new Promise<void>((resolve) => {
        markPublished = resolve;
      });
      const signaling = {
        id: "test",
        receiveDescription: async () => ({
          type: "offer" as const,
          sdp: "offer",
        }),
        publishDescription: async () => {
          markPublished();
        },
      };
      const controller = new AbortController();
      const connecting = new WebRTCDiscoveryAdapter(signaling).connect({
        roomId: "room-test-1",
        peerId: "client",
        role: "answerer",
        connectTimeoutMs: 100,
        signal: controller.signal,
      });
      const outcome = expect(connecting).rejects.toMatchObject({
        code:
          mode === "abort"
            ? "signaling-aborted"
            : mode === "failed"
              ? "peer-connection-failed"
              : "data-channel-timeout",
      });
      await published;
      if (mode === "abort") controller.abort();
      if (mode === "failed" && peer) {
        peer.connectionState = "failed";
        peer.dispatchEvent(new Event("connectionstatechange"));
      }
      await outcome;
      await vi.waitFor(() => expect(peer?.closed).toBe(true));
    },
  );
});
