# TASK-032 two-container WebRTC proof

## Reproduce

From the repository root on an Apple Silicon Mac with OrbStack and Docker CLI available:

```sh
bash artifacts/task-032-two-container-peers/run.sh
```

The script builds the browser image, creates two separate peer containers on an isolated Docker network, starts the static web app in each browser, and runs an HTTPS room-signaling fixture in the host container. It then exchanges the app's real invitation link and exercises the production browser client flow. The fixture uses a one-day self-signed certificate and the test browser ignores certificate errors. It has no external signaling dependency and must not be treated as a production signaling service.

Apple Container was not used: the downloaded upstream installer did not pass `pkgutil --check-signature`, so the package was not installed. OrbStack provides the isolated local containers for this proof.

## Result

Run completed 2026-11-24 using Chrome 158.0.8127.88 in two Linux x86_64 containers under emulation on macOS 27.0.1 arm64 with OrbStack. Both peers ran the static Vite app at their own loopback origin. WebRTC host candidates connected directly over the isolated container bridge.

- Key-value host: remote `SET container-proof remote-value` and `GET container-proof` both passed. Result: [result-kv.json](result-kv.json).
- PostgreSQL host: client ran `SELECT value FROM remote_proof WHERE value = $1` with `container-peer` and received the seeded row. A `CREATE TABLE` request on the read-only invitation was rejected with `permission-denied` before execution. Result: [result-postgresql.json](result-postgresql.json).
- The host and client exchanged offer and answer through the fixture; peer authentication, remote session opening, requests, and disconnect completed.

The first real browser run exposed and fixed a signaling bug: the default `fetch` reference was invoked without its browser-global receiver, raising `Illegal invocation`. `HttpRoomSignalingAdapter` now binds the default fetch to `globalThis`; the two-container run then passed.

## Limits and deferred release evidence

This is two isolated Linux browser containers on one Mac, not two physical Macs or a separate-network/NAT traversal test. The local signaling fixture is disposable and unauthenticated. The physical two-laptop, deployed-site proof and host sleep/wake exercise remain part of the final release gate in [TASK-043](../../board/backlog/TASK-043-certify-the-hackathon-ready-release.md), as requested.
