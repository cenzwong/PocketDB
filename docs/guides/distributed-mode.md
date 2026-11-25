# Distributed Mode quick start

Distributed Mode keeps a Yjs replica in each participant's browser. It is
separate from Hosted Mode SQL and key-value instances. The console uses
authenticated invitations and reliable WebRTC data channels; signaling is a
manual SDP copy-and-paste step in this demonstration.

## Run two browser peers

1. Start the PocketDB web app with `pnpm --filter @pocketdb/web dev` and open
   `/distributed.html` in two browser tabs or devices.
2. On the host, choose a replica name and member access, then select **Start
   host**. Copy the `pocketdb://` invitation to the client tab.
3. On the client, paste the invitation and select **Create client offer**.
   Copy the JSON offer to the host.
4. On the host, paste the offer and select **Accept offer and create answer**.
   Copy the JSON answer to the client.
5. On the client, paste the answer and select **Accept host answer**. Both
   consoles show peer identity, membership access, connection state and local
   document contents.
6. Edit either replica. To demonstrate offline changes, disconnect the client,
   write distinct keys on both sides, create another offer and repeat the answer
   exchange. The state-vector exchange merges the offline changes when the
   authenticated data channel opens.
7. The host can revoke the invitation membership. Revocation invalidates active
   sessions; it does not erase data already copied to a participant.

The invitation is a bearer capability. Keep read-write links private. Read-only
clients can receive replicated changes but their local API and host session
reject writes. A host tab must remain open for participants to connect.

## Persistence and limits

`@pocketdb/engine-yjs` exposes IndexedDB persistence, explicit `flush()` and
versioned snapshots separately from the demonstration page. A browser can evict
or clear local data, private browsing can discard it, and actual quota varies by
browser and origin. Full replica state is capped at 256 MiB; larger histories
need compaction or chunking work. Snapshots are unencrypted. Merge and isolated
restore are explicit operations.

The manual SDP exchange is a product demonstration rather than a signaling
service. Peer connectivity depends on ICE reachability. No public STUN/TURN
service, cross-network relay, mobile, stable-channel compatibility or physical
device claim follows from the local browser result.

## Compatibility evidence

| Environment | Evidence | Support claim |
| --- | --- | --- |
| Chrome Canary 160.0.8181.0, macOS 27.0.1 | Two independent tabs completed invitation authentication, WebRTC synchronization, offline writes, reconnect convergence and revocation in the browser harness. | M5 development evidence only; not a release support range. |
| Safari, Firefox, stable Chrome/Edge, mobile browsers | Not exercised by this M5 harness. | No compatibility claim. |
| Two physical devices, cross-network ICE and TURN relay | Not exercised by this M5 harness; retained for product-end device acceptance. | Not verified. |

Browser capability support remains staged under [ADR-014](../decisions/ADR-014-browser-support.md)
and the [browser matrix task](../../board/backlog/TASK-041-verify-browser-compatibility-limits-and-performance.md).
