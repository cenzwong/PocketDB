import {
  WorkerEngineAdapter,
  type EngineInstance,
  type WorkerLike,
} from "@pocketdb/runtime";
import { encodeSnapshot } from "@pocketdb/runtime";

declare global {
  interface Window {
    __pglitePersistenceProbe?: {
      run: () => Promise<unknown>;
      runQuota: () => Promise<unknown>;
      holdOwner: (dataDir: string) => Promise<void>;
      readOwner: () => Promise<unknown>;
      closeOwner: () => Promise<void>;
      tryOpenOwner: (dataDir: string) => Promise<unknown>;
      runSnapshots: () => Promise<unknown>;
    };
  }
}

const capabilities = {
  operations: ["query", "schema", "describe-query"],
  readOnlyOperations: ["query", "schema", "describe-query"],
  features: { persistentDataDir: true, portableSnapshots: true },
};
let heldOwner: EngineInstance | undefined;
let heldOwnerSession: Awaited<ReturnType<typeof openSession>> | undefined;

function createInstance(
  instanceId: string,
  dataDir: string,
  snapshot?: Uint8Array,
): EngineInstance {
  const adapter = new WorkerEngineAdapter(
    "postgresql",
    capabilities,
    (() =>
      new Worker(new URL("./persistence-worker.ts", import.meta.url), {
        type: "module",
      })) as () => WorkerLike,
    { maxPendingRequests: 8, requestTimeoutMs: 30_000 },
  );
  return adapter.createInstance(
    { dataDir, ...(snapshot ? { snapshot } : {}) },
    instanceId,
  );
}

async function runSnapshots(): Promise<unknown> {
  const seed = crypto.randomUUID().replaceAll("-", "");
  const source = createInstance(`snapshot-source-${seed}`, "memory://");
  const sourceSession = await openSession(
    source,
    `snapshot-source-session-${seed}`,
  );
  await query(
    source,
    sourceSession,
    "CREATE TABLE snapshot_rows (id integer, value text)",
  );
  await query(
    source,
    sourceSession,
    "INSERT INTO snapshot_rows VALUES (1, $1)",
    ["worker-round-trip"],
  );
  const snapshot = await (
    source as EngineInstance & {
      exportSnapshot(): Promise<Uint8Array>;
    }
  ).exportSnapshot();
  await source.stop();

  const restored = createInstance(
    `snapshot-restored-${seed}`,
    "memory://",
    snapshot,
  );
  const restoredSession = await openSession(
    restored,
    `snapshot-restored-session-${seed}`,
  );
  const restoredRows = await query(
    restored,
    restoredSession,
    "SELECT id, value FROM snapshot_rows",
  );
  await restored.stop();

  const dataDir = `idb://pocketdb-pglite-${seed}-occupied`;
  const existing = createInstance(`snapshot-existing-${seed}`, dataDir);
  const existingSession = await openSession(
    existing,
    `snapshot-existing-session-${seed}`,
  );
  await query(
    existing,
    existingSession,
    "CREATE TABLE existing_rows (value text)",
  );
  await query(
    existing,
    existingSession,
    "INSERT INTO existing_rows VALUES ($1)",
    ["preserved"],
  );
  await existing.stop();

  const malformed = createInstance(
    `snapshot-malformed-${seed}`,
    dataDir,
    new Uint8Array([1, 2]),
  );
  const malformedCode = await malformed.start().then(
    () => "unexpected-success",
    (error: { code?: string }) => error.code ?? "unknown-error",
  );
  await malformed.stop().catch(() => undefined);

  const incompatible = createInstance(
    `snapshot-incompatible-${seed}`,
    dataDir,
    encodeSnapshot("kv", "kv-entries-v1", new Uint8Array()),
  );
  const incompatibleCode = await incompatible.start().then(
    () => "unexpected-success",
    (error: { code?: string }) => error.code ?? "unknown-error",
  );
  await incompatible.stop().catch(() => undefined);

  const rejected = createInstance(
    `snapshot-rejected-${seed}`,
    dataDir,
    snapshot,
  );
  const occupiedCode = await rejected.start().then(
    () => "unexpected-success",
    (error: { code?: string }) => error.code ?? "unknown-error",
  );
  await rejected.stop().catch(() => undefined);

  const reopened = createInstance(`snapshot-reopened-${seed}`, dataDir);
  const reopenedSession = await openSession(
    reopened,
    `snapshot-reopened-session-${seed}`,
  );
  const preservedRows = await query(
    reopened,
    reopenedSession,
    "SELECT value FROM existing_rows",
  );
  await reopened.stop();
  return {
    ok:
      restoredRows.rows[0]?.value === "worker-round-trip" &&
      malformedCode === "snapshot-invalid" &&
      incompatibleCode === "snapshot-incompatible" &&
      occupiedCode === "snapshot-target-not-empty" &&
      preservedRows.rows[0]?.value === "preserved",
    browser: navigator.userAgent,
    malformedCode,
    incompatibleCode,
    occupiedCode,
    restoredRows,
    preservedRows,
  };
}

async function openSession(instance: EngineInstance, sessionId: string) {
  await instance.start();
  return instance.openSession({
    sessionId,
    instanceId: instance.id,
    access: "owner",
  });
}

async function query(
  instance: EngineInstance,
  session: Awaited<ReturnType<typeof openSession>>,
  sql: string,
  params?: unknown[],
): Promise<{ rows: Record<string, unknown>[] }> {
  const result = await instance.execute(session, {
    operation: "query",
    payload: { sql, ...(params ? { params } : {}) },
  });
  return result.value as { rows: Record<string, unknown>[] };
}

async function run(): Promise<unknown> {
  const seed = crypto.randomUUID().replaceAll("-", "");
  const dataDir = `idb://pocketdb-${seed}-primary`;
  const owner = createInstance(`owner-${seed}`, dataDir);
  const ownerSession = await openSession(owner, `session-owner-${seed}`);
  await query(
    owner,
    ownerSession,
    "CREATE TABLE persistence_probe (value text)",
  );
  await query(
    owner,
    ownerSession,
    "INSERT INTO persistence_probe VALUES ($1)",
    ["survives-close"],
  );

  const contender = createInstance(`contender-${seed}`, dataDir);
  const ownershipCode = await contender.start().then(
    () => "unexpected-success",
    (error: { code?: string }) => error.code ?? "unknown-error",
  );
  if (ownershipCode !== "postgres-storage-already-owned") {
    await owner.stop();
    throw new Error(
      `Expected persistent ownership rejection, got ${ownershipCode}.`,
    );
  }
  const ownerRead = await query(
    owner,
    ownerSession,
    "SELECT value FROM persistence_probe",
  );
  if (ownerRead.rows[0]?.value !== "survives-close") {
    await owner.stop();
    throw new Error(
      "A competing owner disturbed the active persistent database.",
    );
  }
  await owner.stop();

  const reopened = createInstance(`reopened-${seed}`, dataDir);
  const reopenedSession = await openSession(
    reopened,
    `session-reopened-${seed}`,
  );
  const persisted = await query(
    reopened,
    reopenedSession,
    "SELECT value FROM persistence_probe",
  );
  if (persisted.rows[0]?.value !== "survives-close") {
    await reopened.stop();
    throw new Error("Persistent data did not survive close and worker reopen.");
  }
  await reopened.stop();

  const firstDir = `idb://pocketdb-${seed}-separate-a`;
  const secondDir = `idb://pocketdb-${seed}-separate-b`;
  const first = createInstance(`separate-a-${seed}`, firstDir);
  const second = createInstance(`separate-b-${seed}`, secondDir);
  const [firstSession, secondSession] = await Promise.all([
    openSession(first, `session-separate-a-${seed}`),
    openSession(second, `session-separate-b-${seed}`),
  ]);
  await query(first, firstSession, "CREATE TABLE isolated_probe (value text)");
  await query(first, firstSession, "INSERT INTO isolated_probe VALUES ($1)", [
    "first",
  ]);
  const isolated = await query(
    second,
    secondSession,
    "SELECT to_regclass('public.isolated_probe') AS name",
  );
  if (isolated.rows[0]?.name !== null) {
    await Promise.all([first.stop(), second.stop()]);
    throw new Error("Separate persistent instances shared database state.");
  }
  await Promise.all([first.stop(), second.stop()]);

  const ephemeralOne = createInstance(`ephemeral-a-${seed}`, "memory://");
  const ephemeralSession = await openSession(
    ephemeralOne,
    `session-ephemeral-a-${seed}`,
  );
  await query(
    ephemeralOne,
    ephemeralSession,
    "CREATE TABLE ephemeral_probe (value text)",
  );
  await query(
    ephemeralOne,
    ephemeralSession,
    "INSERT INTO ephemeral_probe VALUES ('temporary')",
  );
  await ephemeralOne.stop();
  const ephemeralTwo = createInstance(`ephemeral-b-${seed}`, "memory://");
  const ephemeralSessionTwo = await openSession(
    ephemeralTwo,
    `session-ephemeral-b-${seed}`,
  );
  const ephemeral = await query(
    ephemeralTwo,
    ephemeralSessionTwo,
    "SELECT to_regclass('public.ephemeral_probe') AS name",
  );
  if (ephemeral.rows[0]?.name !== null) {
    await ephemeralTwo.stop();
    throw new Error(
      "Ephemeral PostgreSQL state survived instance termination.",
    );
  }
  await ephemeralTwo.stop();

  return {
    ok: true,
    browser: navigator.userAgent,
    checks: [
      "persistent close and worker reopen",
      "same-origin concurrent ownership rejection and release",
      "distinct IndexedDB directories isolate instances",
      "memory mode is empty after termination",
    ],
  };
}

async function runQuota(): Promise<unknown> {
  const seed = crypto.randomUUID().replaceAll("-", "");
  const instance = createInstance(
    `quota-${seed}`,
    `idb://pocketdb-${seed}-quota`,
  );
  try {
    const session = await openSession(instance, `session-quota-${seed}`);
    await query(instance, session, "CREATE TABLE quota_probe (value text)");
    await query(
      instance,
      session,
      "INSERT INTO quota_probe VALUES (repeat('x', 1000000))",
    );
    await instance.stop();
    return { ok: false, code: "write-unexpectedly-succeeded" };
  } catch (error) {
    if (
      "code" in Object(error) &&
      Object(error).code === "postgres-storage-quota-exceeded"
    ) {
      return { ok: true, code: "postgres-storage-quota-exceeded" };
    }
    return {
      ok: false,
      code: "code" in Object(error) ? Object(error).code : "unknown-error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await instance.stop().catch(() => undefined);
  }
}

async function holdOwner(dataDir: string): Promise<void> {
  if (heldOwner)
    throw new Error("This tab already holds a persistence probe database.");
  const seed = crypto.randomUUID().replaceAll("-", "");
  heldOwner = createInstance(`cross-tab-owner-${seed}`, dataDir);
  heldOwnerSession = await openSession(
    heldOwner,
    `session-cross-tab-owner-${seed}`,
  );
  await query(
    heldOwner,
    heldOwnerSession,
    "CREATE TABLE cross_tab_probe (value text)",
  );
  await query(
    heldOwner,
    heldOwnerSession,
    "INSERT INTO cross_tab_probe VALUES ('held-value')",
  );
}

async function readOwner(): Promise<unknown> {
  if (!heldOwner || !heldOwnerSession)
    throw new Error("No owner database is open in this tab.");
  return query(
    heldOwner,
    heldOwnerSession,
    "SELECT value FROM cross_tab_probe",
  );
}

async function closeOwner(): Promise<void> {
  if (!heldOwner) return;
  const owner = heldOwner;
  heldOwner = undefined;
  heldOwnerSession = undefined;
  await owner.stop();
}

async function tryOpenOwner(dataDir: string): Promise<unknown> {
  const seed = crypto.randomUUID().replaceAll("-", "");
  const contender = createInstance(`cross-tab-contender-${seed}`, dataDir);
  try {
    const session = await openSession(
      contender,
      `session-cross-tab-contender-${seed}`,
    );
    const value = await query(
      contender,
      session,
      "SELECT value FROM cross_tab_probe",
    );
    await contender.stop();
    return { ok: true, value: value.rows[0]?.value ?? null };
  } catch (error) {
    await contender.stop().catch(() => undefined);
    return {
      ok: false,
      code: "code" in Object(error) ? Object(error).code : "unknown-error",
    };
  }
}

window.__pglitePersistenceProbe = {
  run,
  runQuota,
  runSnapshots,
  holdOwner,
  readOwner,
  closeOwner,
  tryOpenOwner,
};
document
  .querySelector("#result")
  ?.replaceChildren(document.createTextNode("ready"));
