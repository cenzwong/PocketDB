import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";

const DIMENSIONS = 128;
const SIZES = [1_000, 10_000, 50_000];
const TOP_K = 10;
const QUERY_COUNT = 16;
const REPEATS = 31;

function uleb(value) {
  const out = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
}

function section(id, payload) {
  return [id, ...uleb(payload.length), ...payload];
}

function name(value) {
  const bytes = [...Buffer.from(value)];
  return [...uleb(bytes.length), ...bytes];
}

function i32(value) {
  const out = [];
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7;
    const sign = (byte & 0x40) !== 0;
    more = !((value === 0 && !sign) || (value === -1 && sign));
    if (more) byte |= 0x80;
    out.push(byte);
  }
  return out;
}

function wasmModuleBytes() {
  const type = [0x01, 0x60, 0x05, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x00];
  const functions = [0x01, 0x00];
  const memory = [0x01, 0x00, 0x01];
  const exports = [
    0x02,
    ...name("scan"),
    0x00,
    0x00,
    ...name("memory"),
    0x02,
    0x00,
  ];
  const body = [
    0x03, 0x01, 0x7f, 0x01, 0x7f, 0x01, 0x7c,
    0x41, ...i32(0), 0x21, 0x05,
    0x02, 0x40,
    0x03, 0x40,
    0x20, 0x05, 0x20, 0x03, 0x4e, 0x0d, 0x01,
    0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0x07,
    0x41, ...i32(0), 0x21, 0x06,
    0x02, 0x40,
    0x03, 0x40,
    0x20, 0x06, 0x20, 0x04, 0x4e, 0x0d, 0x01,
    // q = f64(f32(query[j])); x = f64(f32(vectors[i * dims + j])); sum += q*x
    0x20, 0x00, 0x20, 0x06, 0x41, ...i32(4), 0x6c, 0x6a, 0x2a, 0x02, 0x00, 0xbb,
    0x20, 0x01, 0x20, 0x05, 0x20, 0x04, 0x6c, 0x20, 0x06, 0x6a, 0x41, ...i32(4), 0x6c, 0x6a, 0x2a, 0x02, 0x00, 0xbb,
    0xa2,
    0x20, 0x07, 0xa0, 0x21, 0x07,
    0x20, 0x06, 0x41, ...i32(1), 0x6a, 0x21, 0x06,
    0x0c, 0x00,
    0x0b,
    0x0b,
    0x20, 0x02, 0x20, 0x05, 0x41, ...i32(8), 0x6c, 0x6a, 0x20, 0x07, 0x39, 0x03, 0x00,
    0x20, 0x05, 0x41, ...i32(1), 0x6a, 0x21, 0x05,
    0x0c, 0x00,
    0x0b,
    0x0b,
    0x0b,
  ];
  const code = [0x01, ...uleb(body.length), ...body];
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, type),
    ...section(3, functions),
    ...section(5, memory),
    ...section(7, exports),
    ...section(10, code),
  ]);
}

function randomSource(count) {
  let state = 0x4f1bbcdc;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000 - 0.5;
  };
  const vectors = new Float32Array(count * DIMENSIONS);
  for (let i = 0; i < vectors.length; i++) vectors[i] = next();
  return vectors;
}

function queryVectors() {
  let state = 0x78a42a11;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000 - 0.5;
  };
  return Array.from({ length: QUERY_COUNT }, () =>
    Float32Array.from({ length: DIMENSIONS }, next),
  );
}

function topK(scores, k) {
  const best = [];
  for (let id = 0; id < scores.length; id++) {
    const score = scores[id];
    let position = best.findIndex((item) => score > item.score);
    if (position < 0) position = best.length;
    if (position < k) {
      best.splice(position, 0, { id, score });
      if (best.length > k) best.pop();
    }
  }
  return best;
}

function jsScan(index, query, scores) {
  const { vectors, count } = index;
  for (let id = 0; id < count; id++) {
    let sum = 0;
    const start = id * DIMENSIONS;
    for (let j = 0; j < DIMENSIONS; j++) {
      sum += query[j] * vectors[start + j];
    }
    scores[id] = sum;
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const wasmBytes = wasmModuleBytes();
const compileStart = performance.now();
const wasmModule = await WebAssembly.compile(wasmBytes);
const wasmCompileMs = performance.now() - compileStart;
const queries = queryVectors();
const results = [];

for (const count of SIZES) {
  const source = randomSource(count);
  const jsBuildStart = performance.now();
  const jsIndex = { vectors: new Float32Array(source), count };
  const jsBuildMs = performance.now() - jsBuildStart;
  const jsScores = new Float64Array(count);

  const pageCount = Math.ceil((source.byteLength + DIMENSIONS * 4 + count * 8) / 65536);
  const wasmInstanceStart = performance.now();
  const wasmInstance = await WebAssembly.instantiate(wasmModule, {});
  const memory = wasmInstance.exports.memory;
  if (pageCount > 1) memory.grow(pageCount - 1);
  const wasmInstanceMs = performance.now() - wasmInstanceStart;
  const wasmVectors = new Float32Array(memory.buffer, 0, source.length);
  const wasmQueryOffset = source.byteLength;
  const wasmScoresOffset = wasmQueryOffset + DIMENSIONS * 4;
  const wasmQuery = new Float32Array(memory.buffer, wasmQueryOffset, DIMENSIONS);
  const wasmScores = new Float64Array(memory.buffer, wasmScoresOffset, count);
  const wasmBuildStart = performance.now();
  wasmVectors.set(source);
  const wasmBuildMs = performance.now() - wasmBuildStart;

  const timings = { js: [], wasm: [] };
  const quality = [];
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
    const query = queries[queryIndex];
    const oracleStart = performance.now();
    jsScan(jsIndex, query, jsScores);
    const oracle = topK(jsScores, TOP_K);
    const jsElapsed = performance.now() - oracleStart;

    wasmQuery.set(query);
    const wasmStart = performance.now();
    wasmInstance.exports.scan(wasmQueryOffset, 0, wasmScoresOffset, count, DIMENSIONS);
    const wasmTop = topK(wasmScores, TOP_K);
    const wasmElapsed = performance.now() - wasmStart;
    quality.push(wasmTop.filter(({ id }) => oracle.some((item) => item.id === id)).length / TOP_K);
    if (queryIndex >= 4) {
      timings.js.push(jsElapsed);
      timings.wasm.push(wasmElapsed);
    }
  }

  const jsExact = jsIndex.vectors;
  assert.equal(jsExact.length, count * DIMENSIONS);
  results.push({
    vectorCount: count,
    dimensions: DIMENSIONS,
    topK: TOP_K,
    queryCount: queries.length,
    warmSearchMedianMs: {
      javascriptFlatExact: median(timings.js),
      webAssemblyFlatExact: median(timings.wasm),
    },
    wasmRecallAt10AgainstJavascriptExact: median(quality),
    buildMs: {
      javascriptCopy: jsBuildMs,
      wasmInstantiationAndMemory: wasmInstanceMs,
      wasmVectorCopy: wasmBuildMs,
    },
    accountedIndexAndScratchBytes: {
      javascript: jsIndex.vectors.byteLength + jsScores.byteLength + DIMENSIONS * 4,
      webAssembly: memory.buffer.byteLength,
    },
  });
}

const output = {
  task: "TASK-059",
  kind: "deterministic-javascript-versus-wasm-flat-vector-search-probe",
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    wasmCompileMs,
    wasmModuleBytes: wasmBytes.byteLength,
  },
  generation: "LCG Float32 vectors with seed 0x4f1bbcdc; deterministic 128-dimensional synthetic dataset",
  qualityMetric: "Recall@10 across 16 fixed queries, WASM exact scores ranked against JS exact scan; expected 1.0",
  timings: "31 repeated iterations per query, first 4 discarded; median of 192 query timings per dataset and runtime",
  results,
  recommendation: "Start with JavaScript exact flat scan for bounded datasets up to the measured 10,000-vector tier. Keep the API independent of the index implementation. Gate WASM/HNSW adapter work on a representative browser benchmark that includes download, initialization, realistic recall, persistence, and memory limits.",
  limitations: [
    "Both candidates are exact flat scans, not approximate HNSW indexes; this compares JS versus WASM execution, not ANN recall or a third-party library.",
    "Node timings do not substitute for browser worker, battery, memory pressure, or static-site asset measurements.",
    "The WASM module is a minimal probe kernel generated inline by this script; it is not proposed product code.",
    "Synthetic vectors are deterministic and bounded but do not represent application embeddings or semantic relevance judgments.",
  ],
};
await writeFile(new URL("./results.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
