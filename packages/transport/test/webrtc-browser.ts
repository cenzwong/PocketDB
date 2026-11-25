import { WebRTCDataChannelAdapter } from "../src";

declare global {
  interface Window {
    __webrtcResult?: {
      ok: boolean;
      browser: string;
      maxMessageBytes?: number;
      ordered?: boolean;
      reliable?: boolean;
      framingBoundaries?: number[];
      ordering?: boolean;
      oversizedRejected?: boolean;
      sendFailure?: string;
      peerDisconnect?: string;
      error?: string;
    };
  }
}

async function run(): Promise<void> {
  const clientPeer = new RTCPeerConnection({ iceServers: [] });
  const hostPeer = new RTCPeerConnection({ iceServers: [] });
  let clientChannel: RTCDataChannel | undefined;
  let hostChannel: RTCDataChannel | undefined;
  try {
    clientChannel = clientPeer.createDataChannel("pocketdb", {
      ordered: true,
    });
    const hostChannelPromise = new Promise<RTCDataChannel>((resolve) => {
      hostPeer.addEventListener(
        "datachannel",
        (event) => resolve(event.channel),
        { once: true },
      );
    });

    const offer = await clientPeer.createOffer();
    await clientPeer.setLocalDescription(offer);
    await waitForIceGathering(clientPeer);
    const localOffer = clientPeer.localDescription;
    if (!localOffer) throw new Error("Client did not produce a local offer.");
    await hostPeer.setRemoteDescription(localOffer);
    const answer = await hostPeer.createAnswer();
    await hostPeer.setLocalDescription(answer);
    await waitForIceGathering(hostPeer);
    const localAnswer = hostPeer.localDescription;
    if (!localAnswer) throw new Error("Host did not produce a local answer.");
    await clientPeer.setRemoteDescription(localAnswer);
    hostChannel = await hostChannelPromise;
    await Promise.all([
      waitForChannelOpen(clientChannel),
      waitForChannelOpen(hostChannel),
    ]);

    const adapter = new WebRTCDataChannelAdapter({ maxPendingMessages: 32 });
    const [client, host] = await Promise.all([
      adapter.connect({
        peerId: "host",
        peerConnection: clientPeer,
        channel: clientChannel,
      }),
      adapter.connect({
        peerId: "client",
        peerConnection: hostPeer,
        channel: hostChannel,
      }),
    ]);
    const received: Uint8Array[] = [];
    host.onMessage((message) => received.push(message));
    const exactLimit = client.maxMessageBytes ?? 0;
    const boundaryLengths = [0, 1, exactLimit];
    for (const length of boundaryLengths) {
      const bytes = new Uint8Array(length);
      bytes.fill(length & 0xff);
      await client.send(bytes);
    }
    await waitFor(() => received.length === boundaryLengths.length);
    for (let index = 0; index < boundaryLengths.length; index++) {
      const message = received[index];
      if (message.byteLength !== boundaryLengths[index]) {
        throw new Error(`Framing boundary ${index} changed message length.`);
      }
      if (message.some((byte) => byte !== (boundaryLengths[index] & 0xff))) {
        throw new Error(`Framing boundary ${index} changed message bytes.`);
      }
    }

    const orderingStart = received.length;
    const orderingCount = 24;
    await Promise.all(
      Array.from({ length: orderingCount }, (_, index) =>
        client.send(new Uint8Array([index, 255 - index])),
      ),
    );
    await waitFor(() => received.length === orderingStart + orderingCount);
    for (let index = 0; index < orderingCount; index++) {
      const message = received[orderingStart + index];
      if (message[0] !== index || message[1] !== 255 - index) {
        throw new Error(`Ordered delivery changed message ${index}.`);
      }
    }

    let oversizedRejected = false;
    try {
      await client.send(new Uint8Array(exactLimit + 1));
    } catch (error) {
      oversizedRejected =
        error instanceof Error &&
        "code" in error &&
        error.code === "message-too-large";
    }
    if (!oversizedRejected) throw new Error("Oversized send was not rejected.");

    const clientState = new Promise<string>((resolve) =>
      client.onStateChange((event) => resolve(event.state)),
    );
    const previousReceived = received.length;
    await host.disconnect("remote peer disconnect probe");
    const disconnectedState = await withTimeout(clientState);
    if (disconnectedState !== "disconnected") {
      throw new Error(`Peer disconnect reported ${disconnectedState}.`);
    }
    let sendFailure = "";
    try {
      await client.send(new Uint8Array([1]));
    } catch (error) {
      sendFailure =
        error instanceof Error && "code" in error
          ? String(error.code)
          : String(error);
    }
    if (sendFailure !== "not-connected") {
      throw new Error(`Send after peer disconnect returned ${sendFailure}.`);
    }

    window.__webrtcResult = {
      ok: true,
      browser: navigator.userAgent,
      maxMessageBytes: exactLimit,
      ordered: clientChannel.ordered && hostChannel.ordered,
      reliable:
        clientChannel.maxRetransmits === null &&
        clientChannel.maxPacketLifeTime === null,
      framingBoundaries: boundaryLengths,
      ordering: true,
      oversizedRejected,
      sendFailure,
      peerDisconnect: disconnectedState,
    };
    resultElement().textContent = JSON.stringify(window.__webrtcResult);
    // Ensure the browser checks the peer remained silent after disconnection.
    await Promise.resolve();
    if (received.length !== previousReceived) {
      throw new Error("A message arrived after peer disconnect.");
    }
  } catch (error) {
    window.__webrtcResult = {
      ok: false,
      browser: navigator.userAgent,
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    };
    resultElement().textContent = JSON.stringify(window.__webrtcResult);
  } finally {
    clientPeer.close();
    hostPeer.close();
  }
}

function resultElement(): HTMLElement {
  const element = document.querySelector("#result");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Browser probe result element is missing.");
  }
  return element;
}

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return withTimeout(
    new Promise<void>((resolve) => {
      const check = () => {
        if (peer.iceGatheringState !== "complete") return;
        peer.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      peer.addEventListener("icegatheringstatechange", check);
      check();
    }),
  );
}

function waitForChannelOpen(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        channel.removeEventListener("open", onOpen);
        channel.removeEventListener("close", onClose);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error("Data channel closed before opening."));
      };
      channel.addEventListener("open", onOpen);
      channel.addEventListener("close", onClose);
      if (channel.readyState === "open") onOpen();
    }),
  );
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!condition()) throw new Error("Timed out waiting for peer message.");
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("WebRTC probe timed out.")), 10_000),
    ),
  ]);
}

void run();
