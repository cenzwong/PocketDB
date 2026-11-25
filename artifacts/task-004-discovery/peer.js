function waitFor(check, label) {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + 10_000;
    function poll() {
      const result = check();
      if (result !== undefined && result !== false) resolve(result);
      else if (performance.now() >= deadline) reject(new Error(`Timed out: ${label}`));
      else setTimeout(poll, 25);
    }
    poll();
  });
}

async function signalPath(room, role, description) {
  const response = await fetch(`./signal/${room}/${role}`, description ? {
    method: "POST",
    body: JSON.stringify(description),
  } : undefined);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Signaling HTTP ${response.status}`);
  if (!description) return response.json();
}

async function receive(room, role) {
  const stop = performance.now() + 10_000;
  do {
    const signal = await signalPath(room, role);
    if (signal) return signal;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (performance.now() < stop);
  throw new Error(`Missing ${role} signal`);
}

globalThis.createPeer = (role, configuration) => {
  const peer = new RTCPeerConnection(configuration);
  const candidateTypes = new Set();
  const iceErrors = new Set();
  peer.onicecandidate = ({ candidate }) => {
    if (candidate) candidateTypes.add(candidate.type);
  };
  peer.onicecandidateerror = ({ errorCode }) => iceErrors.add(errorCode);
  const replies = new Map();
  const values = new Map();
  let channel;
  function attach(dataChannel) {
    channel = dataChannel;
    channel.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (role === "client") replies.set(message.id, message.value);
      else {
        if (message.op === "set") values.set(message.key, message.value);
        channel.send(JSON.stringify({
          id: message.id, value: message.op === "set" ? "OK" : values.get(message.key),
        }));
      }
    };
  }
  if (role === "client") attach(peer.createDataChannel("pocketdb"));
  else peer.ondatachannel = (event) => attach(event.channel);

  async function localDescription(description) {
    await peer.setLocalDescription(description);
    await waitFor(() => peer.iceGatheringState === "complete", "ICE gathering");
    return peer.localDescription.toJSON();
  }
  async function makeOffer() {
    return localDescription(await peer.createOffer());
  }
  async function makeAnswer(offer) {
    await peer.setRemoteDescription(offer);
    return localDescription(await peer.createAnswer());
  }
  async function acceptAnswer(answer) {
    await peer.setRemoteDescription(answer);
  }
  return {
    makeOffer, makeAnswer, acceptAnswer,
    async automatic(room) {
      if (role === "client") {
        await signalPath(room, "offer", await makeOffer());
        await acceptAnswer(await receive(room, "answer"));
      } else {
        await signalPath(room, "answer", await makeAnswer(await receive(room, "offer")));
      }
    },
    async check() {
      await waitFor(() => Boolean(channel && channel.readyState === "open"), "data channel");
      const marker = crypto.randomUUID();
      for (const [id, op, expected] of [[1, "set", "OK"], [2, "get", marker]]) {
        channel.send(JSON.stringify({ id, op, key: "probe", value: marker }));
        if (await waitFor(() => replies.get(id), op) !== expected) throw new Error(`${op} reply mismatch`);
      }
      return true;
    },
    async diagnostics() {
      const stats = await peer.getStats();
      const transport = [...stats.values()].find((item) => item.selectedCandidatePairId);
      const pair = transport && stats.get(transport.selectedCandidatePairId);
      return {
        candidateTypes: [...candidateTypes].sort(),
        iceErrors: [...iceErrors],
        connection: peer.connectionState,
        selected: pair ? {
          local: stats.get(pair.localCandidateId)?.candidateType,
          remote: stats.get(pair.remoteCandidateId)?.candidateType,
          protocol: stats.get(pair.localCandidateId)?.protocol,
        } : null,
      };
    },
    close: () => peer.close(),
  };
};
