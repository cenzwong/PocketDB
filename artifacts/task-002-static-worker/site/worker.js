async function runWasm() {
  const url = new URL("./answer.wasm", import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`WASM request returned HTTP ${response.status}`);
  const mime = response.headers.get("content-type");
  const { instance } = await WebAssembly.instantiateStreaming(response);
  return { path: url.pathname, mime, answer: instance.exports.answer() };
}

async function probeOpfs() {
  const root = await navigator.storage.getDirectory();
  const name = `pocketdb-task-002-${crypto.randomUUID()}.bin`;
  const file = await root.getFileHandle(name, { create: true });
  try {
    const handle = await file.createSyncAccessHandle();
    try {
      const payload = new Uint8Array([42, 17, 99]);
      const copy = new Uint8Array(payload.length);
      const written = handle.write(payload, { at: 0 });
      handle.flush();
      const read = handle.read(copy, { at: 0 });
      return written === payload.length && read === payload.length &&
        payload.every((byte, index) => byte === copy[index]);
    } finally {
      handle.close();
    }
  } finally {
    await root.removeEntry(name);
  }
}

self.onmessage = async ({ data: sharedBuffer }) => {
  const result = {
    script: location.pathname,
    secureContext: isSecureContext,
    crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer === "function",
  };
  try {
    result.wasm = await runWasm();
  } catch (error) {
    result.wasmError = String(error);
  }
  try {
    result.opfsRoundTrip = await probeOpfs();
  } catch (error) {
    result.opfsError = String(error);
  }
  if (sharedBuffer) Atomics.store(new Int32Array(sharedBuffer), 0, 42);
  self.postMessage(result);
};
