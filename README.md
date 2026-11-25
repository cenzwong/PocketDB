# PocketDB

PocketDB runs databases in your browser. Start a local instance, query it from
the console, and invite another browser or a client application to connect over
WebRTC. The static site delivers the app. Your browser runs the database and
owns its storage.

## Quick start

Use the Node.js version in [`.node-version`](.node-version) and the pnpm version
in [`package.json`](package.json).

```sh
pnpm install --frozen-lockfile
pnpm --filter @pocketdb/web dev
```

Open the URL printed by Vite. Choose **Key-value**, select **Start**, and run
`SET` with `["greeting", "hello"]`, followed by `GET` with `["greeting"]`.
For SQL, start a **PostgreSQL** instance and run `SELECT 42 AS answer;`.
Use the [Hosted Mode guide](docs/guides/hosted-mode.md) to connect a second client.

## Capabilities

- **Local databases** for key-value commands, PGlite PostgreSQL, SQLite, and DuckDB analytics. Available operations, storage, and import/export formats vary by engine. [Capability reference](docs/capabilities/README.md)
- **Hosted Mode** for authenticated peer sessions with scoped invitations and host-side permission checks. Both peers need a compatible signaling endpoint. Keep the host browser open and awake while clients are connected. [Hosted Mode and networking](docs/guides/hosted-mode.md#invite-a-client)
- **Distributed Mode** for invitation-authorized Yjs replicas that can edit offline and sync on reconnect. [Distributed Mode guide](docs/guides/distributed-mode.md)
- **Client integrations** through the browser SDK, Node client, CLI, localhost PostgreSQL and RESP2 bridges, and MCP tools. [SDK guide](docs/guides/client-sdk.md), [CLI](packages/cli/README.md), [MCP guide](docs/guides/mcp.md)

## Architecture

The static app opens engine sessions in dedicated workers. The runtime defines
engine contracts. Hosted clients send versioned requests over WebRTC, and the
host authorizes each request before it reaches an engine session. Distributed
Mode exchanges replica updates between participating browsers. [Architecture](docs/architecture/README.md)

Run `pnpm build` to produce the static site in `apps/web/dist`.
See [deployment](docs/deployment.md) for static hosting and verification,
[development](docs/development.md) for contributor checks, and [PROJECT.md](PROJECT.md)
for project scope and release status.

PocketDB is licensed under [Apache-2.0](LICENSE).
