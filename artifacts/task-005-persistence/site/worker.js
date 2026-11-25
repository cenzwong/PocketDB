import { PGlite } from "./vendor/index.js";
import { citext } from "./vendor/contrib/citext.js";

let database;
let release;
let lockLifetime;

async function open() {
  if (database) throw new Error("Database already open");
  await new Promise((resolve, reject) => {
    lockLifetime = navigator.locks.request("pocketdb-task-005", { ifAvailable: true }, (lock) => {
      if (!lock) return reject(new Error("Database already owned by another tab"));
      return new Promise((unlock) => {
        release = unlock;
        resolve();
      });
    });
    lockLifetime.catch(reject);
  });
  try {
    database = await PGlite.create("idb://pocketdb-task-005", { extensions: { citext } });
  } catch (error) {
    release();
    await lockLifetime;
    throw error;
  }
}

async function close() {
  try {
    await database.close();
  } finally {
    database = undefined;
    release();
    await lockLifetime;
  }
}

const actions = {
  open,
  close,
  async seed(value) {
    await database.exec("CREATE TABLE IF NOT EXISTS probe (id integer PRIMARY KEY, value text)");
    await database.query("INSERT INTO probe VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET value = $2", [1, value]);
    await database.exec("CREATE EXTENSION IF NOT EXISTS citext");
    return (await database.query("SELECT 'probe'::citext = 'PROBE'::citext AS matches")).rows[0].matches;
  },
  async read() {
    return (await database.query("SELECT value FROM probe WHERE id = $1", [1])).rows[0].value;
  },
  async snapshot() {
    const snapshot = await database.dumpDataDir("gzip");
    const restored = await PGlite.create({ loadDataDir: snapshot, extensions: { citext } });
    try {
      return { bytes: snapshot.size, value: (await restored.query("SELECT value FROM probe WHERE id = $1", [1])).rows[0].value };
    } finally {
      await restored.close();
    }
  },
};

self.onmessage = async ({ data: { id, action, value } }) => {
  try {
    self.postMessage({ id, value: await actions[action](value) });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
