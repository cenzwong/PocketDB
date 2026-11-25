import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

async function until(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export async function connectPeer(page, native) {
  const peer = new native.PeerConnection("PocketDB spike", { iceServers: [] });
  const channel = peer.createDataChannel("pocketdb");
  let next = 0;
  let closed = false;
  const pending = new Map();
  function disconnect() {
    closed = true;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Browser channel disconnected"));
    }
    pending.clear();
  }
  channel.onClosed(disconnect);
  channel.onMessage((data) => {
    const message = JSON.parse(data.toString());
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error));
    else waiter.resolve(message.value);
  });
  function close() {
    disconnect();
    channel.close();
    peer.close();
  }
  try {
    await page.wait("Boolean(globalThis.probePeer)");
    const offer = await until(() => peer.gatheringState() === "complete" && peer.localDescription(), "ICE offer");
    const answer = await page.evaluate(`probePeer.accept(${JSON.stringify(offer)})`);
    peer.setRemoteDescription(answer.sdp, answer.type);
    await until(() => channel.isOpen(), "browser data channel");
    return {
      request(request, timeout = 5000) {
        return new Promise((resolve, reject) => {
          if (closed) return reject(new Error("Browser channel disconnected"));
          const id = ++next;
          const message = JSON.stringify({ id, request });
          assert(Buffer.byteLength(message) <= 16_384, "Spike request exceeded 16 KiB");
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("Browser reply timed out"));
          }, timeout);
          pending.set(id, { timer, resolve, reject });
          if (!channel.sendMessage(message)) {
            pending.delete(id);
            clearTimeout(timer);
            reject(new Error("Browser channel refused the message"));
          }
        });
      },
      closed: () => closed,
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
