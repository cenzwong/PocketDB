import { makeDuckDBParquetFixture } from "@pocketdb/engine-duckdb/test-support";

declare global {
  interface Window {
    __duckdbFixture?: { ok: boolean; base64?: string; error?: string };
  }
}

async function run(): Promise<void> {
  try {
    const bytes = await makeDuckDBParquetFixture();
    let binary = "";
    const chunkSize = 0x8000;
    for (let start = 0; start < bytes.length; start += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(start, Math.min(start + chunkSize, bytes.length)),
      );
    }
    window.__duckdbFixture = { ok: true, base64: btoa(binary) };
  } catch (error) {
    window.__duckdbFixture = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const element = document.querySelector("#result");
  if (element)
    element.textContent = JSON.stringify(window.__duckdbFixture, null, 2);
}

void run();
