# Backup and restore

The host console exports a portable `.pdb` snapshot for the active database.
Snapshots contain database data and are unencrypted. Store them as carefully
as the source database.

## Export

1. Open the host console and select **Export snapshot**.
2. Save the downloaded `.pdb` file to a protected location.
3. Keep a copy outside the browser profile. IndexedDB is not a backup and can
   be cleared or evicted.

Snapshot support depends on the engine advertising `portableSnapshots` and
implementing `exportSnapshot()`. The format includes a versioned envelope and
engine identifier; it is not a SQL dump or cross-engine export.

## Restore

1. Start the intended engine in the host console.
2. Select **Import and restore snapshot**, then choose a `.pdb` file.
3. Wait for validation and the replacement instance to start. The app switches
   to the restored instance only after startup succeeds.
4. Verify important tables or keys before sharing a new invitation.

Restore replaces the active database through a newly created instance. An
invalid snapshot or failed startup leaves the active instance in use. PostgreSQL
restore requires a fresh data directory and the recorded PGlite engine version;
it does not overwrite an existing PostgreSQL data directory. Key-value restore
replaces the destination key set atomically.

**Reset database** starts a fresh empty instance and removes the previous stored
copy after switching. **Delete database** stops the current instance and removes
its stored data after confirmation. Memory-mode data disappears on stop or
reload. Review these controls carefully before using them.

See [ADR-015](../decisions/ADR-015-snapshot-formats-and-restore.md), the
[runtime snapshot contract](../../packages/runtime/README.md), and the
[key-value](../../packages/engine-kv/README.md) and
[PostgreSQL](../../packages/engine-pglite/README.md) adapter notes for exact
formats, version compatibility and failure behavior.
