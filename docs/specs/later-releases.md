# Later releases

Native interoperability, distributed replication, engine expansion and agent access build on the Hosted Mode release. Source requirements are in [handoff sections 5–7, 16–19, 27 and 31–35](../handoff.md).

## Native ecosystem (M4)

- The Node.js client uses the shared SDK and a validated Node transport. Publish supported runtime and platform versions.
- The CLI supports direct connection, queries, ping, inspection and authorized export, plus local bridge startup. Support scriptable noninteractive use, JSON output, meaningful exit codes, configurable deadlines and secure credential handling.
- PostgreSQL and RESP bridges map local driver connections to remote browser-owned instances. They bind to loopback by default, require explicit non-local configuration, isolate client sessions, redact credentials and close local connections when remote access is lost.
- Verify a named PostgreSQL driver with a parameterized query and transaction. Verify a named Redis client with key-value read/write and an unsupported-command response. Publish driver and capability matrices and executable Python examples using standard drivers.

The verified driver versions, Python examples and M4 evidence are recorded in
the [native driver matrix](../compatibility/native-drivers.md).

## Distributed Mode (M5)

- Authorized participants hold local replicas and can read and write while disconnected. Provide typed map, array, text and structured document operations with binary state exchange.
- Synchronize incremental updates, handle duplicate and out-of-order delivery, reconnect and converge after independent concurrent changes. Bound update sizes and document membership, revocation and visibility of retained copies.
- Persist replica state locally. Provide binary export/import and explicit choices for merging updates or restoring an isolated document.
- Show synchronization, membership and document state in the console. Verify offline writes and subsequent convergence on independent authorized replicas, state-vector exchange, normal reload, and snapshot import and merge.

The Yjs implementation boundary, membership/revocation guarantees and current
console evidence are recorded in [ADR-013](../decisions/ADR-013-crdt-synchronization.md)
and the [Distributed Mode guide](../guides/distributed-mode.md). The typed API,
authenticated synchronization and local persistence are in
[the Yjs adapter package](../../packages/engine-yjs/README.md). Independent
physical-device acceptance remains a release gate.

## Engine expansion (M6)

| Candidate | Evidence needed for selection and release |
| --- | --- |
| SQLite WASM | Parameterized SQL, transactions, file import/export and persistent storage on supported static browser targets. |
| DuckDB WASM | Representative CSV, JSON and Parquet ingestion, analytical SQL and efficient results, with verified asset/worker constraints. |
| Document storage | A validated use case and evidence for a hosted JSON or CRDT-based model, including query and portability requirements. |
| Vector search | A validated use case and measured indexing/query quality, runtime and resource bounds. |

Select adapters using feasibility and actual workloads. The Hosted engine contract and compatibility documentation apply to each shipped adapter.

## Agent integration (M7)

Provide machine-readable capabilities, structured discovery and permission-scoped access through the SDK and MCP. An authorized agent must be able to connect or provision through the supported surface, inspect supported schema/features, execute allowed operations and receive structured results and errors. Verify authorization with an executable example. A direct Python SDK and generalized infrastructure service contracts require separate scope decisions.

See [PROJECT.md](../../PROJECT.md#delivery-and-release-gates) for release gates and the [decision records](../decisions/README.md) for architectural choices.
