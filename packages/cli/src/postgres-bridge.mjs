import { createServer } from "node:net";

const MAX_PACKET_BYTES = 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const OID_SIZES = new Map([
  [16, 1],
  [20, 8],
  [21, 2],
  [23, 4],
  [26, 4],
  [700, 4],
  [701, 8],
]);

/**
 * A deliberately small PostgreSQL v3 frontend backed by the shared PocketDB
 * client. One bridge owns one authenticated invitation and one driver socket.
 */
export async function createPostgresBridge(
  client,
  { host = "127.0.0.1", port = 5432, allowRemoteBind = false } = {},
) {
  if (!LOOPBACK.has(host) && !allowRemoteBind) {
    throw bridgeError(
      "configuration",
      "Non-loopback bind requires --allow-remote-bind.",
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw bridgeError(
      "configuration",
      "Port must be an integer from 0 to 65535.",
    );
  }
  if (client.engineId === "kv") {
    throw bridgeError(
      "unsupported-operation",
      "PostgreSQL bridge requires a SQL engine invitation.",
    );
  }

  let activeSocket;
  let activeCleanup = Promise.resolve();
  let stopped = false;
  let closePromise;
  let resolveDisconnected;
  let unsubscribe;
  const disconnected = new Promise((resolve) => {
    resolveDisconnected = resolve;
  });
  const server = createServer((socket) => {
    socket.on("error", () => socket.destroy());
    if (activeSocket || stopped) {
      socket.end(
        errorResponse(
          "53300",
          "This invitation already has a local driver connection.",
        ),
      );
      return;
    }
    activeSocket = socket;
    activeCleanup = handleSocket(socket, client)
      .catch(() => socket.destroy())
      .finally(() => {
        activeSocket = undefined;
      });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const close = ({ hostUnavailable = false } = {}) => {
    if (closePromise) return closePromise;
    stopped = true;
    if (activeSocket && !activeSocket.destroyed) {
      if (hostUnavailable) {
        activeSocket.end(
          errorResponse("08006", "The browser host is unavailable."),
        );
      } else {
        activeSocket.destroy();
      }
    }
    closePromise = (async () => {
      await activeCleanup;
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      unsubscribe?.();
    })();
    return closePromise;
  };
  unsubscribe = client.onStateChange?.(({ state }) => {
    if (state === "failed") {
      void close({ hostUnavailable: true }).then(resolveDisconnected);
    }
  });
  return {
    host,
    port: typeof address === "object" && address ? address.port : port,
    disconnected,
    close: () => close(),
  };
}

async function handleSocket(socket, client) {
  let incoming = Buffer.alloc(0);
  let started = false;
  let transaction = "I";
  let extendedFailed = false;
  const statements = new Map();
  const portals = new Map();
  let chain = Promise.resolve();
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  socket.on("data", (chunk) => {
    incoming = Buffer.concat([incoming, chunk]);
    if (incoming.length > MAX_PACKET_BYTES * 2) return socket.destroy();
    try {
      while (incoming.length >= 4) {
        if (!started) {
          const length = incoming.readInt32BE(0);
          if (length < 8 || length > MAX_PACKET_BYTES) return socket.destroy();
          if (incoming.length < length) break;
          const packet = incoming.subarray(0, length);
          incoming = incoming.subarray(length);
          if (length === 8 && packet.readInt32BE(4) === 80_877_103) {
            socket.write(Buffer.from("N"));
            continue;
          }
          if (length < 9 || packet.readInt32BE(4) !== 196_608) {
            socket.write(
              errorResponse(
                "0A000",
                "Only PostgreSQL protocol version 3.0 is supported.",
              ),
            );
            socket.end();
            return;
          }
          started = true;
          socket.write(startupResponse());
          continue;
        }
        if (incoming.length < 5) break;
        const length = incoming.readInt32BE(1);
        if (length < 4 || length > MAX_PACKET_BYTES) return socket.destroy();
        if (incoming.length < length + 1) break;
        const type = String.fromCharCode(incoming[0]);
        const body = incoming.subarray(5, length + 1);
        incoming = incoming.subarray(length + 1);
        chain = chain.then(() =>
          processMessage(
            type,
            body,
            socket,
            client,
            statements,
            portals,
            (state) => {
              transaction = state;
            },
            () => transaction,
            () => {
              extendedFailed = true;
            },
            () => extendedFailed,
            () => {
              extendedFailed = false;
            },
          ),
        );
        chain.catch(() => socket.destroy());
      }
    } catch {
      socket.destroy();
    }
  });
  socket.once("close", async () => {
    await chain.catch(() => undefined);
    try {
      if (transaction !== "I") await client.query("ROLLBACK");
    } catch {
      /* The connection may already have been revoked by the host. */
    }
    resolveClosed();
  });
  return closed;
}

async function processMessage(
  type,
  body,
  socket,
  client,
  statements,
  portals,
  setTransaction,
  getTransaction,
  markExtendedError,
  isExtendedFailed,
  clearExtendedError,
) {
  if (socket.destroyed) return;
  if (isExtendedFailed()) {
    if (type === "S") {
      clearExtendedError();
      socket.write(ready(getTransaction()));
    }
    return;
  }
  switch (type) {
    case "Q": {
      const sql = cstring(body, 0).value;
      await runQuery(sql, [], client, socket, setTransaction, getTransaction);
      socket.write(ready(getTransaction()));
      return;
    }
    case "P": {
      const name = cstring(body, 0);
      const query = cstring(body, name.next);
      let offset = query.next;
      const count = body.readInt16BE(offset);
      offset += 2;
      const oids = [];
      for (let i = 0; i < count; i++, offset += 4)
        oids.push(body.readUInt32BE(offset));
      statements.set(name.value, { sql: query.value, oids });
      socket.write(message("1"));
      return;
    }
    case "B": {
      const portal = cstring(body, 0);
      const statement = cstring(body, portal.next);
      const parsed = statements.get(statement.value);
      if (!parsed)
        return fail(
          socket,
          "26000",
          "Prepared statement does not exist.",
          markExtendedError,
        );
      let offset = statement.next;
      const formats = readInt16Array(body, offset);
      offset += 2 + formats.length * 2;
      const count = body.readInt16BE(offset);
      offset += 2;
      const rawParams = [];
      for (let i = 0; i < count; i++) {
        const size = body.readInt32BE(offset);
        offset += 4;
        if (size === -1) rawParams.push(null);
        else {
          rawParams.push(body.subarray(offset, offset + size));
          offset += size;
        }
      }
      const resultFormats = readInt16Array(body, offset);
      if (
        formats.some((format) => format !== 0) ||
        resultFormats.some((format) => format !== 0)
      ) {
        return fail(
          socket,
          "0A000",
          "Binary parameter and result formats are unsupported.",
          markExtendedError,
        );
      }
      const params = rawParams.map((value, index) =>
        decodeParameter(value, parsed.oids[index] ?? 0),
      );
      portals.set(portal.value, { statement: parsed, params });
      socket.write(message("2"));
      return;
    }
    case "D": {
      const target = String.fromCharCode(body[0]);
      const name = cstring(body, 1).value;
      if (target === "S") {
        const statement = statements.get(name);
        if (!statement)
          return fail(
            socket,
            "26000",
            "Prepared statement does not exist.",
            markExtendedError,
          );
        await describe(statement, client, socket, markExtendedError, true);
      } else if (target === "P") {
        const portal = portals.get(name);
        if (!portal)
          return fail(
            socket,
            "34000",
            "Portal does not exist.",
            markExtendedError,
          );
        await describe(portal.statement, client, socket, markExtendedError);
      } else
        return fail(
          socket,
          "0A000",
          "Only statement and portal descriptions are supported.",
          markExtendedError,
        );
      return;
    }
    case "E": {
      const portal = cstring(body, 0);
      const data = portals.get(portal.value);
      if (!data)
        return fail(
          socket,
          "34000",
          "Portal does not exist.",
          markExtendedError,
        );
      const result = await runQuery(
        data.statement.sql,
        data.params,
        client,
        socket,
        setTransaction,
        getTransaction,
        false,
      );
      if (!result) {
        markExtendedError();
        return;
      }
      if (result && Array.isArray(result.rows) && result.fields?.length) {
        for (const row of result.rows)
          socket.write(dataRow(row, result.fields));
      }
      const maxRows = body.readInt32BE(portal.next);
      if (maxRows > 0 && result?.rows?.length > maxRows)
        return fail(
          socket,
          "0A000",
          "Portal row limits are unsupported.",
          markExtendedError,
        );
      socket.write(
        commandComplete(
          result?.command,
          result?.affectedRows,
          result?.rows?.length,
          data.statement.sql,
        ),
      );
      return;
    }
    case "S":
      socket.write(ready(getTransaction()));
      return;
    case "C": {
      const target = String.fromCharCode(body[0]);
      const name = cstring(body, 1).value;
      (target === "S" ? statements : portals).delete(name);
      socket.write(message(target === "S" ? "3" : "3"));
      return;
    }
    case "H":
      return;
    case "X":
      socket.end();
      return;
    default:
      return fail(
        socket,
        "0A000",
        `PostgreSQL message ${type} is unsupported.`,
        markExtendedError,
      );
  }
}

async function describe(
  statement,
  client,
  socket,
  markExtendedError,
  includeParameters = false,
) {
  try {
    const description = await client.describeQuery(statement.sql);
    if (includeParameters)
      socket.write(parameterDescription(description.parameters));
    socket.write(
      description.fields.length
        ? rowDescription(description.fields)
        : message("n"),
    );
  } catch (error) {
    markExtendedError();
    socket.write(
      errorResponse(
        sqlState(error),
        error.message ?? "Query description failed.",
      ),
    );
  }
}

async function runQuery(
  sql,
  params,
  client,
  socket,
  setTransaction,
  getTransaction,
  simpleQuery = true,
) {
  try {
    if (getTransaction() === "E" && !/^\s*(rollback|commit)\b/i.test(sql)) {
      throw Object.assign(
        new Error("Current transaction is aborted; rollback is required."),
        { code: "25P02" },
      );
    }
    const result = await client.query(sql, params, { rowMode: "array" });
    if (result.command === "BEGIN" || /^\s*begin\b/i.test(sql))
      setTransaction("T");
    else if (/^\s*(commit|rollback)\b/i.test(sql)) setTransaction("I");
    if (simpleQuery && Array.isArray(result.rows)) {
      const fields = result.fields ?? [];
      if (fields.length) {
        socket.write(rowDescription(fields));
        for (const row of result.rows) socket.write(dataRow(row, fields));
      }
      socket.write(
        commandComplete(
          result.command,
          result.affectedRows,
          result.rows?.length,
          sql,
        ),
      );
    }
    return result;
  } catch (error) {
    if (getTransaction() !== "I") setTransaction("E");
    socket.write(
      errorResponse(sqlState(error), error.message ?? "Query failed."),
    );
    return undefined;
  }
}

function startupResponse() {
  return Buffer.concat([
    message("R", int32(0)),
    message("S", cstringBuffer("server_version", "16.0")),
    message("S", cstringBuffer("client_encoding", "UTF8")),
    message("S", cstringBuffer("DateStyle", "ISO, MDY")),
    message("S", cstringBuffer("integer_datetimes", "on")),
    message("K", Buffer.concat([int32(0), int32(1)])),
    ready("I"),
  ]);
}

function rowDescription(fields) {
  const items = [int16(fields.length)];
  for (const field of fields)
    items.push(
      Buffer.concat([
        cstringBuffer(field.name),
        int32(0),
        int16(0),
        int32(field.dataTypeID ?? 25),
        int16(OID_SIZES.get(field.dataTypeID) ?? -1),
        int32(-1),
        int16(0),
      ]),
    );
  return message("T", Buffer.concat(items));
}
function parameterDescription(parameters) {
  return message(
    "t",
    Buffer.concat([
      int16(parameters.length),
      ...parameters.map((p) => int32(p.dataTypeID ?? 0)),
    ]),
  );
}
function dataRow(row, fields) {
  const values = Array.isArray(row)
    ? row
    : fields.map((field) => row?.[field.name]);
  return message(
    "D",
    Buffer.concat([
      int16(values.length),
      ...values.map((value, index) => {
        if (value === null || value === undefined) return int32(-1);
        const oid = fields[index]?.dataTypeID;
        const text =
          oid === 114 || oid === 3802
            ? JSON.stringify(value)
            : value instanceof Uint8Array
              ? `\\x${Buffer.from(value).toString("hex")}`
              : String(value);
        const bytes = Buffer.from(text, "utf8");
        return Buffer.concat([int32(bytes.length), bytes]);
      }),
    ]),
  );
}
function commandComplete(command, affectedRows, rowCount, sql) {
  const tag =
    command ||
    /^\s*(select|with|show|values)\b/i.exec(sql)?.[1]?.toUpperCase() ||
    "OK";
  const count = Number.isInteger(affectedRows) ? affectedRows : 0;
  const suffix =
    tag === "INSERT"
      ? ` 0 ${count}`
      : tag === "SELECT"
        ? ` ${rowCount ?? 0}`
        : count > 0
          ? ` ${count}`
          : "";
  return message("C", cstringBuffer(`${tag}${suffix}`));
}
function ready(status) {
  return message("Z", Buffer.from(status));
}
function errorResponse(code, text) {
  return message(
    "E",
    Buffer.concat([
      Buffer.from("S"),
      cstringBuffer("ERROR"),
      Buffer.from("V"),
      cstringBuffer("ERROR"),
      Buffer.from("C"),
      cstringBuffer(code),
      Buffer.from("M"),
      cstringBuffer(text),
      Buffer.from([0]),
    ]),
  );
}
function sqlState(error) {
  if (/^[0-9A-Z]{5}$/.test(error?.code ?? "")) return error.code;
  if (error?.code === "postgres-session-busy") return "55006";
  if (["permission-denied", "forbidden"].includes(error?.code)) return "42501";
  if (
    ["unsupported-operation", "postgres-unsupported-operation"].includes(
      error?.code,
    )
  )
    return "0A000";
  if (["invalid-query", "query-failed"].includes(error?.code)) return "42601";
  return "XX000";
}
function fail(socket, code, text, markExtendedError) {
  markExtendedError();
  socket.write(errorResponse(code, text));
}
function message(type, body = Buffer.alloc(0)) {
  const length = Buffer.alloc(4);
  length.writeInt32BE(body.length + 4);
  return Buffer.concat([Buffer.from(type), length, body]);
}
function int16(value) {
  const out = Buffer.alloc(2);
  out.writeInt16BE(value);
  return out;
}
function int32(value) {
  const out = Buffer.alloc(4);
  out.writeInt32BE(value);
  return out;
}
function cstringBuffer(...parts) {
  return Buffer.concat(
    parts.flatMap((part) => [
      Buffer.from(String(part), "utf8"),
      Buffer.from([0]),
    ]),
  );
}
function cstring(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  if (end < 0) throw new Error("Malformed PostgreSQL string.");
  return { value: buffer.toString("utf8", offset, end), next: end + 1 };
}
function readInt16Array(buffer, offset) {
  const count = buffer.readInt16BE(offset);
  const values = [];
  for (let i = 0; i < count; i++)
    values.push(buffer.readInt16BE(offset + 2 + i * 2));
  return values;
}
function decodeParameter(bytes, oid) {
  if (bytes === null) return null;
  const value = bytes.toString("utf8");
  if (oid === 20) return BigInt(value);
  if ([21, 23, 26].includes(oid)) return Number(value);
  if ([700, 701].includes(oid)) return Number(value);
  if (oid === 1700) return value;
  if (oid === 16) return value === "t" || value === "true";
  if (oid === 17)
    return Uint8Array.from(Buffer.from(value.replace(/^\\x/, ""), "hex"));
  return value;
}
function bridgeError(code, message) {
  return Object.assign(new Error(message), { code });
}
