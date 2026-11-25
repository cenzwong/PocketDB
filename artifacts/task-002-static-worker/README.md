# Static worker compatibility spike

Measured 24 November 2026 on macOS 27.0.1 (26A434), arm64. The [probe](site/index.html) loads a dedicated module worker and streams a 39-byte single-threaded WASM module. The worker returns the module's answer, writes, flushes and reads back three bytes using an OPFS synchronous access handle, then deletes its own file. When the page exposes SharedArrayBuffer, it also checks that the worker can mutate shared memory.

## Reproduce

From this directory, create a temporary certificate and start the loopback HTTPS preview with Python 3.13.

```sh
preview="$(mktemp -d /tmp/pocketdb-static-worker.XXXXXX)"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$preview/key.pem" \
  -out "$preview/cert.pem" -days 2 -subj /CN=localhost \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
python3 preview.py --cert "$preview/cert.pem" --key "$preview/key.pem"
```

Open `https://localhost:9443/PocketDB/` and `https://localhost:9443/isolated/PocketDB/` in a browser that trusts the preview certificate. Record the displayed JSON and the full browser version. To reproduce the automated Chromium capture without changing system trust, run the following in another shell with `preview` set to the directory printed by `mktemp`. The browser's certificate exception is scoped to the generated public key and the session uses a fresh profile.

```sh
spki="$(openssl x509 -in "$preview/cert.pem" -pubkey -noout |
  openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | openssl base64 -A)"
for browser in 'Google Chrome Canary' 'Microsoft Edge'; do
  node verify-chromium.mjs "/Applications/$browser.app/Contents/MacOS/$browser" \
    "$(mktemp -d /tmp/pocketdb-chromium.XXXXXX)" "$spki" \
    https://localhost:9443/PocketDB/ https://localhost:9443/isolated/PocketDB/
done
for resource in /PocketDB/ /isolated/PocketDB/ /PocketDB/probe.js \
  /PocketDB/worker.js /isolated/PocketDB/worker.js \
  /PocketDB/answer.wasm /isolated/PocketDB/answer.wasm /worker.js; do
  curl --max-time 5 --cacert "$preview/cert.pem" -sSI "https://localhost:9443$resource"
done
```

The deployable asset bundle is `site/`. Its paths resolve relative to the page, module and worker. The readable WASM source is [answer.wat](site/answer.wat). Rebuild it with `wat2wasm site/answer.wat -o site/answer.wasm` if changing that fixture. For an authorized Pages deployment, publish the contents of `site/` at the project root and rerun the browser and header checks against its public HTTPS URL. See [GitHub Pages HTTPS documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

## Results

The preview served identical assets in two configurations. The baseline omitted both isolation headers. The control sent COOP `same-origin` and COEP `require-corp` on the document and module worker responses. All four browser runs reported secure contexts.

| Browser | Preview | Page and worker isolated | SharedArrayBuffer in both contexts | Shared memory mutation | Worker WASM | Worker OPFS write/read |
| --- | --- | --- | --- | --- | --- | --- |
| Chrome Canary 160.0.8180.0, headless | Baseline | No | No | Unavailable | 42 | Pass |
| Chrome Canary 160.0.8180.0, headless | Isolated | Yes | Yes | Pass | 42 | Pass |
| Edge 116.0.1938.62, headless | Baseline | No | No | Unavailable | 42 | Pass |
| Edge 116.0.1938.62, headless | Isolated | Yes | Yes | Pass | 42 | Pass |

The page, module, worker and WASM loaded below the project prefix. The recorded responses returned HTTP 200 with `text/javascript` for JavaScript and `application/wasm` for WASM. The root-level `/worker.js` probe returned HTTP 404. See the [TLS-verified response headers](headers.txt), [Chrome Canary JSON](chrome-canary.json) and [Edge JSON](edge.json).

This was a local, header-constrained HTTPS preview with a self-signed certificate. GitHub Pages CDN responses, production certificate trust, routing, cache behavior and deployment remain unmeasured. The browser results cover two headless Chromium versions on one machine. Safari, Firefox, mobile, private browsing, actual engine startup, WASM threading, reload persistence, quota, eviction and multi-tab ownership remain unverified.

## Recommendation and impact

Keep GitHub Pages as the first static deployment candidate. Use a dedicated worker and single-threaded engine build that can operate without SharedArrayBuffer. Keep ephemeral memory mode available where persistent storage is unavailable. Evaluate each engine's OPFS or IndexedDB adapter and reload behavior in [TASK-005](../../board/done/TASK-005-evaluate-pglite-and-browser-persistence.md). An engine that requires isolation blocks its Pages release until a compatible build or a header-capable static host passes the deployed checks.

Use Chromium as the first feasibility reference. Confirm current stable browser versions and test Gecko, WebKit and mobile before making release support claims. Repeat this probe on the actual deployment under [TASK-040](../../board/backlog/TASK-040-automate-github-pages-deployment.md) and carry the browser matrix into [TASK-041](../../board/backlog/TASK-041-verify-browser-compatibility-limits-and-performance.md).

The results are inputs to ADR-001 (deployment), ADR-009 (persistence), ADR-010 (worker execution) and ADR-014 (browser support). Keep threaded WASM outside the initial Pages baseline. No implementation estimate change is supported by this small fixture. Engine storage proof and the deployed browser matrix remain in their existing tickets. Review these recommendations at [TASK-012](../../board/done/TASK-012-ratify-initial-architecture-and-feasibility-exit.md). See the [decision backlog](../../project/ADR_BACKLOG.md).
