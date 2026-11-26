import type { RemoteRequestMetric } from "@pocketdb/remote-access";
import type { HostPeerNetworkDiagnostic } from "./host-administration";

export const MAX_DIAGNOSTIC_EVENTS = 100;

export interface LocalDiagnosticEvent {
  readonly elapsedMs: number;
  readonly level: "info" | "warning" | "error";
  readonly category: "runtime" | "signaling" | "peer" | "request";
  readonly event: string;
  readonly code?: string;
  readonly durationMs?: number;
  readonly executionDurationMs?: number;
  readonly requestBytes?: number;
  readonly responseBytes?: number;
}

export interface LocalDiagnosticContext {
  readonly status: "stopped" | "starting" | "running" | "stopping";
  readonly engine?: string;
  readonly activePeers: number;
  readonly network: readonly HostPeerNetworkDiagnostic[];
  readonly storageUsageBytes?: number;
  readonly storageQuotaBytes?: number;
}

interface DiagnosticCounters {
  requestsReceived: number;
  successfulRequests: number;
  failedRequests: number;
  unknownOutcomes: number;
  requestDurationTotalMs: number;
  executionDurationTotalMs: number;
  requestBytes: number;
  responseBytes: number;
  activeRequests: number;
}

/** Keeps a bounded, allow-listed diagnostics journal in this page only. */
export class LocalObservability {
  private readonly events: LocalDiagnosticEvent[] = [];
  private startedAt = performance.now();
  private counters = createCounters();

  reset(): void {
    this.startedAt = performance.now();
    this.counters = createCounters();
    this.events.length = 0;
    this.record({
      level: "info",
      category: "runtime",
      event: "database-started",
    });
  }

  record(
    input: Omit<LocalDiagnosticEvent, "elapsedMs"> & {
      readonly elapsedMs?: number;
    },
  ): void {
    const entry: LocalDiagnosticEvent = {
      elapsedMs: finiteNonNegative(
        input.elapsedMs ?? Number.NaN,
        performance.now() - this.startedAt,
      ),
      level: input.level,
      category: input.category,
      event: safeLabel(input.event, "event"),
      ...(input.code === undefined ? {} : { code: safeCode(input.code) }),
      ...(input.durationMs === undefined
        ? {}
        : { durationMs: finiteNonNegative(input.durationMs, 0) }),
      ...(input.executionDurationMs === undefined
        ? {}
        : {
            executionDurationMs: finiteNonNegative(
              input.executionDurationMs,
              0,
            ),
          }),
      ...(input.requestBytes === undefined
        ? {}
        : { requestBytes: finiteNonNegative(input.requestBytes, 0) }),
      ...(input.responseBytes === undefined
        ? {}
        : { responseBytes: finiteNonNegative(input.responseBytes, 0) }),
    };
    this.events.push(entry);
    if (this.events.length > MAX_DIAGNOSTIC_EVENTS) this.events.shift();
  }

  recordRequest(metric: RemoteRequestMetric): void {
    this.counters.requestsReceived += 1;
    this.counters.successfulRequests += metric.outcome === "success" ? 1 : 0;
    this.counters.failedRequests += metric.outcome === "failed" ? 1 : 0;
    this.counters.unknownOutcomes += metric.outcome === "unknown" ? 1 : 0;
    this.counters.requestDurationTotalMs += finiteNonNegative(
      metric.durationMs,
      0,
    );
    this.counters.executionDurationTotalMs += finiteNonNegative(
      metric.executionDurationMs,
      0,
    );
    this.counters.requestBytes += finiteNonNegative(metric.requestBytes, 0);
    this.counters.responseBytes += finiteNonNegative(metric.responseBytes, 0);
    this.counters.activeRequests = finiteNonNegative(metric.activeRequests, 0);
    this.record({
      level: metric.outcome === "success" ? "info" : "warning",
      category: "request",
      event: "remote-request-completed",
      ...(metric.code ? { code: metric.code } : {}),
      durationMs: metric.durationMs,
      executionDurationMs: metric.executionDurationMs,
      requestBytes: metric.requestBytes,
      responseBytes: metric.responseBytes,
    });
  }

  export(context: LocalDiagnosticContext): {
    readonly format: "pocketdb-local-diagnostics-v1";
    readonly generatedAt: string;
    readonly telemetry: "disabled";
    readonly runtime: {
      readonly status: LocalDiagnosticContext["status"];
      readonly engine?: string;
      readonly uptimeMs: number;
      readonly activePeers: number;
      readonly requestsReceived: number;
      readonly successfulRequests: number;
      readonly failedRequests: number;
      readonly unknownOutcomes: number;
      readonly averageRequestDurationMs: number;
      readonly averageExecutionDurationMs: number;
      readonly requestBytes: number;
      readonly responseBytes: number;
      readonly activeRequests: number;
    };
    readonly browserStorage: {
      readonly usageBytes?: number;
      readonly quotaBytes?: number;
    };
    readonly network: readonly DiagnosticNetworkEntry[];
    readonly events: readonly LocalDiagnosticEvent[];
  } {
    const counters = this.counters;
    return {
      format: "pocketdb-local-diagnostics-v1",
      generatedAt: new Date().toISOString(),
      telemetry: "disabled",
      runtime: {
        status: context.status,
        ...(context.engine
          ? { engine: safeLabel(context.engine, "unknown") }
          : {}),
        uptimeMs: Math.max(0, Math.round(performance.now() - this.startedAt)),
        activePeers: finiteNonNegative(context.activePeers, 0),
        requestsReceived: counters.requestsReceived,
        successfulRequests: counters.successfulRequests,
        failedRequests: counters.failedRequests,
        unknownOutcomes: counters.unknownOutcomes,
        averageRequestDurationMs:
          counters.requestsReceived === 0
            ? 0
            : Math.round(
                counters.requestDurationTotalMs / counters.requestsReceived,
              ),
        averageExecutionDurationMs:
          counters.requestsReceived === 0
            ? 0
            : Math.round(
                counters.executionDurationTotalMs / counters.requestsReceived,
              ),
        requestBytes: counters.requestBytes,
        responseBytes: counters.responseBytes,
        activeRequests: counters.activeRequests,
      },
      browserStorage: {
        ...(context.storageUsageBytes === undefined
          ? {}
          : { usageBytes: finiteNonNegative(context.storageUsageBytes, 0) }),
        ...(context.storageQuotaBytes === undefined
          ? {}
          : { quotaBytes: finiteNonNegative(context.storageQuotaBytes, 0) }),
      },
      network: context.network.map(toDiagnosticNetworkEntry),
      events: this.events.map((event) => ({ ...event })),
    };
  }
}

interface DiagnosticNetworkEntry {
  readonly invitationState: string;
  readonly transportState?: string;
  readonly peerConnectionState?: string;
  readonly iceConnectionState?: string;
  readonly path: "direct" | "relay" | "unknown";
  readonly candidateTypes: readonly string[];
  readonly iceErrorCodes: readonly number[];
  readonly currentRoundTripTimeMs?: number;
  readonly dataChannelBytesSent?: number;
  readonly dataChannelBytesReceived?: number;
  readonly dataChannelBufferedBytes?: number;
  readonly detailsAvailable: boolean;
}

function toDiagnosticNetworkEntry(
  entry: HostPeerNetworkDiagnostic,
): DiagnosticNetworkEntry {
  return {
    invitationState: entry.invitationState,
    ...(entry.transportState
      ? { transportState: safeLabel(entry.transportState, "unknown") }
      : {}),
    ...(entry.peerConnectionState
      ? { peerConnectionState: safeLabel(entry.peerConnectionState, "unknown") }
      : {}),
    ...(entry.iceConnectionState
      ? { iceConnectionState: safeLabel(entry.iceConnectionState, "unknown") }
      : {}),
    path: entry.path,
    candidateTypes: entry.candidateTypes
      .filter((value) => /^[a-z-]{1,24}$/i.test(value))
      .slice(0, 8),
    iceErrorCodes: entry.iceErrorCodes
      .filter((value) => Number.isSafeInteger(value) && value >= 0)
      .slice(0, 16),
    ...(entry.currentRoundTripTimeMs === undefined
      ? {}
      : {
          currentRoundTripTimeMs: finiteNonNegative(
            entry.currentRoundTripTimeMs,
            0,
          ),
        }),
    ...(entry.dataChannelBytesSent === undefined
      ? {}
      : {
          dataChannelBytesSent: finiteNonNegative(
            entry.dataChannelBytesSent,
            0,
          ),
        }),
    ...(entry.dataChannelBytesReceived === undefined
      ? {}
      : {
          dataChannelBytesReceived: finiteNonNegative(
            entry.dataChannelBytesReceived,
            0,
          ),
        }),
    ...(entry.dataChannelBufferedBytes === undefined
      ? {}
      : {
          dataChannelBufferedBytes: finiteNonNegative(
            entry.dataChannelBufferedBytes,
            0,
          ),
        }),
    detailsAvailable: entry.detailsAvailable === true,
  };
}

function createCounters(): DiagnosticCounters {
  return {
    requestsReceived: 0,
    successfulRequests: 0,
    failedRequests: 0,
    unknownOutcomes: 0,
    requestDurationTotalMs: 0,
    executionDurationTotalMs: 0,
    requestBytes: 0,
    responseBytes: 0,
    activeRequests: 0,
  };
}

function safeCode(value: string): string | undefined {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value) ? value : undefined;
}

function safeLabel(value: string, fallback: string): string {
  return /^[a-z0-9][a-z0-9._-]{0,47}$/i.test(value) ? value : fallback;
}

function finiteNonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}
