import { randomUUID } from "node:crypto";
import { connectNode } from "../dist/index.js";

const endpoint = required("POCKETDB_SIGNALING_ENDPOINT");
const kvInvitation = required("POCKETDB_KV_INVITATION");
const sqlInvitation = required("POCKETDB_SQL_INVITATION");
const iceConfig = configuredIce();

const kv = await connectNode(kvInvitation, {
  signalingEndpoint: endpoint,
  iceConfig,
});
const sql = await connectNode(sqlInvitation, {
  signalingEndpoint: endpoint,
  iceConfig,
});
const stopObserving = [kv.client, sql.client].map((client) =>
  client.onStateChange?.((event) => {
    if (event.state === "failed") {
      console.error(
        "Browser host connection lost; in-flight mutation outcomes may be unknown.",
      );
    }
  }),
);

try {
  const key = `node-example:${randomUUID()}`;
  const value = `written by Node ${process.version}`;
  await kv.client.kv.set(key, value);
  const readBack = await kv.client.kv.get(key);
  if (new TextDecoder().decode(readBack ?? new Uint8Array()) !== value) {
    throw new Error(
      "The browser-hosted key-value read did not match the write.",
    );
  }
  console.log("browser-hosted KV write/read passed");

  const sqlResult = await sql.client.query(
    "SELECT $1::text AS client, $2::text AS runtime",
    ["PocketDB Node SDK", process.version],
  );
  console.log("browser-hosted SQL query passed", sqlResult);

  if (process.env.POCKETDB_DEMONSTRATE_TIMEOUT === "1") {
    try {
      await kv.client.kv.set(`${key}:timeout`, value, { timeoutMs: 1 });
    } catch (error) {
      if (error?.outcome === "unknown") {
        console.warn("request timed out after dispatch; outcome is unknown");
      } else {
        throw error;
      }
    }
  }
} finally {
  for (const unsubscribe of stopObserving) unsubscribe?.();
  await Promise.allSettled([kv.close(), sql.close()]);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function configuredIce() {
  const host = process.env.POCKETDB_ICE_STUN_HOST;
  const portValue = process.env.POCKETDB_ICE_STUN_PORT;
  if (!host && !portValue) return {};
  const port = Number(portValue ?? "3478");
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Set a valid POCKETDB_ICE_STUN_HOST and optional port.");
  }
  return { iceServers: [{ urls: `stun:${host}:${port}` }] };
}
