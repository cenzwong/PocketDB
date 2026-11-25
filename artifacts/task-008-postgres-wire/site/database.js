import { PGlite } from "./vendor/index.js";

const database = PGlite.create().then(async (db) => {
  await db.exec("create table wire_probe (id integer primary key, value text)");
  return db;
});

self.onmessage = async ({ data: { id, request } }) => {
  try {
    const db = await database;
    let value;
    if (request.type === "inspect") {
      value = (await db.query("select id, value from wire_probe order by id")).rows;
    } else if (request.type === "wire") {
      const response = await db.execProtocolRaw(Uint8Array.fromBase64(request.frame), { syncToFs: false });
      if (response.byteLength > 8192) throw new Error("Spike backend response exceeded 8 KiB");
      value = response.toBase64();
    } else {
      throw new Error("Unsupported worker request");
    }
    self.postMessage({ id, value });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
