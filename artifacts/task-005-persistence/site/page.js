const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let sequence = 0;
const pending = new Map();

worker.onmessage = ({ data }) => {
  const request = pending.get(data.id);
  pending.delete(data.id);
  if (data.error) request.reject(new Error(data.error));
  else request.resolve(data.value);
};
worker.onerror = (event) => {
  for (const request of pending.values()) request.reject(new Error(event.message));
  pending.clear();
};

function database(action, value) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, value });
  });
}

async function keyValue(mode, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("pocketdb-task-005-kv", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("values");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("values", mode);
      const store = transaction.objectStore("values");
      const request = mode === "readwrite" ? store.put(value, "probe") : store.get("probe");
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

globalThis.probe = {
  database,
  keyValue,
  async storage() {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota, persisted: await navigator.storage.persisted(), isolated: crossOriginIsolated };
  },
};
