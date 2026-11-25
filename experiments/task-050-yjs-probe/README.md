# TASK-050: Yjs convergence probe

This experiment uses three isolated `Y.Doc` replicas to make offline edits, apply updates in different orders, replay duplicates, leave one replica disconnected, and reconnect with state-vector deltas. It then brings a fourth peer online after an offline edit. All replicas run in one Node process; the probe measures CRDT state behavior, not WebRTC, peer authentication or network performance.

## Reproduce

Environment used for the recorded run: macOS `27.0.1`, Node `v25.8.1` (`darwin arm64`), pnpm `11.25.0`, Yjs `13.6.33`.

```sh
pnpm --dir experiments/task-050-yjs-probe install --ignore-workspace --frozen-lockfile
pnpm --dir experiments/task-050-yjs-probe probe
```

The isolated `pnpm-lock.yaml` pins Yjs and its two transitive packages. The probe writes a fresh local `results.json`. The Yjs package documents updates as commutative, associative and idempotent, and provides `encodeStateVector`, `encodeStateAsUpdate` and `applyUpdate` for state-vector synchronization ([Yjs update API](https://docs.yjs.dev/api/document-updates)).

## Results

- Three independently edited replicas produced 1,026-byte local updates each. Two peers applied all updates in reordered sequences, with two duplicate replays; their materialized maps and arrays converged.
- The third peer was deliberately kept disconnected. Its smaller state vector (7 bytes versus 19 bytes) and missing records detected that it was behind.
- Reconnection used state-vector deltas between pairs. In the recorded run, two passes transferred 2,240 bytes in total in this small fixture; all peers converged and their encoded state vectors matched. This is payload accounting for the simulated full mesh, not a latency measurement.
- A fourth peer made an offline edit, then exchanged state-vector deltas with an online peer. Its offline update was 1,026 bytes; the two directions transferred 3,076 bytes, after which the peers converged.
- After four edits, the encoded full state was 4,098 bytes, the state vector was 25 bytes before the fourth peer joined, and the shared event array held four events. This fixture is intentionally small and does not predict storage growth for long-lived or deletion-heavy documents.

Yjs client identifiers are generated per run, so encoded payload totals can vary slightly; use the checked-in result as the evidence for this recorded execution rather than treating these byte counts as a performance guarantee.

## Recommendation for ADR-013 / TASK-051

Keep Hosted Mode authoritative and separate from replication. For an initial Distributed Mode contract, use Yjs update-based synchronization over authenticated peer connections and state-vector deltas after reconnect. Treat updates as duplicate-safe and order-independent for this tested map/array fixture; do not claim conflict-free user intent for concurrent writes to the same scalar key. The deterministic map winner is a merge rule, not a domain-level resolution policy.

Start with a closed, invitation-authorized member roster. Gate every received update on the authenticated session's capability before applying it; Yjs updates do not provide PocketDB authorization. Defer open membership and online membership changes until TASK-051 defines admission, leave, revocation and offline-member semantics. A disconnected peer can continue editing its local copy, so this probe does not establish immediate revocation or safe admission of those later edits.

The comparison remains architectural rather than a network benchmark: a full mesh avoids a required application server but uses up to `N(N-1)/2` peer links and makes roster consistency harder; a relay/coordinator reduces peer connectivity and centralizes admission but adds an availability, privacy and operations dependency. Optional TURN transports packets and does not become database authority. TASK-051 should select the intended topology based on measured supported peer counts, not these payload sizes.

Affected decisions: ADR-002 remains unchanged (Hosted Mode ships first); ADR-005's authenticated WebRTC transport is a candidate carrier; ADR-008's capability and peer identity checks must gate update application. No ADR-013 was created because TASK-051 owns the final replication semantics. Scope impact: one bounded document prototype is supportable; multi-document persistence, compaction, membership consensus, revocation guarantees, cross-network connectivity and performance limits remain unmeasured.
