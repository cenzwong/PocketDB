import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const board = new URL("../board/", import.meta.url);
const states = ["backlog", "ready", "in-progress", "blocked", "done"];
const fields = ["id", "title", "priority", "created", "depends_on", "labels"];
const taskId = /^TASK-\d{3,}$/;
const tasks = new Map();
const archiveBatches = JSON.parse(
  readFileSync(new URL("archive/completed.json", board), "utf8"),
);

function add(id, record, state, dependencies) {
  assert.match(id, taskId);
  assert(
    record.startsWith(`${id}-`) &&
      record.endsWith(".md") &&
      !record.includes("/"),
    `Invalid record for ${id}: ${record}`,
  );
  assert(!tasks.has(id), `Duplicate task ID: ${id}`);
  assert(
    Array.isArray(dependencies) && dependencies.every((id) => taskId.test(id)),
    `Invalid dependencies for ${id}`,
  );
  assert.equal(
    new Set(dependencies).size,
    dependencies.length,
    `Duplicate dependency for ${id}`,
  );
  tasks.set(id, { state, dependencies });
}

let archivedCount = 0;
for (const { revision, tasks: archived } of archiveBatches) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  for (const [id, { record, dependsOn }] of Object.entries(archived)) {
    add(id, record, "done", dependsOn);
    archivedCount += 1;
  }
}

for (const state of states) {
  for (const record of readdirSync(new URL(`${state}/`, board)).filter((name) =>
    name.endsWith(".md"),
  )) {
    const contents = readFileSync(new URL(`${state}/${record}`, board), "utf8");
    const frontMatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert(frontMatter, `Missing front matter: ${record}`);
    const entries = frontMatter[1]
      .split(/\r?\n/)
      .map((line) => line.match(/^([a-z_]+):\s*(.*)$/));
    assert(entries.every(Boolean), `Invalid front matter: ${record}`);
    assert.deepEqual(
      entries.map((entry) => entry[1]).sort(),
      [...fields].sort(),
      record,
    );
    const data = Object.fromEntries(
      entries.map(([, key, value]) => [key, value]),
    );
    const dependencies = data.depends_on.match(/^\[(.*)\]$/);
    assert(dependencies, `Use an inline depends_on list: ${record}`);
    add(
      data.id,
      record,
      state,
      dependencies[1].trim()
        ? dependencies[1].split(",").map((id) => id.trim())
        : [],
    );
  }
}

const visiting = new Set();
const checked = new Set();
function checkDependencies(id) {
  if (checked.has(id)) return;
  assert(!visiting.has(id), `Dependency cycle at ${id}`);
  visiting.add(id);
  const { state, dependencies } = tasks.get(id);
  for (const dependency of dependencies) {
    assert(tasks.has(dependency), `${id} depends on missing ${dependency}`);
    if (state === "done" || state === "in-progress") {
      assert.equal(
        tasks.get(dependency).state,
        "done",
        `${id} depends on incomplete ${dependency}`,
      );
    }
    checkDependencies(dependency);
  }
  visiting.delete(id);
  checked.add(id);
}

for (const id of tasks.keys()) checkDependencies(id);
console.log(
  `Validated ${tasks.size} board records, including ${archivedCount} archived completions.`,
);
