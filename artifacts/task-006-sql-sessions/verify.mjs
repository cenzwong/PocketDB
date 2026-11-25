import assert from "node:assert/strict";
import { join } from "node:path";

const dependency = process.env.POCKETDB_NODE_MODULES;
const { PGlite } = await import(dependency
  ? join(dependency, "@electric-sql/pglite/dist/index.js")
  : "@electric-sql/pglite");
const db = await PGlite.create();
const trace = [];
const started = performance.now();
function record(client, event, fields = {}) {
  trace.push({ client, event, ms: Math.round(performance.now() - started), ...fields });
}
function run(client, action) {
  record(client, "requested");
  return db.transaction(async (tx) => {
    const { rows: [{ pid }] } = await tx.query("select pg_backend_pid() as pid");
    record(client, "entered", { pid });
    return action(tx);
  }).then((value) => {
    record(client, "committed");
    return value;
  }, (error) => {
    record(client, "rolled back", { reason: error.message });
    throw error;
  });
}

try {
  const { rows: [{ version }] } = await db.query("select version()");
  await db.exec("create table probe (id text primary key)");
  const commitGate = Promise.withResolvers();
  const clientEntered = Promise.withResolvers();
  const a = run("client-a", async (tx) => {
    await tx.query("insert into probe values ($1)", ["committed-a"]);
    clientEntered.resolve();
    await commitGate.promise;
  });
  await clientEntered.promise;
  let bEntered = false;
  const b = assert.rejects(run("client-b", async (tx) => {
    bEntered = true;
    assert.deepEqual((await tx.query("select id from probe")).rows, [{ id: "committed-a" }]);
    await tx.query("insert into probe values ($1)", ["rolled-back-b"]);
    throw new Error("client rollback");
  }), /client rollback/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(bEntered, false);
  commitGate.resolve();
  await Promise.all([a, b]);

  const disconnected = Promise.withResolvers();
  const writeStarted = Promise.withResolvers();
  const c = assert.rejects(run("client-c", async (tx) => {
    await tx.query("insert into probe values ($1)", ["lost-c"]);
    writeStarted.resolve();
    await disconnected.promise;
    throw new Error("client disconnected before commit");
  }), /client disconnected/);
  await writeStarted.promise;
  const d = run("client-d", (tx) => tx.query("select id from probe"));
  record("client-c", "connection lost");
  disconnected.resolve();
  await c;
  const { rows: committedRows } = await d;
  assert.deepEqual(committedRows, [{ id: "committed-a" }]);
  assert.equal(new Set(trace.filter((entry) => entry.event === "entered").map((entry) => entry.pid)).size, 1);

  const readOnlyRejections = [];
  for (const statement of [
    "insert into probe values ('unexpected')",
    "with write as (delete from probe returning id) select * from write",
    "create table unexpected (id integer)",
  ]) {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.exec("set transaction read only");
      assert.deepEqual((await tx.query("select id from probe")).rows, committedRows);
      try {
        await tx.exec(statement);
      } catch (error) {
        readOnlyRejections.push({ statement, sqlState: error.code });
        throw error;
      }
    }), { code: "25006" });
  }

  const permittedRemoteRead = (request) => {
    if (request.kind !== "lookup" || "sql" in request) return Promise.reject(new Error("remote SQL disabled for read-only capability"));
    return db.query("select id from probe where id = $1", [request.id]);
  };
  assert.deepEqual((await permittedRemoteRead({ kind: "lookup", id: "committed-a" })).rows, committedRows);
  await assert.rejects(permittedRemoteRead({ kind: "lookup", sql: "select id from probe" }), /remote SQL disabled/);
  assert.deepEqual((await db.query("select id from probe")).rows, committedRows);

  console.log(JSON.stringify({ node: process.version, postgres: version, trace,
    committedRows, readOnlyRejections, arbitraryReadOnlyRemoteSql: "denied before dispatch" }, null, 2));
} finally {
  await db.close();
}
