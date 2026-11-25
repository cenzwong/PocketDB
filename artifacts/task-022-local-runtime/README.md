# M1 local runtime browser evidence

## Environment

- Host: macOS 27.0.1, arm64, running OrbStack Linux x86_64 containers under emulation
- Container: Node.js v24.22.3, pnpm 11.25.0
- Stable Google Chrome: 158.0.8127.88
- Stable Microsoft Edge: 158.0.4370.33
- Previous preview/legacy host-browser runs are historical and are not used as stable-browser evidence.

The browser support policy in [ADR-014](../../docs/decisions/ADR-014-browser-support.md) targets current stable Chromium-based desktop browsers first. The stable matrix below ran in Linux browser containers on this Mac. It establishes current stable Chromium behavior in Linux, not native macOS browser behavior.

## Commands and outcomes

Run from the repository root with Node v24.22.3 and pnpm 11.25.0 inside the Linux test container:

```sh
pnpm --filter @pocketdb/web test:browser
pnpm --filter @pocketdb/engine-kv test:browser
```

For Edge 116, set `POCKETDB_CHROMIUM` to `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` before each command.

| Browser | Local console (`@pocketdb/web`) | Key-value persistence (`@pocketdb/engine-kv`) |
| --- | --- | --- |
| Chrome 158.0.8127.88 (stable) | Passed. PostgreSQL SQL success and syntax error, stop, IndexedDB write and full page reload recovery. Key-value SET, visible key row, stop, full page reload, GET recovery, malformed JSON feedback and stop. | Passed. Full page reload recovery, TTL timestamp preservation, expiry while stopped, same-origin ownership rejection/release, distinct-directory key isolation, ephemeral reset, malformed/incompatible snapshot rejection, and quota rollback with a 1 MiB origin quota. Existing data remained intact. |
| Edge 158.0.4370.33 (stable) | Passed the same console flows. | Passed the same persistence, snapshot validation, and quota rollback checks. Existing data remained intact. |

The KV quota probe uses deterministic pseudorandom binary data because Edge compressed the former repeated-character fixture and did not exceed the configured quota. The complete `pnpm test:browser` chain previously passed in Chrome Canary 160.0.8181.0, including runtime, invitation, WebRTC, key-value persistence, PGlite persistence and console suites. Stable focused browser commands were run for both Chrome and Edge. PGlite persistence evidence for the previous preview/legacy matrix is in [TASK-020](../../board/done/TASK-020-persist-browser-local-postgresql-instances.md).

## Limitations

The current stable browsers ran in Linux x86_64 containers under emulation; native macOS stable-browser behavior is not covered. Safari, Firefox, mobile browsers, browser eviction and real Pages CDN hosting remain outside this milestone's tested matrix.
