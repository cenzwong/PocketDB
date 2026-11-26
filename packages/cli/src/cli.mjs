import { readFile } from "node:fs/promises";
import { connectNode } from "@pocketdb/node-client";
import { createPostgresBridge } from "./postgres-bridge.mjs";
import { createRespBridge } from "./resp-bridge.mjs";

const COMMANDS = new Set(["connect", "query", "ping", "inspect", "export"]);
const DEFAULT_CONNECT_TIMEOUT_MS = 120_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_EXPORT_MAX_ROWS = 1_000;

export async function main(argv, io = process, dependencies = {}) {
  let parsed;
  try {
    parsed = parseArguments(argv);
    if (parsed.help) {
      io.stdout.write(`${helpText()}\n`);
      return 0;
    }
    const invitation = await readInvitation(
      parsed,
      io.stdin,
      dependencies.env ?? process.env,
    );
    parsed.invitation = invitation;
    if (parsed.bridgePort !== undefined) {
      return await runBridge(parsed, invitation, io, dependencies);
    }
    const result = jsonSafe(await execute(parsed, invitation, dependencies));
    if (parsed.format === "json") {
      io.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      io.stdout.write(`${formatHuman(parsed.command, result)}\n`);
    }
    return 0;
  } catch (error) {
    const safe = errorForOutput(error, parsed?.invitation);
    const jsonErrors =
      parsed?.format === "json" ||
      (Array.isArray(argv) &&
        argv.includes("--json") &&
        !argv.includes("--human"));
    if (jsonErrors) {
      io.stderr.write(
        `${JSON.stringify({ error: safe.code, message: safe.message })}\n`,
      );
    } else {
      io.stderr.write(`pocketdb: ${safe.message}\n`);
    }
    return exitCode(safe.code);
  }
}

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.some((item) => typeof item !== "string")) {
    throw cliError("usage", "Arguments must be strings.");
  }
  const args = [...argv];
  const formatIndex = args.indexOf("--json");
  const humanIndex = args.indexOf("--human");
  if (formatIndex !== -1 && humanIndex !== -1) {
    throw cliError("usage", "Choose either --json or --human.");
  }
  const format = formatIndex !== -1 ? "json" : "human";
  if (formatIndex !== -1) args.splice(formatIndex, 1);
  if (humanIndex !== -1) args.splice(args.indexOf("--human"), 1);
  if (args.includes("--help") || args.length === 0) {
    return { help: true, format };
  }
  const command = args.shift();
  if (command === "-h" || command === "--help") return { help: true, format };
  if (!COMMANDS.has(command)) {
    throw cliError("usage", `Unknown command '${command}'.`);
  }

  const options = {
    command,
    format,
    uriEnv: undefined,
    uriStdin: false,
    positionalUri: undefined,
    sql: undefined,
    params: [],
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
    maxRows: DEFAULT_EXPORT_MAX_ROWS,
    bridgePort: undefined,
    bridgeHost: "127.0.0.1",
    allowRemoteBind: false,
    bridgeProtocol: "postgresql",
    protocolSpecified: false,
  };
  const positional = [];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--uri-env") options.uriEnv = readOptionValue(arg, args);
    else if (arg === "--uri-stdin") options.uriStdin = true;
    else if (arg === "--query") options.sql = readOptionValue(arg, args);
    else if (arg === "--params")
      options.params = parseParams(readOptionValue(arg, args));
    else if (arg === "--timeout-ms")
      options.requestTimeoutMs = parseTimeout(arg, readOptionValue(arg, args));
    else if (arg === "--connect-timeout-ms")
      options.connectTimeoutMs = parseTimeout(arg, readOptionValue(arg, args));
    else if (arg === "--max-rows")
      options.maxRows = parseBoundedInteger(
        arg,
        readOptionValue(arg, args),
        1,
        100_000,
      );
    else if (arg === "--port")
      options.bridgePort = parseBoundedInteger(
        arg,
        readOptionValue(arg, args),
        0,
        65_535,
      );
    else if (arg === "--host") options.bridgeHost = readOptionValue(arg, args);
    else if (arg === "--allow-remote-bind") options.allowRemoteBind = true;
    else if (arg === "--protocol") {
      options.bridgeProtocol = readOptionValue(arg, args);
      options.protocolSpecified = true;
      if (!["postgresql", "resp"].includes(options.bridgeProtocol)) {
        throw cliError("usage", "--protocol must be postgresql or resp.");
      }
    } else if (arg.startsWith("-"))
      throw cliError("usage", `Unknown option '${arg}'.`);
    else positional.push(arg);
  }
  if (options.uriEnv && options.uriStdin) {
    throw cliError("usage", "Use only one of --uri-env and --uri-stdin.");
  }
  if (
    options.command !== "connect" &&
    (options.bridgePort !== undefined ||
      options.bridgeHost !== "127.0.0.1" ||
      options.allowRemoteBind ||
      options.protocolSpecified)
  ) {
    throw cliError("usage", "Bridge options are only valid for connect.");
  }
  if (
    options.bridgePort === undefined &&
    (options.bridgeHost !== "127.0.0.1" ||
      options.allowRemoteBind ||
      options.protocolSpecified)
  ) {
    throw cliError(
      "usage",
      "--host, --allow-remote-bind, and --protocol require --port.",
    );
  }
  if (
    options.bridgePort !== undefined &&
    !["127.0.0.1", "::1", "localhost"].includes(options.bridgeHost) &&
    !options.allowRemoteBind
  ) {
    throw cliError(
      "configuration",
      "Non-loopback bind requires --allow-remote-bind.",
    );
  }
  const allowedPositionals = options.command === "query" ? 2 : 1;
  if (positional.length > allowedPositionals)
    throw cliError("usage", "Too many positional arguments.");
  options.positionalUri = positional[0];
  if (options.positionalUri && (options.uriEnv || options.uriStdin)) {
    throw cliError(
      "usage",
      "Use one invitation source: URI argument, --uri-env, or --uri-stdin.",
    );
  }
  if (options.command === "query" && !options.sql) {
    options.sql = positional[1];
    if (!options.sql)
      throw cliError(
        "usage",
        "query requires SQL text as a positional argument or --query.",
      );
  }
  if (options.command === "export" && !options.sql) {
    throw cliError(
      "usage",
      "export requires an explicit read query with --query.",
    );
  }
  if (
    options.command !== "query" &&
    options.command !== "export" &&
    options.sql
  ) {
    throw cliError("usage", `--query is not valid for ${options.command}.`);
  }
  if (
    options.command !== "query" &&
    options.command !== "export" &&
    options.params.length > 0
  ) {
    throw cliError("usage", `--params is not valid for ${options.command}.`);
  }
  if (
    options.command !== "export" &&
    options.maxRows !== DEFAULT_EXPORT_MAX_ROWS
  ) {
    throw cliError("usage", "--max-rows is only valid for export.");
  }
  return options;
}

async function runBridge(options, invitation, io, dependencies) {
  const env = dependencies.env ?? process.env;
  const connect = dependencies.connect ?? connectNode;
  const endpoint = env.POCKETDB_SIGNALING_ENDPOINT;
  if (!endpoint)
    throw cliError(
      "configuration",
      "Set POCKETDB_SIGNALING_ENDPOINT before connecting.",
    );
  const connection = await connect(invitation, {
    signalingEndpoint: endpoint,
    iceConfig: configuredIce(env),
    connectTimeoutMs: options.connectTimeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
  });
  let bridge;
  try {
    const createBridge =
      dependencies.createBridge ??
      (options.bridgeProtocol === "resp"
        ? createRespBridge
        : createPostgresBridge);
    try {
      bridge = await createBridge(connection.client, {
        host: options.bridgeHost,
        port: options.bridgePort,
        allowRemoteBind: options.allowRemoteBind,
      });
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        throw cliError(
          "bridge-port-in-use",
          "Requested local bridge port is already in use.",
        );
      }
      if (error?.code === "EACCES") {
        throw cliError(
          "bridge-bind-failed",
          "Permission denied while binding the local bridge.",
        );
      }
      throw error;
    }
    const summary = {
      listening: true,
      host: bridge.host,
      port: bridge.port,
      protocol: options.bridgeProtocol,
      engine: connection.client.engineId,
    };
    io.stdout.write(
      `${options.format === "json" ? JSON.stringify(summary) : `${options.bridgeProtocol === "resp" ? "RESP2 Redis" : "PostgreSQL"} bridge listening on ${bridge.host}:${bridge.port}.`}\n`,
    );
    const shutdownWaiter = dependencies.waitForShutdown
      ? { promise: dependencies.waitForShutdown(), dispose() {} }
      : processShutdownWaiter(io);
    const outcome = await Promise.race([
      shutdownWaiter.promise.then(() => "signal"),
      bridge.disconnected?.then(() => "remote-disconnect") ??
        new Promise(() => {}),
    ]);
    shutdownWaiter.dispose();
    if (outcome === "remote-disconnect") {
      const failure = {
        error: "host-disconnected",
        message: "Browser host disconnected; local bridge closed.",
      };
      io.stderr.write(
        `${options.format === "json" ? JSON.stringify(failure) : `pocketdb: ${failure.message}`}\n`,
      );
      return 4;
    }
    return 0;
  } finally {
    await bridge?.close();
    await connection.close();
  }
}

async function execute(options, invitation, dependencies) {
  const env = dependencies.env ?? process.env;
  const connect = dependencies.connect ?? connectNode;
  const signalingEndpoint = env.POCKETDB_SIGNALING_ENDPOINT;
  if (!signalingEndpoint) {
    throw cliError(
      "configuration",
      "Set POCKETDB_SIGNALING_ENDPOINT before connecting.",
    );
  }
  const iceConfig = configuredIce(env);
  const connection = await connect(invitation, {
    signalingEndpoint,
    iceConfig,
    connectTimeoutMs: options.connectTimeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
  });
  const client = connection.client;
  try {
    const summary = {
      engine: client.engineId,
      access: client.access,
      peerId: client.peerId,
      sessionId: client.sessionId,
      capabilities: client.capabilities,
    };
    switch (options.command) {
      case "connect":
        return { connected: true, ...summary };
      case "ping": {
        const response =
          client.engineId === "kv"
            ? await client.kv.ping({ timeoutMs: options.requestTimeoutMs })
            : await (client.capabilities.operations.includes("schema")
                ? client.schema({ timeoutMs: options.requestTimeoutMs })
                : client.query("SELECT 1", [], {
                    timeoutMs: options.requestTimeoutMs,
                  })
              ).then(() => "PONG");
        return {
          ...summary,
          response,
          ...(client.engineId === "kv"
            ? {}
            : {
                probe: client.capabilities.operations.includes("schema")
                  ? "schema"
                  : "query",
              }),
        };
      }
      case "inspect": {
        const schema =
          client.engineId === "kv" ||
          !client.capabilities.operations.includes("schema")
            ? undefined
            : await client.schema({ timeoutMs: options.requestTimeoutMs });
        return { ...summary, ...(schema ? { schema } : {}) };
      }
      case "query": {
        if (client.engineId === "kv")
          throw cliError(
            "unsupported-operation",
            "query requires a SQL engine invitation.",
          );
        const result = await client.query(options.sql, options.params, {
          timeoutMs: options.requestTimeoutMs,
        });
        return { ...summary, result };
      }
      case "export": {
        if (client.engineId === "kv")
          throw cliError(
            "unsupported-operation",
            "export requires a SQL engine invitation and an explicit read query.",
          );
        if (client.access !== "read-only") {
          throw cliError(
            "permission-denied",
            "export requires a read-only invitation.",
          );
        }
        const sql = wrapBoundedReadQuery(options.sql, options.maxRows);
        const result = await client.query(sql, options.params, {
          timeoutMs: options.requestTimeoutMs,
        });
        const rows = result.rows;
        if (!Array.isArray(rows))
          throw cliError(
            "invalid-response",
            "The host returned an invalid export result.",
          );
        const truncated = rows.length > options.maxRows;
        const boundedRows = rows.slice(0, options.maxRows);
        return {
          format: "jsonl",
          rowCount: boundedRows.length,
          truncated,
          data: boundedRows
            .map((row) => JSON.stringify(jsonSafe(row)))
            .join("\n"),
        };
      }
      default:
        throw cliError("usage", `Unsupported command '${options.command}'.`);
    }
  } finally {
    await connection.close();
  }
}

function wrapBoundedReadQuery(sql, maxRows) {
  const clean = sql.trim().replace(/;+\s*$/, "");
  if (
    !/^select\b/i.test(clean) ||
    clean.includes(";") ||
    /\blimit\b/i.test(clean)
  ) {
    throw cliError(
      "usage",
      "export accepts one SELECT query without an existing LIMIT or embedded semicolons.",
    );
  }
  return `${clean} LIMIT ${maxRows + 1}`;
}

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) {
    return { $type: "bytes", base64: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
}

function configuredIce(env) {
  const host = env.POCKETDB_ICE_STUN_HOST;
  const rawPort = env.POCKETDB_ICE_STUN_PORT;
  if (!host && !rawPort) return {};
  const port = Number(rawPort ?? "3478");
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw cliError(
      "configuration",
      "Set a valid POCKETDB_ICE_STUN_HOST and optional port.",
    );
  }
  return { iceServers: [{ urls: `stun:${host}:${port}` }] };
}

async function readInvitation(options, stdin, env) {
  let value;
  if (options.uriEnv) value = env[options.uriEnv];
  else if (options.uriStdin) value = await readFile(stdin.fd ?? 0, "utf8");
  else value = options.positionalUri;
  value = typeof value === "string" ? value.trim() : "";
  if (!value)
    throw cliError(
      "usage",
      "Provide an invitation URI, --uri-env NAME, or --uri-stdin.",
    );
  return value;
}

function readOptionValue(option, args) {
  const value = args.shift();
  if (!value || value.startsWith("--"))
    throw cliError("usage", `${option} requires a value.`);
  return value;
}

function parseParams(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw cliError("usage", "--params must be a JSON array.");
  }
  if (!Array.isArray(parsed))
    throw cliError("usage", "--params must be a JSON array.");
  return parsed;
}

function parseTimeout(option, value) {
  return parseBoundedInteger(option, value, 1, 600_000);
}

function parseBoundedInteger(option, value, min, max) {
  if (!/^\d+$/.test(value))
    throw cliError(
      "usage",
      `${option} must be an integer from ${min} to ${max}.`,
    );
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw cliError(
      "usage",
      `${option} must be an integer from ${min} to ${max}.`,
    );
  }
  return parsed;
}

function errorForOutput(error, invitation) {
  const rawCode =
    typeof error?.code === "string" ? error.code : "internal-error";
  const code = rawCode.replace(/[^a-z0-9-]/gi, "-").slice(0, 64);
  let message =
    typeof error?.message === "string" ? error.message : "The command failed.";
  if (invitation)
    message = message.replaceAll(invitation, "[REDACTED INVITATION]");
  message = message.replace(/pocketdb:\/\/[^\s"']+/gi, "[REDACTED INVITATION]");
  return { code, message };
}

function exitCode(code) {
  if (["usage", "configuration"].includes(code)) return 2;
  if (["bridge-port-in-use", "bridge-bind-failed"].includes(code)) return 2;
  if (["permission-denied", "unauthorized", "forbidden"].includes(code))
    return 3;
  if (
    [
      "connect-timeout",
      "request-timeout",
      "host-disconnected",
      "transport-failed",
    ].includes(code)
  )
    return 4;
  if (
    [
      "query-failed",
      "engine-error",
      "unsupported-operation",
      "row-limit-exceeded",
    ].includes(code)
  )
    return 5;
  return 1;
}

function processShutdownWaiter(io) {
  let onSignal;
  const promise = new Promise((resolve) => {
    onSignal = () => resolve();
    io.once("SIGINT", onSignal);
    io.once("SIGTERM", onSignal);
  });
  return {
    promise,
    dispose() {
      io.removeListener("SIGINT", onSignal);
      io.removeListener("SIGTERM", onSignal);
    },
  };
}

function formatHuman(command, result) {
  if (command === "connect")
    return `Connected to ${result.engine} (${result.access}).`;
  if (command === "ping")
    return `Ping succeeded: ${JSON.stringify(result.response)}`;
  if (command === "export") return result.data;
  return JSON.stringify(result, null, 2);
}

function cliError(code, message) {
  return Object.assign(new Error(message), { code });
}

function helpText() {
  return [
    "Usage: pocketdb <connect|query|ping|inspect|export> [invitation] [options]",
    "Invitation input: positional URI, --uri-env NAME, or --uri-stdin.",
    "Options: --json | --human, --timeout-ms N, --connect-timeout-ms N, --params JSON.",
    "Export: pocketdb export [invitation] --query SQL [--params JSON] [--max-rows N]",
    "Bridge: pocketdb connect [invitation] --port N [--host 127.0.0.1] [--allow-remote-bind]",
    "Redis: pocketdb connect [invitation] --protocol resp --port 6379",
    "The PostgreSQL bridge supports text-format simple and parameterized queries, one driver connection per invitation, and explicit transactions.",
    "Set POCKETDB_SIGNALING_ENDPOINT; optionally set POCKETDB_ICE_STUN_HOST and POCKETDB_ICE_STUN_PORT.",
  ].join("\n");
}
