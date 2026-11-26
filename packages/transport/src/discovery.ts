import {
  WebRTCDataChannelAdapter,
  type WebRTCDataChannelOptions,
} from "./webrtc-data-channel";
import type { TransportConnection, TransportAdapter } from "./contracts";

export type SignalRole = "offer" | "answer";

export interface SignalingAdapter {
  readonly id: string;
  publishDescription(
    roomId: string,
    role: SignalRole,
    description: RTCSessionDescriptionInit,
    signal?: AbortSignal,
  ): Promise<void>;
  receiveDescription(
    roomId: string,
    role: SignalRole,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ): Promise<RTCSessionDescriptionInit>;
}

export interface DiscoveryAdapter<Config = WebRTCDiscoveryConfig> {
  readonly id: string;
  connect(config: Config): Promise<DiscoveredPeer>;
}

export interface IceConfiguration {
  readonly iceServers?: readonly RTCIceServer[];
  readonly iceTransportPolicy?: RTCIceTransportPolicy;
}

export interface WebRTCDiscoveryConfig extends IceConfiguration {
  readonly roomId: string;
  readonly peerId: string;
  readonly role: "offerer" | "answerer";
  readonly channelLabel?: string;
  readonly signalingTimeoutMs?: number;
  readonly gatheringTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface IceDiagnostics {
  readonly connectionState: RTCPeerConnectionState;
  readonly iceConnectionState: RTCIceConnectionState;
  readonly candidateTypes: readonly string[];
  readonly iceErrorCodes: readonly number[];
  readonly currentRoundTripTimeMs?: number;
  readonly dataChannelBytesSent?: number;
  readonly dataChannelBytesReceived?: number;
  readonly dataChannelBufferedBytes?: number;
  readonly selectedPair?: {
    readonly localCandidateType?: string;
    readonly remoteCandidateType?: string;
    readonly protocol?: string;
  };
}

export interface DiscoveredPeer {
  readonly peerConnection: RTCPeerConnection;
  readonly dataChannel: RTCDataChannel;
  readonly transport: TransportConnection;
  diagnostics(): Promise<IceDiagnostics>;
  close(): Promise<void>;
}

export type SignalingErrorCode =
  | "invalid-room"
  | "signaling-unavailable"
  | "signaling-http-error"
  | "signaling-room-not-found"
  | "signaling-peer-timeout"
  | "signaling-invalid-response"
  | "signaling-aborted"
  | "invalid-ice-configuration"
  | "ice-gathering-timeout"
  | "data-channel-timeout"
  | "peer-connection-failed";

export class SignalingError extends Error {
  constructor(
    readonly code: SignalingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SignalingError";
  }
}

export interface HttpRoomSignalingOptions {
  readonly endpoint: string;
  readonly fetcher?: typeof fetch;
  readonly pollIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxSignalBytes?: number;
}

const DEFAULT_SIGNAL_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_SIGNAL_BYTES = 64 * 1024;

/** Client for a replaceable HTTPS room service using the TASK-004 offer/answer shape. */
export class HttpRoomSignalingAdapter implements SignalingAdapter {
  readonly id = "http-room-signaling";
  private readonly endpoint: URL;
  private readonly fetcher: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxSignalBytes: number;

  constructor(options: HttpRoomSignalingOptions) {
    this.endpoint = validateEndpoint(options.endpoint);
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_SIGNAL_TIMEOUT_MS;
    this.maxSignalBytes = options.maxSignalBytes ?? DEFAULT_MAX_SIGNAL_BYTES;
    validatePositiveInteger("pollIntervalMs", this.pollIntervalMs);
    validatePositiveInteger("requestTimeoutMs", this.requestTimeoutMs);
    validatePositiveInteger("maxSignalBytes", this.maxSignalBytes);
  }

  async publishDescription(
    roomId: string,
    role: SignalRole,
    description: RTCSessionDescriptionInit,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = this.signalUrl(roomId, role);
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(description),
        cache: "no-store",
        credentials: "omit",
        signal,
      });
      if (response.status === 404) {
        throw new SignalingError(
          "signaling-room-not-found",
          "The signaling room does not exist or has expired.",
        );
      }
      if (!response.ok) {
        throw new SignalingError(
          "signaling-http-error",
          `The signaling service returned HTTP ${response.status}.`,
        );
      }
    } catch (cause) {
      if (cause instanceof SignalingError) throw cause;
      if (signal?.aborted) {
        throw new SignalingError(
          "signaling-aborted",
          "Signaling was cancelled.",
          { cause },
        );
      }
      throw new SignalingError(
        "signaling-unavailable",
        "The configured signaling service could not be reached.",
        { cause },
      );
    }
  }

  async receiveDescription(
    roomId: string,
    role: SignalRole,
    options: {
      readonly timeoutMs?: number;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<RTCSessionDescriptionInit> {
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    validatePositiveInteger("timeoutMs", timeoutMs);
    const url = this.signalUrl(roomId, role);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw new SignalingError(
          "signaling-aborted",
          "Signaling was cancelled.",
        );
      }
      const requestSignal = AbortSignal.any([
        options.signal ?? new AbortController().signal,
        AbortSignal.timeout(
          Math.max(1, Math.min(timeoutMs, deadline - Date.now())),
        ),
      ]);
      try {
        const response = await this.fetcher(url, {
          cache: "no-store",
          credentials: "omit",
          signal: requestSignal,
        });
        if (response.status === 404) {
          await delay(this.pollIntervalMs, options.signal);
          continue;
        }
        if (!response.ok) {
          throw new SignalingError(
            "signaling-http-error",
            `The signaling service returned HTTP ${response.status}.`,
          );
        }
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > this.maxSignalBytes) {
          throw new SignalingError(
            "signaling-invalid-response",
            "The remote signaling description exceeds the configured size limit.",
          );
        }
        const value: unknown = JSON.parse(text);
        if (
          !isRecord(value) ||
          value.type !== role ||
          typeof value.sdp !== "string" ||
          value.sdp.length === 0
        ) {
          throw new SignalingError(
            "signaling-invalid-response",
            "The signaling service returned an invalid peer description.",
          );
        }
        return { type: value.type as SignalRole, sdp: value.sdp };
      } catch (cause) {
        if (cause instanceof SignalingError) throw cause;
        if (options.signal?.aborted) {
          throw new SignalingError(
            "signaling-aborted",
            "Signaling was cancelled.",
            { cause },
          );
        }
        if (Date.now() >= deadline) break;
        throw new SignalingError(
          "signaling-unavailable",
          "The configured signaling service could not be reached.",
          { cause },
        );
      }
    }
    throw new SignalingError(
      "signaling-peer-timeout",
      `The signaling service did not provide a ${role} description before the timeout.`,
    );
  }

  private signalUrl(roomId: string, role: SignalRole): URL {
    validateRoomId(roomId);
    const url = new URL(this.endpoint);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/signal/${encodeURIComponent(roomId)}/${role}`;
    url.search = "";
    url.hash = "";
    return url;
  }
}

/** Gathers complete ICE descriptions, exchanges them through a replaceable provider, then opens the byte transport. */
export class WebRTCDiscoveryAdapter implements DiscoveryAdapter {
  readonly id = "webrtc-room-discovery";
  private readonly transportAdapter: TransportAdapter<{
    readonly peerId: string;
    readonly peerConnection: RTCPeerConnection;
    readonly channel: RTCDataChannel;
  }>;

  constructor(
    private readonly signaling: SignalingAdapter,
    transportAdapter?: TransportAdapter<{
      readonly peerId: string;
      readonly peerConnection: RTCPeerConnection;
      readonly channel: RTCDataChannel;
    }>,
    transportOptions: WebRTCDataChannelOptions = {},
  ) {
    this.transportAdapter =
      transportAdapter ?? new WebRTCDataChannelAdapter(transportOptions);
  }

  async connect(config: WebRTCDiscoveryConfig): Promise<DiscoveredPeer> {
    validateRoomId(config.roomId);
    if (!config.peerId.trim())
      throw new TypeError("A non-empty peerId is required.");
    validateIceConfiguration(config);
    const peerConnection = new RTCPeerConnection({
      iceServers: config.iceServers?.map((server) => ({ ...server })),
      ...(config.iceTransportPolicy === undefined
        ? {}
        : { iceTransportPolicy: config.iceTransportPolicy }),
    });
    const candidateTypes = new Set<string>();
    const iceErrorCodes = new Set<number>();
    peerConnection.addEventListener("icecandidate", (event) => {
      if (event.candidate?.type) candidateTypes.add(event.candidate.type);
    });
    peerConnection.addEventListener("icecandidateerror", (event) => {
      iceErrorCodes.add(event.errorCode);
    });
    let dataChannel: RTCDataChannel | undefined;
    let cancelChannelWait: (() => void) | undefined;
    try {
      if (config.role === "offerer") {
        dataChannel = peerConnection.createDataChannel(
          config.channelLabel ?? "pocketdb",
          {
            ordered: true,
          },
        );
        const offer = await localDescription(
          peerConnection,
          await peerConnection.createOffer(),
          config.gatheringTimeoutMs,
          config.signal,
        );
        await this.signaling.publishDescription(
          config.roomId,
          "offer",
          offer,
          config.signal,
        );
        const answer = await this.signaling.receiveDescription(
          config.roomId,
          "answer",
          { timeoutMs: config.signalingTimeoutMs, signal: config.signal },
        );
        await peerConnection.setRemoteDescription(answer);
      } else {
        const channel = new Promise<RTCDataChannel>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            peerConnection.removeEventListener("datachannel", onChannel);
            peerConnection.removeEventListener(
              "connectionstatechange",
              onState,
            );
            config.signal?.removeEventListener("abort", onAbort);
          };
          const onChannel = (event: RTCDataChannelEvent) => {
            cleanup();
            resolve(event.channel);
          };
          const onState = () => {
            if (
              peerConnection.connectionState === "failed" ||
              peerConnection.connectionState === "closed"
            ) {
              cleanup();
              reject(
                new SignalingError(
                  "peer-connection-failed",
                  "Peer connection failed before the data channel arrived.",
                ),
              );
            }
          };
          const onAbort = () => {
            cleanup();
            reject(
              new SignalingError(
                "signaling-aborted",
                "Peer discovery was cancelled.",
              ),
            );
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(
              new SignalingError(
                "data-channel-timeout",
                "Timed out waiting for the peer data channel.",
              ),
            );
          }, config.connectTimeoutMs ?? DEFAULT_SIGNAL_TIMEOUT_MS);
          cancelChannelWait = cleanup;
          peerConnection.addEventListener("datachannel", onChannel);
          peerConnection.addEventListener("connectionstatechange", onState);
          if (config.signal?.aborted) onAbort();
          else
            config.signal?.addEventListener("abort", onAbort, { once: true });
        });
        // Attach the rejection handler before signaling can yield.
        const channelResult = channel.then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        const offer = await this.signaling.receiveDescription(
          config.roomId,
          "offer",
          { timeoutMs: config.signalingTimeoutMs, signal: config.signal },
        );
        await peerConnection.setRemoteDescription(offer);
        const answer = await localDescription(
          peerConnection,
          await peerConnection.createAnswer(),
          config.gatheringTimeoutMs,
          config.signal,
        );
        await this.signaling.publishDescription(
          config.roomId,
          "answer",
          answer,
          config.signal,
        );
        const result = await channelResult;
        if ("error" in result) throw result.error;
        dataChannel = result.value;
      }
      if (!dataChannel)
        throw new Error("Peer negotiation did not create a data channel.");
      const openedDataChannel = dataChannel;
      const transport = await this.transportAdapter.connect({
        peerId: config.peerId,
        peerConnection,
        channel: openedDataChannel,
      });
      const diagnostics = async (): Promise<IceDiagnostics> => {
        const stats = await peerConnection.getStats();
        const transportStats = [...stats.values()].find(
          (item) =>
            "selectedCandidatePairId" in item && item.selectedCandidatePairId,
        ) as (RTCStats & { selectedCandidatePairId?: string }) | undefined;
        const pair = transportStats?.selectedCandidatePairId
          ? stats.get(transportStats.selectedCandidatePairId)
          : undefined;
        const selectedPair = pair as
          | (RTCStats & {
              localCandidateId?: string;
              remoteCandidateId?: string;
              currentRoundTripTime?: number;
            })
          | undefined;
        const local = selectedPair?.localCandidateId
          ? stats.get(selectedPair.localCandidateId)
          : undefined;
        const remote = selectedPair?.remoteCandidateId
          ? stats.get(selectedPair.remoteCandidateId)
          : undefined;
        const dataChannelStats = [...stats.values()].find(
          (item) => item.type === "data-channel",
        ) as
          | (RTCStats & {
              bytesSent?: number;
              bytesReceived?: number;
            })
          | undefined;
        return {
          connectionState: peerConnection.connectionState,
          iceConnectionState: peerConnection.iceConnectionState,
          candidateTypes: [...candidateTypes].sort(),
          iceErrorCodes: [...iceErrorCodes].sort((a, b) => a - b),
          ...(typeof selectedPair?.currentRoundTripTime === "number"
            ? {
                currentRoundTripTimeMs:
                  selectedPair.currentRoundTripTime * 1_000,
              }
            : {}),
          ...(typeof dataChannelStats?.bytesSent === "number"
            ? { dataChannelBytesSent: dataChannelStats.bytesSent }
            : {}),
          ...(typeof dataChannelStats?.bytesReceived === "number"
            ? { dataChannelBytesReceived: dataChannelStats.bytesReceived }
            : {}),
          dataChannelBufferedBytes: openedDataChannel.bufferedAmount,
          ...(selectedPair
            ? {
                selectedPair: {
                  localCandidateType: candidateType(local),
                  remoteCandidateType: candidateType(remote),
                  protocol: statsString(local, "protocol"),
                },
              }
            : {}),
        };
      };
      return {
        peerConnection,
        dataChannel: openedDataChannel,
        transport,
        diagnostics,
        async close() {
          await transport.disconnect("discovery peer closed");
          if (peerConnection.connectionState !== "closed")
            peerConnection.close();
        },
      };
    } catch (cause) {
      cancelChannelWait?.();
      dataChannel?.close();
      peerConnection.close();
      if (cause instanceof SignalingError) throw cause;
      if (config.signal?.aborted) {
        throw new SignalingError(
          "signaling-aborted",
          "Peer discovery was cancelled.",
          { cause },
        );
      }
      throw cause;
    }
  }
}

export function validateIceConfiguration(config: IceConfiguration): void {
  if (
    config.iceTransportPolicy !== undefined &&
    config.iceTransportPolicy !== "all" &&
    config.iceTransportPolicy !== "relay"
  ) {
    throw new SignalingError(
      "invalid-ice-configuration",
      "iceTransportPolicy must be 'all' or 'relay'.",
    );
  }
  for (const server of config.iceServers ?? []) {
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new SignalingError(
        "invalid-ice-configuration",
        "Every ICE server requires a URL.",
      );
    }
    const usesTurn = urls.some((url) => /^turns?:/i.test(url));
    if (usesTurn && (!server.username || !server.credential)) {
      throw new SignalingError(
        "invalid-ice-configuration",
        "TURN servers require scoped username and credential values.",
      );
    }
    if (urls.some((url) => !/^(?:stuns?|turns?):\S+$/i.test(url))) {
      throw new SignalingError(
        "invalid-ice-configuration",
        "ICE server URLs must use stun:, stuns:, turn: or turns: schemes.",
      );
    }
  }
}

async function localDescription(
  peerConnection: RTCPeerConnection,
  description: RTCSessionDescriptionInit,
  timeoutMs = DEFAULT_SIGNAL_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<RTCSessionDescriptionInit> {
  await peerConnection.setLocalDescription(description);
  if (peerConnection.iceGatheringState !== "complete") {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        peerConnection.removeEventListener("icegatheringstatechange", onState);
        signal?.removeEventListener("abort", onAbort);
      };
      const onState = () => {
        if (peerConnection.iceGatheringState === "complete") {
          cleanup();
          resolve();
        }
      };
      const onAbort = () => {
        cleanup();
        reject(
          new SignalingError(
            "signaling-aborted",
            "ICE gathering was cancelled.",
          ),
        );
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new SignalingError(
            "ice-gathering-timeout",
            "ICE gathering did not complete before the timeout.",
          ),
        );
      }, timeoutMs);
      peerConnection.addEventListener("icegatheringstatechange", onState);
      signal?.addEventListener("abort", onAbort, { once: true });
      onState();
    });
  }
  if (!peerConnection.localDescription) {
    throw new SignalingError(
      "signaling-invalid-response",
      "The peer did not produce a local description.",
    );
  }
  return peerConnection.localDescription.toJSON();
}

function validateEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch (cause) {
    throw new TypeError("Signaling endpoint must be an absolute URL.", {
      cause,
    });
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError(
      "Signaling requires HTTPS except for loopback development endpoints.",
    );
  }
  return url;
}

function validateRoomId(roomId: string): void {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(roomId)) {
    throw new SignalingError(
      "invalid-room",
      "Room IDs must contain 8 to 128 URL-safe characters.",
    );
  }
}

function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new SignalingError("signaling-aborted", "Signaling was cancelled."),
      );
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(
        new SignalingError("signaling-aborted", "Signaling was cancelled."),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function candidateType(value: RTCStats | undefined): string | undefined {
  return value &&
    "candidateType" in value &&
    typeof value.candidateType === "string"
    ? value.candidateType
    : undefined;
}

function statsString(
  value: RTCStats | undefined,
  key: string,
): string | undefined {
  return value &&
    key in value &&
    typeof value[key as keyof typeof value] === "string"
    ? (value[key as keyof typeof value] as string)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
