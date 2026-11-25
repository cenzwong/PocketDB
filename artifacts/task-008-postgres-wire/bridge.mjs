import { createServer } from "node:net";
import { once } from "node:events";

const cancelCode = 80877102;
const sslCode = 80877103;
const protocolV3 = 196608;
const maximum = 8192;
const cstring = (text) => Buffer.from(text + "\0");
function message(type, payload) {
  const header = Buffer.alloc(5);
  header[0] = type.charCodeAt(0);
  header.writeInt32BE(4 + payload.length, 1);
  return Buffer.concat([header, payload]);
}
const startupReply = Buffer.concat([
  message("R", Buffer.alloc(4)),
  message("S", Buffer.concat([cstring("client_encoding"), cstring("UTF8")])),
  message("Z", Buffer.from("I")),
]);
const rollback = message("Q", cstring("ROLLBACK;"));
const allowed = new Set(["Q", "P", "B", "D", "E", "S", "H", "C"]);

export async function openBridge(remote) {
  const trace = [];
  let owner = null;
  let cleanup = Promise.resolve();
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let started = false;
    let queue = Promise.resolve();
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      if (owner === socket) {
        owner = null;
        cleanup = queue.then(async () => {
          await remote.request({ type: "wire", frame: rollback.toString("base64") });
          trace.push("cleanup rollback");
        });
        cleanup.catch(() => {});
      }
    });
    socket.on("data", (data) => {
      if (buffer.length + data.length > 2 * maximum) {
        socket.destroy();
        return;
      }
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= (started ? 5 : 4)) {
        const length = buffer.readInt32BE(started ? 1 : 0) + Number(started);
        if (length < (started ? 5 : 8) || length > maximum) {
          socket.destroy();
          return;
        }
        if (buffer.length < length) return;
        const frame = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        if (!started) {
          const code = frame.readInt32BE(4);
          if (code === sslCode && length === 8) {
            trace.push("SSLRequest declined");
            socket.write("N");
          } else if (code === cancelCode && length === 16) {
            trace.push("CancelRequest unsupported");
            socket.end();
            return;
          } else if (code !== protocolV3 || owner) {
            socket.destroy();
            return;
          } else {
            owner = socket;
            started = true;
            trace.push("v3 startup handled locally");
            queue = cleanup.then(() => socket.write(startupReply));
          }
        } else {
          const type = String.fromCharCode(frame[0]);
          if (type === "X") {
            trace.push("Terminate handled locally");
            queue = queue.then(() => socket.end());
            return;
          }
          if (!allowed.has(type)) {
            socket.destroy();
            return;
          }
          trace.push(type);
          queue = queue.then(async () => {
            if (socket.destroyed) return;
            const result = await remote.request({ type: "wire", frame: frame.toString("base64") });
            if (result && !socket.destroyed) socket.write(Buffer.from(result, "base64"));
          });
        }
        queue.catch(() => socket.destroy());
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    trace,
    async close() {
      sockets.forEach((socket) => socket.destroy());
      await new Promise((resolve) => server.close(resolve));
      await cleanup;
    },
  };
}
