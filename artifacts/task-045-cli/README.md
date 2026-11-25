# TASK-045: Scriptable direct CLI commands

The CLI lives in `packages/cli` and exposes the `pocketdb` executable with
`connect`, `query`, `ping`, `inspect`, and `export`. It uses the authenticated
Node client and does not implement a second transport or authorization path.

Successful calls support JSON output for scripts. Invitations can be passed as
an environment variable or through stdin so they need not appear in shell
history or process arguments. Output and errors redact invitations. Request
and connection timeouts are configurable and failures map to stable exit codes.

`export` requires a read-only SQL invitation and an explicit SELECT. It appends
a bounded row limit and emits JSON Lines in a JSON result. It does not expose
KV enumeration because the current SDK has no key-list operation. PostgreSQL
read-only ping uses the authorized schema operation because the server permits
only a narrow SELECT subset.

## Browser-hosted run

The `test:browser` harness starts the actual web app and a disposable local
signaling server, obtains scoped invitations in the browser, then invokes the
CLI executable as a separate Node process for each operation. The host uses a
single peer per invitation, so each invocation receives a fresh invitation.

On macOS 27.0.1 arm64, Node.js 25.8.1, Chrome 160.0.8181.0:

- KV: connect, `PING`, and inspect capability metadata passed.
- PostgreSQL: parameterized `CREATE`, `INSERT`, read-only ping, parameterized
  SELECT, and schema inspection passed.
- SQL export returned the expected JSONL row with a read-only invitation; a
  read-write invitation was denied for export.
- Capability URIs were absent from CLI stdout and stderr.

Machine-readable run summary: [results.json](results.json).

Reproduce with `pnpm --filter @pocketdb/cli test:browser`. This is a local
browser-host integration, not validation of a deployed public site, separate
network, TURN relay, or cross-platform Node runtime. The CLI package remains
private; publishing is gated by ADR-016.
