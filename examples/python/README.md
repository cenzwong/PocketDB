# Python driver examples

These examples connect standard Python drivers to a browser-hosted PocketDB
instance through the private CLI's loopback bridge. Keep the host browser open.
Each invitation supports one local driver connection, so start one bridge with a
fresh invitation for each example. The CLI never needs the invitation in its
command line:

```sh
export POCKETDB_SIGNALING_ENDPOINT='https://signal.example/api'
export POCKETDB_INVITATION='pocketdb://...'
node packages/cli/bin/pocketdb.mjs connect --uri-env POCKETDB_INVITATION \
  --protocol postgresql --port 5432 --json
```

In another terminal, install the pinned drivers and run the example:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r examples/python/requirements.txt
python examples/python/postgresql.py
```

For Redis, start another bridge process using a separate Redis invitation:

```sh
node packages/cli/bin/pocketdb.mjs connect --uri-env POCKETDB_INVITATION \
  --protocol resp --port 6379 --json
python examples/python/redis_resp2.py
```

`redis-py` 8 defaults to RESP3; the example sets `protocol=2`, as the PocketDB
bridge implements RESP2 only. Examples use loopback, no local password, and no
TLS. Stop the bridge after the client exits. See [the driver matrix](../../docs/compatibility/native-drivers.md)
for exact protocol, command, transaction, parameter and lifecycle boundaries.

The browser-backed Python integration check requires these pinned dependencies
in the selected interpreter. For an isolated environment:

```sh
python3 -m venv /tmp/pocketdb-python-drivers
/tmp/pocketdb-python-drivers/bin/python -m pip install \
  -r examples/python/requirements.txt
POCKETDB_PYTHON=/tmp/pocketdb-python-drivers/bin/python \
  pnpm --filter @pocketdb/cli test:python:browser
```
