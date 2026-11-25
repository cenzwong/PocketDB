# Browser WebRTC request delivery spike

The [probe](site/index.html) uses an ordered, reliable WebRTC data channel and a host-side in-memory key-value map. Offer and answer each include the candidates gathered up to ICE completion. There are no configured ICE servers.

## Reproduce

For a same-Mac test, run this command from this directory with Python 3.13.

```sh
python3 -m http.server --bind 127.0.0.1 --directory site 9444
```

Open `http://localhost:9444/` in separate browsers. For the physical-device run, serve a local copy on each computer using the same command, or serve `site/` on a trusted HTTPS static preview accessible from both devices. Use the same LAN for the initial direct-connection attempt. Open a fresh page on each device.

1. On the client, click **Create client offer**. Wait for the local signal to appear. Copy it into the host's **Remote signal** field.
2. On the host, click **Accept offer and create host answer**. Wait for the local signal to appear. Copy it into the client's **Remote signal** field.
3. On the client, click **Accept answer on client**. When **Run client write, read and size checks** becomes enabled, click it once.
4. After `checks-complete` appears, close the host data channel with **Close this peer**. Verify that the client reports `channel-close` and its run button is disabled.
5. Save both JSON results and record each device model, OS, full browser version and network arrangement. Record any connection failures or skipped sizes. Keep SDP out of the saved results.

The probe measures connection on each device from that peer's remote signal action, excluding manual transfer time before the action. The host's figure includes generating the answer and the client's subsequent processing. Request timings measure the client round trip. The disconnect figure in the client report measures from completion of the last check.

The recorded same-Mac run used two separate headless Chromium profiles and exchanged SDP through the existing page controls via Chrome DevTools Protocol. Run `node verify-same-device.mjs http://localhost:9444/` with Chrome Canary and Edge installed in `/Applications`. The driver's close observation includes its polling interval of up to 100 ms.

## Measured result

On 24 November 2026 on one Mac running macOS 27.0.1 (26A434), Chrome Canary 160.0.8180.0 hosted and Edge 116.0.1938.62 acted as client. The host reported channel open 321 ms after starting its remote signal action. The client reported 109 ms. The negotiated maximum was 262,144 bytes on both peers.

| Operation | Result | Client RTT |
| --- | --- | --- |
| SET, request 1 | Acknowledged | 3.4 ms |
| GET, request 2 | Returned the value just written | 1.0 ms |
| 16 KiB echo | Byte-for-byte match | 9.4 ms |
| 64 KiB echo | Byte-for-byte match | 11.1 ms |
| 256 KiB echo | Byte-for-byte match | 21.1 ms |

Host channel close occurred 2 ms after the local close request on the host clock. The client received the close event and disabled requests. The driver observed closure within 105 ms of issuing the host action. See the [raw same-device report](same-device.json).

One run measured ordered request/response and an orderly close. Two later runs timed out reaching the loopback HTTP preview before negotiation began. Abrupt disconnects, in-flight mutation outcome, backpressure under concurrency, backgrounding, reconnect, peer authentication and WAN or relay behavior remain unverified. The page is a feasibility fixture for peers you control.

## Physical-device run

The user ran the probe on two macOS devices connected to the same Wi-Fi and supplied both browser reports. Browser versions below come from the reported user agents. Hardware models, OS builds and exact Chrome build versions were unavailable.

| Role | Browser version reported by user agent | Channel open after remote signal action |
| --- | --- | --- |
| Host | Chrome 160.0.0.0 | 31,633 ms, including manual answer transfer and client processing |
| Client | Chrome 159.0.0.0 | 31 ms |

The client recorded a successful SET at 9.2 ms, GET at 9.3 ms and byte-for-byte echoes at 16, 64 and 256 KiB in 44, 105 and 357.3 ms. Both peers reported a negotiated maximum of 262,144 bytes. The host recorded its channel close 78 ms after requesting it. Client-side close is captured in the separate same-Mac run. See the [physical host JSON](physical-host.json) and [physical client JSON](physical-client.json).

## Recommendation and impact

Start with one request in flight for feasibility and a provisional 16 KiB limit on encoded application messages, capped by the negotiated SCTP maximum. Validate `bufferedAmount` limits before increasing concurrency. Reject oversize payloads until framing or fragmentation has its own evidence. Treat a disconnect after sending a mutation as an unknown outcome until the protocol can establish what happened.

Use these results as inputs to ADR-002, ADR-004, ADR-005 and ADR-007. Keep NAT and relay testing in scope. Neither run supports an estimate change. See the [decision backlog](../../project/ADR_BACKLOG.md).
