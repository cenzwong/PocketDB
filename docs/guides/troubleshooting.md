# Troubleshooting

## The client cannot connect

- Confirm the host and client use the same signaling endpoint and that it is
  HTTPS. Plain HTTP is limited to loopback development.
- Confirm the provider implements the expected offer and answer routes and is
  reachable from both browsers.
- Create a new invitation after revocation, host restart, disconnect or page
  reload. Invitations are single-peer capabilities and established sessions
  are not resumed.
- Check the host and client status messages and the host's **Local
  diagnostics** panel. The panel reports signaling and WebRTC state when the
  browser exposes it; missing transport statistics are shown as unavailable.
- Direct same-network connections have been exercised. Public cross-network,
  restrictive NAT and relay-only operation remain unverified. Static hosting
  does not supply STUN or TURN.

## The host stopped responding

Keep the host tab open and prevent the host device from sleeping during use.
If the host browser is suspended, sleeps, closes or reloads, reconnecting requires
the host to return and create a new invitation. The SDK reports a terminal
connection failure and does not replay operations with an unknown outcome.

## A write or query failed

- Check invitation access. Read-only invitations reject writes before engine
  dispatch.
- For key-value errors, confirm the selected command and JSON array arguments.
  The key-value API is a bounded subset; see the [supported commands and
  errors](../../packages/engine-kv/README.md).
- For SQL, check syntax, parameters and the selected engine. Remote read-only
  sessions accept only a parameterized `SELECT` in the documented safe subset.
- Do not retry a mutation after a timeout if its outcome is `unknown`; inspect
  the database to determine whether it completed first.

## Stored data is unavailable

IndexedDB data is scoped to the site origin and instance name. Use the same
origin, browser profile and instance name to reopen it. Close another tab or
worker that owns the same database. Browser quota errors, private browsing,
storage clearing and eviction can prevent recovery; restore a `.pdb` snapshot
when available.

## Export diagnostics safely

The host's **Export diagnostics** action downloads a bounded, local event log.
The export omits invitation capabilities, signaling URLs, peer/session IDs, SQL
text, key-value arguments and arbitrary error text. Still review a file before
sharing it outside your team. PocketDB does not send diagnostic telemetry.

See the [remote access limits](../specs/remote-access.md),
[deployment networking requirements](../deployment.md), and
[sanitized diagnostics contract](../specs/hosted-runtime.md).
