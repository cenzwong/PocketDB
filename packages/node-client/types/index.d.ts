import type { PocketDBClient } from "@pocketdb/client";

export interface NodeIceServer {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface NodeIceConfiguration {
  readonly iceServers?: readonly NodeIceServer[];
  readonly iceTransportPolicy?: "all" | "relay";
  readonly iceUseDefaultStunServer?: boolean;
}

export interface ConnectNodeOptions {
  readonly signalingEndpoint: string;
  readonly signalingTimeoutMs?: number;
  readonly channelTimeoutMs?: number;
  readonly authenticationTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly iceConfig?: NodeIceConfiguration;
}

export interface NodeConnection {
  readonly client: PocketDBClient;
  close(): Promise<void>;
}

/** Connect to a browser-hosted database and authenticate the invitation over Werift WebRTC. */
export declare function connectNode(
  invitationUri: string,
  options: ConnectNodeOptions,
): Promise<NodeConnection>;
