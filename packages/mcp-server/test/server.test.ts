import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, expect, test, vi } from "vitest";
import { createPocketDBMcpServer } from "../src/index.js";

const servers: Array<ReturnType<typeof createPocketDBMcpServer>> = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function startClient(server: ReturnType<typeof createPocketDBMcpServer>) {
  const mcpClient = new Client({ name: "test-client", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  servers.push(server);
  clients.push(mcpClient);
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return mcpClient;
}

test("exposes structured results, delegates authorization, and redacts failed credentials", async () => {
  const kv = {
    ping: vi.fn(async () => "PONG"),
    get: vi.fn(async () => new TextEncoder().encode("value")),
    set: vi.fn(async () => {
      throw Object.assign(new Error("Invitation does not allow SET."), {
        code: "operation-not-authorized",
      });
    }),
    delete: vi.fn(async () => 0),
  };
  const client = {
    engineId: "kv",
    access: "read-only",
    state: "connected",
    capabilities: { operations: ["PING", "GET"] },
    kv,
    close: vi.fn(async () => undefined),
  };
  const connect = vi.fn(async (invitationUri: string) => {
    if (invitationUri === "pocketdb://private-token")
      throw new Error(`Could not parse ${invitationUri}`);
    return { client, close: client.close };
  });
  const server = createPocketDBMcpServer({ connect: connect as never });
  const mcpClient = await startClient(server);

  const failedConnect = await mcpClient.callTool({
    name: "pocketdb_connect",
    arguments: {
      invitationUri: "pocketdb://private-token",
      signalingEndpoint: "https://private.example/signal",
    },
  });
  expect(failedConnect.isError).toBe(true);
  expect(failedConnect.structuredContent).toMatchObject({
    ok: false,
    error: {
      code: "operation-failed",
      message: "Could not parse [redacted invitation]",
    },
  });
  expect(JSON.stringify(failedConnect)).not.toContain("private-token");

  const connected = await mcpClient.callTool({
    name: "pocketdb_connect",
    arguments: {
      invitationUri: "pocketdb://valid",
      signalingEndpoint: "https://signal.example",
    },
  });
  const data = connected.structuredContent as {
    data: { connectionId: string };
  };
  expect(data.data.connectionId).toMatch(/^[0-9a-f-]{36}$/);

  const get = await mcpClient.callTool({
    name: "pocketdb_key_value",
    arguments: {
      connectionId: data.data.connectionId,
      command: "GET",
      key: "a",
    },
  });
  expect(get.structuredContent).toMatchObject({
    ok: true,
    data: { base64: "dmFsdWU=" },
  });

  const denied = await mcpClient.callTool({
    name: "pocketdb_key_value",
    arguments: {
      connectionId: data.data.connectionId,
      command: "SET",
      key: "a",
      value: "b",
    },
  });
  expect(kv.set).toHaveBeenCalledTimes(1);
  expect(denied.isError).toBe(true);
  expect(denied.structuredContent).toMatchObject({ ok: false });

  const disconnected = await mcpClient.callTool({
    name: "pocketdb_disconnect",
    arguments: { connectionId: data.data.connectionId },
  });
  expect(disconnected.structuredContent).toMatchObject({
    ok: true,
    data: { disconnected: true },
  });
  expect(client.close).toHaveBeenCalledOnce();
});

test("serializes nested SQLite bigint results as decimal strings in both MCP outputs", async () => {
  const client = {
    engineId: "sqlite",
    access: "owner",
    capabilities: { operations: ["query"] },
    query: vi.fn(async () => ({
      rows: [
        {
          id: 9223372036854775807n,
          nested: { values: [-9223372036854775808n, 1, null] },
        },
      ],
    })),
  };
  const close = vi.fn(async () => undefined);
  const connect = vi.fn(async () => ({ client, close }));
  const mcpClient = await startClient(
    createPocketDBMcpServer({ connect: connect as never }),
  );
  const connected = await mcpClient.callTool({
    name: "pocketdb_connect",
    arguments: {
      invitationUri: "pocketdb://valid",
      signalingEndpoint: "https://signal.example",
    },
  });
  const {
    data: { connectionId },
  } = connected.structuredContent as { data: { connectionId: string } };
  try {
    const result = await mcpClient.callTool({
      name: "pocketdb_query",
      arguments: {
        connectionId,
        sql: "INSERT INTO items DEFAULT VALUES RETURNING id",
      },
    });
    const expected = {
      ok: true,
      data: {
        rows: [
          {
            id: "9223372036854775807",
            nested: { values: ["-9223372036854775808", 1, null] },
          },
        ],
      },
    };
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expected);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(expected) },
    ]);
    expect(client.query).toHaveBeenCalledOnce();
  } finally {
    await mcpClient.callTool({
      name: "pocketdb_disconnect",
      arguments: { connectionId },
    });
  }
});

test("inspects capabilities without invoking unsupported SQL schema", async () => {
  const client = {
    engineId: "sqlite",
    access: "read-only",
    capabilities: { operations: ["query"] },
    schema: vi.fn(async () => {
      throw new Error("unsupported");
    }),
  };
  const close = vi.fn(async () => undefined);
  const mcpClient = await startClient(
    createPocketDBMcpServer({
      connect: (async () => ({ client, close })) as never,
    }),
  );
  const connected = await mcpClient.callTool({
    name: "pocketdb_connect",
    arguments: {
      invitationUri: "pocketdb://valid",
      signalingEndpoint: "https://signal.example",
    },
  });
  const {
    data: { connectionId },
  } = connected.structuredContent as { data: { connectionId: string } };
  try {
    const result = await mcpClient.callTool({
      name: "pocketdb_inspect",
      arguments: { connectionId },
    });
    expect(result.structuredContent).toEqual({
      ok: true,
      data: { capabilities: client.capabilities },
    });
    expect(client.schema).not.toHaveBeenCalled();
  } finally {
    await mcpClient.callTool({
      name: "pocketdb_disconnect",
      arguments: { connectionId },
    });
  }
});

test.each(["sqlite", "duckdb"])(
  "exports %s query results without describe-query, including empty results",
  async (engineId) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        columns: ["name", "value"],
        rows: [{ name: "a,b", value: 2 }],
      })
      .mockResolvedValueOnce({ columns: ["name", "value"], rows: [] })
      .mockResolvedValueOnce({
        columns: ["name", "value"],
        rows: [{ name: "x", value: 1 }],
        truncated: true,
      });
    const describeQuery = vi.fn();
    const client = {
      engineId,
      access: "read-only",
      capabilities: { operations: ["query"] },
      query,
      describeQuery,
    };
    const mcpClient = await startClient(
      createPocketDBMcpServer({
        connect: (async () => ({
          client,
          close: async () => undefined,
        })) as never,
      }),
    );
    const connected = await mcpClient.callTool({
      name: "pocketdb_connect",
      arguments: {
        invitationUri: "pocketdb://valid",
        signalingEndpoint: "https://signal.example",
      },
    });
    const {
      data: { connectionId },
    } = connected.structuredContent as { data: { connectionId: string } };
    const exportQuery = () =>
      mcpClient.callTool({
        name: "pocketdb_export_query_csv",
        arguments: {
          connectionId,
          sql: "SELECT name, value FROM items",
          maxRows: 5,
        },
      });
    expect((await exportQuery()).structuredContent).toEqual({
      ok: true,
      data: { csv: 'name,value\r\n"a,b",2', rowCount: 1, truncated: false },
    });
    expect((await exportQuery()).structuredContent).toEqual({
      ok: true,
      data: { csv: "name,value", rowCount: 0, truncated: false },
    });
    expect((await exportQuery()).structuredContent).toMatchObject({
      ok: true,
      data: { truncated: true },
    });
    expect(describeQuery).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(3);
  },
);
