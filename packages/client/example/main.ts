import {
  createInvitation,
  createPocketDBInvitationUri,
  decodeEnvelope,
  type AuthenticatedPeerSession,
} from "@pocketdb/protocol";
import { KeyValueEngineAdapter } from "@pocketdb/engine-kv";
import { PGliteEngineAdapter } from "@pocketdb/engine-pglite";
import { RemoteSessionHost } from "@pocketdb/remote-access";
import { DatabaseRuntime } from "@pocketdb/runtime";
import { createInProcessTransportPair } from "@pocketdb/transport";
import { connect, PocketDBClientError } from "@pocketdb/client";

declare global {
  interface Window {
    __clientSdkTrace?: string[];
    __clientSdkResult?: {
      readonly ok: boolean;
      readonly checks: readonly string[];
      readonly error?: string;
    };
  }
}

const hostId = "A".repeat(43);
let currentPhase = "starting";
const trace: string[] = [];
window.__clientSdkTrace = trace;

async function run(): Promise<Window["__clientSdkResult"]> {
  currentPhase = "starting database engines";
  const runtime = new DatabaseRuntime();
  runtime.registerAdapter(new KeyValueEngineAdapter());
  runtime.registerAdapter(new PGliteEngineAdapter());
  const kvInvitation = createInvitation({
    roomId: "client-example-kv",
    instanceId: "client-example-kv-db",
    engineId: "kv",
    expectedHostId: hostId,
    access: "read-write",
  });
  const sqlInvitation = createInvitation({
    roomId: "client-example-sql",
    instanceId: "client-example-sql-db",
    engineId: "postgresql",
    expectedHostId: hostId,
    access: "read-write",
  });
  await runtime.startInstance("kv", kvInvitation.instanceId);
  await runtime.startInstance("postgresql", sqlInvitation.instanceId);

  const hosts: RemoteSessionHost[] = [];
  const connectPeer = async (invitation: typeof kvInvitation) => {
    trace.push(`connector:${invitation.engineId}`);
    const pair = createInProcessTransportPair();
    const auth: AuthenticatedPeerSession = {
      sessionId: `example-auth-${invitation.engineId}`,
      roomId: invitation.roomId,
      instanceId: invitation.instanceId,
      engineId: invitation.engineId,
      hostId,
      clientId: "browser-example-client",
      access: invitation.access,
    };
    hosts.push(
      new RemoteSessionHost(runtime, pair.right, { authorize: () => auth }),
    );
    pair.left.onMessage((message) => {
      try {
        trace.push(`client-received:${decodeEnvelope(message).type}`);
      } catch {
        trace.push("client-received:invalid");
      }
    });
    pair.right.onMessage((message) => {
      try {
        trace.push(`host-received:${decodeEnvelope(message).type}`);
      } catch {
        trace.push("host-received:invalid");
      }
    });
    return pair.left;
  };

  const checks: string[] = [];
  try {
    currentPhase = "connecting key-value SDK client";
    const keyValue = await connect(createPocketDBInvitationUri(kvInvitation), {
      connectPeer,
      requestTimeoutMs: 10_000,
    });
    if (keyValue.engineId !== "kv") throw new Error("Expected a KV client.");
    const original = new Uint8Array([0, 1, 127, 128, 255]);
    await keyValue.kv.set("sdk-binary", original);
    const copied = await keyValue.kv.get("sdk-binary");
    if (!copied || !sameBytes(original, copied)) {
      throw new Error("The key-value client changed a binary value.");
    }
    checks.push("key-value API preserves binary values");

    currentPhase = "connecting PostgreSQL SDK client";
    const sql = await connect(createPocketDBInvitationUri(sqlInvitation), {
      connectPeer,
      requestTimeoutMs: 30_000,
    });
    if (sql.engineId !== "postgresql") {
      throw new Error("Expected a PostgreSQL client.");
    }
    await sql.query(
      "CREATE TABLE client_sdk_probe (id integer primary key, payload bytea)",
    );
    await sql.query(
      "INSERT INTO client_sdk_probe (id, payload) VALUES ($1, $2)",
      [42, original],
    );
    currentPhase = "querying SQL schema metadata";
    const columns = await sql.schema({ table: "client_sdk_probe" });
    if (
      !columns.some(
        ({ column_name, data_type }) =>
          column_name === "id" && data_type === "integer",
      ) ||
      !columns.some(
        ({ column_name, data_type }) =>
          column_name === "payload" && data_type === "bytea",
      )
    ) {
      throw new Error(
        "Structured SQL schema discovery returned wrong columns.",
      );
    }
    const description = await sql.describeQuery(
      "SELECT id, payload FROM client_sdk_probe WHERE id = $1",
    );
    if (
      description.parameters[0]?.dataTypeID !== 23 ||
      description.fields.map(({ name }) => name).join(",") !== "id,payload"
    ) {
      throw new Error("Structured SQL query description returned wrong types.");
    }
    checks.push("SQL schema and query description return structured metadata");
    const selected = await sql.query<{
      readonly rows: readonly {
        readonly id: number;
        readonly payload: Uint8Array;
      }[];
    }>("SELECT id, payload FROM client_sdk_probe WHERE id = $1", [42]);
    const row = selected.rows[0];
    if (row?.id !== 42 || !sameBytes(row.payload, original)) {
      throw new Error("SQL parameter or binary result fidelity failed.");
    }
    checks.push("SQL parameters and binary query results preserve values");

    const failed = await sql.query("SELECT FROM").then(
      () => undefined,
      (error: unknown) => error,
    );
    if (
      !(failed instanceof PocketDBClientError) ||
      failed.outcome !== "failed" ||
      failed.code.length === 0
    ) {
      throw new Error(
        "SQL failures did not return a structured failed outcome.",
      );
    }
    checks.push("SQL failure returns a structured failed outcome");

    await Promise.all([keyValue.close(), sql.close()]);
    checks.push("both typed clients close their remote sessions");
    return { ok: true, checks };
  } finally {
    await Promise.allSettled(hosts.map((host) => host.close()));
    await Promise.all([
      runtime.stopInstance(kvInvitation.instanceId),
      runtime.stopInstance(sqlInvitation.instanceId),
    ]);
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

void run().then(
  (result) => {
    window.__clientSdkResult = result;
    const status = document.querySelector<HTMLElement>("#status");
    if (status) status.textContent = "Client SDK checks passed.";
  },
  (error: unknown) => {
    const message =
      error instanceof Error
        ? `${currentPhase}: ${error.name}: ${error.message}; trace=${trace.join(",")}`
        : `${currentPhase}: ${String(error)}; trace=${trace.join(",")}`;
    window.__clientSdkResult = { ok: false, checks: [], error: message };
    const status = document.querySelector<HTMLElement>("#status");
    if (status) status.textContent = message;
  },
);
