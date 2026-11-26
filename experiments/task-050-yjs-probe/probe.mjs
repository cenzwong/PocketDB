import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as Y from "yjs";

const peers = ["peer-a", "peer-b", "peer-c"].map((id) => ({
  id,
  doc: new Y.Doc(),
  update: undefined,
}));

for (const peer of peers) {
  const records = peer.doc.getMap("records");
  records.set("shared-name", peer.id);
  records.set(`offline/${peer.id}`, {
    editedOffline: true,
    payload: `${peer.id}:`.repeat(128),
  });
  peer.doc.getArray("events").push([{ peer: peer.id, sequence: 1 }]);
  peer.update = Y.encodeStateAsUpdate(peer.doc);
}

const updateOrder = [
  ["peer-b", "peer-a", "peer-c", "peer-b"],
  ["peer-c", "peer-a", "peer-b", "peer-a"],
];
for (const [index, peer] of peers.slice(0, 2).entries()) {
  const sequence = updateOrder[index];
  for (const id of sequence) {
    const source = peers.find((candidate) => candidate.id === id);
    Y.applyUpdate(peer.doc, source.update);
  }
}

assert.deepEqual(stable(view(peers[0].doc)), stable(view(peers[1].doc)));
assert.notDeepEqual(stable(view(peers[0].doc)), stable(view(peers[2].doc)));
const disconnectedStateVectorBytes = peers.map((peer) =>
  Y.encodeStateVector(peer.doc).byteLength,
);

const reconnectPasses = [];
for (let pass = 0; pass < 2; pass += 1) {
  let payloadBytes = 0;
  let nonEmptyMessages = 0;
  for (let leftIndex = 0; leftIndex < peers.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < peers.length; rightIndex += 1) {
      const left = peers[leftIndex].doc;
      const right = peers[rightIndex].doc;
      const leftVector = Y.encodeStateVector(left);
      const rightVector = Y.encodeStateVector(right);
      const leftDelta = Y.encodeStateAsUpdate(left, rightVector);
      const rightDelta = Y.encodeStateAsUpdate(right, leftVector);
      payloadBytes += leftDelta.byteLength + rightDelta.byteLength;
      nonEmptyMessages += Number(hasChanges(leftDelta)) + Number(hasChanges(rightDelta));
      Y.applyUpdate(left, rightDelta);
      Y.applyUpdate(right, leftDelta);
    }
  }
  reconnectPasses.push({ payloadBytes, nonEmptyMessages });
}

for (const peer of peers.slice(1)) {
  assert.deepEqual(stable(view(peer.doc)), stable(view(peers[0].doc)));
  assert.deepEqual(
    Y.encodeStateVector(peer.doc),
    Y.encodeStateVector(peers[0].doc),
  );
}

const offlinePeer = { id: "peer-d", doc: new Y.Doc() };
offlinePeer.doc.getMap("records").set("shared-name", offlinePeer.id);
offlinePeer.doc.getMap("records").set("offline/peer-d", {
  editedOffline: true,
  payload: "peer-d:".repeat(128),
});
offlinePeer.doc.getArray("events").push([
  { peer: offlinePeer.id, sequence: 1 },
]);
const offlinePeerUpdate = Y.encodeStateAsUpdate(offlinePeer.doc);
for (const peer of peers) Y.applyUpdate(peer.doc, offlinePeerUpdate);

// The returning peer exchanges state-vector deltas with an online peer.
const remoteVector = Y.encodeStateVector(peers[0].doc);
const localVector = Y.encodeStateVector(offlinePeer.doc);
const toRemote = Y.encodeStateAsUpdate(offlinePeer.doc, remoteVector);
const toLocal = Y.encodeStateAsUpdate(peers[0].doc, localVector);
const joinSyncBytes = toRemote.byteLength + toLocal.byteLength;
Y.applyUpdate(peers[0].doc, toRemote);
Y.applyUpdate(offlinePeer.doc, toLocal);

const allDocs = [...peers.map((peer) => peer.doc), offlinePeer.doc];
const stateVectors = allDocs.map((doc) => Y.encodeStateVector(doc));
for (const vector of stateVectors.slice(1)) assert.deepEqual(vector, stateVectors[0]);

const result = {
  kind: "yjs-offline-reorder-duplicate-reconnect-state-vector-probe",
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  yjs: "13.6.33",
  peers: peers.map((peer) => peer.id),
  offlineUpdateBytes: peers.map((peer) => ({ peer: peer.id, bytes: peer.update.byteLength })),
  initialOutOfOrderDuplicateApplication: {
    sequences: updateOrder,
    duplicateApplications: 2,
    sharedPeersConverged: true,
    disconnectedPeerDetectedAsBehind: true,
    stateVectorBytesWhileDisconnected: disconnectedStateVectorBytes,
  },
  reconnectByStateVector: {
    passes: reconnectPasses,
    converged: true,
    stateVectorBytesAfterReconnect: stateVectors[0].byteLength,
  },
  snapshotGrowth: {
    localUpdateBytes: peers.reduce((total, peer) => total + peer.update.byteLength, 0),
    fullStateBytes: Y.encodeStateAsUpdate(peers[0].doc).byteLength,
    stateVectorBytes: stateVectors[0].byteLength,
    eventCount: peers[0].doc.getArray("events").length,
    offlineRecordCount: Object.keys(peers[0].doc.getMap("records").toJSON())
      .filter((key) => key.startsWith("offline/"))
      .length,
  },
  fourthPeerOfflineJoin: {
    beforeSyncStateBytes: offlinePeerUpdate.byteLength,
    stateVectorDeltaBytes: joinSyncBytes,
    converged: true,
  },
  mergeUpdateIsIdempotent: equalBytes(
    Y.mergeUpdates([peers[0].update, peers[0].update]),
    peers[0].update,
  ),
  authorizationTested: false,
  networkLatencyTested: false,
};

await writeFile(
  fileURLToPath(new URL("./results.json", import.meta.url)),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));

function view(doc) {
  return { records: doc.getMap("records").toJSON(), events: doc.getArray("events").toJSON() };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function hasChanges(update) {
  return !equalBytes(update, Y.encodeStateAsUpdate(new Y.Doc()));
}

function equalBytes(left, right) {
  return Buffer.from(left).equals(Buffer.from(right));
}
