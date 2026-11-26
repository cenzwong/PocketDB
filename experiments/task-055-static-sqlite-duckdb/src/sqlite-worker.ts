import initSqlite from "@sqlite.org/sqlite-wasm";
import sqliteWasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";

self.addEventListener("message", ({ data }: MessageEvent<{ id: number; profile: string }>) => {
  void run(data.id, data.profile);
});

async function run(id: number, profile: string): Promise<void> {
  let pool: Awaited<ReturnType<Awaited<ReturnType<typeof initSqlite>>["installOpfsSAHPoolVfs"]>> | undefined;
  try {
    const sqlite3 = await initSqlite({
      locateFile: (path, prefix) =>
        path.endsWith(".wasm") ? sqliteWasmUrl : `${prefix}${path}`,
    });
    pool = await sqlite3.installOpfsSAHPoolVfs({
      name: `pocketdb-task-055-${profile}`,
      directory: `/pocketdb-task-055-${profile}`,
      initialCapacity: 6,
    });
    const database = new pool.OpfsSAHPoolDb(`/sqlite-probe-${profile}.db`);
    database.exec("PRAGMA journal_mode=DELETE");
    database.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT)");
    database.exec({
      sql: "INSERT INTO probe VALUES (?, ?)",
      bind: [7, "sqlite-file-round-trip"],
    });
    const query = database.selectObject(
      "SELECT id, value FROM probe WHERE id = ?",
      [7],
    );
    if (query?.id !== 7 || query.value !== "sqlite-file-round-trip") {
      throw new Error("SQLite representative query returned an unexpected row.");
    }
    const bytes = pool.exportFile(`/sqlite-probe-${profile}.db`);
    database.close();
    const importedBytes = await pool.importDb(
      `/sqlite-round-trip-${profile}.db`,
      bytes,
    );
    const restored = new pool.OpfsSAHPoolDb(
      `/sqlite-round-trip-${profile}.db`,
    );
    const restoredQuery = restored.selectObject(
      "SELECT id, value FROM probe WHERE id = ?",
      [7],
    );
    if (
      restoredQuery?.id !== 7 ||
      restoredQuery.value !== "sqlite-file-round-trip"
    ) {
      throw new Error("SQLite imported file returned an unexpected row.");
    }
    restored.close();
    await pool.removeVfs();
    self.postMessage({
      id,
      ok: true,
      version: sqlite3.version.libVersion,
      storage: "opfs-sahpool",
      query,
      fileBytes: bytes.byteLength,
      importedBytes,
      roundTrip: restoredQuery,
    });
  } catch (error) {
    try {
      await pool?.removeVfs();
    } catch {
      // Keep the original probe error.
    }
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}
