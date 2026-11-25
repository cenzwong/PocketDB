# TASK-049: Python driver verification

## Outcome

Verified the pinned Python drivers against the browser-hosted PocketDB engines
through the CLI's loopback listeners in Chrome 160 on macOS arm64:

- Psycopg 3.3.9 completed a parameterized `%s` insert, explicit transaction
  commit, read-back, table cleanup and connection-context close.
- redis-py 8.2.0 connected with RESP2 explicitly selected, completed PING,
  binary SET/GET and DEL, received the expected unsupported `INCR` error, and
  closed its connection.
- Each Python run used its own invitation and bridge process. Both bridge
  processes exited cleanly and released their local ports after the Python
  client closed.

Full machine-readable output is in [results.json](results.json). The published
driver and capability boundaries are in
[the compatibility matrix](../../docs/compatibility/native-drivers.md).

## Reproduction

```sh
python3 -m venv /tmp/pocketdb-python-drivers
/tmp/pocketdb-python-drivers/bin/python -m pip install \
  -r examples/python/requirements.txt
POCKETDB_PYTHON=/tmp/pocketdb-python-drivers/bin/python \
  pnpm --filter @pocketdb/cli test:python:browser
```

## Validation

- `POCKETDB_PYTHON=/private/tmp/pocketdb-task049-venv/bin/python pnpm --filter @pocketdb/cli test:python:browser` — passed; Chrome 160, macOS arm64, Psycopg 3.3.9 and redis-py 8.2.0.
- `pnpm check` — passed (Biome format/lint and workspace typechecks).
- `pnpm --filter @pocketdb/cli test` — see TASK-049 task validation.
- `git diff --check` — see TASK-049 task validation.
