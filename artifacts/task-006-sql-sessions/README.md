# PostgreSQL transaction and read-only spike

Four logical clients share one PGlite 0.6.0 instance. Each request enters PGlite's transaction callback for the entire logical transaction. The harness records logical client IDs, the engine backend PID and elapsed time.

## Reproduce

From this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs
```

## Results

Node v25.8.1 on macOS arm64 ran the PostgreSQL WASM engine. All four logical clients had backend PID 42. Client B requested a transaction while A held its transaction. B entered after A's commit, saw A's row, inserted its own and rolled back. Client C inserted a row and then received a simulated disconnect before commit. It rolled back before queued client D entered. D saw only A's row. The [trace](results.json) records the identities, ordering and outcomes.

Inside a read-only transaction, ordinary reads succeeded. PostgreSQL rejected INSERT, a data-modifying CTE and DDL with SQLSTATE `25006`. The fixture separately permits a fixed parameterized lookup and rejects arbitrary read-only remote SQL before dispatch. This bounded suite does not establish safe execution of arbitrary SQL under a remote read-only capability.

## Recommendation and impact

Serialize complete logical transactions. Keep an exclusive transaction owner until commit or rollback, and release it on session loss only after rollback completes. If a client loses the connection after dispatching commit, represent the outcome as unknown until the protocol can establish it. The fixture simulated loss before commit. It did not test lost commit acknowledgements, transport timing, cancellation or concurrent independent PostgreSQL backends.

Fail closed for arbitrary SQL under a remote read-only capability. Only enable a constrained operation after its permissions and safe parameter binding are verified. Evaluate dedicated backend or vetted role and session controls before broadening that scope. See the [PGlite API](https://pglite.dev/docs/api) and the [PostgreSQL transaction documentation](https://www.postgresql.org/docs/current/sql-set-transaction.html).

Record these inputs for ADR-002, ADR-004, ADR-007, ADR-008 and ADR-011. The result supports a serialized Hosted Mode and excludes unrestricted read-only SQL from the initial release until stronger enforcement is verified. The spike supplies no new implementation estimate.
