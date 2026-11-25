# Key-value engine

`@pocketdb/engine-kv` implements a Redis-inspired `EngineAdapter` for `PING`, `GET`, `SET`, `DEL`, `EXISTS`, `MGET`, `MSET`, `INCR`, `DECR`, `EXPIRE`, `TTL`, `PERSIST`, `SCAN` and `DBSIZE`. It is a small command subset and does not claim Redis compatibility. Instances default to ephemeral memory storage; an explicit `idb://<name>` data directory enables browser persistence.

## Request and value model

Pass a command name through `EngineRequest.operation` and its argument list through `payload`:

```ts
{ operation: "SET", payload: ["photo", new Uint8Array([0, 255])] }
{ operation: "GET", payload: ["photo"] }
```

Keys are JavaScript strings. Values accept strings, `ArrayBuffer` and typed-array views. The engine stores owned byte copies; `GET` and `MGET` return defensive `Uint8Array` copies. Missing reads return `null`. `MGET` preserves argument order and yields `null` for missing keys. `MSET` validates the full batch before applying any entry; repeated keys are applied in order, so the last value wins. `DEL` counts each key only once after its first successful deletion. `EXISTS` counts each argument occurrence whose key exists.

`INCR` and `DECR` create missing counters from zero, return a `bigint`, and store canonical decimal bytes. Values must parse as signed 64-bit integers. Invalid values and overflow leave the stored value unchanged. Commands execute in order against an instance-scoped map, so counter updates are atomic within one engine instance. Sessions share their instance data; separate instances do not.

## Expiry, scanning and size

`EXPIRE key seconds` accepts an integer number of seconds. A zero or negative value deletes a live key immediately. `TTL` returns `-2` for a missing or expired key, `-1` for a key without expiry, or the remaining whole seconds (which may be `0`). `PERSIST` removes an existing expiry and returns `1`, or returns `0` if the key is missing or had no expiry. `SET` and `MSET` clear prior expiry; `INCR` and `DECR` preserve it. Expiry is lazy: reads check the requested key, while writes, `SCAN` and `DBSIZE` purge expired entries before continuing. There is no background expiration thread.

`SCAN cursor [MATCH glob] [COUNT n]` returns `[nextCursor, keys]`. It supports `*` and `?` wildcards, defaults to 10 keys per call and caps `COUNT` at 1,000. Cursor values are offsets in the current map iteration order; mutations between calls can change that order and cause repeats or misses, as allowed by this limited scan contract. It is not a Redis cursor compatibility claim. `DBSIZE` returns the count of live keys after lazy expiry cleanup.

## Memory budget

Each instance defaults to a 64 MiB logical storage budget. Configure a lower limit with `maxMemoryBytes`; the engine rejects a limit above 64 MiB. Accounting is UTF-8 key bytes plus value bytes plus 128 bytes per entry for map and expiry metadata. This is a conservative logical estimate, not an exact JavaScript heap cap, and excludes transient request/response allocations. `SET`, `MSET`, `INCR` and `DECR` reject writes that exceed the budget with `key-value-memory-limit`. `MSET` validates and sizes the final value for every key before applying any batch entry, so a rejected batch leaves its values unchanged. Expired entries are reclaimed before capacity is checked.

## Browser persistence

Pass `{ dataDir: "idb://<name>" }` to `KeyValueEngineAdapter.createInstance` to store values and absolute expiry timestamps in IndexedDB. The adapter holds an exclusive Web Lock for the instance lifetime, writes each command's changed records transactionally before acknowledging it, and reloads stored entries on start. A competing owner fails with `key-value-storage-already-owned`. Missing IndexedDB/Web Locks, blocked storage and quota failures produce `key-value-storage-unavailable` or `key-value-storage-quota-exceeded`. Expiry keeps its original timestamp across reload; time spent stopped still counts toward TTL. The browser can evict or clear IndexedDB data, so persistence is not a permanent-retention guarantee. `memory://` remains ephemeral and does not require browser storage APIs.

The selected missing-key, repeated-key, batch-write and signed-counter behavior follows the corresponding Redis command conventions for [GET](https://redis.io/docs/latest/commands/get/), [MGET](https://redis.io/docs/latest/commands/mget/), [EXISTS](https://redis.io/docs/latest/commands/exists/), [MSET](https://redis.io/docs/latest/commands/mset/) and [INCR](https://redis.io/docs/latest/commands/incr/).

## Portable snapshots

Instances export versioned `Uint8Array` snapshots through `exportSnapshot()`. Create a destination instance with `{ snapshot }` to import. The `kv-entries-v1` payload preserves binary values and absolute expiry timestamps; expired entries are omitted or dropped. Import replaces the complete destination key set. When `dataDir` is persistent, clear and replacement writes share one IndexedDB transaction, so a quota or transaction failure leaves its prior entries intact. See [ADR-015](../../docs/decisions/ADR-015-snapshot-formats-and-restore.md) for the envelope and compatibility rules.

## Errors and limits

Invalid commands and arguments throw `KeyValueCommandError`, a structured `EngineOperationError`. Stable codes include `key-value-unknown-command`, `key-value-wrong-number-of-arguments`, `key-value-invalid-arguments`, `key-value-invalid-key`, `key-value-invalid-value`, `key-value-not-integer-or-out-of-range`, `key-value-integer-overflow`, `key-value-invalid-expiry`, `key-value-invalid-cursor`, `key-value-invalid-scan-count` and `key-value-memory-limit`. The runtime and worker dispatcher preserve these codes. `PING` without arguments returns `PONG`; with one string or byte value it echoes that value.

Redis wire compatibility, eviction and distributed concurrency are outside this adapter. The memory budget limits logical retained key/value data for one instance; it is not an operating-system memory guarantee. IndexedDB ownership coordinates same-origin adapters using Web Locks; it cannot coordinate writers that bypass this adapter.

Run `pnpm --filter @pocketdb/engine-kv typecheck`, `pnpm --filter @pocketdb/engine-kv test`, and `pnpm --filter @pocketdb/engine-kv test:browser` from the repository root.
