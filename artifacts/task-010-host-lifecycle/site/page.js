import { browserPeer } from "./peer-rpc.js";

const output = document.querySelector("#result");
const incoming = document.querySelector("#incoming");
const outgoing = document.querySelector("#outgoing");
const events = [];
function record(event, details = {}) {
  events.push({ event, at: new Date().toISOString(), ...details });
  output.textContent = JSON.stringify(events, null, 2);
}
document.addEventListener("visibilitychange", () => record("visibility", { state: document.visibilityState }));
document.addEventListener("freeze", () => record("freeze"));
document.addEventListener("resume", () => record("resume"));
addEventListener("pagehide", () => record("pagehide"));
record("loaded", { state: document.visibilityState, browser: navigator.userAgent });

const worker = new Worker("./worker.js");
let workerSequence = 0;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const waiter = pending.get(data.id);
  pending.delete(data.id);
  if (data.error) waiter.reject(new Error(data.error));
  else waiter.resolve(data.result);
};
function dispatch({ value }) {
  return new Promise((resolve, reject) => {
    const id = ++workerSequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, value });
  });
}

function makeHost() {
  return browserPeer(dispatch);
}
globalThis.probePeer = makeHost();
globalThis.resetPeer = () => {
  probePeer.close();
  globalThis.probePeer = makeHost();
  return true;
};
globalThis.hostJournal = () => events;
globalThis.hostDocumentId = crypto.randomUUID();

const client = new RTCPeerConnection({ iceServers: [] });
let channel;
let sequence = 0;
const waiting = new Map();
function bind(id, action) {
  document.getElementById(id).onclick = () => Promise.resolve().then(action).catch((error) => record("error", { message: String(error) }));
}
bind("offer", async () => {
  channel = client.createDataChannel("pocketdb");
  for (const name of ["open", "close"]) channel.addEventListener(name, () => record(name));
  channel.onmessage = ({ data }) => {
    const result = JSON.parse(data);
    if (!waiting.has(result.id)) return;
    clearTimeout(waiting.get(result.id));
    waiting.delete(result.id);
    record("reply", result);
  };
  await client.setLocalDescription(await client.createOffer());
  if (client.iceGatheringState !== "complete") {
    await new Promise((resolve) => {
      function update() {
        if (client.iceGatheringState !== "complete") return;
        client.removeEventListener("icegatheringstatechange", update);
        resolve();
      }
      client.addEventListener("icegatheringstatechange", update);
      update();
    });
  }
  outgoing.value = JSON.stringify(client.localDescription);
});
bind("answer", async () => {
  outgoing.value = JSON.stringify(await probePeer.accept(JSON.parse(incoming.value)));
});
bind("connect", () => client.setRemoteDescription(JSON.parse(incoming.value)));
function sample(request) {
  if (channel?.readyState !== "open") throw new Error("Channel is not open");
  const id = ++sequence;
  channel.send(JSON.stringify({ id, request }));
  waiting.set(id, setTimeout(() => {
    waiting.delete(id);
    record("timeout", { id });
  }, 5000));
  record("requested", { id });
}
bind("seed", () => sample({ value: "lifecycle-marker" }));
bind("sample", () => sample({}));
