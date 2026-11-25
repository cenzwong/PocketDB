# Historical archive

The immutable [pre-cleanup tree](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4) preserves the original files,
their relative links, and the context in which historical checks ran. Current results
are generated under `test-results/` and CI attaches them to each workflow run.

Archive revision `305098005dc63218e2822a7853c0b7c12b93b6e4`.

The `pocketdb-pre-cleanup` tag keeps this revision reachable after a squash merge.
To reproduce an archived run, use a separate worktree and follow its original runbook.

```sh
git fetch origin tag pocketdb-pre-cleanup
git worktree add --detach ../PocketDB-archive pocketdb-pre-cleanup
```

## Extract the reusable project scaffold

The scaffold has its own operating guide, templates and example board. Extract it into a
separate destination and initialize a new repository there.

```sh
mkdir -p ../agent-native-project
git archive 305098005dc63218e2822a7853c0b7c12b93b6e4:templates/agent-native-project | tar -x -C ../agent-native-project
```

Browse the [scaffold source](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/templates/agent-native-project),
[historical planning set](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/project), or
[completed task records](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/board/done).
The [completion index](../board/archive/completed.json) supplies IDs for the active board.

## Evidence inventory

Counts cover all 151 tracked files under the former `artifacts/` directory. The archive
retains every original file, including measurements, journals, package tarball and digest,
prototype sources, and the physical sleep/wake runbook. The last two columns count files
maintained in the current checkout.

| Original path | Archive only | Tests | Experiments |
| --- | ---: | ---: | ---: |
| [`.gitkeep`](https://github.com/cenzwong/PocketDB/blob/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/.gitkeep) | 1 | 0 | 0 |
| [`spike-support`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/spike-support) | 4 | 1 | 0 |
| [`task-002-static-worker`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-002-static-worker) | 11 | 0 | 0 |
| [`task-003-webrtc`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-003-webrtc) | 7 | 0 | 0 |
| [`task-004-discovery`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-004-discovery) | 7 | 0 | 0 |
| [`task-005-persistence`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-005-persistence) | 8 | 0 | 0 |
| [`task-006-sql-sessions`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-006-sql-sessions) | 5 | 0 | 0 |
| [`task-007-node-webrtc`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-007-node-webrtc) | 6 | 0 | 0 |
| [`task-008-postgres-wire`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-008-postgres-wire) | 8 | 0 | 0 |
| [`task-009-resp`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-009-resp) | 7 | 0 | 0 |
| [`task-010-host-lifecycle`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-010-host-lifecycle) | 13 | 0 | 0 |
| [`task-011-peer-identity`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-011-peer-identity) | 4 | 0 | 0 |
| [`task-022-local-runtime`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-022-local-runtime) | 1 | 0 | 0 |
| [`task-026-discovery`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-026-discovery) | 2 | 0 | 0 |
| [`task-031-client-sdk`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-031-client-sdk) | 2 | 0 | 0 |
| [`task-032-two-container-peers`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-032-two-container-peers) | 3 | 4 | 0 |
| [`task-033-snapshots`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-033-snapshots) | 2 | 0 | 0 |
| [`task-041-performance`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-041-performance) | 3 | 1 | 0 |
| [`task-043-container-peers`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-043-container-peers) | 4 | 0 | 0 |
| [`task-044-node-client`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-044-node-client) | 3 | 0 | 0 |
| [`task-045-cli`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-045-cli) | 2 | 0 | 0 |
| [`task-046-postgres-bridge`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-046-postgres-bridge) | 2 | 0 | 0 |
| [`task-047-resp-bridge`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-047-resp-bridge) | 2 | 0 | 0 |
| [`task-048-cli-bridge-lifecycle`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-048-cli-bridge-lifecycle) | 2 | 0 | 0 |
| [`task-049-python-drivers`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-049-python-drivers) | 2 | 0 | 0 |
| [`task-050-yjs-probe`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-050-yjs-probe) | 1 | 0 | 4 |
| [`task-055-static-sqlite-duckdb`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-055-static-sqlite-duckdb) | 1 | 0 | 8 |
| [`task-056-sqlite-adapter`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-056-sqlite-adapter) | 2 | 0 | 0 |
| [`task-057-duckdb-adapter`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-057-duckdb-adapter) | 2 | 0 | 0 |
| [`task-058-document-storage`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-058-document-storage) | 2 | 0 | 0 |
| [`task-059-vector-search`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-059-vector-search) | 1 | 0 | 2 |
| [`task-061-mcp-operations`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-061-mcp-operations) | 1 | 0 | 0 |
| [`task-065-package-release`](https://github.com/cenzwong/PocketDB/tree/305098005dc63218e2822a7853c0b7c12b93b6e4/artifacts/task-065-package-release) | 9 | 1 | 0 |
| **Total** | **130** | **7** | **14** |
