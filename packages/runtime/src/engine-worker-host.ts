import {
  EngineOperationError,
  EngineRuntimeError,
  type SnapshotEngineInstance,
  type EngineAdapter,
  type EngineInstance,
  type DatasetImportResult,
  type EngineSession,
  type InstanceId,
  type SessionId,
} from "./contracts";
import type {
  WorkerCallMessage,
  WorkerReplyMessage,
  WorkerRequestMessage,
} from "./worker-protocol";

export interface EngineWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequestMessage>) => void,
  ): void;
  postMessage(message: WorkerReplyMessage): void;
}

export function installEngineWorker(
  scope: EngineWorkerScope,
  adapter: EngineAdapter,
): void {
  let instance: EngineInstance | undefined;
  let instanceId: InstanceId | undefined;
  const sessions = new Map<SessionId, EngineSession>();
  const cancellations = new Map<number, AbortController>();

  scope.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "cancel") {
      cancellations.get(message.id)?.abort();
      return;
    }
    void dispatch(message);
  });

  async function dispatch(message: WorkerCallMessage): Promise<void> {
    try {
      const result = await perform(message);
      scope.postMessage({ type: "reply", id: message.id, ok: true, result });
    } catch (error) {
      scope.postMessage({
        type: "reply",
        id: message.id,
        ok: false,
        error: {
          code:
            error instanceof EngineRuntimeError ||
            error instanceof EngineOperationError
              ? error.code
              : "execution-failed",
          message:
            error instanceof Error
              ? error.message
              : "The worker operation failed.",
          ...(error instanceof EngineOperationError && error.details
            ? { details: error.details }
            : {}),
        },
      });
    } finally {
      cancellations.delete(message.id);
    }
  }

  async function perform(
    message: WorkerCallMessage,
  ): Promise<WorkerReplyMessage["result"]> {
    if (message.method === "start") {
      if (instance) {
        throw new EngineRuntimeError(
          "instance-already-exists",
          "The worker already owns an instance.",
        );
      }
      const created = adapter.createInstance(
        message.config ?? {},
        message.instanceId,
      );
      if (
        created.id !== message.instanceId ||
        created.engineId !== adapter.id
      ) {
        throw new EngineRuntimeError(
          "instance-start-failed",
          "The adapter created an instance with mismatched identity.",
        );
      }
      instance = created;
      instanceId = message.instanceId;
      try {
        await created.start();
      } catch (cause) {
        instance = undefined;
        instanceId = undefined;
        try {
          await created.stop();
        } catch {
          // Keep the startup failure as the reported cause.
        }
        if (
          cause instanceof EngineRuntimeError ||
          cause instanceof EngineOperationError
        ) {
          throw cause;
        }
        throw new EngineRuntimeError(
          "instance-start-failed",
          "The worker engine failed to start.",
          { cause },
        );
      }
      return undefined;
    }

    const activeInstance = requireInstance(message.instanceId);
    switch (message.method) {
      case "open-session": {
        if (!message.context)
          throw new EngineRuntimeError(
            "session-open-failed",
            "Session context is missing.",
          );
        const session = await activeInstance.openSession(message.context);
        if (
          session.id !== message.context.sessionId ||
          session.instanceId !== message.instanceId
        ) {
          try {
            await activeInstance.closeSession(session);
          } catch {
            // Do not expose a session that violates the runtime contract.
          }
          throw new EngineRuntimeError(
            "session-instance-mismatch",
            "The engine returned an invalid session.",
          );
        }
        sessions.set(session.id, session);
        return session;
      }
      case "execute": {
        const session = requireSession(message.sessionId);
        if (!message.request)
          throw new EngineRuntimeError(
            "execution-failed",
            "The worker request is missing.",
          );
        const controller = new AbortController();
        cancellations.set(message.id, controller);
        return await activeInstance.execute(session, {
          ...message.request,
          signal: controller.signal,
        });
      }
      case "close-session": {
        const session = requireSession(message.sessionId);
        sessions.delete(session.id);
        await activeInstance.closeSession(session);
        return undefined;
      }
      case "health":
        return await activeInstance.health();
      case "export-native-file": {
        const nativeFileInstance = activeInstance as EngineInstance & {
          exportNativeFile?: () => Promise<Uint8Array>;
        };
        if (typeof nativeFileInstance.exportNativeFile !== "function") {
          throw new EngineOperationError(
            "native-file-unsupported",
            "This engine does not support native database file export.",
          );
        }
        return await nativeFileInstance.exportNativeFile();
      }
      case "import-dataset": {
        const datasetInstance = activeInstance as EngineInstance & {
          importDataset?: (
            fileName: string,
            bytes: Uint8Array,
          ) => Promise<DatasetImportResult>;
        };
        if (
          typeof datasetInstance.importDataset !== "function" ||
          !message.fileName ||
          !(message.fileBytes instanceof Uint8Array)
        ) {
          throw new EngineOperationError(
            "dataset-ingestion-unsupported",
            "This worker does not accept dataset imports.",
          );
        }
        return await datasetInstance.importDataset(
          message.fileName,
          message.fileBytes,
        );
      }
      case "export-snapshot": {
        const snapshotEngine =
          activeInstance as Partial<SnapshotEngineInstance>;
        if (typeof snapshotEngine.exportSnapshot !== "function") {
          throw new EngineOperationError(
            "snapshot-unsupported",
            "This engine does not support portable snapshots.",
          );
        }
        return await snapshotEngine.exportSnapshot.call(activeInstance);
      }
      case "stop": {
        const failures: unknown[] = [];
        for (const [sessionId, session] of sessions) {
          try {
            await activeInstance.closeSession(session);
          } catch (error) {
            failures.push(error);
          } finally {
            sessions.delete(sessionId);
          }
        }
        try {
          await activeInstance.stop();
        } catch (error) {
          failures.push(error);
        } finally {
          instance = undefined;
          instanceId = undefined;
        }
        if (failures.length > 0) {
          throw new EngineRuntimeError(
            "instance-stop-failed",
            `Worker stopped with ${failures.length} cleanup error(s).`,
            { cause: new AggregateError(failures) },
          );
        }
        return undefined;
      }
    }
  }

  function requireInstance(requestedId: InstanceId): EngineInstance {
    if (!instance || instanceId !== requestedId) {
      throw new EngineRuntimeError(
        "instance-not-found",
        `Worker instance '${requestedId}' is not started.`,
      );
    }
    return instance;
  }

  function requireSession(sessionId?: SessionId): EngineSession {
    if (!sessionId)
      throw new EngineRuntimeError(
        "session-not-found",
        "Session ID is missing.",
      );
    const session = sessions.get(sessionId);
    if (!session)
      throw new EngineRuntimeError(
        "session-not-found",
        `Session '${sessionId}' is not open.`,
      );
    return session;
  }
}
