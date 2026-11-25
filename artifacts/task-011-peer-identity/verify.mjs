import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { identity, JoinHost, respond } from "./protocol.mjs";

const now = Date.now();
const expiresAt = now + 60_000;
const host = await JoinHost.create("test-instance", "read-write", expiresAt);
const invitation = host.invitation();
const client = await identity();
const other = await identity();
const channel = (id) => Object.freeze({
  id,
  context: Object.freeze({ hostFingerprint: "host-dtls-fixture", clientFingerprint: "client-dtls-fixture" }),
});
const connection = channel("primary");

let challenge = await host.challenge(connection, client.publicKey, now);
let proof = await respond(invitation, connection, challenge, client);
const session = await host.join(connection, proof, now);
assert.deepEqual(host.authorize(connection, session, now), { instance: "test-instance", role: "read-write" });
await assert.rejects(host.join(connection, proof, now), /invalid challenge/);
assert.throws(() => host.authorize(channel("second"), session, now), /invalid session binding/);

challenge = await host.challenge(connection, client.publicKey, now);
proof = await respond(invitation, connection, challenge, client);
const changed = { id: connection.id, context: { ...connection.context, hostFingerprint: "substituted" } };
await assert.rejects(respond(invitation, changed, challenge, client), /invalid host proof/);
await assert.rejects(host.join(changed, proof, now), /invalid channel binding/);

challenge = await host.challenge(connection, client.publicKey, now);
await assert.rejects(respond(invitation, connection, { ...challenge, hostKey: other.publicKey }, client), /invalid identity/);
proof = await respond(invitation, connection, challenge, client);
proof.identity = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, other.privateKey, new Uint8Array([1]));
await assert.rejects(host.join(connection, proof, now), /invalid identity/);

challenge = await host.challenge(connection, client.publicKey, now);
proof = await respond({ ...invitation, secret: randomBytes(32).toString("base64url") }, connection, challenge, client);
await assert.rejects(host.join(connection, proof, now), /invalid capability/);

challenge = await host.challenge(connection, client.publicKey, expiresAt - 1);
proof = await respond(invitation, connection, challenge, client);
await assert.rejects(host.join(connection, proof, expiresAt), /expired/);
assert.throws(() => host.authorize(connection, session, expiresAt), /expired/);

challenge = await host.challenge(connection, client.publicKey, now);
proof = await respond(invitation, connection, challenge, client);
host.revoke();
await assert.rejects(host.join(connection, proof, now), /revoked/);
await assert.rejects(host.challenge(connection, client.publicKey, now), /revoked/);
assert.throws(() => host.authorize(connection, session, now), /revoked/);

console.log(JSON.stringify({
  node: process.version, platform: process.platform, architecture: process.arch,
  authorized: true,
  rejected: ["replay", "wrong connection", "changed channel binding", "substituted host key",
    "invalid client signature", "wrong capability", "expired join and session", "revoked join and session"],
  transport: "Injected trusted channel contexts for the fixture",
}, null, 2));
