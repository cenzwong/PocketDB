# Apple Container lifecycle supplement for TASK-043

This result is a repeat of the TASK-010 two-guest worker lifecycle probe using the Apple Container runtime installed for local evaluation. It exercises browser-process suspension and full Linux guest restart across two isolated arm64 Linux containers on one Mac. It does not simulate macOS sleep, two physical Macs, PocketDB's database engines, or the final deployed-site flow.

## Reproduce

From the repository root on Apple silicon with Apple Container 1.7.1:

```sh
container build -f artifacts/task-043-container-peers/Dockerfile \
  -t pocketdb-lifecycle-local:1 artifacts
python3 artifacts/task-043-container-peers/verify-containers.py \
  > artifacts/task-043-container-peers/lifecycle-results.json
```

The image installs Alpine Chromium into the locally available `node:25-alpine` guest. The verifier differs from the TASK-010 copy only in using BusyBox-compatible `hostname -i` for checking that the guest addresses differ. It creates and removes the two named probe guests.

## Result

Apple Container 1.7.1 on macOS 27.0.1 arm64, Node 25.9.0, Chromium 149.0.7827.53 in both arm64 Linux guests. Browser-process suspension caused a read timeout; the existing worker replied 288 ms after resume. Stopping the host guest caused a timeout; after restart and fresh negotiation, the saved marker was read from a new worker 3,437 ms after the restart request. Full peer journals and timestamps are in [lifecycle-results.json](lifecycle-results.json).

## Limitation

This is Linux guest lifecycle evidence on one awake Mac. It does not meet TASK-043's requirement for two physical Macs to run §32 against the deployed site, including both P0 engines, persistence/export, and physical host sleep/wake. Those final release checks remain outstanding.
