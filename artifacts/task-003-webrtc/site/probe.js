const sizes = [16_384, 65_536, 262_144];
const timeoutMs = 5_000;
const peer = new RTCPeerConnection({ iceServers: [] });
const store = new Map();
const pending = new Map();
const incoming = document.querySelector("#incoming");
const outgoing = document.querySelector("#outgoing");
const run = document.querySelector("#run");
const disconnect = document.querySelector("#disconnect");
const output = document.querySelector("#result");
const report = { userAgent: navigator.userAgent, events: [], checks: [] };
let channel;
let nextId = 0;
let connectStarted;
let lastCheckEnded;
let running = false;

function render() {
  output.textContent = JSON.stringify(report, null, 2);
}

function record(event, fields = {}) {
  report.events.push({ event, ms: Math.round(performance.now()), ...fields });
  render();
}

function failPending(reason) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(reason));
  }
  pending.clear();
}

function onHostMessage({ data }) {
  if (data instanceof ArrayBuffer) {
    if (data.byteLength <= sizes.at(-1)) channel.send(data);
    return;
  }
  const request = JSON.parse(data);
  if (request.op === "set") store.set(request.key, request.value);
  const response = {
    id: request.id,
    value: request.op === "set" ? "OK" : store.get(request.key),
  };
  channel.send(JSON.stringify(response));
}

function onClientMessage({ data }) {
  const response = data instanceof ArrayBuffer
    ? { id: new DataView(data).getUint32(0), value: data }
    : JSON.parse(data);
  const request = pending.get(response.id);
  if (request) {
    pending.delete(response.id);
    clearTimeout(request.timer);
    request.resolve(response.value);
  }
}

function attach(dataChannel, role) {
  channel = dataChannel;
  channel.binaryType = "arraybuffer";
  channel.addEventListener("message", role === "client" ? onClientMessage : onHostMessage);
  channel.addEventListener("open", () => {
    record("channel-open", {
      role,
      maxMessageSize: peer.sctp?.maxMessageSize,
      sinceRemoteSignalMs: Math.round(performance.now() - connectStarted),
    });
    run.disabled = role !== "client";
    disconnect.disabled = false;
  });
  channel.addEventListener("close", () => {
    failPending("Data channel closed");
    run.disabled = true;
    disconnect.disabled = true;
    const fields = lastCheckEnded === undefined ? {} : {
      sinceLastCheckMs: Math.round(performance.now() - lastCheckEnded),
    };
    record("channel-close", fields);
  });
}

peer.addEventListener("datachannel", (event) => attach(event.channel, "host"));
peer.addEventListener("connectionstatechange", () => {
  record("connection-state", { state: peer.connectionState });
});

async function localSignal(description) {
  await peer.setLocalDescription(description);
  if (peer.iceGatheringState !== "complete") {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        peer.removeEventListener("icegatheringstatechange", onState);
        reject(new Error("ICE gathering timed out"));
      }, 10_000);
      function onState() {
        if (peer.iceGatheringState === "complete") {
          clearTimeout(timer);
          peer.removeEventListener("icegatheringstatechange", onState);
          resolve();
        }
      }
      peer.addEventListener("icegatheringstatechange", onState);
      onState();
    });
  }
  outgoing.value = JSON.stringify(peer.localDescription);
  record("local-signal-ready", { type: peer.localDescription.type });
}

function newRequest(id, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Request timed out"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      channel.send(message);
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function measure(check, makeMessage, verify) {
  const id = ++nextId;
  const started = performance.now();
  try {
    const value = await newRequest(id, makeMessage(id));
    report.checks.push({ ...check, id, ok: verify(value), rttMs: performance.now() - started });
  } catch (error) {
    report.checks.push({ ...check, id, ok: false, error: String(error), rttMs: performance.now() - started });
  }
  render();
}

async function runChecks() {
  if (running) return;
  running = true;
  run.disabled = true;
  try {
    const key = "probe";
    const value = `value-${crypto.randomUUID()}`;
    await measure({ operation: "set" }, (id) => JSON.stringify({ id, op: "set", key, value }), (result) => result === "OK");
    await measure({ operation: "get" }, (id) => JSON.stringify({ id, op: "get", key }), (result) => result === value);
    for (const bytes of sizes) {
      if (bytes > peer.sctp.maxMessageSize) {
        report.checks.push({ operation: "echo", bytes, skipped: "exceeds negotiated maximum" });
        continue;
      }
      let sent;
      await measure({ operation: "echo", bytes }, (id) => {
        sent = new Uint8Array(bytes).fill(42);
        new DataView(sent.buffer).setUint32(0, id);
        return sent;
      }, (result) => result.byteLength === bytes && new Uint8Array(result).every((byte, index) => byte === sent[index]));
    }
    lastCheckEnded = performance.now();
    record("checks-complete");
  } finally {
    running = false;
    run.disabled = channel.readyState !== "open";
  }
}

function bind(id, action) {
  document.getElementById(id).addEventListener("click", async () => {
    try {
      await action();
    } catch (error) {
      record("error", { action: id, error: String(error) });
    }
  });
}

bind("offer", async () => {
  attach(peer.createDataChannel("pocketdb"), "client");
  await localSignal(await peer.createOffer());
});
bind("answer", async () => {
  connectStarted = performance.now();
  await peer.setRemoteDescription(JSON.parse(incoming.value));
  await localSignal(await peer.createAnswer());
});
bind("connect", async () => {
  connectStarted = performance.now();
  await peer.setRemoteDescription(JSON.parse(incoming.value));
});
bind("run", runChecks);
bind("disconnect", () => {
  record("local-close-requested");
  channel.close();
});
render();
