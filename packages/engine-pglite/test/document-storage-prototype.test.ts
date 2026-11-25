import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

type DocumentRow = { id: string; body: Record<string, unknown> };

describe("hosted JSON document storage prototype", () => {
  let database: PGlite | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it("supports nested CRUD, indexed containment queries, and JSONL portability", async () => {
    database = await PGlite.create();
    await database.exec(`
      CREATE TABLE documents (
        id text PRIMARY KEY,
        body jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX documents_body_gin ON documents USING gin (body jsonb_path_ops);
      CREATE INDEX documents_team_idx ON documents ((body #>> '{owner,team}'));
    `);

    const seed = Array.from({ length: 512 }, (_, index) => ({
      id: `doc-${index.toString().padStart(4, "0")}`,
      body: {
        title: `Project ${index}`,
        owner: { team: index === 407 ? "search" : `team-${index % 16}` },
        tags: index === 407 ? ["pocketdb", "prototype"] : [`tag-${index % 8}`],
        steps: [{ name: "review", complete: index % 2 === 0 }],
      },
    }));
    await database.query(
      "INSERT INTO documents (id, body) SELECT item->>'id', item->'body' FROM jsonb_array_elements($1::jsonb) item",
      [JSON.stringify(seed)],
    );
    await database.exec("ANALYZE documents");
    // Keep this plan assertion deterministic for the small in-memory fixture.
    // It proves the operator/index path exists, not that the planner would
    // choose it for this fixture or that it is faster in production.
    await database.exec("SET enable_seqscan = off");

    const created = await database.query<DocumentRow>(
      "SELECT id, body FROM documents WHERE id = $1",
      ["doc-0407"],
    );
    expect(created.rows[0]?.body.owner).toEqual({ team: "search" });
    expect(created.rows[0]?.body.steps).toEqual([
      { name: "review", complete: false },
    ]);

    await database.query(
      "UPDATE documents SET body = jsonb_set(body, '{owner,team}', to_jsonb($2::text)), updated_at = now() WHERE id = $1",
      ["doc-0407", "platform"],
    );
    const updated = await database.query<{ team: string }>(
      "SELECT body #>> '{owner,team}' AS team FROM documents WHERE id = $1",
      ["doc-0407"],
    );
    expect(updated.rows[0]?.team).toBe("platform");

    const plan = await database.query<{
      "QUERY PLAN": Array<{ Plan: unknown }>;
    }>(
      "EXPLAIN (FORMAT JSON) SELECT id FROM documents WHERE body @> $1::jsonb",
      [JSON.stringify({ tags: ["pocketdb", "prototype"] })],
    );
    expect(JSON.stringify(plan.rows[0]?.["QUERY PLAN"])).toContain(
      "documents_body_gin",
    );
    const matched = await database.query<{ id: string }>(
      "SELECT id FROM documents WHERE body @> $1::jsonb",
      [JSON.stringify({ tags: ["pocketdb", "prototype"] })],
    );
    expect(matched.rows.map(({ id }) => id)).toEqual(["doc-0407"]);
    await database.exec("RESET enable_seqscan");

    await database.query("DELETE FROM documents WHERE id = $1", ["doc-0000"]);
    const remaining = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM documents",
    );
    expect(remaining.rows[0]?.count).toBe("511");

    const exported = await database.query<{
      id: string;
      body: Record<string, unknown>;
    }>("SELECT id, body FROM documents ORDER BY id");
    const jsonl = exported.rows
      .map(({ id, body }) => JSON.stringify({ id, body }))
      .join("\n");
    await database.close();
    database = await PGlite.create();
    await database.exec(
      "CREATE TABLE documents (id text PRIMARY KEY, body jsonb NOT NULL)",
    );
    const portableRows = jsonl.split("\n").map((line) => JSON.parse(line));
    await database.query(
      "INSERT INTO documents (id, body) SELECT item->>'id', item->'body' FROM jsonb_array_elements($1::jsonb) item",
      [JSON.stringify(portableRows)],
    );
    const restored = await database.query<DocumentRow>(
      "SELECT id, body FROM documents WHERE id = $1",
      ["doc-0407"],
    );
    const restoredCount = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM documents",
    );
    expect(restored.rows[0]?.body.owner).toEqual({ team: "platform" });
    expect(restoredCount.rows[0]?.count).toBe("511");
  });
});
