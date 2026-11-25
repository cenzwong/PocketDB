let ticks = 0;
const boot = crypto.randomUUID();
setInterval(() => ticks++, 100);
const opened = new Promise((resolve, reject) => {
  const request = indexedDB.open("pocketdb-task-010", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("values");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

self.onmessage = async ({ data: { id, value } }) => {
  try {
    const db = await opened;
    const saved = await new Promise((resolve, reject) => {
      const transaction = db.transaction("values", value === undefined ? "readonly" : "readwrite");
      const store = transaction.objectStore("values");
      const request = value === undefined ? store.get("marker") : store.put(value, "marker");
      transaction.oncomplete = () => resolve(value ?? request.result ?? null);
      transaction.onabort = () => reject(transaction.error);
    });
    self.postMessage({ id, result: { boot, ticks, value: saved } });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
