# TASK-059: Vector search prototype

## Recommendation

For the first vector-search release, select a JavaScript exact flat scan for a
bounded dataset. Keep the index behind an implementation-independent adapter
contract so a WASM implementation can be added later without changing the
client API. Use 10,000 vectors at 128 dimensions as the initial benchmark tier,
not as a browser memory or capacity guarantee.

The WASM exact scan was faster in this Node run, but the gain at the 10,000
vector tier was modest (about 1.16 ms to 0.91 ms median including top-10
selection), while index and scratch memory were similar. Exact JavaScript has
the simpler startup, packaging, debugging and compatibility path. At 50,000
vectors both exact scans took multiple milliseconds and required roughly 26 MB
for index and scratch arrays, which is a useful signal to prototype an ANN
index only if a real use case needs that scale.

Do not yet select HNSW or another approximate index for release. Its recall,
browser startup cost, persistence, real embedding quality, and memory limits
remain unmeasured. Follow-up work for a selected adapter should implement a
bounded exact JavaScript index behind the engine contract, validate it in the
static browser worker, expose only the minimal nearest-neighbor query surface,
and set any supported dataset cap from that browser evidence.

## Candidates and evidence

The probe compares equivalent exact flat scans: JavaScript typed-array scoring
and a minimal WebAssembly scoring kernel. Both use the same Float32 vectors,
queries, dot-product scoring, and JavaScript top-10 selection. They returned
identical nearest-neighbor IDs for 16 deterministic queries at each size
(Recall@10 = 1.0). Dataset tiers were 1,000, 10,000 and 50,000 vectors at 128
dimensions. Results, initialization/copy timings and accounted index/scratch
bytes are in [`results.json`](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-059-vector-search/results.json) (archived run).

## Reproduction

From the repository root:

```sh
node experiments/task-059-vector-search/probe.mjs
```

The script has no third-party dependencies and rewrites `results.json` with the
current environment and measurements. It uses a fixed-seed linear congruential
generator, 16 fixed queries, top-10 recall, 31 repetitions per query, discards
the first four timed passes, and records the median of 192 warmed timings per
size and runtime. WASM compilation is recorded separately; per-size module
instantiation, linear-memory growth, and index copying are timed separately.

## Candidate review

- **JavaScript exact flat scan:** selected for the bounded initial scope. It
  gives exact results and avoids a WASM artifact and runtime loader. Search is
  linear in vector count and dimension; any dataset limit must be validated in
  the browser, not inferred from Node memory measurements.
- **WASM exact flat scan:** the probe's scalar kernel is faster in this Node
  environment, with comparable accounted index/scratch memory. It still scans
  every vector and has no ANN index or browser evidence. It remains an
  optimization candidate, not the selected first release.
- **WASM HNSW:** established browser ports expose approximate search and
  persistence, but require tuning recall against realistic data and validating
  package maintenance, static asset loading, persistence and browser memory.
  The `hnswlib-wasm` project itself describes the port as early-stage and the
  npm page reports its latest publish was three years ago ([project README](https://github.com/shravansunder/hnswlib-wasm), [npm package](https://www.npmjs.com/package/hnswlib-wasm)).

## Limits

This is a Node.js CPU microbenchmark on synthetic vectors, not a browser worker
or application-level semantic relevance study. JavaScript and WASM candidates
are exact flat scans, so this does not measure ANN recall or HNSW indexing. The
WASM kernel is generated inline only for this probe and is not product code.
No deployment dependency was added. The registry lookup for a current WASM
package failed because DNS resolution was unavailable in this environment.
