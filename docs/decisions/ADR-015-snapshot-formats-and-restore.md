# ADR-015: Versioned portable snapshots and restore

- Status: accepted
- Date: 2026-11-24

## Context

TASK-005 demonstrated a PGlite 0.6.0 data-directory export and restore. TASK-019 and TASK-020 added separate IndexedDB-backed key-value and PostgreSQL persistence. Recovery needs an engine identifier, a format version, strict validation and explicit whole-instance replacement behavior.

## Decision

Use a binary PocketDB envelope for portable whole-instance snapshots. The envelope starts with the UTF-8 magic `POCKETDB-SNAPSHOT\n`, a four-byte unsigned big-endian JSON header length, a UTF-8 JSON header and the exact payload bytes. Version 1 headers carry `formatVersion`, `engineId`, `createdAt` (Unix milliseconds), `payloadFormat`, `payloadBytes`, and an optional `engineVersion`. The parser rejects malformed lengths, invalid metadata, unsupported versions, incompatible engines and payload formats, trailing data, and snapshots above 256 MiB before applying data.

The key-value payload format `kv-entries-v1` is a binary sequence of a four-byte entry count followed by entries. Each entry contains four-byte big-endian UTF-16LE key byte length, four-byte value length, an eight-byte big-endian absolute expiry timestamp (`-1` means no expiry), then key and value bytes. UTF-16 code units preserve every JavaScript key string, including lone surrogates. Export omits expired keys. Restore drops entries whose absolute expiry has elapsed and replaces all keys in the destination. IndexedDB restore clears and writes the object store in one transaction; if validation, quota enforcement or the transaction fails, the previous store remains intact. The destination must fit its configured memory budget.

The PostgreSQL payload format `pglite-data-dir-gzip-v1` is PGlite's gzip-compressed data-directory archive. Version 1 records PGlite engine version `0.6.0`; other versions are incompatible until deliberately reviewed. The archive is opened and queried in a temporary in-memory PGlite instance before the target is acquired. Restore loads into a fresh data directory. PGlite rejects an occupied data directory, which PocketDB surfaces as `snapshot-target-not-empty`; use a new data directory and switch the host to that instance after validating it. This avoids mutating an existing database during import. Snapshot bytes are supplied when creating the destination instance; live in-place PostgreSQL replacement is not supported.

The SQLite payload format `sqlite-database-file-v1` is a native SQLite database file, with engine version `3.54.1` recorded in the envelope. SQLite validates the file through its OPFS import path before the host switches to a fresh instance. Native `.sqlite` import/export is also available separately from `.pdb` snapshots; both formats are unencrypted and limited to 256 MiB.

The CRDT payload format `yjs-state-v1` contains a full Yjs state update and records Yjs `13.6.33` as the engine version. PocketDB validates the complete update against a temporary replica before import. Isolated restore creates a new replica; merge applies the validated update to an existing replica using Yjs semantics. Persistent replicas use IndexedDB with an exclusive Web Lock per replica ID. The 256 MiB envelope is only a safety ceiling: actual browser quota, eviction and private-context lifetime vary.

Workers transfer snapshot bytes through the runtime's optional `exportSnapshot()` capability. Restore is requested by supplying `snapshot: Uint8Array` in the new instance configuration. Snapshot content is local, unencrypted data; encryption, replica state, merge semantics, cross-engine conversion and cross-PGlite-version conversion are outside this format.

## Alternatives considered

- Export PostgreSQL as SQL statements — simpler to inspect, but does not preserve the complete PGlite data directory and internal state.
- Encode every engine payload as JSON/base64 — easy to inspect, but expands binary snapshots and PostgreSQL archives substantially.
- Replace PostgreSQL files in place — PGlite's public restore API requires a data directory without an existing database. Closing and rewriting an occupied persistent directory would weaken recovery guarantees.

## Consequences

- Snapshot readers can reject unsupported data before opening or replacing the destination.
- Key-value restore has IndexedDB transaction rollback semantics and preserves absolute expiry.
- PostgreSQL restore needs spare storage for staging, and writes only to a fresh destination. An interrupted import can leave that new destination unusable, but leaves the source and any other existing data directory untouched; delete the failed destination and retry.
- PGlite snapshots are tied to PGlite 0.6.0 and the versioned archive format. A PGlite upgrade requires a compatibility decision and fixture validation before accepting older archives.
- The 256 MiB envelope limit bounds browser memory use but also limits exportable compressed PostgreSQL archives.
