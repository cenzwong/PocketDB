import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { withBrowser } from "../../../artifacts/spike-support/chromium.mjs";
import pg from "pg";
import { createClient, RESP_TYPES } from "redis";

const execFileAsync = promisify(execFile);
const repo = resolve(new URL("../../..", import.meta.url).pathname);
const pythonIntegration = process.env.POCKETDB_PYTHON_INTEGRATION === "1";
const python = process.env.POCKETDB_PYTHON ?? "python3";
const webRoot = resolve(repo, "apps/web");
const viteModule = pathToFileURL(
  resolve(webRoot, "node_modules/vite/dist/node/index.js"),
);
const { createServer: createViteServer } = await import(viteModule.href);
const vite = await createViteServer({
  configFile: resolve(webRoot, "vite.config.ts"),
  root: webRoot,
  server: { host: "127.0.0.1", port: 0 },
});
const signaling = createSignalingServer();
const result = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
};

try {
  await Promise.all([
    new Promise((resolveListen) =>
      signaling.listen(0, "127.0.0.1", resolveListen),
    ),
    vite.listen(),
  ]);
  const signalAddress = signaling.address();
  const webAddress = vite.httpServer.address();
  assert(signalAddress && typeof signalAddress === "object");
  assert(webAddress && typeof webAddress === "object");
  const endpoint = `http://127.0.0.1:${signalAddress.port}/api`;
  const webUrl = `http://127.0.0.1:${webAddress.port}/`;
  const cli = resolve(repo, "packages/cli/bin/pocketdb.mjs");

  await withBrowser(async ({ page, version }) => {
    const host = await page(webUrl);
    await host.wait("Boolean(document.querySelector('#start-button'))");

    const kvInvitation = await startHost(host, "kv", endpoint, "read-write");
    const connected = await runCli(cli, endpoint, kvInvitation, [
      "connect",
      "--json",
    ]);
    assert.equal(connected.connected, true);
    assert.equal(connected.engine, "kv");
    const kvPingInvitation = await createInvitation(
      host,
      endpoint,
      "read-write",
    );
    const ping = await runCli(cli, endpoint, kvPingInvitation, [
      "ping",
      "--json",
    ]);
    assert.equal(ping.response, "PONG");
    const kvInspectInvitation = await createInvitation(
      host,
      endpoint,
      "read-write",
    );
    const kvInspect = await runCli(cli, endpoint, kvInspectInvitation, [
      "inspect",
      "--json",
    ]);
    assert.equal(kvInspect.engine, "kv");
    assert.ok(kvInspect.capabilities.operations.includes("GET"));

    await stopHost(host);
    const sqlWriteInvitation = await startHost(
      host,
      "postgresql",
      endpoint,
      "read-write",
    );
    const create = await runCli(cli, endpoint, sqlWriteInvitation, [
      "query",
      "--query",
      "CREATE TABLE cli_rows (value text)",
      "--json",
    ]);
    assert.equal(create.result.command, "CREATE");
    const sqlInsertInvitation = await createInvitation(
      host,
      endpoint,
      "read-write",
    );
    await runCli(cli, endpoint, sqlInsertInvitation, [
      "query",
      "--query",
      "INSERT INTO cli_rows VALUES ($1)",
      "--params",
      '["pocketdb-cli"]',
      "--json",
    ]);

    const sqlPingInvitation = await createInvitation(
      host,
      endpoint,
      "read-only",
    );
    const sqlPing = await runCli(cli, endpoint, sqlPingInvitation, [
      "ping",
      "--json",
    ]);
    assert.equal(sqlPing.response, "PONG");
    assert.equal(sqlPing.probe, "schema");
    const queryInvitation = await createInvitation(host, endpoint, "read-only");
    const query = await runCli(cli, endpoint, queryInvitation, [
      "query",
      "--query",
      "SELECT value FROM cli_rows WHERE value = $1",
      "--params",
      '["pocketdb-cli"]',
      "--timeout-ms",
      "5000",
      "--json",
    ]);
    assert.deepEqual(query.result.rows, [{ value: "pocketdb-cli" }]);
    const inspectInvitation = await createInvitation(
      host,
      endpoint,
      "read-only",
    );
    const inspected = await runCli(cli, endpoint, inspectInvitation, [
      "inspect",
      "--json",
    ]);
    assert.ok(
      inspected.schema.some((column) => column.table_name === "cli_rows"),
    );
    const exportInvitation = await createInvitation(
      host,
      endpoint,
      "read-only",
    );
    const exported = await runCli(cli, endpoint, exportInvitation, [
      "export",
      "--query",
      "SELECT value FROM cli_rows ORDER BY value",
      "--max-rows",
      "5",
      "--json",
    ]);
    assert.equal(exported.format, "jsonl");
    assert.equal(exported.rowCount, 1);
    assert.equal(exported.data, '{"value":"pocketdb-cli"}');
    const deniedExportInvitation = await createInvitation(
      host,
      endpoint,
      "read-write",
    );
    const deniedExport = await runCli(
      cli,
      endpoint,
      deniedExportInvitation,
      ["export", "--query", "SELECT value FROM cli_rows", "--json"],
      3,
    );
    assert.equal(deniedExport.error, "permission-denied");

    const bridgeInvitations = [
      await createInvitation(host, endpoint, "read-write"),
      await createInvitation(host, endpoint, "read-write"),
    ];
    const bridges = await Promise.all(
      bridgeInvitations.map((invitation) =>
        startBridge(cli, endpoint, invitation),
      ),
    );
    const [localA, localB] = bridges.map(
      ({ port }) =>
        new pg.Client({
          host: "127.0.0.1",
          port,
          user: "pocketdb",
          database: "demo",
        }),
    );
    localA.on("error", () => undefined);
    localB.on("error", () => undefined);
    let pgPortConflictExit;
    try {
      await Promise.all([localA.connect(), localB.connect()]);
      await localA.query(
        "CREATE TABLE IF NOT EXISTS task_046_bridge_rows (value text PRIMARY KEY)",
      );
      await localA.query("DELETE FROM task_046_bridge_rows");
      await localA.query("BEGIN");
      await localA.query(
        "INSERT INTO task_046_bridge_rows(value) VALUES ($1)",
        ["committed-after-transaction"],
      );
      let isolationError;
      try {
        await localB.query(
          "SELECT value FROM task_046_bridge_rows WHERE value = $1",
          ["committed-after-transaction"],
        );
      } catch (error) {
        isolationError = error;
      }
      assert.equal(
        isolationError?.code,
        "55006",
        "second invitation must not enter a database transaction owned by the first",
      );
      await localA.query("COMMIT");
      const visible = await localB.query(
        "SELECT value FROM task_046_bridge_rows WHERE value = $1",
        ["committed-after-transaction"],
      );
      assert.equal(visible.rows[0]?.value, "committed-after-transaction");
      await localA.query("BEGIN");
      await localA.query(
        "INSERT INTO task_046_bridge_rows(value) VALUES ($1)",
        ["rolled-back-on-disconnect"],
      );
      const streamClosed = once(localA.connection.stream, "close");
      localA.connection.stream.destroy();
      await streamClosed;
      await waitFor(async () => {
        try {
          const count = await localB.query(
            "SELECT count(*) FROM task_046_bridge_rows WHERE value = $1",
            ["rolled-back-on-disconnect"],
          );
          return count.rows[0]?.count === "0";
        } catch (error) {
          if (error.code === "55006") return false;
          throw error;
        }
      });
      result.postgresBridge = {
        driver: "node-postgres 8.23.1",
        startup: true,
        parameterizedQueries: true,
        transaction: "committed row visible after commit",
        isolation:
          "second invitation received PostgreSQL 55006 while another session owned a transaction, then worked after commit",
        driverDisconnect: "uncommitted row rolled back",
        bind: "127.0.0.1 by default",
        separateInvitations: 2,
      };
      const pgConflictInvitation = await createInvitation(
        host,
        endpoint,
        "read-write",
      );
      const pgConflict = await runCli(
        cli,
        endpoint,
        pgConflictInvitation,
        [
          "connect",
          "--protocol",
          "postgresql",
          "--port",
          String(bridges[0].port),
          "--json",
        ],
        2,
      );
      assert.equal(pgConflict.error, "bridge-port-in-use");
      pgPortConflictExit = 2;
    } finally {
      await Promise.allSettled([localA.end(), localB.end()]);
      await Promise.all(bridges.map((bridge) => stopBridge(bridge.child)));
    }

    const pgControlInvitation = await createInvitation(
      host,
      endpoint,
      "read-write",
    );
    const pgControl = await startBridge(cli, endpoint, pgControlInvitation);
    const pgControlExit = await stopBridge(pgControl.child, "SIGINT");
    assert.equal(pgControlExit.code, 0);
    await assertPortClosed(pgControl.port);
    if (pythonIntegration) {
      const pythonPgInvitation = await createInvitation(
        host,
        endpoint,
        "read-write",
      );
      const pythonPg = await startBridge(cli, endpoint, pythonPgInvitation);
      const pythonPgResult = await runPythonExample(
        "postgresql.py",
        pythonPg.port,
      );
      assert.equal(pythonPgResult.driver, "psycopg");
      assert.equal(pythonPgResult.parameterizedQuery, true);
      assert.equal(pythonPgResult.transaction, "committed");
      const pythonPgExit = await stopBridge(pythonPg.child);
      assert.equal(pythonPgExit.code, 0);
      await assertPortClosed(pythonPg.port);
      result.pythonPostgres = {
        driver: pythonPgResult.version,
        parameterizedQuery: true,
        transaction: "committed and read back",
        connectionContextClosed: true,
      };
    }
    const pgLossInvitation = await createInvitation(
      host,
      endpoint,
      "read-write",
    );
    const pgLossBridge = await startBridge(cli, endpoint, pgLossInvitation);
    const pgLossClient = new pg.Client({
      host: "127.0.0.1",
      port: pgLossBridge.port,
      user: "pocketdb",
      database: "demo",
    });
    pgLossClient.on("error", () => undefined);
    await pgLossClient.connect();
    await pgLossClient.query("SELECT 1 AS reachable");
    const pgSocketClosed = once(pgLossClient.connection.stream, "close");
    const pgBridgeExited = waitForExit(pgLossBridge.child);

    await stopHost(host);
    await pgSocketClosed;
    const pgLossExit = await pgBridgeExited;
    assert.equal(pgLossExit.code, 4);
    await assertPortClosed(pgLossBridge.port);
    await pgLossClient.end().catch(() => undefined);

    const kvHostInvitation = await startHost(
      host,
      "kv",
      endpoint,
      "read-write",
    );
    const redisInvitations = [
      kvHostInvitation,
      await createInvitation(host, endpoint, "read-write"),
      await createInvitation(host, endpoint, "read-write"),
    ];
    const redisBridges = await Promise.all(
      redisInvitations.map((invitation) =>
        startBridge(cli, endpoint, invitation, "resp"),
      ),
    );
    if (pythonIntegration) {
      const pythonRedisInvitation = await createInvitation(
        host,
        endpoint,
        "read-write",
      );
      const pythonRedis = await startBridge(
        cli,
        endpoint,
        pythonRedisInvitation,
        "resp",
      );
      const pythonRedisResult = await runPythonExample(
        "redis_resp2.py",
        pythonRedis.port,
      );
      assert.equal(pythonRedisResult.client, "redis-py");
      assert.equal(pythonRedisResult.protocol, 2);
      assert.equal(pythonRedisResult.binaryRoundTrip, true);
      const pythonRedisExit = await stopBridge(pythonRedis.child);
      assert.equal(pythonRedisExit.code, 0);
      await assertPortClosed(pythonRedis.port);
      result.pythonRedis = {
        client: pythonRedisResult.version,
        protocol: 2,
        binaryRoundTrip: true,
        unsupportedCommand: pythonRedisResult.unsupportedCommand,
        connectionClosed: true,
      };
    }
    const redisClients = redisBridges.map(({ port }) =>
      createClient({
        url: `redis://127.0.0.1:${port}`,
        RESP: 2,
        socket: { reconnectStrategy: false },
      }).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer }),
    );
    for (const client of redisClients) client.on("error", () => undefined);
    try {
      await Promise.all(redisClients.map((client) => client.connect()));
      assert.equal(await redisClients[0].ping(), "PONG");
      const value = Buffer.from([0, 255, 13, 10, 42]);
      assert.equal(await redisClients[0].set("task047:binary", value), "OK");
      assert.deepEqual(await redisClients[1].get("task047:binary"), value);
      assert.equal(await redisClients[1].get("task047:missing"), null);
      await assert.rejects(
        redisClients[0].sendCommand(["INCR", "task047:binary"]),
        /unsupported command or arguments/,
      );
      await redisClients[2].ping();
      const redisConflictInvitation = await createInvitation(
        host,
        endpoint,
        "read-write",
      );
      const redisConflict = await runCli(
        cli,
        endpoint,
        redisConflictInvitation,
        [
          "connect",
          "--protocol",
          "resp",
          "--port",
          String(redisBridges[0].port),
          "--json",
        ],
        2,
      );
      assert.equal(redisConflict.error, "bridge-port-in-use");
      const redisControlInvitation = await createInvitation(
        host,
        endpoint,
        "read-write",
      );
      const redisControl = await startBridge(
        cli,
        endpoint,
        redisControlInvitation,
        "resp",
      );
      const redisControlExit = await stopBridge(redisControl.child, "SIGINT");
      assert.equal(redisControlExit.code, 0);
      await assertPortClosed(redisControl.port);
      const redisBridgeExits = redisBridges.map((bridge) =>
        waitForExit(bridge.child),
      );
      await stopHost(host);
      await waitFor(() => redisClients.every((client) => !client.isOpen));
      const redisExitResults = await Promise.all(redisBridgeExits);
      assert.ok(redisExitResults.every(({ code }) => code === 4));
      for (const bridge of redisBridges) await assertPortClosed(bridge.port);
      result.redisBridge = {
        driver: "node-redis 6.4.0",
        protocol: "RESP2",
        commands: ["PING", "SET", "GET", "CLIENT SETINFO"],
        binaryValues: true,
        credentialRedaction: true,
        separateInvitations: 3,
        unsupported: "INCR returned ERR unsupported command or arguments",
        hostLoss:
          "all three local Redis sockets closed after remote client failure",
        portConflictExit: 2,
        ctrlCExit: 0,
        hostLossExit: 4,
        bind: "127.0.0.1 by default",
      };
      result.nativeBridgeLifecycle = {
        postgresql: {
          portConflictExit: pgPortConflictExit,
          ctrlCExit: pgControlExit.code,
          remoteDisconnectExit: pgLossExit.code,
          remoteSocketClosed: true,
          portReleased: true,
        },
        resp: {
          portConflictExit:
            redisConflict.error === "bridge-port-in-use" ? 2 : null,
          ctrlCExit: redisControlExit.code,
          remoteDisconnectExit: redisExitResults.map(({ code }) => code),
          localSocketsClosed: true,
          portsReleased: true,
        },
        credentialRedaction: true,
      };
    } finally {
      for (const client of redisClients) client.destroy();
      await Promise.all(redisBridges.map((bridge) => stopBridge(bridge.child)));
    }

    await host.close();
    result.browser = version;
    result.keyValue = { connect: true, ping: "PONG", inspect: true };
    result.sql = {
      parameterizedQuery: true,
      ping: true,
      schemaInspection: true,
    };
    result.export = {
      readOnlyInvitation: true,
      rows: 1,
      readWriteInvitationDenied: true,
    };
  });
  const postgresDir = resolve(repo, "artifacts/task-046-postgres-bridge");
  const redisDir = resolve(repo, "artifacts/task-047-resp-bridge");
  const lifecycleDir = resolve(repo, "artifacts/task-048-cli-bridge-lifecycle");
  await Promise.all([
    mkdir(postgresDir, { recursive: true }),
    mkdir(redisDir, { recursive: true }),
    mkdir(lifecycleDir, { recursive: true }),
  ]);
  const common = {
    node: result.node,
    platform: result.platform,
    arch: result.arch,
    browser: result.browser,
  };
  await Promise.all([
    writeFile(
      resolve(postgresDir, "results.json"),
      `${JSON.stringify({ ...common, postgresBridge: result.postgresBridge, pythonPostgres: result.pythonPostgres, keyValue: result.keyValue, sql: result.sql, export: result.export }, null, 2)}\n`,
    ),
    writeFile(
      resolve(redisDir, "results.json"),
      `${JSON.stringify({ ...common, redisBridge: result.redisBridge, pythonRedis: result.pythonRedis }, null, 2)}\n`,
    ),
    writeFile(
      resolve(lifecycleDir, "results.json"),
      `${JSON.stringify({ ...common, lifecycle: result.nativeBridgeLifecycle }, null, 2)}\n`,
    ),
    ...(pythonIntegration
      ? [
          mkdir(resolve(repo, "artifacts/task-049-python-drivers"), {
            recursive: true,
          }),
          writeFile(
            resolve(repo, "artifacts/task-049-python-drivers/results.json"),
            `${JSON.stringify({ ...common, postgres: result.pythonPostgres, redis: result.pythonRedis }, null, 2)}\n`,
          ),
        ]
      : []),
  ]);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await vite.close();
  await new Promise((resolveClose) => signaling.close(resolveClose));
}

async function startBridge(cli, endpoint, invitation, protocol = "postgresql") {
  const child = spawn(
    process.execPath,
    [
      cli,
      "connect",
      "--uri-env",
      "POCKETDB_INVITATION",
      "--protocol",
      protocol,
      "--port",
      "0",
      "--json",
    ],
    {
      env: {
        ...process.env,
        POCKETDB_SIGNALING_ENDPOINT: endpoint,
        POCKETDB_INVITATION: invitation,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const started = await new Promise((resolveStart, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Bridge startup timed out: ${stderr}`)),
      90_000,
    );
    child.stdout.on("data", () => {
      const line = stdout.split("\n")[0];
      if (!line) return;
      clearTimeout(timer);
      try {
        resolveStart(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Bridge exited ${code}: ${stderr}`));
    });
  });
  assert.equal(started.listening, true);
  assert.equal(started.host, "127.0.0.1");
  assert.equal(started.protocol, protocol);
  assert.ok(!stdout.includes(invitation));
  assert.ok(!stderr.includes(invitation));
  return { child, port: started.port };
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Bridge process did not exit after shutdown.")),
      15_000,
    );
    timer.unref?.();
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

async function runPythonExample(name, port) {
  const script = resolve(repo, "examples/python", name);
  const { stdout, stderr } = await execFileAsync(python, [script], {
    env: {
      ...process.env,
      POCKETDB_LOCAL_PORT: String(port),
    },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(stderr, "");
  return JSON.parse(stdout);
}

async function stopBridge(child, signal = "SIGTERM") {
  const exited = waitForExit(child);
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  return Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Bridge shutdown timed out.")), 10_000),
    ),
  ]);
}

async function assertPortClosed(port) {
  await new Promise((resolveClosed, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(`Bridge port ${port} is still listening.`));
    });
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") resolveClosed();
      else reject(error);
    });
  });
}

async function waitFor(check) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for disconnected transaction rollback.");
}

async function runCli(cli, endpoint, invitation, args, expectedExit = 0) {
  let output;
  try {
    output = await execFileAsync(
      process.execPath,
      [cli, args[0], "--uri-env", "POCKETDB_INVITATION", ...args.slice(1)],
      {
        env: {
          ...process.env,
          POCKETDB_SIGNALING_ENDPOINT: endpoint,
          POCKETDB_INVITATION: invitation,
        },
        timeout: 90_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
  } catch (error) {
    if (expectedExit === 0) {
      throw new Error(
        `CLI exited ${error.code}; stdout=${error.stdout}; stderr=${error.stderr}`,
        { cause: error },
      );
    }
    assert.equal(
      error.code,
      expectedExit,
      `CLI exited ${error.code}; stdout=${error.stdout}; stderr=${error.stderr}`,
    );
    assert.ok(!error.stdout.includes(invitation));
    assert.ok(!error.stderr.includes(invitation));
    return JSON.parse(error.stderr);
  }
  assert.equal(
    expectedExit,
    0,
    `Expected exit ${expectedExit}, but CLI succeeded; stdout=${output.stdout}; stderr=${output.stderr}`,
  );
  assert.ok(!output.stdout.includes(invitation));
  assert.ok(!output.stderr.includes(invitation));
  return JSON.parse(output.stdout);
}

async function startHost(page, engine, endpoint, access) {
  await page.evaluate(
    `document.querySelector('[data-engine="${engine}"]').click(); document.querySelector('#start-button').click(); true`,
  );
  await page.wait(
    "document.querySelector('#runtime-status')?.dataset.state === 'running'",
    { timeoutMs: 90_000 },
  );
  return createInvitation(page, endpoint, access);
}

async function createInvitation(page, endpoint, access) {
  await page.evaluate(
    `document.querySelector('#signaling-endpoint').value = ${JSON.stringify(endpoint)}; document.querySelector('#invitation-access').value = ${JSON.stringify(access)}; document.querySelector('#create-invitation').click(); true`,
  );
  return page.wait(
    "[...document.querySelectorAll('#invitation-list input')].at(-1)?.value || false",
    { timeoutMs: 15_000 },
  );
}

async function stopHost(page) {
  await page.evaluate("document.querySelector('#stop-button').click(); true");
  await page.wait(
    "document.querySelector('#runtime-status')?.dataset.state === 'stopped'",
    { timeoutMs: 30_000 },
  );
}

function createSignalingServer() {
  const descriptions = new Map();
  return createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const match = request.url?.match(
      /^\/api\/signal\/([A-Za-z0-9_-]+)\/(offer|answer)$/,
    );
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    const key = `${match[1]}/${match[2]}`;
    if (request.method === "POST") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 64 * 1024) {
          response.writeHead(413).end();
          return;
        }
      }
      descriptions.set(key, JSON.parse(body));
      response.writeHead(204).end();
      return;
    }
    const description = descriptions.get(key);
    if (!description) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(description));
  });
}
