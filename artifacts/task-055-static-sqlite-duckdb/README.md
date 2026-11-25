# SQLite and DuckDB static-hosting probe

This experiment checks real SQLite WASM and DuckDB-Wasm bundles under a Pages-style project path with and without cross-origin isolation headers. It serves Vite-built files from a local HTTPS preview; it does not test the GitHub Pages CDN.

## Reproduce

From this directory, use Node 26+, npm, Chrome Canary, and OpenSSL:

```sh
npm ci --ignore-scripts --no-audit --no-fund
probe_tls="$(mktemp -d /tmp/pocketdb-task-055.XXXXXX)"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$probe_tls/key.pem" \
  -out "$probe_tls/cert.pem" -days 2 -subj /CN=localhost \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
npm run verify -- "$probe_tls/cert.pem" "$probe_tls/key.pem"
```

`verify.mjs` builds the static site, serves the same project-relative assets at `/PocketDB/` without COOP/COEP and `/isolated/PocketDB/` with COOP `same-origin` and COEP `require-corp`, then runs both probes in a fresh headless Chrome profile. The certificate exception is scoped to that generated certificate. It writes [results.json](results.json), including response MIME types, headers, bundle sizes and browser results.

## Measured results

Measured 24 November 2026 on macOS 27.0.1, arm64, Chrome Canary 160.0.8181.0, Node 26.13.0. The versions were SQLite WASM 3.54.1 (`@sqlite.org/sqlite-wasm` 3.54.1-build1) and DuckDB-Wasm package 1.32.0, which reported DuckDB core v1.4.3.

| Candidate | Headerless project path | Worker and WASM | File result | Built WASM size |
| --- | --- | --- | --- | ---: |
| SQLite | Pass; page was not cross-origin isolated and had no `SharedArrayBuffer` | Dedicated module worker; `sqlite3.wasm` served as `application/wasm` | `opfs-sahpool` query passed; exported and imported a 16 KiB SQLite file and queried the restored row | 879 kB (407 kB gzip) |
| DuckDB | Pass; page was not cross-origin isolated and had no `SharedArrayBuffer` | DuckDB MVP single-threaded worker; `duckdb-mvp.wasm` served as `application/wasm` | OPFS database query, `CHECKPOINT`, close, fresh-worker reopen, and query passed | 39.4 MB (8.8 MB gzip) |

Both candidates also passed the isolated control. SQLite selected the same header-independent SAH-pool VFS. DuckDB used the same MVP bundle; the threaded COI bundle was not part of this probe. Representative query and initialization timings are in the raw results. Built JS and worker files were served at the project prefix with the expected JavaScript MIME type.

The SQLite package README's generic worker example asks for COOP/COEP, but this probe explicitly installed SQLite's `opfs-sahpool` VFS, which succeeded without those headers. This VFS is single-owner: it cannot transparently serve concurrent tabs or workers opening the same database. The regular `opfs` VFS supports different concurrency trade-offs and requires isolation headers. DuckDB's normal MVP bundle and OPFS path worked without isolation; threading requires cross-origin isolation.

## Recommendation and impact

Keep GitHub Pages as the initial static target for both candidates; this probe found no header requirement for the tested single-threaded builds. Prefer SQLite for a general-purpose embedded file database: its tested WASM was 879 KiB, it supported explicit database-file export/import, and its SAH-pool VFS worked without response-header changes. Gate SQLite persistence on an origin-level single-owner lock and choose the VFS deliberately if multi-tab access is needed.

Keep DuckDB as an optional analytical engine and lazy-load it. The tested single-threaded build was about 39.4 MB raw and 8.8 MB gzip, considerably larger than SQLite, even though its query and OPFS reopen worked without isolation headers. Use its threaded bundle only on a deployment that provides COOP/COEP and passes its own browser tests. These results do not justify changing the hosting target or implementation estimate.

This is one headless Chromium version on one Mac using a local HTTPS preview, not a live Pages deployment. Stable Chrome, Firefox, Safari, mobile browsers, real CDN caching, quotas, eviction, multi-tab contention, reload after browser restart, and threaded DuckDB remain unmeasured. Revisit the recommendation at TASK-041 and verify the live deployment at TASK-040.

## Official references

- [SQLite WASM persistence and OPFS VFS trade-offs](https://www.sqlite.org/wasm/doc/trunk/persistence.md)
- [SQLite WASM worker API](https://www.sqlite.org/wasm/doc/trunk/api-worker1.md)
- [DuckDB-Wasm deployment and bundle variants](https://duckdb.org/docs/stable/clients/wasm/deploying_duckdb_wasm)
- [DuckDB-Wasm OPFS instantiation](https://duckdb.org/docs/current/clients/wasm/instantiation)
