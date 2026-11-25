# Portable snapshot validation

The [versioned snapshot decision](../../docs/decisions/ADR-015-snapshot-formats-and-restore.md) defines the envelope, engine payload formats, compatibility policy and replace behavior.

## Validation

The [results file](results.json) records unit and browser evidence from Node v25.8.1 and Chrome 160.0.8181.0.

- Key-value values round-trip as bytes and retain absolute expiration. A worker import into a fresh persistent IndexedDB directory succeeded. Malformed and foreign-engine snapshots were rejected before opening the destination. An over-quota replacement failed with `key-value-storage-quota-exceeded`; reopening the destination returned its original `before-import` value, demonstrating transaction rollback.
- PostgreSQL round-tripped a whole PGlite 0.6.0 data directory through worker RPC. Malformed and foreign-engine snapshots were rejected before acquiring the destination. A restore into an occupied persistent directory returned `snapshot-target-not-empty`; reopening it returned the original row.
- The runtime unit test verifies capability gating and snapshot export routing. The worker adapter test verifies snapshot bytes cross worker RPC.

Run the browser evidence again from the repository root with:

```sh
pnpm --filter @pocketdb/engine-kv test:browser
pnpm --filter @pocketdb/engine-pglite test:browser
```

These checks do not exercise real cross-device transfer, encrypt snapshots, or prove cross-version PGlite archive compatibility. PostgreSQL restore into an occupied data directory is deliberately unsupported; restore into a new directory and switch the host after verification.
