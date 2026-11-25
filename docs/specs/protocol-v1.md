# PocketDB browser protocol v1

This specification defines the first browser SDK envelope encoded as compact UTF-8 JSON. PostgreSQL wire and RESP remain separate native bridge protocols. Implemented codec and fixtures live in [`@pocketdb/protocol`](../../packages/protocol/).

## Envelope and negotiation

Every message has `version: 1` and a `type`. Unknown versions, message types, missing fields and extra fields are rejected. `hello` carries a unique `id` and a non-empty list of supported positive integer versions. `hello-ack` echoes that `id`, selects version 1, and supplies the engine capability value. A peer must reject the handshake if version 1 is absent from the peer's advertised list.

The engine capability value has its own `version`. Version 1 identifies the invited engine and access scope, lists only operations allowed to that scope, describes each operation's input and output with JSON Schema, and includes feature flags. Clients reject unknown capability-manifest versions. The JSON Schema and permission-scoped examples are published under [`docs/capabilities/`](../capabilities/README.md). The manifest is descriptive; the host still enforces authorization for every request.

All request messages carry an `id`; the correlated `response` or `error` echoes that ID. IDs are unique among outstanding messages on one connection. A response also carries its session ID. The host dispatcher deduplicates repeated IDs with identical content on one connection and rejects reuse with different content. A timeout after dispatch returns `outcome: "unknown"`; clients must not replay that mutation automatically. A failed operation reports `failed`, while a request rejected before dispatch reports `not-started`.

## Message types

| Type | Required fields | Purpose |
| --- | --- | --- |
| `hello` | `id`, `supportedVersions` | Begin version negotiation. |
| `hello-ack` | `id`, `selectedVersion`, `engines` | Confirm the selected version and advertised capabilities. |
| `authenticate` | `id`, `invitation`, `peerIdentity` | Present the scoped invitation and the client's base64url SPKI public key. |
| `authentication-challenge` | `id`, `nonce`, `clientIdentity`, `hostPublicKey`, `expiresAt`, `signature` | Return the host-signed, single-use peer-binding challenge. |
| `authentication-proof` | `id`, `nonce`, `identityProof`, `capabilityProof` | Prove client key possession and invitation capability over the signed transcript. |
| `authenticated` | `id`, `sessionId`, `instanceId`, `engineId` | Report the identity-bound session. |
| `open-session` | `id`, `sessionId`, `instanceId`, `engineId`, `access` | Request an authorized engine session. `access` is `read-only` or `read-write`. |
| `close-session` | `id`, `sessionId` | Close an engine session. |
| `request` | `id`, `sessionId`, `instanceId`, `engineId`, `operation`, `payload` | Execute one engine-aware operation. |
| `response` | `id`, `sessionId`, `payload` | Return the correlated result. |
| `error` | `id`, optional `sessionId`, `error` | Return a structured error with `code`, `message`, optional `retryable`, and optional `outcome` (`not-started`, `failed`, or `unknown`). |
| `heartbeat` | `sequence` | Report connection liveness with a non-negative safe integer sequence. |
| `disconnect` | optional `reason` | Announce a clean local disconnect. |

The envelope version identifies the schema used for every message. Authentication and authorization are verified by the host; schema validity alone grants no access. The codec validates shape and encoding but leaves transcript verification, permissions, engine command validation and correlation state to the caller. The transcript covers invitation room, instance, engine, access and expiry; pinned host identity; both DTLS fingerprints; challenge expiry and nonce; and client identity. `@pocketdb/remote-access` revalidates the authenticated connection before handling each session or request message and binds opened runtime sessions to the invitation's instance, engine and access level.

## Payload values

Payloads support `null`, booleans, strings, finite JavaScript numbers, `bigint`, `undefined`, byte arrays and views, arrays, and plain string-keyed objects. The JSON codec tags values that JSON cannot represent without loss. A tagged value is an object with `$pdb` and `value` fields:

| Value | Wire representation |
| --- | --- |
| finite number | `{ "$pdb": "number", "value": "<round-tripping decimal>" }` |
| `bigint` | `{ "$pdb": "bigint", "value": "<base-10 integer>" }` |
| bytes | `{ "$pdb": "bytes", "value": "<canonical padded base64>" }` |
| `undefined` | `{ "$pdb": "undefined" }` |
| array | `{ "$pdb": "array", "value": [<values>] }` |
| object | `{ "$pdb": "object", "value": [[<key>, <value>], ...] }` |

All object values use the tagged pair-list form, so an application object containing a `$pdb` key remains ordinary data. Integer values outside JavaScript's safe integer range should use `bigint`; exact SQL decimals, dates, timestamps and engine-specific scalar formats should use their string representation. `DataView` and typed-array views decode to `Uint8Array`, preserving bytes and view boundaries rather than the source constructor.

Cycles, accessors, symbol keys, non-plain objects, non-finite numbers and unknown value tags are rejected. Object keys are case-sensitive and preserved in insertion order. SQL operation-specific semantics remain owned by the engine adapter.

## Resource and error limits

The default maximum encoded message size is 262,144 UTF-8 bytes, checked before JSON parsing and after encoding. The default maximum wire nesting depth is 32 and maximum wire node count is 10,000. Callers may choose stricter limits; larger limits remain subject to the transport's own message boundary. UTF-8 byte input is decoded in fatal mode. Codec failures use `ProtocolCodecError` with codes including `message-too-large`, `unsupported-version`, `invalid-envelope`, `invalid-value`, `value-too-deep`, `too-many-values`, `malformed-json` and `invalid-utf8`.

The [JSON fixtures](../../packages/protocol/fixtures/v1-messages.json) are executable examples. The data-channel envelope has no fragmentation, streaming or automatic retry semantics. Duplicate suppression is scoped to the host session dispatcher, not the codec or transport. Versioned invitation URI encoding is specified separately in [remote access](remote-access.md).
