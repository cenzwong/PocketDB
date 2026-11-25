# Host tab and worker lifecycle spike

The fixture serves a worker-owned, IndexedDB-backed key over an ordered WebRTC data channel. Each worker start generates a new boot identifier. Successful replies include the boot identifier, heartbeat tick count and persisted marker. The automated client runs outside the browser under test.

## Run the automated matrix

From this directory, run the following with Node and a Chromium installation. Set `POCKETDB_CHROMIUM` to select another executable.

```sh
npm ci --ignore-scripts --no-audit --no-fund
POCKETDB_HEADFUL=1 node verify.mjs
```

The driver records background visibility and a worker read, requests DevTools freeze and unfreeze, reloads, closes and reopens the host tab, and checks old and new client sessions. The timestamps are elapsed from the first established connection. DevTools freeze is an explicit browser lifecycle state, distinct from system sleep. See the [Chrome lifecycle documentation](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).

## Browser and device matrix

Both automated samples used one awake Mac running macOS 27.0.1 on arm64, with a Node v25.8.1 client process and a disposable foreground browser profile. Recovery time starts when the driver requests reload or close and ends at the first correct read after fresh negotiation.

| Browser | Hidden tab | DevTools freeze and resume | Reload recovery | Tab close and reopen |
| --- | --- | --- | --- | --- |
| Chrome Canary 160.0.8180.0 | Read passed on the original worker | 350 ms read timed out. Read passed after resume on the original worker and connection. | Old connection disconnected. New worker restored the value in 255 ms. | Old read timed out. New worker restored the value in 646 ms. |
| Edge 116.0.1938.62 | Read passed on the original worker | 350 ms read timed out. Read passed after resume on the original worker and connection. | Old connection disconnected. New worker restored the value in 136 ms. | Old read timed out. New worker restored the value in 660 ms. |

The freeze samples both recorded the browser's `freeze` and `resume` events. The timings are observations from two local samples and can include driver polling. See the [Chrome trace](chrome.json) and [Edge trace](edge.json).

### Product implications

Suggested host warning: “Keep this tab open and your device awake while others are connected. Backgrounding, sleep, reload, or closing this tab may interrupt access.”

After a timeout, allow a bounded health check before reconnecting. Reload and close require a fresh connection and authentication. A persisted instance may recover on reopen, subject to origin storage and ownership. An in-flight write with no acknowledgement has unknown outcome. A brief hidden-tab success supplies no guarantee of background availability, and this spike supplies no uptime or recovery SLA. Safari, mobile, long background periods and forced OS discard remain outside this matrix.

These results inform ADR-010 and ADR-014. Keep the Hosted Mode availability limits and lifecycle checks in scope. No schedule change follows from the current samples.

## Two Apple Container peers

This run uses two separate Linux arm64 guests on one Mac. Both run Chromium and the same worker-backed probe above. The controller uses guest loopback endpoints to exchange the offer and answer. Database reads and writes travel over WebRTC between the guests. The controller first suspends just the host guest's Chromium processes with SIGSTOP and resumes them with SIGCONT. It then stops and restarts the host guest while the client remains running. The same container filesystem retains the host browser profile across restart.

From the PocketDB root, with [Apple Container](https://github.com/apple/container) running:

```sh
container build -f artifacts/task-010-host-lifecycle/container/Dockerfile \
  -t pocketdb-lifecycle-local:1 artifacts
python3 artifacts/task-010-host-lifecycle/container/verify-containers.py
```

Set `POCKETDB_CONTAINER` if the CLI is outside PATH. The controller removes only the two containers it creates. The guest browser uses the root-only `--no-sandbox` option in a disposable Linux VM and loads only the local fixture. The probe uses an isolated development network and no external ICE services.

The repeat run on Apple Container 1.7.1 used Chromium 156.0.8078.108 on both guests. The awake client timed out during roughly 5.4 seconds of host browser suspension, then read the marker from the original worker within 282 ms of the resume command returning. After a full host stop, the client recorded a timeout. It read the saved marker from a new worker after fresh negotiation, 3,162 ms from the restart request. The [two-guest result](container/results.json) records the peer outcomes, worker identities and recovery timeline. The process suspension leaves the Linux guest and its network stack running. The container restart exercises host loss and cold recovery in Linux. Physical macOS sleep and wake remains a separate test.

## Measure physical host sleep

Use two connected Macs on the same Wi-Fi. The client must stay awake while the host sleeps. On this Mac, run from the PocketDB project root:

```sh
lifecycle_site="$(mktemp -d)"
cp artifacts/task-010-host-lifecycle/site/* "$lifecycle_site/"
cp artifacts/spike-support/peer-rpc.js "$lifecycle_site/"
python3 -m http.server --bind 127.0.0.1 --directory "$lifecycle_site" 9444
```

Copy the four staged files to the other Mac and serve them there with the same Python command pointed at that folder. Open [localhost:9444](http://localhost:9444/) on both Macs. An existing trusted HTTPS static preview serving all four files also works.

1. On the client, click **Create client offer**. Transfer its **Local signal** to the host's **Remote signal** field.
2. On the host, click **Accept offer and create host answer**. Transfer its **Local signal** to the client's **Remote signal** field and click **Accept answer on client**.
3. After the client logs `open`, click **Write marker from client** and confirm a reply contains `lifecycle-marker`. Record the host browser and macOS versions.
4. Put the host Mac to sleep for roughly 20 seconds. While the host sleeps, click **Read marker from client** and wait for a reply or timeout. Note when the host was put to sleep and woken.
5. Wake the host and read again. If the channel failed, save both journals, reload both pages, repeat only the offer and answer exchange, and read the existing marker without writing it again.
6. Save the JSON journals and record each device model, full browser version and macOS version. Keep the signal fields out of the evidence.

The client records request and reply or timeout timestamps. Compare worker identifiers and ticks before sleep and after wake, and use the first successful post-wake read to establish a recovery interval.
