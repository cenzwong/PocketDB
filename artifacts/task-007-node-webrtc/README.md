# Node-to-browser WebRTC spike

Node used each candidate as an offerer and sent correlated JSON SET and GET requests to the existing [browser host](../task-003-webrtc/site/index.html). The first reply acknowledged the write. The second returned the generated value. The driver passed SDP through the existing manual controls via Chrome DevTools Protocol. Both peers ran on one Mac with no STUN or TURN configured.

## Reproduce

Run from this directory with Node and Chrome Canary installed. Set `POCKETDB_CHROMIUM` to another Chromium executable if needed.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs node-datachannel
node verify.mjs werift
```

## Evidence

Measured on macOS arm64 with Node v25.8.1, Node-API 10 and Chrome Canary 160.0.8180.0.

| Candidate | Correlated SET and GET | Browser channel open from remote signal action | Browser reported maximum |
| --- | --- | --- | --- |
| node-datachannel 0.33.6, libdatachannel 0.24.6 | Passed | 140 ms | 262,144 bytes |
| werift 0.28.0 | Passed | 187 ms | 65,536 bytes |

The Node-side driver polls every 100 ms. Its observed timings are upper bounds that include polling delay. The browser reports its own connection timing. See the [node-datachannel result](node-datachannel.json) and [werift result](werift.json).

node-datachannel installed and loaded the `@node-datachannel/darwin-arm64` prebuilt add-on without install scripts or a compiler. The native package depends on prebuilt availability for the target platform and architecture. Werift uses JavaScript from TypeScript sources and its installed dependency tree loaded on this Mac. Linux, Windows, Intel Mac, Node LTS, packaging from a published tarball, different networks and relay compatibility remain open. See [node-datachannel packaging](https://github.com/murat-dogan/node-datachannel/blob/master/README.md) and the [werift project](https://github.com/shinyoshiaki/werift-webrtc).

## Recommendation and impact

Advance werift as the first Node adapter candidate to avoid a platform-specific binary in the initial CLI path. Keep node-datachannel as a fallback pending an LTS and target-platform matrix. Retain the provisional 16 KiB application envelope from TASK-003, bounded by the negotiated limit. These results inform ADR-005 and TASK-044 and allow the protocol-bridge probes to use a verified local WebRTC path. Keep distribution and relay checks in their existing scope. No schedule change follows from this single-machine comparison.
