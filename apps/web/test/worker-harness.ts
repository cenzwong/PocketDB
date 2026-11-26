import { WorkerEngineAdapter, type WorkerLike } from "@pocketdb/runtime";

declare global {
  interface Window {
    __workerResult?: { ok: boolean; checks: string[]; error?: string };
  }
}

const capabilities = {
  operations: ["set", "get", "identity", "wait", "structured-error"],
  features: { cancellation: true },
};
const checks: string[] = [];
const createWorker = () =>
  new Worker(new URL("./worker-fixture.ts", import.meta.url), {
    type: "module",
  });
const status = document.querySelector<HTMLElement>("#status");

function setStatus(message: string): void {
  if (status) status.textContent = message;
}

async function run(): Promise<void> {
  const adapter = new WorkerEngineAdapter(
    "browser-worker-fixture",
    capabilities,
    createWorker as () => WorkerLike,
    { maxPendingRequests: 2, requestTimeoutMs: 5_000 },
  );
  const instance = adapter.createInstance({}, "primary");
  await instance.start();
  const first = await instance.openSession({
    sessionId: "session-first",
    instanceId: "primary",
    access: "owner",
    principal: "client-first",
  });
  const second = await instance.openSession({
    sessionId: "session-second",
    instanceId: "primary",
    access: "owner",
    principal: "client-second",
  });

  await instance.execute(first, {
    operation: "set",
    payload: { key: "private", value: "first" },
  });
  const shared = await instance.execute(second, {
    operation: "get",
    payload: { key: "private" },
  });
  if (shared.value !== "first")
    throw new Error("Database state was not shared across sessions.");
  const identity = await instance.execute(second, { operation: "identity" });
  if ((identity.value as { sessionId: string }).sessionId !== second.id) {
    throw new Error("Worker request lost its session identity.");
  }
  checks.push("shared instance state and session identity");

  const operationError = await instance
    .execute(first, { operation: "structured-error" })
    .then(
      () => undefined,
      (error: {
        code?: string;
        name?: string;
        details?: { sqlState?: string };
      }) => error,
    );
  if (
    operationError?.code !== "fixture-invalid-operation" ||
    operationError.name !== "EngineOperationError" ||
    operationError.details?.sqlState !== "XX000"
  ) {
    throw new Error(
      "Worker dispatch did not preserve the engine operation error.",
    );
  }
  checks.push("structured engine error across worker RPC");

  let uiTicks = 0;
  const heartbeat = setInterval(() => (uiTicks += 1), 5);
  await instance.execute(first, { operation: "wait", payload: { ms: 80 } });
  clearInterval(heartbeat);
  if (uiTicks < 2)
    throw new Error(
      "The page did not remain responsive during worker execution.",
    );
  checks.push("main thread responsiveness during worker work");

  const queuedOne = instance.execute(first, {
    operation: "wait",
    payload: { ms: 80 },
  });
  const queuedTwo = instance.execute(second, {
    operation: "wait",
    payload: { ms: 80 },
  });
  const overflow = await instance
    .execute(first, { operation: "wait", payload: { ms: 1 } })
    .then(
      () => "unexpected success",
      (error: { code?: string }) => error.code,
    );
  if (overflow !== "worker-queue-full")
    throw new Error(`Expected bounded queue error, got ${overflow}.`);
  const queuedResults = await Promise.all([queuedOne, queuedTwo]);
  if (
    (queuedResults[0].value as { sessionId: string }).sessionId !== first.id ||
    (queuedResults[1].value as { sessionId: string }).sessionId !== second.id
  ) {
    throw new Error("Concurrent queued requests lost their session identity.");
  }
  checks.push("bounded queue and concurrent session identity");

  const abort = new AbortController();
  const cancelled = instance
    .execute(first, {
      operation: "wait",
      payload: { ms: 500 },
      signal: abort.signal,
    })
    .then(
      () => "unexpected success",
      (error: { code?: string }) => error.code,
    );
  setTimeout(() => abort.abort(), 20);
  if ((await cancelled) !== "request-aborted")
    throw new Error("Active worker request did not settle on cancellation.");
  const afterCancel = await instance.execute(first, {
    operation: "get",
    payload: { key: "private" },
  });
  if (afterCancel.value !== "first")
    throw new Error("Worker did not recover after cancelling a request.");
  checks.push("cancellation and queue recovery");
  await instance.stop();

  const terminated = adapter.createInstance({}, "terminated");
  await terminated.start();
  const terminationSession = await terminated.openSession({
    sessionId: "pending-session",
    instanceId: "terminated",
    access: "owner",
  });
  const pending = terminated
    .execute(terminationSession, { operation: "wait", payload: { ms: 2_000 } })
    .then(
      () => "unexpected success",
      (error: { code?: string }) => error.code,
    );
  setTimeout(
    () => (terminated as typeof terminated & { terminate(): void }).terminate(),
    30,
  );
  if ((await pending) !== "worker-terminated")
    throw new Error("Worker termination left a request pending.");
  checks.push("pending request settlement on worker termination");

  window.__workerResult = { ok: true, checks };
  setStatus("Worker checks passed.");
}

void run().catch((error: unknown) => {
  window.__workerResult = {
    ok: false,
    checks,
    error:
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
  };
  setStatus("Worker checks failed.");
});
