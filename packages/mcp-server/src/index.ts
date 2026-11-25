import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import { connectNode } from "@pocketdb/node-client";
import { z } from "zod/v4";

type PocketDBConnection = Awaited<ReturnType<typeof connectNode>>;
type Connect = typeof connectNode;

export interface PocketDBMcpOptions {
  readonly connect?: Connect;
}

const resultSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

const connections = new Map<string, PocketDBConnection>();

/** Create an MCP server whose tools delegate to the authorized PocketDB SDK. */
export function createPocketDBMcpServer(options: PocketDBMcpOptions = {}) {
  const connect = options.connect ?? connectNode;
  const server = new McpServer({ name: "pocketdb", version: "0.1.0" });

  server.registerTool(
    "pocketdb_connect",
    {
      title: "Connect to PocketDB",
      description:
        "Connect using a host-issued invitation. The invitation and signaling endpoint are never returned by this tool.",
      inputSchema: z.object({
        invitationUri: z.string().min(1),
        signalingEndpoint: z.string().url(),
      }),
      outputSchema: resultSchema,
    },
    async ({ invitationUri, signalingEndpoint }) => {
      try {
        const connection = await connect(invitationUri, { signalingEndpoint });
        const id = randomUUID();
        connections.set(id, connection);
        return success({
          connectionId: id,
          engineId: connection.client.engineId,
          access: connection.client.access,
          capabilities: connection.client.capabilities,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "pocketdb_connections",
    {
      title: "List PocketDB connections",
      description: "List this process's active PocketDB connections.",
      inputSchema: z.object({}),
      outputSchema: resultSchema,
    },
    async () =>
      success(
        [...connections].map(([connectionId, connection]) => ({
          connectionId,
          engineId: connection.client.engineId,
          access: connection.client.access,
          state: connection.client.state,
          capabilities: connection.client.capabilities,
        })),
      ),
  );

  server.registerTool(
    "pocketdb_inspect",
    {
      title: "Inspect PocketDB",
      description:
        "Return negotiated capabilities and SQL schema when available.",
      inputSchema: z.object({
        connectionId: z.string().uuid(),
        schema: z.string().optional(),
        table: z.string().optional(),
      }),
      outputSchema: resultSchema,
    },
    async ({ connectionId, schema, table }) => {
      const connection = connections.get(connectionId);
      if (!connection)
        return failureCode("connection-not-found", "Connection not found.");
      try {
        const client = connection.client;
        const data: Record<string, unknown> = {
          capabilities: client.capabilities,
        };
        if (client.engineId !== "kv") {
          data.schema = await client.schema({
            ...(schema === undefined ? {} : { schema }),
            ...(table === undefined ? {} : { table }),
          });
        }
        return success(data);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "pocketdb_query",
    {
      title: "Run a PocketDB SQL query",
      description:
        "Execute SQL through the invitation-authorized PocketDB client.",
      inputSchema: z.object({
        connectionId: z.string().uuid(),
        sql: z.string().min(1),
      }),
      outputSchema: resultSchema,
    },
    async ({ connectionId, sql }) => {
      const connection = connections.get(connectionId);
      if (!connection)
        return failureCode("connection-not-found", "Connection not found.");
      if (connection.client.engineId === "kv")
        return failureCode(
          "unsupported-engine",
          "This connection does not support SQL.",
        );
      try {
        return success(await connection.client.query(sql));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "pocketdb_key_value",
    {
      title: "Run a PocketDB key-value operation",
      description:
        "Run PING, GET, SET, or DEL through the authorized PocketDB client.",
      inputSchema: z.object({
        connectionId: z.string().uuid(),
        command: z.enum(["PING", "GET", "SET", "DEL"]),
        key: z.string().optional(),
        value: z.string().optional(),
      }),
      outputSchema: resultSchema,
    },
    async (input) => {
      const connection = connections.get(input.connectionId);
      if (!connection)
        return failureCode("connection-not-found", "Connection not found.");
      if (connection.client.engineId !== "kv")
        return failureCode(
          "unsupported-engine",
          "This connection does not support key-value operations.",
        );
      try {
        switch (input.command) {
          case "PING":
            return success(await connection.client.kv.ping());
          case "GET": {
            if (input.key === undefined)
              return failureCode("invalid-input", "GET requires a key.");
            const value = await connection.client.kv.get(input.key);
            return success(
              value === null
                ? null
                : { base64: Buffer.from(value).toString("base64") },
            );
          }
          case "SET": {
            if (input.key === undefined || input.value === undefined)
              return failureCode(
                "invalid-input",
                "SET requires a key and value.",
              );
            return success(
              await connection.client.kv.set(input.key, input.value),
            );
          }
          case "DEL": {
            if (input.key === undefined)
              return failureCode("invalid-input", "DEL requires a key.");
            return success(await connection.client.kv.delete([input.key]));
          }
        }
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "pocketdb_export_query_csv",
    {
      title: "Export a PocketDB query as CSV",
      description:
        "Export a bounded SELECT result. Requires a read-only invitation.",
      inputSchema: z.object({
        connectionId: z.string().uuid(),
        sql: z.string().min(1),
        maxRows: z.number().int().min(1).max(10_000).default(1_000),
      }),
      outputSchema: resultSchema,
    },
    async ({ connectionId, sql, maxRows }) => {
      const connection = connections.get(connectionId);
      if (!connection)
        return failureCode("connection-not-found", "Connection not found.");
      if (connection.client.engineId === "kv")
        return failureCode(
          "unsupported-engine",
          "CSV export requires a SQL connection.",
        );
      if (connection.client.access !== "read-only")
        return failureCode(
          "read-only-required",
          "CSV export requires a read-only invitation.",
        );
      if (!/^\s*SELECT\b/i.test(sql) || /;|\bLIMIT\b/i.test(sql))
        return failureCode(
          "invalid-export-query",
          "CSV export accepts one SELECT statement without a LIMIT clause.",
        );
      try {
        const description = await connection.client.describeQuery(sql);
        const result = (await connection.client.query(
          `${sql.trim()} LIMIT ${maxRows + 1}`,
        )) as { rows?: Record<string, unknown>[] } | null;
        if (!result || !Array.isArray(result.rows))
          return failureCode(
            "invalid-query-result",
            "The SQL engine returned an unsupported result shape.",
          );
        const rows = result.rows;
        const truncated = rows.length > maxRows;
        const bounded = rows.slice(0, maxRows);
        const columns = description.fields.map((field) => field.name);
        const csv = [
          columns,
          ...bounded.map((row) => columns.map((column) => row[column])),
        ]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n");
        return success({ csv, rowCount: bounded.length, truncated });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "pocketdb_disconnect",
    {
      title: "Disconnect from PocketDB",
      description: "Close and remove an active PocketDB connection.",
      inputSchema: z.object({ connectionId: z.string().uuid() }),
      outputSchema: resultSchema,
    },
    async ({ connectionId }) => {
      const connection = connections.get(connectionId);
      if (!connection)
        return failureCode("connection-not-found", "Connection not found.");
      connections.delete(connectionId);
      try {
        await connection.close();
        return success({ disconnected: true });
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

function success(data: unknown) {
  const structuredContent = { ok: true, data };
  return {
    structuredContent,
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
  };
}

function failure(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown };
  const code =
    typeof candidate?.code === "string" ? candidate.code : "operation-failed";
  const message = redact(
    typeof candidate?.message === "string"
      ? candidate.message
      : "PocketDB operation failed.",
  );
  const structuredContent = { ok: false, error: { code, message } };
  return {
    isError: true,
    structuredContent,
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
  };
}

function failureCode(code: string, message: string) {
  const structuredContent = { ok: false, error: { code, message } };
  return {
    isError: true,
    structuredContent,
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
  };
}

function redact(message: string) {
  return message
    .replace(/pocketdb:\/\/[^\s"']+/gi, "[redacted invitation]")
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted endpoint]");
}

function csvCell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
