import {
  SignalingError,
  type SignalRole,
  type SignalingAdapter,
} from "../src/discovery";

/** A deterministic signaling substitute for tests that use two local peers. */
export class InProcessSignalingAdapter implements SignalingAdapter {
  readonly id = "in-process-signaling";
  private readonly descriptions = new Map<string, RTCSessionDescriptionInit>();

  async publishDescription(
    roomId: string,
    role: SignalRole,
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    this.descriptions.set(this.key(roomId, role), { ...description });
  }

  async receiveDescription(
    roomId: string,
    role: SignalRole,
    options: {
      readonly timeoutMs?: number;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<RTCSessionDescriptionInit> {
    const deadline = Date.now() + (options.timeoutMs ?? 5_000);
    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw new SignalingError(
          "signaling-aborted",
          "Signaling was cancelled.",
        );
      }
      const description = this.descriptions.get(this.key(roomId, role));
      if (description) return { ...description };
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new SignalingError(
      "signaling-peer-timeout",
      `No ${role} description was published before the timeout.`,
    );
  }

  private key(roomId: string, role: SignalRole): string {
    return `${roomId}:${role}`;
  }
}
