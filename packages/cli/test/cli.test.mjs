import assert from "node:assert/strict";
import { once } from "node:events";
import { createConnection } from "node:net";
import { describe, it } from "node:test";
import pg from "pg";
import { createPostgresBridge } from "../src/postgres-bridge.mjs";
import { main, parseArguments } from "../src/cli.mjs";

const uri = "pocketdb://example.invalid/secret-capability#private-data";

function io() {
  let stdout = "";
  let stderr = "";
  return {
    stdin: { fd: 0 },
    stdout: {
      write: (value) => {
        stdout += value;
      },
    },
    stderr: {
      write: (value) => {
        stderr += value;
      },
    },
    output: () => ({ stdout, stderr }),
  };
}

function fakeConnection(engineId = "postgresql", overrides = {}) {
  const calls = [];
  const client = {
    engineId,
    access: "read-only",
    peerId: "peer-test",
    sessionId: "session-test",
    capabilities: { operations: ["query", "schema"] },
    query: async (...args) => {
      calls.push(["query", ...args]);
      return overrides.queryResult ?? { rows: [{ value: 1 }], affectedRows: 0 };
    },
    schema: async (...args) => {
      calls.push(["schema", ...args]);
      return [{ table_name: "items", column_name: "value" }];
    },
    kv: {
      ping: async (...args) => {
        calls.push(["ping", ...args]);
        return "PONG";
      },
    },
  };
  return {
    calls,
    client,
    closeCalls: 0,
    close: async function close() {
      this.closeCalls += 1;
    },
  };
}

describe("PocketDB CLI parsing and command execution", () => {
  it("parses positional and environment invitation sources and bounded options", () => {
    assert.deepEqual(
      parseArguments([
        "query",
        uri,
        "SELECT $1::text",
        "--params",
        '["ok"]',
        "--timeout-ms",
        "500",
        "--json",
      ]),
      {
        command: "query",
        format: "json",
        uriEnv: undefined,
        uriStdin: false,
        positionalUri: uri,
        sql: "SELECT $1::text",
        params: ["ok"],
        requestTimeoutMs: 500,
        connectTimeoutMs: 120_000,
        maxRows: 1_000,
        bridgePort: undefined,
        bridgeHost: "127.0.0.1",
        allowRemoteBind: false,
        bridgeProtocol: "postgresql",
        protocolSpecified: false,
      },
    );
    assert.equal(
      parseArguments(["connect", "--uri-env", "POCKETDB_INVITATION"]).uriEnv,
      "POCKETDB_INVITATION",
    );
    assert.throws(
      () => parseArguments(["query", uri, "SELECT 1", "--timeout-ms", "0"]),
      /integer/,
    );
    assert.throws(() => parseArguments(["export", uri]), /explicit read query/);
    assert.deepEqual(parseArguments(["connect", "--port", "0"]).bridgePort, 0);
    assert.equal(
      parseArguments(["connect", "--protocol", "resp", "--port", "0"])
        .bridgeProtocol,
      "resp",
    );
    assert.throws(
      () => parseArguments(["connect", "--protocol", "resp"]),
      /require --port/,
    );
    assert.throws(
      () => parseArguments(["connect", "--protocol", "kv", "--port", "1"]),
      /postgresql or resp/,
    );
    assert.throws(
      () => parseArguments(["connect", "--port", "5432", "--host", "0.0.0.0"]),
      /allow-remote-bind/,
    );
    assert.equal(
      parseArguments([
        "connect",
        "--port",
        "5432",
        "--host",
        "0.0.0.0",
        "--allow-remote-bind",
      ]).allowRemoteBind,
      true,
    );
  });

  it("connects and emits machine-readable metadata without printing the invitation", async () => {
    const streams = io();
    const connected = fakeConnection();
    let seenUri;
    const status = await main(
      [
        "connect",
        "--uri-env",
        "POCKETDB_INVITATION",
        "--connect-timeout-ms",
        "5000",
        "--json",
      ],
      streams,
      {
        env: {
          POCKETDB_INVITATION: uri,
          POCKETDB_SIGNALING_ENDPOINT: "http://127.0.0.1:8080/api",
        },
        connect: async (value, options) => {
          seenUri = value;
          assert.equal(options.connectTimeoutMs, 5000);
          assert.equal(options.requestTimeoutMs, 30_000);
          return connected;
        },
      },
    );
    assert.equal(status, 0);
    assert.equal(seenUri, uri);
    assert.equal(connected.closeCalls, 1);
    assert.equal(JSON.parse(streams.output().stdout).connected, true);
    assert.ok(!streams.output().stdout.includes(uri));
  });

  it("holds one shared-client session open for a bridge and closes it on shutdown", async () => {
    const streams = io();
    const connected = fakeConnection();
    let listenOptions;
    const status = await main(
      ["connect", "--uri-env", "POCKETDB_INVITATION", "--port", "0", "--json"],
      streams,
      {
        env: {
          POCKETDB_SIGNALING_ENDPOINT: "http://127.0.0.1:8080/api",
          POCKETDB_INVITATION: uri,
        },
        connect: async () => connected,
        createBridge: async (_client, options) => {
          listenOptions = options;
          return {
            host: options.host,
            port: 54321,
            close: async () => {
              listenOptions.closed = true;
            },
          };
        },
        waitForShutdown: async () => undefined,
      },
    );
    assert.equal(status, 0);
    assert.deepEqual(
      { host: listenOptions.host, port: listenOptions.port },
      { host: "127.0.0.1", port: 0 },
    );
    assert.equal(listenOptions.closed, true);
    assert.equal(connected.closeCalls, 1);
    assert.deepEqual(JSON.parse(streams.output().stdout), {
      listening: true,
      host: "127.0.0.1",
      port: 54321,
      protocol: "postgresql",
      engine: "postgresql",
    });
  });

  it("returns stable exit codes for port conflicts and remote host loss", async () => {
    const env = {
      POCKETDB_INVITATION: uri,
      POCKETDB_SIGNALING_ENDPOINT: "http://127.0.0.1:8080/api",
    };
    const conflictStreams = io();
    const conflictConnection = fakeConnection();
    const conflictStatus = await main(
      [
        "connect",
        "--uri-env",
        "POCKETDB_INVITATION",
        "--port",
        "5432",
        "--json",
      ],
      conflictStreams,
      {
        env,
        connect: async () => conflictConnection,
        createBridge: async () => {
          throw Object.assign(new Error("ephemeral address"), {
            code: "EADDRINUSE",
          });
        },
      },
    );
    assert.equal(conflictStatus, 2);
    assert.deepEqual(JSON.parse(conflictStreams.output().stderr), {
      error: "bridge-port-in-use",
      message: "Requested local bridge port is already in use.",
    });
    assert.equal(conflictConnection.closeCalls, 1);
    assert.ok(!conflictStreams.output().stderr.includes(uri));

    const remoteStreams = io();
    const remoteConnection = fakeConnection();
    const disconnected = Promise.resolve();
    const remoteStatus = await main(
      [
        "connect",
        "--uri-env",
        "POCKETDB_INVITATION",
        "--port",
        "5432",
        "--json",
      ],
      remoteStreams,
      {
        env,
        connect: async () => remoteConnection,
        createBridge: async () => ({
          host: "127.0.0.1",
          port: 5432,
          disconnected,
          close: async () => undefined,
        }),
        waitForShutdown: () => new Promise(() => {}),
      },
    );
    assert.equal(remoteStatus, 4);
    assert.deepEqual(JSON.parse(remoteStreams.output().stderr), {
      error: "host-disconnected",
      message: "Browser host disconnected; local bridge closed.",
    });
    assert.equal(remoteConnection.closeCalls, 1);
    assert.ok(!remoteStreams.output().stderr.includes(uri));
  });

  it("runs SQL ping, query and schema inspection through the authenticated client", async () => {
    const connected = fakeConnection();
    const streams = io();
    const dependencies = {
      env: { POCKETDB_SIGNALING_ENDPOINT: "http://127.0.0.1:8080/api" },
      connect: async () => connected,
    };
    assert.equal(await main(["ping", uri, "--json"], streams, dependencies), 0);
    assert.equal(connected.calls[0][0], "schema");
    assert.equal(
      await main(
        [
          "query",
          uri,
          "SELECT $1::text",
          "--params",
          '["hello"]',
          "--timeout-ms",
          "500",
          "--json",
        ],
        streams,
        dependencies,
      ),
      0,
    );
    assert.deepEqual(connected.calls[1].slice(1, 4), [
      "SELECT $1::text",
      ["hello"],
      { timeoutMs: 500 },
    ]);
    assert.equal(
      await main(["inspect", uri, "--json"], streams, dependencies),
      0,
    );
    assert.equal(connected.calls[2][0], "schema");
    assert.equal(connected.closeCalls, 3);
  });

  it("exports only explicit read-only SELECT queries with a row bound", async () => {
    const connected = fakeConnection("postgresql", {
      queryResult: { rows: [{ value: 1 }, { value: 2 }, { value: 3 }] },
    });
    const streams = io();
    const status = await main(
      [
        "export",
        uri,
        "--query",
        "SELECT value FROM items",
        "--max-rows",
        "2",
        "--json",
      ],
      streams,
      {
        env: { POCKETDB_SIGNALING_ENDPOINT: "http://127.0.0.1:8080/api" },
        connect: async () => connected,
      },
    );
    assert.equal(status, 0);
    const output = JSON.parse(streams.output().stdout);
    assert.equal(output.format, "jsonl");
    assert.equal(output.rowCount, 2);
    assert.equal(output.truncated, true);
    assert.equal(output.data.split("\n").length, 2);
    assert.match(connected.calls[0][1], /LIMIT 3$/);
    assert.equal(connected.closeCalls, 1);
  });

  it("redacts invitation credentials and maps permission errors to a stable exit code", async () => {
    const streams = io();
    const status = await main(
      ["connect", "--uri-env", "POCKETDB_INVITATION", "--json"],
      streams,
      {
        env: {
          POCKETDB_INVITATION: uri,
          POCKETDB_SIGNALING_ENDPOINT: "http://127.0.0.1:8080/api",
        },
        connect: async () => {
          throw Object.assign(new Error(`Denied ${uri}`), {
            code: "permission-denied",
          });
        },
      },
    );
    assert.equal(status, 3);
    assert.ok(!streams.output().stderr.includes(uri));
    assert.deepEqual(JSON.parse(streams.output().stderr), {
      error: "permission-denied",
      message: "Denied [REDACTED INVITATION]",
    });
  });

  it("returns JSON validation errors and meaningful usage exit codes in noninteractive mode", async () => {
    const streams = io();
    const status = await main(["unknown", "--json"], streams, {});
    assert.equal(status, 2);
    assert.deepEqual(JSON.parse(streams.output().stderr), {
      error: "usage",
      message: "Unknown command 'unknown'.",
    });
  });

  it("keeps timeout failures distinct and closes each connection after command completion", async () => {
    const streams = io();
    const connected = fakeConnection();
    const status = await main(["query", uri, "SELECT 1", "--json"], streams, {
      env: { POCKETDB_SIGNALING_ENDPOINT: "http://127.0.0.1:8080/api" },
      connect: async () => ({
        ...connected,
        client: {
          ...connected.client,
          query: async () => {
            throw Object.assign(new Error("Request timed out"), {
              code: "request-timeout",
            });
          },
        },
      }),
    });
    assert.equal(status, 4);
    assert.equal(JSON.parse(streams.output().stderr).error, "request-timeout");
  });
});

it("decodes JSON and JSONB through the PostgreSQL bridge", async () => {
  const fields = [
    { name: "document", dataTypeID: 3802 },
    { name: "scalar", dataTypeID: 114 },
    { name: "label", dataTypeID: 25 },
    { name: "missing", dataTypeID: 3802 },
  ];
  const row = {
    document: { nested: [true, 7] },
    scalar: "value",
    label: "plain text",
    missing: null,
  };
  const bridge = await createPostgresBridge(
    {
      engineId: "postgresql",
      query: async () => ({ rows: [row], fields }),
    },
    { port: 0 },
  );
  const client = new pg.Client({
    host: bridge.host,
    port: bridge.port,
    user: "pocketdb",
  });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT document, scalar, label, missing",
    );
    assert.deepEqual(result.rows, [row]);
  } finally {
    await client.end();
    await bridge.close();
  }
});

it("decodes PostgreSQL array results through simple and extended queries", async () => {
  const fields = [
    { name: "numbers", dataTypeID: 1007 },
    { name: "labels", dataTypeID: 1009 },
    { name: "dates", dataTypeID: 1182 },
    { name: "bytes", dataTypeID: 1001 },
    { name: "documents", dataTypeID: 3807 },
    { name: "json", dataTypeID: 114 },
    { name: "boxes", dataTypeID: 1020 },
    { name: "empty", dataTypeID: 1007 },
    { name: "absent", dataTypeID: 1007 },
  ];
  const labels = [
    "NULL",
    null,
    "a,b",
    "{braces}",
    '"quoted"',
    "back\\slash",
    " spaced ",
    "",
  ];
  const row = [
    [
      [1, null],
      [2, 3],
    ],
    labels,
    ["2026-11-25", null],
    [Uint8Array.of(0, 255), null],
    [[1, 2], { message: 'a"b' }, null],
    [null, { top: true }],
    ["(1,2),(3,4)", null],
    [],
    null,
  ];
  const bridge = await createPostgresBridge(
    {
      engineId: "postgresql",
      query: async () => ({ rows: [row], fields }),
      describeQuery: async () => ({ parameters: [], fields }),
    },
    { port: 0 },
  );
  const driver = new pg.Client({
    host: bridge.host,
    port: bridge.port,
    user: "pocketdb",
  });
  const expected = {
    numbers: row[0],
    labels,
    dates: [new Date(2026, 10, 25), null],
    bytes: [Buffer.from([0, 255]), null],
    documents: row[4],
    json: row[5],
    boxes: '{"(1,2),(3,4)";NULL}',
    empty: [],
    absent: null,
  };
  try {
    await driver.connect();
    assert.deepEqual((await driver.query("SELECT array_values")).rows, [
      expected,
    ]);
    const extended = await driver.query({
      text: "SELECT array_values",
      queryMode: "extended",
    });
    assert.deepEqual(extended.rows, [expected]);
  } finally {
    await driver.end();
    await bridge.close();
  }
});

it("preserves backend SQLSTATE codes through the PostgreSQL bridge", async () => {
  const bridge = await createPostgresBridge(
    {
      engineId: "postgresql",
      async query(sql) {
        const backendCodes = {
          "INSERT INTO items VALUES (1)": "postgres-sql-23505",
          "UPDATE items SET id = 2": "postgres-sql-40001",
          "SELECT * FROM missing": "postgres-sql-42p01",
          "SELECT forbidden": "permission-denied",
          "SELECT fail": "postgres-sql-23505-extra",
        };
        throw Object.assign(new Error("Backend query failed."), {
          code: backendCodes[sql],
        });
      },
    },
    { port: 0 },
  );
  const driver = new pg.Client({
    host: bridge.host,
    port: bridge.port,
    user: "pocketdb",
  });
  try {
    await driver.connect();
    for (const [sql, code] of [
      ["INSERT INTO items VALUES (1)", "23505"],
      ["UPDATE items SET id = 2", "40001"],
      ["SELECT * FROM missing", "42P01"],
      ["SELECT forbidden", "42501"],
      ["SELECT fail", "XX000"],
    ]) {
      await assert.rejects(driver.query(sql), {
        code,
        message: "Backend query failed.",
      });
    }
  } finally {
    await driver.end();
    await bridge.close();
  }
});

it("waits for a pending PostgreSQL transaction before replacing a reset driver", {
  timeout: 10_000,
}, async () => {
  const beginStarted = Promise.withResolvers();
  const finishBegin = Promise.withResolvers();
  const rollbackStarted = Promise.withResolvers();
  const finishRollback = Promise.withResolvers();
  let transactionOpen = false;
  const bridge = await createPostgresBridge(
    {
      engineId: "postgresql",
      async query(sql) {
        if (sql === "BEGIN") {
          beginStarted.resolve();
          await finishBegin.promise;
          transactionOpen = true;
          return { rows: [], command: "BEGIN" };
        }
        if (sql === "ROLLBACK") {
          rollbackStarted.resolve();
          await finishRollback.promise;
          transactionOpen = false;
          return { rows: [], command: "ROLLBACK" };
        }
        assert.equal(transactionOpen, false);
        return { rows: [], command: "SELECT" };
      },
    },
    { port: 0 },
  );
  const options = { host: bridge.host, port: bridge.port, user: "pocketdb" };
  const first = createConnection(options);
  const assertBusy = async () => {
    const contender = createConnection(options);
    try {
      const [errorResponse] = await once(contender, "data");
      assert.match(errorResponse.toString(), /53300/);
    } finally {
      contender.destroy();
    }
  };
  try {
    await once(first, "connect");
    const startup = Buffer.concat([
      Buffer.from([0, 0, 0, 23, 0, 3, 0, 0]),
      Buffer.from("user\0pocketdb\0\0"),
    ]);
    const ready = once(first, "data");
    first.write(startup);
    await ready;
    first.write(Buffer.from([81, 0, 0, 0, 10, ...Buffer.from("BEGIN\0")]));
    await beginStarted.promise;

    const closed = once(first, "close");
    first.resetAndDestroy();
    await closed;
    await assertBusy();
    finishBegin.resolve();
    await rollbackStarted.promise;
    await assertBusy();

    finishRollback.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    const replacement = new pg.Client(options);
    try {
      await replacement.connect();
      await replacement.query("SELECT 1");
    } finally {
      await replacement.end();
    }
  } finally {
    finishBegin.resolve();
    finishRollback.resolve();
    first.destroy();
    await bridge.close();
  }
});

it("keeps savepoint rollbacks in a transaction and rolls back when the driver leaves", {
  timeout: 10_000,
}, async () => {
  const queries = [];
  const bridge = await createPostgresBridge(
    {
      engineId: "postgresql",
      async query(sql) {
        queries.push(sql);
        if (sql === "SELECT broken") throw new Error("Test query failed.");
        return { rows: [], command: sql.split(" ")[0] };
      },
    },
    { port: 0 },
  );
  const driver = new pg.Client({
    host: bridge.host,
    port: bridge.port,
    user: "pocketdb",
  });
  const rollbackTo =
    "ROLLBACK WORK /* annotated /* nested */ */ TO SAVEPOINT s";
  try {
    await driver.connect();
    await driver.query("BEGIN");
    await driver.query("SAVEPOINT s");
    await driver.query("ROLLBACK TO s");
    assert.equal(driver.getTransactionStatus(), "T");
    const readyAfterError = once(driver.connection, "readyForQuery");
    await assert.rejects(driver.query("SELECT broken"), /Test query failed/);
    await readyAfterError;
    assert.equal(driver.getTransactionStatus(), "E");
    await driver.query(rollbackTo);
    assert.equal(driver.getTransactionStatus(), "T");
    await driver.query("ROLLBACK TRANSACTION");
    assert.equal(driver.getTransactionStatus(), "I");
    await driver.query("BEGIN");
    await driver.query("SAVEPOINT s");
    await driver.query(rollbackTo);
  } finally {
    await driver.end();
    await bridge.close();
  }
  assert.deepEqual(queries.slice(-2), [rollbackTo, "ROLLBACK"]);
});

it("returns zero affected rows for UPDATE and DELETE", async () => {
  const bridge = await createPostgresBridge(
    {
      engineId: "postgresql",
      query: async (sql) => ({
        rows: [],
        command: sql.split(" ")[0],
        affectedRows: 0,
      }),
    },
    { port: 0 },
  );
  const driver = new pg.Client({
    host: bridge.host,
    port: bridge.port,
    user: "pocketdb",
  });
  try {
    await driver.connect();
    assert.equal(
      (await driver.query("UPDATE items SET value = 1")).rowCount,
      0,
    );
    assert.equal((await driver.query("DELETE FROM items")).rowCount, 0);
  } finally {
    await driver.end();
    await bridge.close();
  }
});
