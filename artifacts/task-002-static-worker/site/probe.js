function runWorker(sharedBuffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    const timeout = setTimeout(() => finish(reject, new Error("Worker timed out")), 10_000);

    function finish(settle, value) {
      clearTimeout(timeout);
      worker.terminate();
      settle(value);
    }

    worker.onmessage = ({ data }) => finish(resolve, data);
    worker.onerror = (event) => finish(reject, new Error(event.message || "Worker failed to load"));
    worker.onmessageerror = () => finish(reject, new Error("Worker result could not be decoded"));
    try {
      worker.postMessage(sharedBuffer);
    } catch (error) {
      finish(reject, error);
    }
  });
}

const result = {
  url: location.href,
  userAgent: navigator.userAgent,
  secureContext: isSecureContext,
  crossOriginIsolated,
  sharedArrayBuffer: typeof SharedArrayBuffer === "function",
};
try {
  const response = await fetch(location.href, { cache: "no-store" });
  result.headers = {
    coop: response.headers.get("cross-origin-opener-policy"),
    coep: response.headers.get("cross-origin-embedder-policy"),
  };
  const sharedBuffer = result.sharedArrayBuffer ? new SharedArrayBuffer(4) : null;
  result.worker = await runWorker(sharedBuffer);
  result.sharedBufferRoundTrip = sharedBuffer ? Atomics.load(new Int32Array(sharedBuffer), 0) === 42 : null;
} catch (error) {
  result.error = String(error);
}
const output = document.querySelector("#result");
output.textContent = JSON.stringify(result, null, 2);
output.dataset.complete = "true";
