# Machine-readable client capabilities

The capability manifest describes the engine and access scope authenticated for
one connection. Version 1 includes operations permitted to that invitation,
per-operation JSON Schemas for inputs and outputs, and engine feature flags.
`readOnlyOperations` identifies the subset that is safe for read-only access.
The manifest describes available operations; the host still enforces
authorization when each operation executes.

The [v1 JSON Schema](v1/capability-manifest.schema.json) defines the document.
Examples include key-value and PostgreSQL manifests for both access scopes:

- [Key-value, read-only](v1/key-value-read-only.json)
- [Key-value, read-write](v1/key-value-read-write.json)
- [PostgreSQL, read-only](v1/postgresql-read-only.json)
- [PostgreSQL, read-write](v1/postgresql-read-write.json)
- [SQLite, read-only](v1/sqlite-read-only.json)
- [SQLite, read-write](v1/sqlite-read-write.json)
- [DuckDB, read-only](v1/duckdb-read-only.json)
- [DuckDB, read-write](v1/duckdb-read-write.json)

Both the browser client and `@pocketdb/client` receive the manifest during the
version 1 handshake. See the [SDK reference](../guides/client-sdk.md),
[protocol specification](../specs/protocol-v1.md),
[remote access specification](../specs/remote-access.md),
[ADR-007](../decisions/ADR-007-protocol-encoding.md), and
[ADR-008](../decisions/ADR-008-capability-authentication.md).

PostgreSQL clients can call `schema()` for column names, types, nullability and
defaults, and `describeQuery()` for parameter and result-field type OIDs.
Returned OIDs are PostgreSQL type identifiers; they are not a complete schema
registry or a promise of identical type support across PGlite versions.
