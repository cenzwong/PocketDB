import { connectNode } from "@pocketdb/node-client";
import type { ConnectNodeOptions, NodeConnection } from "@pocketdb/node-client";

const options: ConnectNodeOptions = {
  signalingEndpoint: "https://signal.example/api",
  iceConfig: {
    iceServers: [{ urls: "stun:stun.example:3478" }],
  },
};
const connection: Promise<NodeConnection> = connectNode(
  "pocketdb://room-a/postgres#invite=example",
  options,
);
void connection;
