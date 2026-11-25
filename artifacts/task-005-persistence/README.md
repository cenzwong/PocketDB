# PGlite and browser persistence spike

This experiment stages PGlite 0.6.0 assets beside a dedicated module worker and serves them over a local header-constrained HTTPS project path. The database uses PGlite's IndexedDB filesystem. The key-value probe uses a separate IndexedDB object store and waits for transaction completion. A worker-scoped Web Lock enforces a single cooperative owner for the persistent SQL database.

## Reproduce

Run from this directory with Node and Chrome Canary installed. Set `POCKETDB_CHROMIUM` to another Chromium executable if needed.

```sh
npm ci --ignore-scripts --no-audit --no-fund
fixture_tls="$(mktemp -d)"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$fixture_tls/key.pem" \
  -out "$fixture_tls/cert.pem" -days 2 -subj /CN=127.0.0.1 \
  -addext 'subjectAltName=IP:127.0.0.1'
node verify.mjs "$fixture_tls/cert.pem" "$fixture_tls/key.pem"
```

The driver stages a temporary static asset tree at `/PocketDB/` and allows only the fixture certificate public key in the disposable browser profiles. The preview omits COOP and COEP. Use the same asset layout to rerun on the actual deployment once available. See the [PGlite API](https://pglite.dev/docs/api) and [filesystems documentation](https://pglite.dev/docs/filesystems).

## Evidence

In Chrome Canary 160.0.8180.0 on macOS arm64, worker SQL stored and read back a parameter containing an apostrophe. The installed `citext` extension evaluated case-insensitive equality. The database survived close and page reload. A gzip data directory snapshot of roughly 4.55 MB restored the same row in a fresh in-memory instance. The separate key-value record also survived reload.

A second tab was refused while the first worker held the Web Lock. The second tab opened the database after the owner closed it. This is cooperative ownership scoped to the origin and lock name. Uncoordinated writers and simultaneous transaction semantics need independent checks.

The private browser context passed the same active-context reload and snapshot checks. Its key-value record was absent after disposing the private context and opening a new one. In regular and private contexts the initial reported quota was 10 GiB and persistence was not granted. A separate regular profile with a 64 KiB DevTools quota override rejected a larger IndexedDB write with `QuotaExceededError`. The estimate still reported 10 GiB, so the test observed the write outcome as well as the estimate. See the [raw results](results.json).

This preview verifies a Pages-style asset prefix and a non-isolated HTTPS origin. The live GitHub Pages origin, browser and OS matrix, abrupt termination, quota across devices, persistent storage grants, production eviction and performance remain open. The experiment checks `citext`. Other extensions need individual compatibility measurements.

## Recommendation and impact

Use worker PGlite with IndexedDB and a per-instance Web Lock as the first SQL persistence candidate. Use IndexedDB for persistent key-value mode and keep explicit memory mode available when persistent storage or ownership cannot be obtained. Preserve an export path before changing or replacing stores. OPFS remains an alternative for later profiling. TASK-002 demonstrated its raw worker API, while this experiment measured PGlite on IndexedDB.

The result informs ADR-001, ADR-004, ADR-009, ADR-010 and ADR-015. It supports proceeding to the SQL semantics and worker lifecycle probes under their own acceptance checks. The evidence supports no estimate change.
