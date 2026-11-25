#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
task_dir="$repo_root/tests/two-container-peers"
results="$repo_root/test-results/task-032-two-container-peers"
image="pocketdb-task032-peers:local"
network="pocketdb-task032"
shared="$(mktemp -d)"
host_log="$shared/host.log"

cleanup() {
  docker rm -f pocketdb-task032-host pocketdb-task032-client >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$shared"
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$shared/server-key.pem" -out "$shared/server-cert.pem" \
  -subj '/CN=pdb-host' -addext 'subjectAltName=DNS:pdb-host' >/dev/null 2>&1

if [[ "${TASK032_SKIP_BUILD:-0}" != "1" ]]; then
  docker build --platform linux/amd64 -f "$task_dir/Dockerfile" -t "$image" "$repo_root"
fi
docker network create "$network" >/dev/null
docker run --platform linux/amd64 --rm --name pocketdb-task032-host --network "$network" \
  --network-alias pdb-host -v "$shared:/shared" \
  -v "$task_dir/peer.mjs:/workspace/tests/two-container-peers/peer.mjs:ro" \
  -v "$repo_root/tests/support/chromium.mjs:/workspace/tests/support/chromium.mjs:ro" \
  -v "$repo_root/packages/transport/src/discovery.ts:/workspace/packages/transport/src/discovery.ts:ro" \
  -w /workspace \
  -e POCKETDB_PEER_ROLE=host "$image" \
  node tests/two-container-peers/peer.mjs >"$host_log" 2>&1 &
host_pid=$!

set +e
docker run --platform linux/amd64 --rm --name pocketdb-task032-client --network "$network" \
  -v "$shared:/shared" \
  -v "$task_dir/peer.mjs:/workspace/tests/two-container-peers/peer.mjs:ro" \
  -v "$repo_root/tests/support/chromium.mjs:/workspace/tests/support/chromium.mjs:ro" \
  -v "$repo_root/packages/transport/src/discovery.ts:/workspace/packages/transport/src/discovery.ts:ro" \
  -w /workspace -e POCKETDB_PEER_ROLE=client \
  "$image" node tests/two-container-peers/peer.mjs
client_status=$?
wait "$host_pid"
host_status=$?
set -e

cat "$host_log"
if [[ "$client_status" -ne 0 || "$host_status" -ne 0 ]]; then
  exit 1
fi
mkdir -p "$results"
cp "$shared/result-1.json" "$results/result-kv.json"
cp "$shared/result-2.json" "$results/result-postgresql.json"
cat "$results"/result-*.json
