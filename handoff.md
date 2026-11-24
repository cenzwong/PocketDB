# Engineering Handoff: PocketDB

**Project:** PocketDB — Browser-native Database Infrastructure

**Status:** Project initiation

**Document type:** Product and Engineering Specification

**Target:** Hackathon-ready, local-first, peer-to-peer database infrastructure

**Primary distribution:** Static website, hosted on GitHub Pages

---

# 1. Mission

Build an open-source, browser-native Database-as-a-Service platform that allows anyone to turn their browser into a temporary database server without installing database software, provisioning cloud infrastructure or creating an account.

The product should allow a user to:

1. Open a static website.
2. Select a database engine.
3. Start a database instance inside their browser.
4. Generate a shareable connection URI.
5. Allow other devices, applications, developers and AI agents to connect to the database.
6. Execute database operations remotely.
7. Persist, export, restore or terminate the database instance.

The database computation and storage should take place on participating user devices rather than on centrally managed infrastructure.

The static website should primarily act as a software distribution mechanism.

## Product vision

**Turn any browser into an on-demand database server.**

## Long-term vision

Evolve PocketDB into a browser-native infrastructure platform capable of providing temporary databases, caches, message queues, shared memory, vector search and other lightweight infrastructure services.

A tiny cloud that runs in your browser.

---

# 2. Problem Statement

Developers participating in hackathons, building prototypes, experimenting with AI agents or developing small collaborative applications frequently require temporary infrastructure.

Typical requirements include:

- A PostgreSQL database.
- A Redis cache.
- A key-value store.
- A shared document database.
- A lightweight analytical database.
- A shared state management service.
- A vector database.

Current approaches introduce unnecessary friction for temporary workloads.

| Existing approach | Friction |
|---|---|
| Docker | Requires installation, configuration and sufficient resources |
| Cloud DBaaS | Requires accounts, credentials and potentially payment |
| Local database server | Requires installation and network configuration |
| SQLite file | Does not naturally provide remote database access |
| Managed Redis | Requires externally provisioned infrastructure |
| Firebase or Supabase | Introduces external service dependencies |
| Custom backend | Requires development, hosting and maintenance |

PocketDB should reduce infrastructure provisioning to opening a website, selecting an engine and sharing a connection link.

---

# 3. Design Principles

## 3.1 Zero-install database hosting

The database host should not require:

- Docker.
- Node.js.
- Python.
- A database server installation.
- A browser extension.
- Administrator privileges.
- A cloud account.

A supported modern browser should be sufficient.

Native client applications may optionally use an SDK or install a lightweight protocol bridge.

## 3.2 Static-first deployment

The main website must be deployable as static assets.

The project must not require an application backend for:

- Database execution.
- User authentication.
- Database persistence.
- Session management.
- Query processing.
- Database administration.

Optional networking infrastructure, such as signalling and TURN relays, must be explicitly identified and must not be responsible for database execution or persistence.

## 3.3 Local-first data ownership

Database data should remain under the control of participating users.

The default storage mechanisms should be browser-local technologies such as:

- IndexedDB.
- Origin Private File System (OPFS).
- In-memory storage.

Users must be able to export their data independently of the platform.

## 3.4 Network-agnostic architecture

Database engines must not depend directly on WebRTC, WebSocket or any specific transport implementation.

Transport implementations should be replaceable through stable interfaces.

## 3.5 Engine-agnostic architecture

Every database engine should be implemented as an independent adapter.

Adding a new engine should not require modifications to the transport, session management or core application architecture beyond engine registration and engine-specific capabilities.

## 3.6 Progressive compatibility

Support should be introduced in the following order:

1. Browser-based database console.
2. Browser-to-browser connections.
3. JavaScript and TypeScript SDK.
4. Node.js client support.
5. Native database protocol bridges.
6. Python SDK.
7. AI agent and MCP integration.

## 3.7 Hackathon-first reliability

Prioritise:

- Fast startup.
- Low configuration overhead.
- Clear error messages.
- Predictable behaviour.
- Simple connection management.
- Easy debugging.
- End-to-end working functionality.

Do not prioritise production-scale distributed database guarantees over delivering a usable initial product.

## 3.8 Explicit guarantees

PocketDB must not claim to provide guarantees that the selected database engine or deployment mode cannot support.

In particular:

- Redis-like compatibility is not equivalent to full Redis compatibility.
- SQL databases are not automatically CRDT databases.
- Peer-to-peer networking does not guarantee connectivity.
- Browser persistence does not guarantee permanent data retention.
- Static hosting does not guarantee that no external networking service is used.

---

# 4. Target Users

## 4.1 Hackathon participants

A team needs a shared database within minutes without configuring cloud infrastructure.

## 4.2 Software developers

A developer needs a temporary database to test an application, SDK or integration.

## 4.3 AI coding agents

An AI agent needs access to a lightweight database during software development or testing.

## 4.4 Students and educators

Students need isolated database environments without installing database software.

## 4.5 Local-first application developers

Developers need decentralised, replicated application state.

## 4.6 Data engineers

Data engineers need lightweight SQL environments for examining, transforming or querying local datasets.

## 4.7 Collaborative application developers

Developers need shared state, collaborative documents or synchronised key-value storage.

---

# 5. Core User Experience

## 5.1 Database host workflow

1. Open the PocketDB website.
2. Select a database engine.
3. Configure the instance name, storage mode and access permissions.
4. Start the database.
5. Receive a connection URI and shareable invitation link.
6. View connected clients.
7. Inspect database contents and query activity.
8. Export, restart or terminate the database.

The default workflow should require minimal configuration.

## 5.2 Database client workflow

1. Receive a connection link or URI.
2. Open the client website or use the PocketDB SDK.
3. Establish a connection with the database host.
4. Authenticate using the invitation capability.
5. Execute database operations.
6. Receive query results.
7. Handle disconnections and reconnections.

## 5.3 Native application workflow

A developer should eventually be able to run:

```bash
npx pocketdb connect \
  "pocketdb://example-room/postgres"
```

The CLI should establish a local protocol bridge.

Existing database libraries should then be able to connect through a local endpoint:

```text
postgresql://localhost:5432/demo
```

This is a target workflow, not an existing capability.

## 5.4 Distributed database workflow

For CRDT-backed engines:

1. A user creates a shared database.
2. Other users join the database.
3. Each authorised participant receives a local replica.
4. Participants can perform operations independently.
5. Changes are synchronised when peers are connected.
6. Concurrent changes converge according to the engine's CRDT semantics.

---

# 6. Database Operating Modes

PocketDB must distinguish between different database consistency and execution models.

## 6.1 Hosted Mode

One browser acts as the authoritative database host.

Other clients send queries or commands to that browser.

```text
Client A ──────┐
Client B ──────┼── Database Host
Client C ──────┘
```

Characteristics:

- Single authoritative database instance.
- Centralised execution.
- Database-specific transaction semantics.
- Remote clients do not automatically hold replicas.
- The host must remain operational.
- Database availability depends on the host's browser and device.

Suitable engines:

- PostgreSQL.
- SQLite.
- DuckDB.
- Redis-like key-value store.

This is the primary MVP operating mode.

## 6.2 Distributed Mode

Multiple participants maintain synchronised replicas.

```text
       Replica A
       /       \
Replica B ─── Replica C
```

Characteristics:

- Local reads and writes.
- Offline operation.
- Eventual convergence.
- Conflict resolution through CRDT semantics.
- No permanent authoritative host required for data convergence.
- Access revocation and membership management require separate consideration.

Suitable engines:

- Yjs.
- Loro.
- Automerge.
- Other CRDT-based storage implementations.

Do not attempt to convert arbitrary SQL operations into CRDT operations as part of the initial implementation.

## 6.3 Hybrid Mode

A future operating mode combining:

- Hosted SQL execution.
- Distributed metadata.
- Replicated application state.
- Database snapshots.
- Optional host migration.

Hybrid Mode is a research and development direction and is not required for the first release.

---

# 7. Database Engine Roadmap

| Engine | Implementation candidate | Operating mode | Priority |
|---|---|---|---|
| Key-value store | TypeScript Map and persistence adapter | Hosted | P0 |
| PostgreSQL | PGlite | Hosted | P0 |
| SQLite | SQLite WASM | Hosted | P1 |
| CRDT database | Yjs | Distributed | P1 |
| DuckDB | DuckDB WASM | Hosted | P2 |
| Document database | CRDT or JSON storage adapter | Hosted/Distributed | P2 |
| Vector database | WASM or JavaScript vector index | Hosted | P2 |
| Redis-compatible server | Expanded command and protocol support | Hosted | P2 |
| Additional CRDT engines | Loro or Automerge | Distributed | P3 |

Priority definitions:

- **P0:** Required for the initial working release.
- **P1:** Required for the broader hackathon-ready product.
- **P2:** Post-MVP expansion.
- **P3:** Exploratory functionality.

Implementation candidates must be validated through technical spikes before becoming final architectural commitments.

## 7.1 Key-value engine

Implement a lightweight Redis-inspired key-value engine.

Initial command support:

```text
PING
GET
SET
DEL
EXISTS
MGET
MSET
INCR
DECR
EXPIRE
TTL
PERSIST
SCAN
DBSIZE
```

Additional capabilities:

- Binary-safe values where supported.
- Key expiration.
- Optional persistence.
- Command validation.
- Memory limits.
- Batch operations.

The initial engine should be described as Redis-like rather than fully Redis-compatible.

Native RESP protocol compatibility should be introduced separately.

## 7.2 PostgreSQL engine

Use PGlite as the preferred implementation candidate.

Required capabilities:

- SQL queries.
- DDL and DML.
- Parameterised queries.
- Schema inspection.
- Transactions.
- Data persistence.
- Data export and import.
- Structured query errors.

Evaluate extension support, session isolation, transaction handling across multiple clients and PostgreSQL wire protocol integration.

## 7.3 SQLite engine

Use SQLite WASM.

Required capabilities:

- SQL execution.
- Parameterised statements.
- Transaction support.
- Database file import and export.
- Persistent storage where supported.

OPFS availability and browser-specific requirements must be validated.

## 7.4 CRDT engine

Use Yjs as the initial candidate.

Expose operations over:

- Maps.
- Arrays.
- Text.
- Structured application documents.
- Binary state updates.

Required functionality:

- Local persistence.
- Peer synchronisation.
- Incremental updates.
- Duplicate update handling.
- Offline editing.
- Reconnection.
- State export and import.

CRDT operations should have their own typed API rather than being artificially represented as SQL queries.

## 7.5 Analytical engine

Evaluate DuckDB WASM for:

- CSV ingestion.
- JSON ingestion.
- Parquet ingestion.
- Analytical SQL.
- Aggregations.
- Local dataset exploration.

Prefer efficient result formats, such as Arrow, where justified by workload size.

## 7.6 Future engines

The architecture should permit future adapters for:

- Vector search.
- Graph storage.
- Document storage.
- Time-series storage.
- Persistent queues.
- Object storage.

These capabilities are not required for the initial MVP.

---

# 8. High-Level System Architecture

```text
                 Static Website
                  GitHub Pages
                       │
              HTML / JS / WASM
                       │
       ┌───────────────┴────────────────┐
       │                                │
  Database Host                    Database Client
       │                                │
  Application UI                   SDK / Console
       │                                │
  Session Manager                  Client Runtime
       │                                │
  Request Router                   Protocol Layer
       │                                │
  Database Engine                  Transport Adapter
       │                                │
  Persistence Adapter                   │
       │                                │
       └─────── P2P Transport ───────────┘
                       │
              Optional Signalling
```

The major architectural layers are:

1. Application and administration UI.
2. Client SDK.
3. Session management.
4. Authentication and authorisation.
5. Database protocol.
6. Transport.
7. Database runtime.
8. Database engine adapters.
9. Persistence.
10. Observability.

Each layer must have explicitly defined responsibilities.

---

# 9. Database Runtime

The runtime is responsible for managing database instances independently of their underlying engine.

Responsibilities:

- Register available engine adapters.
- Create database instances.
- Start and stop instances.
- Route requests.
- Manage execution contexts.
- Enforce permissions.
- Enforce resource limits.
- Manage persistence.
- Produce instance status information.
- Handle engine errors.

Multiple database instances should be supported by the architecture, although the initial UI may limit users to one active database.

## 9.1 Database engine contract

The following interface is illustrative and should be refined through an architecture decision.

```typescript
interface DatabaseEngine {
  readonly id: string;

  capabilities(): EngineCapabilities;

  start(
    config: EngineConfig
  ): Promise<void>;

  openSession(
    context: SessionContext
  ): Promise<EngineSession>;

  execute(
    request: DatabaseRequest,
    session: EngineSession
  ): Promise<DatabaseResponse>;

  closeSession(
    session: EngineSession
  ): Promise<void>;

  snapshot(): Promise<Uint8Array>;

  restore(
    snapshot: Uint8Array
  ): Promise<void>;

  health(): Promise<EngineHealth>;

  stop(): Promise<void>;
}
```

Engines may expose additional interfaces for:

- Replication.
- Streaming.
- Native wire protocols.
- Transaction management.
- Subscriptions.
- Bulk operations.

Capabilities should be discoverable at runtime.

Avoid designing a lowest-common-denominator API that removes useful database-specific functionality.

---

# 10. Transport Architecture

WebRTC Data Channels should be evaluated as the default peer-to-peer transport.

The transport layer should provide:

- Peer discovery.
- Connection establishment.
- Message transmission.
- Connection state monitoring.
- Disconnection handling.
- Reconnection.
- Backpressure.
- Message fragmentation where necessary.
- Transport-level error reporting.

## 10.1 Transport interface

```typescript
interface Transport {
  connect(
    config: ConnectionConfig
  ): Promise<Connection>;

  disconnect(): Promise<void>;

  send(
    peerId: string,
    message: Uint8Array
  ): Promise<void>;

  onMessage(
    handler: MessageHandler
  ): Unsubscribe;

  onConnectionStateChange(
    handler: StateHandler
  ): Unsubscribe;
}
```

Database engines must not import or depend directly on transport implementations.

## 10.2 Automatic discovery

Evaluate Trystero or an equivalent WebRTC discovery library.

Potential signalling mechanisms include:

- Nostr relays.
- BitTorrent trackers.
- Configurable signalling services.

External infrastructure dependencies must be documented.

The implementation must not assume that public relays provide guaranteed availability or are suitable for unlimited production usage.

## 10.3 Manual connection

Provide a future manual signalling mode using:

- SDP offer/answer exchange.
- Copy and paste.
- QR codes where payload size permits.
- Exported connection negotiation files.

Manual signalling should enable connection establishment without a dedicated signalling server where network conditions permit.

## 10.4 NAT traversal

Evaluate:

- ICE.
- STUN.
- TURN.
- Direct local network connections.
- Restrictive enterprise networks.

TURN may be required when peers cannot establish a direct connection.

The application must expose meaningful connection diagnostics rather than silently failing.

## 10.5 Alternative transports

The architecture should permit future transport adapters for:

- BroadcastChannel.
- MessagePort.
- WebSocket.
- Node.js WebRTC.
- WebTransport where appropriate.
- In-process testing transports.

The initial implementation should focus on WebRTC and an in-process test transport.

---

# 11. Database Communication Protocol

Implement a versioned PocketDB application protocol over the transport layer.

The protocol must be independent of individual database engines.

## 11.1 Message envelope

Example:

```json
{
  "version": 1,
  "requestId": "req-123",
  "sessionId": "session-456",
  "instanceId": "db-789",
  "engine": "postgres",
  "operation": "query",
  "payload": {
    "sql": "SELECT * FROM users WHERE id = $1",
    "parameters": [42]
  }
}
```

Example response:

```json
{
  "version": 1,
  "requestId": "req-123",
  "status": "success",
  "payload": {
    "rows": [
      {
        "id": 42,
        "name": "Alice"
      }
    ]
  }
}
```

The actual protocol specification must define type encoding for values that JSON cannot represent losslessly.

## 11.2 Initial message types

```text
HELLO
AUTHENTICATE
AUTH_SUCCESS
AUTH_FAILURE
CAPABILITIES
OPEN_SESSION
CLOSE_SESSION
REQUEST
RESPONSE
ERROR
PING
PONG
DISCONNECT
```

Future message types:

```text
STREAM_START
STREAM_CHUNK
STREAM_END
CANCEL_REQUEST
SUBSCRIBE
UNSUBSCRIBE
EVENT
REPLICATION_UPDATE
REPLICATION_SYNC
```

## 11.3 Protocol requirements

- Version negotiation.
- Request-response correlation.
- Structured errors.
- Payload validation.
- Request timeouts.
- Maximum message size.
- Connection lifecycle management.
- Duplicate request handling.
- Engine capability negotiation.
- Binary payload support.

JSON should be considered for the first implementation because of its simplicity and debuggability.

Evaluate MessagePack or CBOR if binary encoding and performance become important.

## 11.4 Retry semantics

Mutating requests must not be automatically retried unless their execution status is known or the operation is explicitly idempotent.

The protocol should distinguish between:

- Request rejected before execution.
- Request completed successfully.
- Request failed during execution.
- Request execution outcome unknown.

Avoid claiming exactly-once execution guarantees unless implemented and verified.

---

# 12. Connection URI and Invitation Design

Use a project-specific connection URI.

Example:

```text
pocketdb://room-a7f2/postgres
```

A browser-compatible invitation link may use:

```text
https://example.github.io/pocketdb/#invite=...
```

The invitation payload may contain:

- Protocol version.
- Room identifier.
- Instance identifier.
- Engine type.
- Host identity information.
- Access capability.
- Expiration time.
- Transport configuration reference.

The final connection format must be specified through an architecture decision.

## Security requirements

- Generate invitation capabilities using a cryptographically secure random number generator.
- Do not use predictable room identifiers as authentication credentials.
- Avoid transmitting secrets through URL query parameters.
- Redact invitation secrets from logs.
- Support invitation revocation.
- Support optional expiration.
- Provide a clear warning when copying privileged connection links.

A custom URI is consumed by PocketDB clients. It must not be presented as directly compatible with standard PostgreSQL or Redis drivers.

---

# 13. Authentication and Authorisation

The default authentication model should be accountless, capability-based access.

## 13.1 Access levels

| Role | Permissions |
|---|---|
| Owner | Complete database and session administration |
| Read-write client | Permitted database reads and writes |
| Read-only client | Permitted database reads |
| Replication participant | Access to an authorised replicated dataset |

## 13.2 Security model

The host must validate permissions before dispatching operations to the database engine.

Read-only SQL access must be enforced through engine-level controls or a verified restricted execution mechanism.

Checking whether a SQL statement starts with SELECT is not sufficient.

## 13.3 Required protections

- Explicit session authentication.
- Secure invitation generation.
- Request schema validation.
- Query size limits.
- Result size limits.
- Connection limits.
- Rate limiting.
- Execution time limits where supported.
- Protection against malformed protocol messages.
- Secure handling of database credentials.
- Access revocation.
- Prevention of unintended host impersonation.

WebRTC transport encryption does not replace application-level authentication and authorisation.

## 13.4 Threat model

The engineering team must consider:

- Malicious database clients.
- Leaked invitation links.
- Untrusted signalling infrastructure.
- Peer identity spoofing.
- Denial-of-service requests.
- Expensive SQL queries.
- Oversized replication updates.
- Malicious database imports.
- Cross-site scripting.
- Supply-chain attacks.
- Browser storage limitations.
- Accidental data exposure.

Engine adapters must not expose arbitrary JavaScript execution as a database capability.

PocketDB must not be marketed as suitable for sensitive production workloads until an appropriate security review has been completed.

---

# 14. Persistence Architecture

Support multiple persistence modes.

| Mode | Behaviour |
|---|---|
| Ephemeral | Data exists only during the runtime session |
| Browser persistent | Data survives normal page reloads |
| Exportable | Data can be downloaded as a portable snapshot |
| Replicated | CRDT data is maintained across authorised replicas |

## 14.1 Persistence candidates

- IndexedDB.
- OPFS.
- Database-native persistence mechanisms.
- In-memory storage.

Persistence must be engine-aware.

Avoid duplicating an engine's native persistence functionality without a clear reason.

## 14.2 Snapshot management

Support:

- Manual export.
- Manual import.
- Database reset.
- Restore.
- Snapshot metadata.
- Snapshot format versioning.

Potential export formats:

| Engine | Export format |
|---|---|
| Key-value | JSON or binary snapshot |
| PostgreSQL | Supported database export format |
| SQLite | SQLite database file |
| CRDT | Binary CRDT state |
| DuckDB | Supported database or analytical file formats |

Snapshot restoration must define whether an operation replaces existing data or merges with it.

CRDT restoration must distinguish between merging updates and restoring an isolated document state.

## 14.3 Storage limitations

The application must account for:

- Browser storage quotas.
- Storage eviction.
- Private browsing restrictions.
- Origin isolation.
- Browser compatibility.
- User-initiated site data deletion.

Persistent browser storage must not be described as equivalent to a durable managed database backup.

---

# 15. Worker and Execution Architecture

Where supported, database engines should execute inside Web Workers.

```text
Main Browser Thread
    ├── UI
    ├── Session Management
    └── Transport
          │
          ▼
    Database Worker
          ├── Request Queue
          ├── Database Engine
          └── Persistence
```

Objectives:

- Keep the UI responsive.
- Isolate database execution.
- Support controlled worker termination.
- Manage concurrent requests.
- Reduce main-thread blocking.

Shared Workers may be evaluated for cross-tab database ownership.

Multi-tab coordination must prevent unsafe concurrent access to the same persistent database instance.

Service Workers may support offline website loading, but must not be treated as permanent background database servers.

The implementation must account for:

- Browser background throttling.
- Device sleep.
- Tab suspension.
- Browser termination.
- Mobile operating system restrictions.
- Worker lifecycle.

---

# 16. Client SDK Architecture

The TypeScript SDK should be the primary programmatic interface.

## 16.1 Connection API

```typescript
import { connect } from "@pocketdb/client";

const db = await connect(connectionUri);
```

## 16.2 SQL API

```typescript
const result = await db.query(
  "SELECT * FROM users WHERE id = $1",
  [42]
);
```

## 16.3 Key-value API

```typescript
const redis = await connectRedis(connectionUri);

await redis.set("name", "Alice");

const name = await redis.get("name");
```

## 16.4 CRDT API

```typescript
const replica = await connectCRDT(connectionUri);

const document = replica.getMap("shared-state");

document.set("status", "ready");
```

These APIs are illustrative targets.

## 16.5 SDK requirements

- Strong typing.
- Predictable error handling.
- Connection lifecycle management.
- Request cancellation where supported.
- Configurable timeouts.
- Reconnection.
- Engine-specific APIs.
- Capability discovery.
- Browser compatibility.
- Minimal dependencies.
- Clear documentation.
- Compatibility testing.

Browser and Node.js environments must be evaluated separately.

The browser's native WebRTC API cannot be assumed to exist in Node.js.

Node.js support may require a separate WebRTC implementation or transport adapter.

---

# 17. Native Database Protocol Bridges

Native compatibility is an important differentiator and should be treated as a dedicated engineering workstream.

Standard websites cannot directly listen on arbitrary TCP ports.

PocketDB must therefore provide an optional client-side bridge for standard database drivers.

```text
Existing Database Client
           │
      Local TCP Port
           │
   PocketDB Bridge CLI
           │
    WebRTC Transport
           │
    Browser Database
```

## 17.1 PostgreSQL bridge

Target usage:

```bash
npx pocketdb connect \
  "pocketdb://room-a7f2/postgres" \
  --port 5432
```

Existing applications should connect using:

```text
postgresql://localhost:5432/demo
```

Evaluate:

- PGlite wire protocol APIs.
- PGlite Socket implementation patterns.
- PostgreSQL startup messages.
- Authentication.
- Extended query protocol.
- Parameter encoding.
- Prepared statements.
- Transaction session isolation.
- Connection pooling behaviour.
- Cancellation.
- Driver compatibility.

The bridge must not create a new database instance locally when it is expected to connect to a remote browser-hosted instance.

## 17.2 Redis bridge

Implement or integrate a RESP protocol adapter.

Target usage:

```bash
npx pocketdb connect \
  "pocketdb://room-a7f2/redis" \
  --port 6379
```

Existing clients should connect using:

```text
redis://localhost:6379
```

Initially evaluate compatibility with:

- redis-cli.
- redis-py.
- Node Redis.
- ioredis.

Unsupported commands must return appropriate protocol errors.

## 17.3 Bridge security

- Bind to localhost by default.
- Require explicit configuration for non-local bindings.
- Avoid exposing invitation credentials through process logs.
- Maintain independent client session contexts.
- Terminate local connections when remote sessions become unavailable.

## 17.4 Compatibility matrix

Maintain a documented compatibility matrix for database drivers, supported commands and protocol features.

Do not claim full PostgreSQL or Redis compatibility based on basic query success alone.

---

# 18. Command-Line Interface

Introduce a CLI once the browser-based transport and SDK are stable.

Target commands:

```bash
pocketdb connect <uri>

pocketdb query <uri> "<query>"

pocketdb ping <uri>

pocketdb inspect <uri>

pocketdb export <uri>

pocketdb bridge <uri> --port 5432
```

Future administrative commands:

```bash
pocketdb sessions

pocketdb disconnect

pocketdb doctor

pocketdb version
```

CLI requirements:

- Machine-readable JSON output.
- Meaningful exit codes.
- Human-readable errors.
- Non-interactive execution.
- Configurable timeouts.
- Secure credential handling.
- Scriptability.
- Compatibility with AI coding agents.

A CLI client must not require cloud infrastructure owned by PocketDB.

---

# 19. AI Agent Integration

PocketDB should be designed to be AI-native without requiring an LLM for normal database operations.

Future integration mechanisms:

- TypeScript SDK.
- Python SDK.
- CLI.
- MCP server.

Example MCP tools:

```text
connect_database
list_databases
inspect_schema
execute_query
get_key
set_key
list_keys
export_database
disconnect_database
```

AI agents should be able to:

- Discover database capabilities.
- Inspect schemas.
- Execute authorised operations.
- Retrieve structured results.
- Understand errors.
- Manage temporary database sessions.

The MCP server should reuse the SDK rather than independently implementing the networking protocol.

Agent permissions must remain limited by the associated database invitation and session.

---

# 20. Web Application

The web application should be both a database hosting console and a database client.

## 20.1 Main screens

### Landing page

- Product explanation.
- Start a database.
- Connect to an existing database.
- Supported engines.
- Architecture and privacy information.

### Database creation

- Engine selector.
- Instance name.
- Persistence mode.
- Resource limits.
- Start database.

### Database dashboard

- Database status.
- Engine type.
- Instance identifier.
- Connection link.
- Connected peers.
- Storage usage estimates.
- Query statistics.
- Runtime information.

### Database console

Engine-specific interfaces:

- SQL editor.
- Redis command console.
- Key-value browser.
- CRDT document inspector.
- Query results table.

### Connection management

- Active connections.
- Pending authentication.
- Client permissions.
- Invitation creation.
- Invitation revocation.
- Disconnect client.

### Data management

- Export.
- Import.
- Restore.
- Reset.
- Delete.

### Network diagnostics

- Signalling status.
- Connection state.
- Peer information.
- Connectivity errors.
- Direct versus relayed connection where discoverable.

## 20.2 UX requirements

The interface should be:

- Desktop-first.
- Responsive.
- Developer-oriented.
- Accessible.
- Keyboard-friendly.
- Visually simple.
- Suitable for rapid demonstration.

Engine-specific features should be displayed according to capability discovery.

The application should clearly distinguish hosting a database from connecting to one.

## 20.3 Lifecycle warnings

The UI must explain that:

- Closing the host page may interrupt service.
- Device sleep may disconnect clients.
- Browser data can be deleted.
- Replicated mode has different consistency semantics.
- External signalling or relay infrastructure may be involved.
- Important datasets should be exported.

---

# 21. Observability

Provide lightweight local observability without requiring external telemetry infrastructure.

## 21.1 Instance metrics

- Uptime.
- Active connections.
- Requests received.
- Successful requests.
- Failed requests.
- Query execution duration.
- Bytes transmitted and received.
- Storage usage estimates.
- Queue depth.

## 21.2 Structured logs

Example:

```json
{
  "timestamp": "2026-01-01T12:00:00Z",
  "level": "info",
  "component": "transport",
  "event": "peer_connected",
  "peerId": "peer-123"
}
```

Logs must not include invitation secrets or query parameters by default.

## 21.3 Diagnostics

Users should be able to export diagnostic information with sensitive values removed.

Remote telemetry should be disabled by default unless an explicit opt-in mechanism is introduced.

---

# 22. Proposed Technology Stack

| Layer | Candidate |
|---|---|
| Programming language | TypeScript |
| Frontend | React or equivalent lightweight framework |
| Build tooling | Vite |
| Package management | pnpm |
| Monorepo | pnpm workspaces |
| PostgreSQL | PGlite |
| SQLite | SQLite WASM |
| Analytics | DuckDB WASM |
| CRDT | Yjs |
| Key-value | Native TypeScript |
| Networking | WebRTC Data Channels |
| Discovery | Trystero or equivalent |
| Persistence | IndexedDB / OPFS |
| Background execution | Web Workers |
| Offline website | Service Worker / PWA |
| Unit testing | Vitest |
| Browser testing | Playwright |
| CI/CD | GitHub Actions |
| Static hosting | GitHub Pages |
| CLI | Node.js / TypeScript |

Technology choices must be validated against:

- Browser support.
- Bundle size.
- Runtime performance.
- Licensing.
- Maintainability.
- Security.
- Active upstream maintenance.
- Static hosting compatibility.

Avoid introducing complex infrastructure solely to support development tooling.

---

# 23. Repository Structure

Use a modular TypeScript monorepo.

```text
pocketdb/
├── apps/
│   ├── web/
│   └── docs/
│
├── packages/
│   ├── core/
│   ├── types/
│   ├── protocol/
│   ├── session/
│   ├── security/
│   ├── runtime/
│   ├── observability/
│   │
│   ├── transport/
│   ├── transport-webrtc/
│   ├── transport-inprocess/
│   │
│   ├── persistence/
│   ├── persistence-indexeddb/
│   ├── persistence-opfs/
│   │
│   ├── engine-kv/
│   ├── engine-postgres/
│   ├── engine-sqlite/
│   ├── engine-crdt/
│   ├── engine-duckdb/
│   │
│   ├── client/
│   ├── cli/
│   ├── bridge-postgres/
│   ├── bridge-redis/
│   └── mcp/
│
├── examples/
│   ├── browser-client/
│   ├── node-client/
│   ├── python-postgres/
│   └── python-redis/
│
├── tests/
│   ├── integration/
│   ├── e2e/
│   ├── compatibility/
│   └── benchmarks/
│
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── protocol/
│   ├── security/
│   └── handoffs/
│
├── project/
│   ├── backlog/
│   ├── in-progress/
│   ├── review/
│   └── done/
│
├── .github/
│   └── workflows/
│
├── AGENTS.md
├── CONTRIBUTING.md
├── README.md
├── SECURITY.md
├── LICENSE
├── package.json
└── pnpm-workspace.yaml
```

This is the target structure, not a requirement to create every package immediately.

Create packages incrementally as functionality is implemented.

Avoid premature abstractions and empty package scaffolding.

---

# 24. Architecture Dependency Rules

Expected dependency direction:

```text
Application
    ↓
Client / Runtime
    ↓
Session / Security
    ↓
Protocol / Engine Contracts
    ↓
Transport and Engine Adapters
```

Cross-cutting functionality should depend on stable contracts rather than concrete implementations.

Rules:

- Engines must not depend on UI frameworks.
- Engines must not directly depend on networking.
- Transports must not depend on database engines.
- Protocol types must not depend on UI components.
- Client SDKs must not require the web application.
- Native bridges must reuse the SDK or shared protocol implementation.
- MCP tools must reuse existing client capabilities.
- Engine-specific packages should remain independently testable.
- Browser and Node.js environment-specific dependencies must be isolated.

---

# 25. Technical Feasibility Workstream

Before committing to the full project timeline, conduct focused technical spikes.

| Spike | Question to resolve |
|---|---|
| SP-01 | Can two independent browsers exchange reliable database requests through WebRTC? |
| SP-02 | Can automatic discovery operate without a PocketDB-owned server? |
| SP-03 | Can the application operate across common NAT and firewall configurations? |
| SP-04 | Can PGlite execute and persist databases within the target static website? |
| SP-05 | Can multiple remote clients maintain correct PostgreSQL transaction sessions? |
| SP-06 | Can Node.js establish a connection to the browser transport? |
| SP-07 | Can PostgreSQL wire protocol messages be forwarded to a remote PGlite instance? |
| SP-08 | Can a RESP bridge support existing Redis clients? |
| SP-09 | Can Yjs replicas synchronise, disconnect and converge reliably? |
| SP-10 | Can SQLite and DuckDB WASM operate within GitHub Pages hosting constraints? |
| SP-11 | What happens to database availability when a host tab is backgrounded? |
| SP-12 | How can peer identity and accountless authentication be established securely? |

Each spike must produce:

- A reproducible experiment.
- Source code.
- Test results.
- Known limitations.
- A recommendation.
- Affected architecture decisions.
- Impact on project scope and delivery estimates.

The native protocol bridge should be investigated early because it materially affects the product's differentiation and architecture.

---

# 26. Architecture Decisions

Create ADRs for significant architectural commitments.

Initial ADR candidates:

| ADR | Subject |
|---|---|
| ADR-001 | Static-first deployment architecture |
| ADR-002 | Hosted versus distributed database modes |
| ADR-003 | Monorepo and package boundaries |
| ADR-004 | Database engine adapter contract |
| ADR-005 | Peer-to-peer transport |
| ADR-006 | Signalling and NAT traversal |
| ADR-007 | Protocol encoding and versioning |
| ADR-008 | Capability-based authentication |
| ADR-009 | Database persistence |
| ADR-010 | Worker execution model |
| ADR-011 | PostgreSQL wire protocol bridge |
| ADR-012 | Redis protocol compatibility |
| ADR-013 | CRDT synchronisation architecture |
| ADR-014 | Browser compatibility strategy |
| ADR-015 | Snapshot and export formats |
| ADR-016 | Package distribution and versioning |
| ADR-017 | Open-source licensing |

Each ADR should document:

- Context.
- Decision.
- Alternatives.
- Trade-offs.
- Consequences.
- Reversibility.
- Validation evidence.
- Decision status.

ADRs should reflect validated decisions rather than simply restating implementation assumptions.

---

# 27. Testing Strategy

## 27.1 Unit tests

Cover:

- Protocol encoding and decoding.
- Request validation.
- Engine lifecycle.
- Key-value commands.
- Expiration logic.
- Authentication.
- Permission enforcement.
- Session management.
- Persistence adapters.
- Error mapping.

## 27.2 Engine contract tests

All engine adapters must pass a shared contract test suite covering supported capabilities.

Additional engine-specific suites should validate the engine's own semantics.

## 27.3 Integration tests

Cover:

- Runtime and engine interaction.
- Protocol and transport interaction.
- Client and host communication.
- Database persistence.
- Session isolation.
- Snapshot restoration.
- Authentication and authorisation.

## 27.4 End-to-end tests

Use isolated browser contexts to represent independent clients.

Required scenarios:

1. Start a database.
2. Generate an invitation.
3. Connect from another browser.
4. Authenticate.
5. Write data.
6. Read data.
7. Observe results.
8. Disconnect.
9. Reconnect.
10. Restore persistent state.

Include tests on separate physical devices and realistic networks, since automated browser contexts do not fully represent real-world NAT traversal.

## 27.5 Failure scenarios

Test:

- Host closes browser.
- Host refreshes page.
- Client disconnects unexpectedly.
- Signalling becomes unavailable.
- Invalid authentication.
- Expired invitations.
- Malformed messages.
- Oversized responses.
- Duplicate requests.
- Storage quota exceeded.
- Worker termination.
- Concurrent writes.
- Interrupted transactions.

## 27.6 Security tests

Verify:

- Unauthenticated requests cannot execute.
- Read-only clients cannot write.
- Revoked credentials cannot reconnect.
- Invalid protocol messages are rejected.
- Resource limits are enforced.
- Secrets are not included in logs.
- Native bridges bind to localhost by default.

## 27.7 CRDT correctness tests

Verify:

- Convergence across replicas.
- Duplicate updates.
- Out-of-order updates.
- Offline editing.
- Concurrent updates.
- Reconnection.
- State vector synchronisation.
- Snapshot import and merge.

---

# 28. Performance and Resource Objectives

The following are provisional engineering targets, not validated guarantees.

| Metric | Initial target |
|---|---|
| Key-value engine startup after assets load | Under 2 seconds |
| PostgreSQL startup after assets load | Under 5 seconds on reference hardware |
| Direct peer connection establishment | Under 10 seconds in favourable network conditions |
| Small key-value request latency | Under 100 ms p95 on the same LAN |
| Concurrent clients | At least 5 in the MVP |
| Persistent dataset | At least 50 MB on reference browsers |
| Main-thread responsiveness | No prolonged blocking during normal queries |

Establish a reference test environment and benchmark methodology before treating these targets as acceptance criteria.

Measure:

- Cold versus warm startup.
- Direct versus relayed connections.
- Query execution versus transport latency.
- Memory consumption.
- Bundle size.
- Worker startup.
- Storage performance.
- Large result transmission.

Lazy-load database engines so that users do not need to download all WASM binaries when opening the website.

---

# 29. Static Hosting and Deployment

The application must support GitHub Pages deployment.

Requirements:

- No mandatory application server.
- Static asset generation.
- HTTPS.
- Correct asset base paths.
- Compatible client-side routing.
- WASM asset loading.
- Cache versioning.
- Automated deployment.
- Reproducible builds.

Evaluate limitations relating to:

- Cross-origin isolation.
- COOP and COEP headers.
- SharedArrayBuffer.
- WASM threading.
- OPFS access.
- Browser-specific worker behaviour.
- Static host header configuration.

If a database engine requires capabilities unavailable on GitHub Pages, evaluate a compatible fallback build or alternative static hosting.

Do not silently introduce a dynamic application backend.

GitHub Actions should automate:

- Dependency installation.
- Linting.
- Type checking.
- Unit tests.
- Integration tests.
- Build verification.
- Static website deployment.
- Package publication after release approval.

---

# 30. Documentation Requirements

Documentation must be usable by both human developers and AI agents.

Required documentation:

- README.
- Quick start.
- Architecture overview.
- Supported database engines.
- Database mode comparison.
- SDK reference.
- Protocol specification.
- Security model.
- Persistence model.
- Browser compatibility.
- Native client compatibility.
- Troubleshooting.
- Self-hosting instructions.
- Engine adapter development guide.
- Transport adapter development guide.
- Known limitations.

Examples should demonstrate:

- Browser-to-browser key-value storage.
- Browser-hosted PostgreSQL.
- JavaScript SDK usage.
- Node.js client usage.
- Python applications through native bridges.
- CRDT collaboration.
- Database export and restore.

Examples must be executable and covered by appropriate tests.

---

# 31. Development Milestones

The following milestone sequence defines delivery outcomes. The downstream planning process must translate these milestones into estimated work packages and a project timeline.

## Milestone 0 — Technical feasibility

Demonstrate:

- Browser-to-browser communication.
- Browser-hosted key-value execution.
- PGlite execution.
- Persistence feasibility.
- Native protocol bridge feasibility.
- Basic static hosting compatibility.

Exit criteria:

- Major technical assumptions validated.
- Blocking constraints documented.
- Initial ADRs completed.
- MVP scope confirmed.

## Milestone 1 — Local database runtime

Deliver:

- Monorepo foundation.
- Engine contract.
- Runtime.
- Key-value engine.
- PostgreSQL engine.
- Worker execution.
- Local database console.
- Local persistence.

Exit criteria:

- A user can start and operate both engines within a browser.

## Milestone 2 — Peer-to-peer database access

Deliver:

- WebRTC transport.
- Discovery.
- Protocol.
- Request routing.
- Connection invitations.
- Session authentication.
- TypeScript client SDK.

Exit criteria:

- Two independent devices can execute remote database operations without a PocketDB-owned application backend.

## Milestone 3 — Hackathon MVP

Deliver:

- Database hosting dashboard.
- Database client console.
- Connection management.
- Persistence.
- Export and import.
- Resource limits.
- Reconnection handling.
- Error reporting.
- Network diagnostics.
- GitHub Pages deployment.

Exit criteria:

- A developer can provision and share a functional browser-hosted database without installing software on the host.

## Milestone 4 — Native ecosystem integration

Deliver:

- Node.js client.
- CLI.
- PostgreSQL protocol bridge.
- Initial Redis protocol bridge.
- Driver compatibility tests.
- Python integration examples.

Exit criteria:

- At least one established PostgreSQL driver and one Redis client can execute supported operations against a remote browser-hosted instance.

## Milestone 5 — Distributed database mode

Deliver:

- CRDT engine.
- Peer replication.
- Offline writes.
- Conflict resolution.
- State synchronisation.
- Replicated persistence.
- CRDT administration UI.

Exit criteria:

- Multiple authorised replicas converge after independent offline modifications.

## Milestone 6 — Engine expansion

Deliver selected additional adapters:

- SQLite.
- DuckDB.
- Document storage.
- Vector search.

Prioritise according to validated use cases.

## Milestone 7 — AI-native infrastructure

Deliver:

- MCP integration.
- Python SDK where justified.
- Machine-readable capability discovery.
- Agent-oriented examples.
- Infrastructure service extension contracts.

Exit criteria:

- An authorised AI agent can provision or connect to a database and perform supported operations programmatically.

---

# 32. Definition of Hackathon-Ready

The product should be considered hackathon-ready when a small team can:

1. Open the website.
2. Start a PostgreSQL or key-value database.
3. Generate a secure invitation.
4. Connect from another laptop.
5. Execute remote reads and writes.
6. Integrate the database into a prototype using the SDK.
7. Inspect active connections and database activity.
8. Recover data after a normal host page reload when persistent storage is enabled.
9. Export the database.
10. Understand connectivity and lifecycle limitations.

Target onboarding experience:

- No cloud account.
- No database installation on the host.
- No manual network configuration in favourable network environments.
- Minimal setup.
- Clear diagnostics when connectivity fails.

Native database protocol bridges should be considered a major subsequent release capability unless feasibility work demonstrates that they can be delivered within the initial hackathon milestone.

---

# 33. Key Engineering Risks

| Risk | Impact | Mitigation |
|---|---|---|
| WebRTC connectivity failure | High | Diagnostics, configurable signalling and optional TURN |
| Host browser suspension | High | Lifecycle detection, warnings and reconnection |
| Native protocol complexity | High | Early feasibility spikes and incremental compatibility |
| PostgreSQL session isolation | High | Explicit session management and transaction tests |
| Browser storage eviction | High | Persistent storage requests and export |
| Public signalling instability | High | Replaceable discovery adapters |
| Unauthorised database access | High | Capability authentication and peer identity validation |
| Expensive remote queries | High | Resource controls and worker isolation |
| Static hosting limitations | Medium | Compatible WASM builds and deployment testing |
| CRDT state growth | Medium | Measure update growth and evaluate safe compaction |
| Browser incompatibility | Medium | Published compatibility matrix |
| Excessive scope | High | Deliver complete vertical slices before adding engines |
| Large frontend bundle | Medium | Lazy loading and engine-specific packages |
| Upstream dependency changes | Medium | Version pinning and compatibility tests |

Risks must be maintained in a project risk register and revisited during milestone planning.

---

# 34. Non-Goals

PocketDB is not initially intended to provide:

- Production-grade high availability.
- Guaranteed 24/7 database hosting.
- Unlimited storage.
- Guaranteed internet connectivity.
- Full Redis compatibility.
- Full PostgreSQL server compatibility.
- Distributed SQL transactions.
- Automatic SQL-to-CRDT conversion.
- Kubernetes orchestration.
- Managed database backups.
- Enterprise identity federation.
- Public database hosting for anonymous users.
- Guaranteed zero external networking dependencies.
- Permanent background execution on mobile browsers.
- A complete replacement for managed cloud infrastructure.

These exclusions should remain explicit during planning to prevent scope creep.

---

# 35. Future Product Direction

After the database architecture is established, evaluate whether the runtime can be generalised into a browser-native infrastructure platform.

Potential service adapters:

| Service | Candidate capability |
|---|---|
| Cache | Redis-like key-value storage |
| Database | SQL execution |
| Shared state | CRDT replication |
| Message queue | Persistent task and message storage |
| Pub/Sub | Real-time event distribution |
| Object storage | Browser-hosted binary objects |
| Vector search | Semantic retrieval |
| Workflow runtime | Temporary task execution |
| Agent memory | Shared structured memory |
| Analytical service | DuckDB-based query execution |

Future abstraction:

```typescript
interface InfrastructureService {
  readonly id: string;

  capabilities(): ServiceCapabilities;

  start(config: ServiceConfig): Promise<void>;

  execute(
    request: ServiceRequest
  ): Promise<ServiceResponse>;

  health(): Promise<ServiceHealth>;

  stop(): Promise<void>;
}
```

Do not introduce this generalised infrastructure abstraction before the database runtime is sufficiently understood.

The broader vision should guide architectural boundaries without unnecessarily expanding the MVP.

---

# 36. Engineering Ways of Working

The repository should be designed to support both human engineers and autonomous coding agents.

## 36.1 Specification-driven development

Before implementing substantial functionality:

1. Define the problem.
2. Identify relevant architecture decisions.
3. Define the intended behaviour.
4. Establish acceptance criteria.
5. Identify dependencies.
6. Implement.
7. Test.
8. Document.
9. Review.

## 36.2 Agent-readable repository

Maintain:

- AGENTS.md.
- Explicit package responsibilities.
- Typed interfaces.
- Architecture diagrams.
- ADRs.
- Executable examples.
- Consistent naming.
- Local development instructions.
- Context anchors for significant architectural decisions.

Avoid requiring agents to infer architectural intent from scattered implementation details.

## 36.3 File-based project management

Maintain work items in version-controlled Markdown files.

```text
project/
├── roadmap.md
├── milestones.md
├── dependencies.md
├── risks.md
├── backlog/
├── in-progress/
├── review/
└── done/
```

Each engineering ticket should contain:

- Unique identifier.
- Title.
- Parent epic.
- Milestone.
- Objective.
- Context.
- Scope.
- Out-of-scope items.
- Dependencies.
- Related ADRs.
- Technical requirements.
- Acceptance criteria.
- Testing requirements.
- Documentation requirements.
- Estimated effort.
- Implementation status.

## 36.4 Implementation strategy

Prefer vertical slices.

For example:

```text
Browser client
    → Transport
    → Protocol
    → Runtime
    → Key-value engine
    → Response
```

Deliver a complete working request lifecycle before introducing numerous engines and optional infrastructure components.

Avoid simultaneously building all architectural layers without demonstrating end-to-end functionality.

## 36.5 Code quality

Require:

- Type safety.
- Conventional commits.
- Automated formatting.
- Linting.
- Unit tests.
- Integration tests.
- Clear public interfaces.
- Minimal dependencies.
- Backwards compatibility where appropriate.
- Explicit deprecation policies after stable release.

---

# 37. Instructions for Downstream Project Planning

The next agent receiving this handoff must act as a Technical Project Manager and Software Architect.

Its responsibility is to convert this specification into an executable engineering delivery plan.

It must not begin implementing the complete project before producing the project plan.

## 37.1 Required planning deliverables

### A. Product scope document

Separate:

- MVP.
- Hackathon-ready release.
- Native ecosystem integration.
- Distributed database release.
- Long-term platform vision.

### B. Work breakdown structure

Identify all major engineering workstreams and decompose them into:

```text
Initiative
    └── Epic
          └── Feature
                └── Engineering Ticket
                      └── Subtask
```

### C. Dependency graph

Identify:

- Blocking dependencies.
- Critical path.
- Parallelisable work.
- Architecture decision gates.
- Technical feasibility gates.
- Integration milestones.

The graph must distinguish hard technical dependencies from preferred implementation ordering.

### D. Project timeline

Produce:

- An optimistic estimate.
- An expected estimate.
- A conservative estimate.
- An individual developer scenario.
- A small engineering team scenario.
- An accelerated AI-agent-assisted scenario.

AI assistance must not be assumed to eliminate integration, testing, debugging or review effort.

Explicitly state assumptions concerning engineering capacity and available working hours.

### E. Technical spike backlog

Prioritise investigations that could materially alter the architecture or scope.

Every spike must have a clear exit condition.

### F. Architecture decision backlog

Identify ADRs that must be resolved before dependent implementation work can begin.

### G. Engineering ticket backlog

Generate sufficiently small, independently verifiable tickets.

Tickets should:

- Have a single primary objective.
- Be implementable without excessive context.
- Reference required architecture decisions.
- Identify dependencies.
- Specify testable acceptance criteria.
- Avoid vague instructions such as "implement database support".
- Specify expected deliverables.

### H. Release plan

Define:

- Release milestones.
- Exit criteria.
- Demonstration scenarios.
- Compatibility requirements.
- Test gates.
- Documentation requirements.
- Known limitations.

### I. Risk register

Maintain technical and delivery risks with:

- Probability.
- Impact.
- Mitigation.
- Owner or responsible workstream.
- Trigger conditions.
- Review status.

## 37.2 Suggested epics

The planning agent should validate and refine the following epic structure:

```text
EPIC-00  Technical Feasibility
EPIC-01  Repository and Developer Infrastructure
EPIC-02  Database Runtime
EPIC-03  Database Communication Protocol
EPIC-04  Peer-to-Peer Networking
EPIC-05  Authentication and Session Security
EPIC-06  Key-Value Engine
EPIC-07  PostgreSQL Engine
EPIC-08  Persistence and Snapshots
EPIC-09  Client SDK
EPIC-10  Web Administration Console
EPIC-11  Observability and Diagnostics
EPIC-12  Static Deployment
EPIC-13  Node.js Client
EPIC-14  PostgreSQL Protocol Bridge
EPIC-15  Redis Protocol Bridge
EPIC-16  CLI
EPIC-17  CRDT Replication
EPIC-18  Additional Database Engines
EPIC-19  AI Agent and MCP Integration
EPIC-20  Documentation and Examples
EPIC-21  Testing and Compatibility
EPIC-22  Security and Release Hardening
```

## 37.3 Required planning artifacts

Produce the following files:

```text
project/
├── PROJECT_PLAN.md
├── PRODUCT_SCOPE.md
├── ROADMAP.md
├── TIMELINE.md
├── MILESTONES.md
├── DEPENDENCY_GRAPH.md
├── RISK_REGISTER.md
├── RELEASE_PLAN.md
├── TECHNICAL_SPIKES.md
├── ADR_BACKLOG.md
├── epics/
└── backlog/
```

The dependency graph and timeline should include Mermaid visualisations where appropriate.

Each artifact must remain consistent with the other planning documents.

## 37.4 Planning priorities

The first deliverable must be a complete end-to-end database experience, not the maximum possible number of supported engines.

Prioritise the following proof of value:

```text
Open website
    ↓
Start database
    ↓
Share invitation
    ↓
Connect from another device
    ↓
Execute database operation
    ↓
Receive result
```

The second major proof of value is:

```text
Existing application
    ↓
Standard database driver
    ↓
Local protocol bridge
    ↓
Peer-to-peer connection
    ↓
Browser-hosted database
```

The third major proof of value is:

```text
Multiple independent devices
    ↓
Offline database modifications
    ↓
Peer reconnection
    ↓
CRDT convergence
```

These demonstrations should guide milestone construction and technical prioritisation.

---

# 38. Definition of Done

An engineering ticket is complete only when:

- Implementation is present.
- Acceptance criteria are satisfied.
- Relevant automated tests pass.
- Type checking passes.
- Linting passes.
- Error handling is implemented.
- Security implications are considered.
- Documentation is updated.
- Related architecture decisions are recorded.
- Known limitations are documented.
- No unexplained regression is introduced.

A milestone is complete only when its end-to-end demonstration is reproducible from documented instructions.

---

# 39. Final Success Criteria

PocketDB succeeds when a developer can provision useful temporary infrastructure as easily as opening a webpage.

The primary product differentiation is the combination of:

- Zero-install database hosting.
- Static website distribution.
- Local database execution.
- Peer-to-peer connectivity.
- Portable database state.
- Standard client compatibility through optional bridges.
- Distributed CRDT-backed database modes.
- Extensible infrastructure adapters.

The architecture should allow PocketDB to grow from a hackathon database utility into a broader browser-native infrastructure platform without requiring a fundamental redesign.

The fundamental promise must remain:

**Your browser. Your compute. Your storage. Your database.**

**No database installation. No mandatory cloud account. No centrally hosted database.**