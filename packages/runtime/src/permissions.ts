import {
  EngineOperationError,
  type EngineCapabilities,
  type EngineRequest,
  type SessionAccess,
} from "./contracts";

/** Rejects read-only operations unless the adapter explicitly advertises them. */
export function assertEngineOperationPermission(
  access: SessionAccess,
  capabilities: EngineCapabilities,
  request: EngineRequest,
): void {
  if (access !== "owner" && access !== "read-write" && access !== "read-only") {
    throw new EngineOperationError(
      "permission-denied",
      "The session access level is invalid.",
    );
  }
  if (access !== "read-only") return;
  const operation = request.operation.toLowerCase();
  if (
    !capabilities.readOnlyOperations?.some(
      (candidate) => candidate.toLowerCase() === operation,
    )
  ) {
    throw new EngineOperationError(
      "permission-denied",
      `Operation '${request.operation}' is not available to a read-only session.`,
    );
  }
}
