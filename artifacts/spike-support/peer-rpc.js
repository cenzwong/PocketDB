export function browserPeer(dispatch) {
  const peer = new RTCPeerConnection({ iceServers: [] });
  let queue = Promise.resolve();
  peer.ondatachannel = ({ channel }) => {
    channel.onmessage = ({ data }) => {
      queue = queue.then(async () => {
        const { id, request } = JSON.parse(data);
        let response;
        try {
          response = { id, value: await dispatch(request) };
        } catch (error) {
          response = { id, error: String(error) };
        }
        if (channel.readyState === "open") channel.send(JSON.stringify(response));
      });
    };
  };
  return {
    async accept(offer) {
      await peer.setRemoteDescription(offer);
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== "complete") {
        await new Promise((resolve) => {
          function update() {
            if (peer.iceGatheringState !== "complete") return;
            peer.removeEventListener("icegatheringstatechange", update);
            resolve();
          }
          peer.addEventListener("icegatheringstatechange", update);
          update();
        });
      }
      return peer.localDescription.toJSON();
    },
    close: () => peer.close(),
  };
}
