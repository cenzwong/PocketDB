const maxFrame = 8192;
const CRLF = Buffer.from("\r\n");

function lengthAt(buffer, offset, marker, maximum) {
  if (offset === buffer.length) return null;
  if (buffer[offset] !== marker.charCodeAt(0)) throw new Error("Expected RESP array of bulk strings");
  const end = buffer.indexOf(CRLF, offset);
  if (end < 0) {
    if (buffer.length - offset > 12) throw new Error("Invalid length");
    return null;
  }
  const digits = buffer.toString("ascii", offset + 1, end);
  if (!/^\d{1,5}$/.test(digits)) throw new Error("Invalid length");
  const length = Number(digits);
  if (length > maximum) throw new Error("Length exceeds spike limit");
  return { length, next: end + 2 };
}

export function readCommand(buffer) {
  const array = lengthAt(buffer, 0, "*", 8);
  if (!array) return null;
  if (array.length === 0) throw new Error("Empty command");
  const values = [];
  let offset = array.next;
  for (let i = 0; i < array.length; i++) {
    const field = lengthAt(buffer, offset, "$", 4096);
    if (!field) return null;
    const end = field.next + field.length;
    if (end + 2 > maxFrame) throw new Error("Frame exceeds spike limit");
    if (end + 2 > buffer.length) return null;
    if (buffer[end] !== 13 || buffer[end + 1] !== 10) throw new Error("Missing bulk terminator");
    values.push(buffer.subarray(field.next, end));
    offset = end + 2;
  }
  return { values, consumed: offset };
}

export function bulk(value) {
  if (value === null) return Buffer.from("$-1\r\n");
  return Buffer.concat([Buffer.from(`$${value.length}\r\n`), value, CRLF]);
}

export function bridge(socket, remote, trace) {
  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();
  socket.on("data", (chunk) => {
    if (buffer.length + chunk.length > 8192) {
      socket.end("-ERR input buffer exceeded\r\n");
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    try {
      for (let frame = readCommand(buffer); frame; frame = readCommand(buffer)) {
        buffer = buffer.subarray(frame.consumed);
        const [name, ...args] = frame.values;
        const op = name.toString("ascii").toUpperCase();
        trace.push(op);
        queue = queue.then(async () => {
          if (socket.destroyed) return;
          if (op === "PING" && args.length <= 1) {
            socket.write(args.length ? bulk(args[0]) : "+PONG\r\n");
          } else if (op === "CLIENT" && args.length === 3 && args[0].toString().toUpperCase() === "SETINFO") {
            socket.write("+OK\r\n");
          } else if (op === "QUIT" && args.length === 0) {
            socket.end("+OK\r\n");
          } else if (op === "SET" && args.length === 2) {
            await remote.request({ op, key: args[0].toString("base64"), value: args[1].toString("base64") });
            socket.write("+OK\r\n");
          } else if (op === "GET" && args.length === 1) {
            const value = await remote.request({ op, key: args[0].toString("base64") });
            socket.write(bulk(value === null ? null : Buffer.from(value, "base64")));
          } else {
            socket.write("-ERR unsupported command or arguments\r\n");
          }
        }).catch(() => socket.end("-ERR browser host unavailable\r\n"));
      }
    } catch {
      socket.end("-ERR invalid RESP2 command\r\n");
    }
  });
}
