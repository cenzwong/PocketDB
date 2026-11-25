# ADR-013: Yjs replication and membership semantics

- Status: TASK-052 authenticated synchronization and TASK-053 persistence are implemented; independent-device product acceptance remains gated by TASK-054.
- Date: 2026-11-25
- Reversibility: medium; the typed API isolates Yjs, while persisted update formats and member-roster epochs require versioning.

## Context

TASK-050 tested Yjs 13.6.33 with offline edits, duplicate and reordered updates,
state-vector deltas and late peer admission. Its small map/array fixtures
converged, but it did not test WebRTC, authenticated membership, revocation,
persistence or large histories. Distributed Mode is separate from the
authoritative Hosted Mode, and arbitrary SQL is not converted to CRDT
operations.

## Decision

- Use Yjs 13.6.33 for the first distributed typed replica API. Keep Yjs behind
  `@pocketdb/engine-yjs` so a future CRDT engine can be added without changing
  hosted SQL or key-value contracts.
- Expose named shared maps, arrays and text, plus a field-oriented structured
  document whose individual fields are finite JSON values. Each structured
  field is an atomic map value; applications that need independent concurrent
  edits must use separate fields or shared collections.
- Exchange binary Yjs updates and state vectors. Updates are duplicate-safe and
  order-independent according to Yjs. Convergence does not imply preservation
  of user intent: concurrent writes to the same map key use Yjs's deterministic
  winner. There is no domain conflict callback in this version.
- Cap each replication frame at 16 KiB, the current WebRTC message boundary.
  The 4-byte frame header leaves a 16,380-byte payload for an encoded update.
  Oversized deltas are rejected. Fragmentation, compaction and recovery of
  histories whose delta exceeds the bound require later evidence and scope.
- Use a closed invitation-authorized membership roster. Reads can be granted to
  read-only members; local writes and replication writes require a current
  read-write capability bound to an authenticated peer session. The local
  adapter's `localWriteAccess` switch is only a guard, not authentication.
  Callers must authorize the sender before applying a received update.
- Membership changes require the owner to issue or revoke an invitation while
  connected. Revoke access by invalidating the capability and closing its live
  sessions. A disconnected member may continue editing its local copy, but
  peers reject new updates from a session that no longer has write access.
  Re-admission requires a new invitation and authorization check.
- Revocation is prospective access control, not data erasure. It cannot remove
  state already copied to a replica. Yjs updates do not prove who originally
  authored each item; an authorized member can relay update bytes it already
  knows. Do not claim that revocation retracts offline writes already received
  by another member or prevents a still-authorized member from sharing retained
  state.

## Alternatives considered

- Keep CRDT selection deferred: TASK-050 provides enough reproducible
  convergence evidence to define a deliberately small API, while network,
  storage and membership enforcement remain separate release tasks.
- Represent CRDT operations as SQL: this would misstate offline editing and
  transaction semantics and would conflate Hosted and Distributed modes.
- Promise strong revocation of replicated copies: no peer-to-peer protocol can
  erase data already delivered to a participant; doing so would overstate the
  capability model.

## Consequences

- TASK-051 implements only typed local structures, bounded binary update APIs,
  and the documented semantics. The adapter is memory-only and has no network
  or persistence layer.
- TASK-052 enforces current member authorization before accepting remote
  updates, and tests duplicate/out-of-order delivery and revocation limits.
- TASK-053 implements same-origin IndexedDB persistence guarded by Web Locks,
  with a 256 MiB safety cap, and versioned snapshot export plus separate merge
  and isolated restore operations. Browser quota, eviction, private-context
  disposal, user deletion and encryption remain explicit limitations.
- TASK-054 provides the member/sync UI, offline demonstration and compatibility
  evidence. The automated Chrome result uses two independent tabs on one
  machine; physical-device and cross-network release acceptance remain open.

## Evidence

- [TASK-050 probe and results](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-050-yjs-probe/README.md)
- [Yjs typed replica package](../../packages/engine-yjs/README.md)
- [Native protocol message bound](../specs/protocol-v1.md)

## Reversibility

The package boundary and typed operations can be backed by a different CRDT
implementation. Persisted Yjs bytes, roster epochs or public API types require
versioned migration before changing engines or membership semantics.
