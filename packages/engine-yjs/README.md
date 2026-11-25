# Yjs replica adapter

`@pocketdb/engine-yjs` is the first typed, local replica API for Distributed
Mode. It uses Yjs 13.6.33, the version measured by
[TASK-050](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-050-yjs-probe/README.md). Hosted SQL and
key-value APIs remain separate; this package does not translate SQL into CRDT
operations.

```ts
import { YjsReplica } from "@pocketdb/engine-yjs";

const replica = new YjsReplica();
const tasks = replica.map<{ done: boolean }>("tasks");
tasks.set("first", { done: false });
const events = replica.array<string>("events");
events.push("created");
const notes = replica.text("notes");
notes.insert(0, "hello");
const settings = replica.documentFor<{ title: string }>("settings");
settings.set("title", "Shared board");

// Exchange this binary update through the authenticated replication layer.
const update = replica.encodeUpdate(remoteStateVector);
replica.applyUpdate(update); // only after authorizing the sending peer
```

Maps, arrays and text are Yjs shared structures. A structured document is a
named, field-oriented map of finite JSON values; each field is an atomic CRDT
value. Inputs and reads are copied so caller-side object mutation cannot bypass
Yjs change tracking. Concurrent writes to the same map key converge
deterministically but do not resolve application intent. Use separate fields or
shared collections when independent concurrent editing is required. Values are
limited to 32 levels and 10,000 JSON nodes per write. Root names are non-empty
and at most 256 UTF-8 bytes. Each replication frame is limited to 16 KiB,
including its 4-byte frame header, leaving 16,380 bytes for the encoded Yjs
update. Larger transfers and chunking are not supported here.

`localWriteAccess: false` creates a reader that can apply updates but cannot
mutate through this API. This is a local capability-derived guard, not an
authentication mechanism. `ReplicaSyncSession` exchanges state vectors and
bounded updates over an already authenticated transport, and rechecks
host-side membership before accepting each message. Destroy replicas when
their local owner closes them.

## Persistence and snapshots

`IndexedDBReplicaPersistence.open(replicaId)` restores a same-origin replica
from IndexedDB and holds an exclusive Web Lock for that ID until `close()`.
Updates are persisted as bounded full-state Yjs updates; call `flush()` before
handoff or shutdown when the caller needs an explicit durability boundary.
Browser eviction, user deletion, private-context disposal and actual storage
quota remain browser-controlled; failures report `storage-quota-exceeded` or
`storage-unavailable`. The 256 MiB state cap is a format safety limit, not a
promise that a browser has that much quota. Stored states are unencrypted.

`createReplicaSnapshot()` exports a versioned PocketDB envelope.
`restoreReplicaSnapshot()` creates an isolated replica from the snapshot;
`mergeReplicaSnapshot()` applies it to existing state with Yjs merge semantics.
Malformed, incompatible, truncated and oversized snapshots are rejected before
the destination is changed. Snapshot import does not replace persistent state
automatically: explicitly persist the selected restored or merged replica.
See [ADR-013](../../docs/decisions/ADR-013-crdt-synchronization.md) for
replication semantics and [ADR-015](../../docs/decisions/ADR-015-snapshot-formats-and-restore.md)
for the shared envelope.

Member/sync UI and end-to-end distributed demonstrations remain in TASK-054.
