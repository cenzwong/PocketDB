# PocketDB guides

These guides describe the browser Hosted Mode that exists in this repository.
The host browser owns database execution and default storage. PocketDB does not
operate a database or signaling service.

- [Start a hosted database and run SQL or key-value commands](hosted-mode.md)
- [Distributed Mode quick start](distributed-mode.md)
- [Browser TypeScript client reference](client-sdk.md)
- [Machine-readable capability manifests](../capabilities/README.md)
- [Export and restore a database snapshot](backup-restore.md)
- [Troubleshooting and recovery](troubleshooting.md)
- [Static hosting and external networking requirements](../deployment.md)

For implementation boundaries, supported protocol behavior, and decisions,
see the [target architecture](../architecture/README.md),
[hosted runtime specification](../specs/hosted-runtime.md),
[remote access specification](../specs/remote-access.md),
[version 1 protocol specification](../specs/protocol-v1.md), and
[architecture decision index](../decisions/README.md).

The checked-in SDK example is in [`packages/client/example/`](../../packages/client/example/).
CI exercises the browser contract and SDK example with `pnpm test:browser`; the
static project-path smoke is `pnpm test:pages:artifact` after a build.
# Guides

- [MCP server](mcp.md): connect an MCP client to an invitation-authorized PocketDB host.
