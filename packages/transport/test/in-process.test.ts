import { createInProcessTransportPair } from "../src";
import { defineTransportContract } from "../testing/transport-contract";

defineTransportContract("in-process", () =>
  createInProcessTransportPair({
    leftPeerId: "client",
    rightPeerId: "host",
  }),
);
