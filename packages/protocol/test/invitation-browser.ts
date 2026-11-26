import {
  createBrowserInvitationLink,
  createInvitation,
  parseInvitation,
  redactInvitationForLog,
} from "../src";

declare global {
  interface Window {
    __invitationResult?: {
      ok: boolean;
      browser: string;
      secureContext: boolean;
      capabilityBytes?: number;
      queryEmpty?: boolean;
      fragmentRoundTrip?: boolean;
      warningShown?: boolean;
      redacted?: boolean;
      error?: string;
    };
  }
}

try {
  const expectedHostId = encodeBase64Url(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const invitation = createInvitation({
    roomId: "browser-room",
    instanceId: "browser-instance",
    engineId: "kv",
    expectedHostId,
    access: "read-write",
    expiresAt: Date.now() + 60_000,
  });
  const link = createBrowserInvitationLink(
    `${location.origin}${location.pathname}?remove=this#old`,
    invitation,
  );
  const parsed = parseInvitation(link.url, {
    expectedTarget: {
      roomId: "browser-room",
      instanceId: "browser-instance",
      engineId: "kv",
      expectedHostId,
    },
  });
  const logged = redactInvitationForLog(link.url);
  const fragmentRoundTrip = parsed.capability === invitation.capability;
  const redacted =
    !logged.includes(invitation.capability) &&
    !logged.includes(new URL(link.url).hash.slice("#invite=".length));
  window.__invitationResult = {
    ok:
      crypto.subtle !== undefined &&
      fragmentRoundTrip &&
      new URL(link.url).search === "" &&
      Boolean(link.warning) &&
      redacted,
    browser: navigator.userAgent,
    secureContext: isSecureContext,
    capabilityBytes: atob(
      `${invitation.capability.replaceAll("-", "+").replaceAll("_", "/")}=`,
    ).length,
    queryEmpty: new URL(link.url).search === "",
    fragmentRoundTrip,
    warningShown: Boolean(link.warning),
    redacted,
  };
  document
    .querySelector("#result")
    ?.replaceChildren(
      document.createTextNode(JSON.stringify(window.__invitationResult)),
    );
} catch (error) {
  window.__invitationResult = {
    ok: false,
    browser: navigator.userAgent,
    secureContext: isSecureContext,
    error:
      error instanceof Error ? (error.stack ?? error.message) : String(error),
  };
  document
    .querySelector("#result")
    ?.replaceChildren(
      document.createTextNode(JSON.stringify(window.__invitationResult)),
    );
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
