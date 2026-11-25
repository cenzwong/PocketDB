# Remote RESP compatibility spike

Node Redis connects to a loopback RESP2 bridge. The bridge parses TCP input and forwards SET and GET over WebRTC. A browser-owned Map stores the bytes using base64 keys and values. Node responds to local negotiation and checks, and independently reads the browser state to confirm ownership.

## Reproduce

From this directory, with Node and Chrome Canary:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs
```

Set `POCKETDB_CHROMIUM` to another Chromium executable if needed.

## Results

Node Redis 6.4.0 on Node v25.8.1 and macOS arm64 connected to a host in Chrome Canary 160.0.8180.0. Startup sent two CLIENT SETINFO commands and the bridge acknowledged them. PING returned PONG. SET and GET preserved a binary key and a binary value containing NUL, CRLF and non-UTF-8 bytes. A missing GET returned a RESP2 null bulk string. INCR returned `ERR unsupported command or arguments`. The [report](results.json) also records fragmentation, coalescing and invalid-length or terminator parser checks.

The bounded parser accepts RESP2 arrays of bulk strings with up to eight elements, 4 KiB per field and 8 KiB per frame and receive buffer. It supports SET and GET without options, PING, the measured CLIENT SETINFO acknowledgement and local QUIT handling. QUIT was not exercised by this client run. No RESP3, HELLO, AUTH, SELECT, transactions, subscriptions, pipelining beyond the fixture buffer, or Redis Cluster semantics are claimed. See the [Redis protocol specification](https://redis.io/docs/latest/develop/reference/protocol-spec/), [CLIENT SETINFO](https://redis.io/docs/latest/commands/client-setinfo/) and [Node Redis connection settings](https://redis.io/docs/latest/develop/clients/nodejs/connect/).

## Recommendation and impact

Advance RESP2 as a bounded localhost compatibility subset under ADR-012. Publish a command and client-version matrix and return protocol errors for unsupported commands. Verify local multi-client lifecycle, rate and buffer limits, binary handling, redis-cli and other drivers before extending the scope. No schedule change follows from a single driver on one machine.
