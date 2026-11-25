# TASK-041 browser performance and limits

## Reference environment and methodology

Measurements ran 2026-11-24 on an Apple Silicon Mac (macOS 27.0.1) through OrbStack Linux x86_64 containers under emulation. Browsers were stable Chrome 158.0.8127.88 and Edge 158.0.4370.33. Startup timing begins after the app shell and assets load, then measures database start until the host invitation control is ready. Warm samples stop and restart the engine in the same browser page. The per-request sample measures the full remote client call, host routing, engine operation, and return over the direct WebRTC path; it is not a transport-only timing.

## Results against provisional targets

| Measure | Provisional target | Chrome | Edge | Assessment |
| --- | --- | ---: | ---: | --- |
| KV cold startup | <2 s after assets load | 366 ms | 372 ms | Under target in this environment |
| KV warm restart p95 | — | 153 ms | 157 ms | Recorded reference |
| PostgreSQL cold startup | <5 s after assets load | 3,552 ms | 3,273 ms | Under target in this environment |
| PostgreSQL warm restart p95 | — | 2,298 ms | 2,304 ms | Recorded reference |
| Direct remote KV GET p95, 20 sequential samples | <100 ms same-LAN p95 | 13 ms | Not measured | Under target for same-host container bridge |
| Relay connection | Measure direct vs relay | — | — | Unknown; no TURN/relay service selected |
| Concurrent clients | At least 5 | — | — | Not measured by this run |
| Persistent dataset capacity | At least 50 MB | — | — | Unknown; persistence suites cover reload and quota rollback, not a 50 MB fixture |
| Browser memory use | Measure | — | — | Not measured; no stable-browser memory profile collected |
| Large-result throughput | Measure | — | — | Not measured; oversized-result rejection is covered by remote-access tests |
| Main-thread responsiveness | No prolonged blocking | — | — | No long task trace collected; worker/browser interaction suites pass |

Cold/warm startup samples are in [Chrome JSON](startup-chrome.json) and [Edge JSON](startup-edge.json). Direct request samples and percentiles are in the [container peer result](../task-032-two-container-peers/result-kv.json). The sample counts are small engineering probes, not release guarantees. Container measurements are affected by x86_64 emulation and do not predict native Mac timing.

## Build size

`pnpm build` passed. `du -sh apps/web/dist` reported 17 MB. The output includes a 9.0 MB PGlite WASM asset and 6.0 MB PGlite data asset; the main web entry chunk is 137 KB, the shared PGlite JavaScript chunk is 376 KB, and the PGlite worker is 514 KB. The engine payloads are separate files and their cold asset download time is excluded from the startup timings above.

## Browser and failure matrix

The following focused browser suites passed in both stable browsers in the Linux reference container:

- `pnpm --filter @pocketdb/web test:browser` — console start/query/error/stop, host administration, and data management flows.
- `pnpm --filter @pocketdb/engine-kv test:browser` — reload, expiration, ownership and directory isolation, ephemeral reset, malformed/incompatible snapshots, and IndexedDB quota rollback.
- `pnpm --filter @pocketdb/engine-pglite test:browser` — persistence/reload, snapshot recovery, and IndexedDB quota rollback.

`pnpm test` also passed on the Mac host after the browser signaling fix. Its remote-access cases cover duplicate request IDs, oversized requests/results, rate and concurrency limits, timeout outcomes, and worker cleanup; PGlite cases cover orderly session/instance-close rollback and SQL error handling. The task-032 two-container run verified authenticated remote requests and orderly client disconnect. The terminal behavior after host disappearance and the no-replay rule are covered by the existing TASK-038 SDK and browser probes; this performance run did not measure reconnect latency.

## Support boundary

This matrix is stable desktop Chromium on Linux under container emulation. Native macOS, Firefox, Safari, mobile browsers, relay/NAT traversal, five-client concurrency, a 50 MB dataset, browser memory/long-task profiles, and deployed-site cold caching remain unverified. A failed forced worker termination cannot promise orderly PGlite transaction rollback. Physical two-laptop and sleep/wake acceptance remains in the final release gate TASK-043.
