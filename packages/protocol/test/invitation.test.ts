import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserInvitationLink,
  createInvitation,
  createPocketDBInvitationUri,
  encodeInvitation,
  isPrivilegedInvitation,
  parseInvitation,
  redactInvitationForLog,
  type CreateInvitationInput,
} from "../src";

const hostId = encodeBase64Url(new Uint8Array(32).fill(7));
const input: CreateInvitationInput = {
  roomId: "room-a7f2",
  instanceId: "instance-01",
  engineId: "postgresql",
  expectedHostId: hostId,
  access: "read-write",
  expiresAt: Date.now() + 60_000,
};

afterEach(() => vi.unstubAllGlobals());

describe("versioned capability invitations", () => {
  it("accepts SQLite as a SQL engine invitation target", () => {
    const sqlite = createInvitation({ ...input, engineId: "sqlite" });
    expect(parseInvitation(createPocketDBInvitationUri(sqlite))).toEqual(
      sqlite,
    );
  });
  it("accepts DuckDB as an analytical SQL engine invitation target", () => {
    const duckdb = createInvitation({ ...input, engineId: "duckdb" });
    expect(parseInvitation(createPocketDBInvitationUri(duckdb))).toEqual(
      duckdb,
    );
  });
  it("accepts CRDT as a separate replica invitation target", () => {
    const crdt = createInvitation({ ...input, engineId: "crdt" });
    expect(parseInvitation(createPocketDBInvitationUri(crdt))).toEqual(crdt);
  });

  it("generates an independent 256-bit capability and round-trips pocketdb URIs", () => {
    const first = createInvitation(input);
    const second = createInvitation(input);
    expect(first.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      atob(`${first.capability.replaceAll("-", "+").replaceAll("_", "/")}=`),
    ).toHaveLength(32);
    expect(first.capability).not.toBe(second.capability);

    const uri = createPocketDBInvitationUri(first);
    expect(new URL(uri).search).toBe("");
    expect(uri).toContain("/postgres#invite=");
    expect(parseInvitation(uri)).toEqual(first);
  });

  it("round-trips browser fragment invitations and warns for write access", () => {
    const invitation = createInvitation(input);
    const link = createBrowserInvitationLink(
      "https://example.github.io/pocketdb/?campaign=remove#old",
      invitation,
    );
    const url = new URL(link.url);
    expect(url.search).toBe("");
    expect(url.hash).toMatch(/^#invite=/);
    expect(link.warning).toContain("read-write access");
    expect(parseInvitation(link.url)).toEqual(invitation);
  });

  it("allows optional expiry and rejects expired invitations", () => {
    const noExpiry = createInvitation({ ...input, expiresAt: undefined });
    expect(noExpiry.expiresAt).toBeUndefined();
    expect(parseInvitation(createPocketDBInvitationUri(noExpiry))).toEqual(
      noExpiry,
    );

    const expiring = createInvitation(input);
    const expiredUri = createPocketDBInvitationUri({
      ...expiring,
      expiresAt: Date.now() - 1,
    });
    expect(() => parseInvitation(expiredUri)).toThrow(
      expect.objectContaining({ code: "expired" }),
    );
    expect(() =>
      createInvitation({ ...input, expiresAt: Date.now() - 1 }),
    ).toThrow(expect.objectContaining({ code: "expired" }));
  });

  it("rejects wrong routes, hosts, instances and engines", () => {
    const invitation = createInvitation(input);
    const uri = createPocketDBInvitationUri(invitation);
    expect(() =>
      parseInvitation(uri.replace("room-a7f2", "room-other")),
    ).toThrow(expect.objectContaining({ code: "wrong-target" }));
    expect(() =>
      parseInvitation(uri, {
        expectedTarget: {
          expectedHostId: encodeBase64Url(new Uint8Array(32).fill(8)),
        },
      }),
    ).toThrow(expect.objectContaining({ code: "wrong-target" }));
    expect(() =>
      parseInvitation(uri, {
        expectedTarget: { instanceId: "another-instance" },
      }),
    ).toThrow(expect.objectContaining({ code: "wrong-target" }));
    expect(() =>
      parseInvitation(uri, { expectedTarget: { engineId: "kv" } }),
    ).toThrow(expect.objectContaining({ code: "wrong-target" }));
  });

  it("rejects malformed payloads, unsupported versions and query-string secrets", () => {
    const invitation = createInvitation(input);
    const uri = createPocketDBInvitationUri(invitation);
    const [route, fragment] = uri.split("#");
    expect(() =>
      parseInvitation(`${route}?capability=do-not-leak#${fragment}`),
    ).toThrow(expect.objectContaining({ code: "query-not-allowed" }));
    expect(() => parseInvitation(`${uri}&extra=value`)).toThrow(
      expect.objectContaining({ code: "invalid-invitation" }),
    );
    expect(() =>
      parseInvitation("pocketdb://room-a7f2/postgres#invite=%%%"),
    ).toThrow(expect.objectContaining({ code: "invalid-invitation" }));

    const unsupported = encodePayload({ ...invitation, version: 2 });
    expect(() =>
      parseInvitation(`pocketdb://room-a7f2/postgres#invite=${unsupported}`),
    ).toThrow(expect.objectContaining({ code: "unsupported-version" }));
  });

  it("requires HTTPS except on loopback and redacts all invitation data from logs", () => {
    const invitation = createInvitation(input);
    const link = createBrowserInvitationLink(
      "http://localhost:5173/pocketdb",
      invitation,
    );
    expect(parseInvitation(link.url)).toEqual(invitation);
    expect(() =>
      createBrowserInvitationLink("http://example.com/pocketdb", invitation),
    ).toThrow(expect.objectContaining({ code: "insecure-origin" }));

    for (const url of [createPocketDBInvitationUri(invitation), link.url]) {
      const logged = redactInvitationForLog(url);
      expect(logged).not.toContain(invitation.capability);
      expect(logged).not.toContain(encodeInvitation(invitation));
      expect(logged).toContain("REDACTED");
    }
    expect(redactInvitationForLog("not a uri with capability secret")).toBe(
      "[redacted invitation]",
    );
  });

  it("does not warn for read-only invitations and exposes privileged status", () => {
    const invitation = createInvitation({ ...input, access: "read-only" });
    expect(isPrivilegedInvitation(invitation)).toBe(false);
    expect(
      createBrowserInvitationLink("https://example.com/", invitation).warning,
    ).toBeUndefined();
    expect(isPrivilegedInvitation(createInvitation(input))).toBe(true);
  });

  it("fails closed when Web Crypto secure randomness is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => createInvitation(input)).toThrow(
      expect.objectContaining({ code: "secure-random-unavailable" }),
    );
  });
});

function encodePayload(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
