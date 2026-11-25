import type {
  EngineConfig,
  EngineHealth,
  EngineRequest,
  EngineResponse,
  EngineSession,
  DatasetImportResult,
  InstanceId,
  SessionContext,
  SessionId,
} from "./contracts";

export type WorkerCallMethod =
  | "start"
  | "open-session"
  | "execute"
  | "close-session"
  | "health"
  | "export-snapshot"
  | "export-native-file"
  | "import-dataset"
  | "stop";

export interface WorkerCallMessage {
  readonly type: "call";
  readonly id: number;
  readonly method: WorkerCallMethod;
  readonly instanceId: InstanceId;
  readonly config?: EngineConfig;
  readonly context?: SessionContext;
  readonly sessionId?: SessionId;
  readonly request?: Omit<EngineRequest, "signal">;
  readonly fileName?: string;
  readonly fileBytes?: Uint8Array;
}

export interface WorkerCancelMessage {
  readonly type: "cancel";
  readonly id: number;
}

export type WorkerRequestMessage = WorkerCallMessage | WorkerCancelMessage;

export interface SerializedWorkerError {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface WorkerReplyMessage {
  readonly type: "reply";
  readonly id: number;
  readonly ok: boolean;
  readonly result?:
    | EngineHealth
    | EngineSession
    | EngineResponse
    | Uint8Array
    | DatasetImportResult
    | undefined;
  readonly error?: SerializedWorkerError;
}
