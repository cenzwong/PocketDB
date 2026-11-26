import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const invitationUri = process.env.POCKETDB_INVITATION;
const signalingEndpoint = process.env.POCKETDB_SIGNALING_ENDPOINT;
if (!invitationUri || !signalingEndpoint) {
  throw new Error("Set POCKETDB_INVITATION and POCKETDB_SIGNALING_ENDPOINT.");
}

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const client = new Client({ name: "pocketdb-agent-example", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(packageRoot, "dist/stdio.js")],
});

try {
  await client.connect(transport);
  const connected = await client.callTool({
    name: "pocketdb_connect",
    arguments: { invitationUri, signalingEndpoint },
  });
  const connection = requireData(connected);
  const connectionId = connection.connectionId;
  const inspected = await client.callTool({
    name: "pocketdb_inspect",
    arguments: { connectionId },
  });
  requireData(inspected);

  const capability = connection.capabilities?.operations ?? [];
  const result =
    connection.engineId === "kv"
      ? await client.callTool({
          name: "pocketdb_key_value",
          arguments: { connectionId, command: "PING" },
        })
      : await client.callTool({
          name: "pocketdb_query",
          arguments: { connectionId, sql: "SELECT 1 AS agent_check" },
        });
  const data = requireData(result);
  console.log(
    JSON.stringify(
      {
        engineId: connection.engineId,
        access: connection.access,
        capabilities: capability,
        result: data,
      },
      null,
      2,
    ),
  );
  await client.callTool({
    name: "pocketdb_disconnect",
    arguments: { connectionId },
  });
} finally {
  await client.close();
}

function requireData(result) {
  const content = result.structuredContent;
  if (result.isError || !content || content.ok !== true) {
    const error = content?.error;
    throw new Error(
      `PocketDB tool failed (${error?.code ?? "unknown"}): ${error?.message ?? "No structured result."}`,
    );
  }
  return content.data;
}
