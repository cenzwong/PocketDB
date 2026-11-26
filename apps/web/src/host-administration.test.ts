import { afterEach, expect, it, vi } from "vitest";
import { DatabaseRuntime } from "@pocketdb/runtime";
import { WebRTCDiscoveryAdapter } from "@pocketdb/transport";
import { HostAdministration } from "./host-administration";

afterEach(() => vi.restoreAllMocks());

it("closes a connected peer that has not authenticated on revocation", async () => {
  const unsubscribe = vi.fn();
  const close = vi.fn(async () => undefined);
  const certificates = new Map([
    [
      "transport",
      {
        type: "transport",
        dtlsState: "connected",
        localCertificateId: "local",
        remoteCertificateId: "remote",
      },
    ],
    [
      "local",
      { fingerprintAlgorithm: "sha-256", fingerprint: "AA:".repeat(31) + "AA" },
    ],
    [
      "remote",
      { fingerprintAlgorithm: "sha-256", fingerprint: "BB:".repeat(31) + "BB" },
    ],
  ]);
  const onMessage = vi.fn(() => unsubscribe);
  vi.spyOn(WebRTCDiscoveryAdapter.prototype, "connect").mockResolvedValue({
    peerConnection: {
      connectionState: "connected",
      getStats: async () => certificates,
    },
    transport: { onMessage, onStateChange: () => () => undefined },
    close,
  } as never);
  const host = new HostAdministration(new DatabaseRuntime(), "instance", "kv");
  const invitation = await host.createInvitation(
    "read-write",
    "http://localhost",
    "http://localhost",
  );
  await vi.waitFor(() => expect(onMessage).toHaveBeenCalled());
  await host.revokeInvitation(invitation.id);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  await host.close();
});
