import { describe, expect, it } from "vitest";
import { createAppMarkup } from "./app";

describe("PocketDB entry point", () => {
  it("provides keyboard-operable setup and consoles for all engines", () => {
    const markup = createAppMarkup();

    expect(markup).toContain(
      '<a class="brand" href="#" aria-label="PocketDB home">PocketDB</a>',
    );
    expect(markup).toContain("<h1>Local database</h1>");
    expect(markup).toContain(
      'href="./distributed.html">Open Distributed Mode</a>',
    );
    expect(markup).toContain(
      'id="runtime-status" class="status-pill" role="status"',
    );
    expect(markup).toContain('data-engine="postgresql"');
    expect(markup).toContain('data-engine="sqlite"');
    expect(markup).toContain('data-engine="duckdb"');
    expect(markup).toContain('data-engine="kv"');
    expect(markup).toContain('id="sql-input"');
    expect(markup).toContain('id="command-arguments"');
    expect(markup).toContain('id="start-button"');
    expect(markup).toContain('id="stop-button"');
    expect(markup).toContain('id="export-native-file"');
    expect(markup).toContain('id="import-native-file-button"');
    expect(markup).toContain('id="import-dataset-button"');
    expect(markup).toContain(
      'id="error-message" class="error-message" role="alert"',
    );
  });
});
