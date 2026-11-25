import { createServer } from "node:net";

const MAX_FRAME_BYTES = 8 * 1024;
const MAX_FIELD_BYTES = 4 * 1024;
const MAX_ARGUMENTS = 8;
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** RESP2 translation backed exclusively by the authenticated PocketDB KV client. */
export async function createRespBridge(
  client,
  { host = "127.0.0.1", port = 6379, allowRemoteBind = false } = {},
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
  if (client.engineId !== "kv") {
    throw bridgeError(
      "unsupported-operation",
      "RESP bridge requires a key-value invitation.",
    );
  }

  let activeSocket;
  let stopped = false;
  let cleanup = Promise.resolve();
  let resolveDisconnected;
  const disconnected = new Promise((resolve) => {
    resolveDisconnected = resolve;
  });
  const server = createServer((socket) => {
    socket.on("error", () => socket.destroy());
    if (activeSocket || stopped) {
      socket.end(error("ERR this invitation already has a local Redis client"));
      return;
    }
    activeSocket = socket;
    cleanup = handleClient(socket, client).catch(() => socket.destroy());
    socket.once("close", () => {
      if (activeSocket === socket) activeSocket = undefined;
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
  let closePromise;
  const close = (reason = "ERR bridge closed") => {
    if (closePromise) return closePromise;
    stopped = true;
    closePromise = (async () => {
      if (activeSocket && !activeSocket.destroyed)
        activeSocket.end(error(reason));
      await cleanup;
      await new Promise((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve())),
      );
      unsubscribe?.();
    })();
    return closePromise;
  };
  const unsubscribe = client.onStateChange?.(({ state }) => {
    if (state === "failed") {
      void close("ERR browser host unavailable").then(resolveDisconnected);
    }
  });
  return {
    host,
    port: typeof address === "object" && address ? address.port : port,
    disconnected,
    close: () => close(),
  };
}

async function handleClient(socket, client) {
  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();
  socket.on("data", (chunk) => {
    if (buffer.length + chunk.length > MAX_FRAME_BYTES) {
      socket.end(error("ERR input buffer exceeded"));
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    try {
      for (
        let command = readCommand(buffer);
        command;
        command = readCommand(buffer)
      ) {
        buffer = buffer.subarray(command.consumed);
        queue = queue
          .then(async () => {
            if (!socket.destroyed)
              await respond(socket, client, command.values);
          })
          .catch((cause) => {
            if (!socket.destroyed) {
              socket.end(
                error(
                  isHostUnavailable(cause)
                    ? "ERR browser host unavailable"
                    : safeMessage(cause),
                ),
              );
            }
          });
      }
    } catch {
      socket.end(error("ERR invalid RESP2 command"));
    }
  });
  await new Promise((resolve) => socket.once("close", resolve));
  await queue;
}

async function respond(socket, client, values) {
  if (values.length === 0) return socket.write(error("ERR empty command"));
  let name;
  try {
    name = ascii(values[0]).toUpperCase();
  } catch {
    return socket.write(error("ERR invalid command name"));
  }
  const args = values.slice(1);
  if (name === "PING") {
    if (args.length > 1) return wrongArity(socket, "ping");
    return socket.write(args.length ? bulk(args[0]) : Buffer.from("+PONG\r\n"));
  }
  if (
    name === "CLIENT" &&
    args.length === 3 &&
    asciiSafe(args[0]).toUpperCase() === "SETINFO"
  ) {
    const property = asciiSafe(args[1]).toUpperCase();
    if (["LIB-NAME", "LIB-VER"].includes(property))
      return socket.write(Buffer.from("+OK\r\n"));
  }
  if (name === "QUIT") {
    if (args.length !== 0) return wrongArity(socket, "quit");
    return socket.end(Buffer.from("+OK\r\n"));
  }
  if (name === "GET") {
    if (args.length !== 1) return wrongArity(socket, "get");
    try {
      return socket.write(bulk(await client.kv.get(key(args[0]))));
    } catch (cause) {
      return socket.write(error(safeMessage(cause)));
    }
  }
  if (name === "SET") {
    if (args.length !== 2) return wrongArity(socket, "set");
    try {
      await client.kv.set(key(args[0]), args[1]);
      return socket.write(Buffer.from("+OK\r\n"));
    } catch (cause) {
      return socket.write(error(safeMessage(cause)));
    }
  }
  if (name === "DEL") {
    if (args.length < 1) return wrongArity(socket, "del");
    try {
      const count = await client.kv.delete(args.map(key));
      return socket.write(integer(count));
    } catch (cause) {
      return socket.write(error(safeMessage(cause)));
    }
  }
  return socket.write(error("ERR unsupported command or arguments"));
}

export function readCommand(buffer) {
  const array = readLength(buffer, 0, "*", MAX_ARGUMENTS);
  if (!array) return null;
  if (array.length < 1) throw new Error("Empty RESP command.");
  const values = [];
  let offset = array.next;
  for (let index = 0; index < array.length; index += 1) {
    const field = readLength(buffer, offset, "$", MAX_FIELD_BYTES);
    if (!field) return null;
    const end = field.next + field.length;
    if (end + 2 > MAX_FRAME_BYTES) throw new Error("RESP frame exceeds limit.");
    if (end + 2 > buffer.length) return null;
    if (buffer[end] !== 13 || buffer[end + 1] !== 10)
      throw new Error("Invalid RESP bulk terminator.");
    values.push(buffer.subarray(field.next, end));
    offset = end + 2;
  }
  return { values, consumed: offset };
}

function readLength(buffer, offset, marker, maximum) {
  if (offset === buffer.length) return null;
  if (buffer[offset] !== marker.charCodeAt(0))
    throw new Error("Expected RESP array of bulk strings.");
  const end = buffer.indexOf("\r\n", offset, "ascii");
  if (end < 0) {
    if (buffer.length - offset > 12) throw new Error("Invalid RESP length.");
    return null;
  }
  const digits = buffer.toString("ascii", offset + 1, end);
  if (!/^\d{1,5}$/.test(digits)) throw new Error("Invalid RESP length.");
  const length = Number(digits);
  if (length > maximum) throw new Error("RESP length exceeds limit.");
  return { length, next: end + 2 };
}

function key(value) {
  try {
    return utf8.decode(value);
  } catch {
    throw bridgeError(
      "key-value-invalid-key",
      "Redis keys must be valid UTF-8 strings.",
    );
  }
}
function ascii(value) {
  if (value.some((byte) => byte > 0x7f)) throw new Error("Non-ASCII command.");
  return value.toString("ascii");
}
function asciiSafe(value) {
  try {
    return ascii(value);
  } catch {
    return "";
  }
}
function bulk(value) {
  if (value === null) return Buffer.from("$-1\r\n");
  const bytes = Buffer.from(value);
  return Buffer.concat([
    Buffer.from(`$${bytes.length}\r\n`),
    bytes,
    Buffer.from("\r\n"),
  ]);
}
function integer(value) {
  return Buffer.from(`:${value}\r\n`);
}
function error(message) {
  return Buffer.from(`-${message.replace(/[\r\n]/g, " ")}\r\n`);
}
function wrongArity(socket, command) {
  return socket.write(
    error(`ERR wrong number of arguments for '${command}' command`),
  );
}
function safeMessage(cause) {
  if (
    ["key-value-invalid-key", "key-value-invalid-value"].includes(cause?.code)
  )
    return `ERR ${cause.message}`;
  return "ERR key-value operation failed";
}
function isHostUnavailable(cause) {
  return [
    "host-disconnected",
    "transport-failed",
    "connection-closed",
    "client-not-connected",
  ].includes(cause?.code);
}
function bridgeError(code, message) {
  return Object.assign(new Error(message), { code });
}
