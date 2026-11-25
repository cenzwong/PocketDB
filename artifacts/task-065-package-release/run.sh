#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="$repo_root/artifacts/task-065-package-release"
consumer_dir="$(mktemp -d "${TMPDIR:-/tmp}/pocketdb-package-consumer.XXXXXX")"
cleanup() {
  rm -rf "$consumer_dir"
}
trap cleanup EXIT

cd "$repo_root"
pnpm --filter @pocketdb/protocol pack --dry-run --json \
  > "$artifact_dir/pack-dry-run.json"
pnpm --filter @pocketdb/protocol pack \
  --pack-destination "$artifact_dir" \
  > "$artifact_dir/pack.log"

tarball="$artifact_dir/pocketdb-protocol-0.1.0.tgz"
test -f "$tarball"
tar -tzf "$tarball" > "$artifact_dir/tarball-files.txt"
shasum -a 512 "$tarball" > "$artifact_dir/sha512.txt"

npm init -y --prefix "$consumer_dir" >/dev/null
npm install --prefix "$consumer_dir" --cache "$consumer_dir/npm-cache" \
  --no-audit --no-fund --ignore-scripts "$tarball" \
  > "$artifact_dir/install.log" 2>&1

cat > "$consumer_dir/probe.js" <<'EOF'
import {
  createInvitation,
  createPocketDBInvitationUri,
  parseInvitation,
} from "@pocketdb/protocol";

const invitation = createInvitation({
  roomId: "package-smoke",
  instanceId: "artifact-check",
  engineId: "kv",
  expectedHostId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  access: "read-only",
});
const roundTrip = parseInvitation(createPocketDBInvitationUri(invitation));
if (roundTrip.roomId !== "package-smoke" || roundTrip.access !== "read-only") {
  throw new Error("Installed package consumer smoke returned the wrong invitation.");
}
console.log("installed package consumer smoke passed");
EOF

cat > "$consumer_dir/vite.config.mjs" <<'EOF'
export default {
  build: {
    lib: {
      entry: "./probe.js",
      formats: ["es"],
      fileName: "probe",
    },
    outDir: "dist",
    emptyOutDir: true,
  },
};
EOF

"$repo_root/apps/web/node_modules/.bin/vite" build "$consumer_dir" \
  --config "$consumer_dir/vite.config.mjs" \
  > "$artifact_dir/consumer-build.log" 2>&1
node "$consumer_dir/dist/probe.mjs" | tee "$artifact_dir/consumer-run.log"
