# Candidate compatibility rehearsal (not a Production approval)

Base: `33ad6f49d9ce940fd694c6a3c84cbb98f039ac6e`.
Candidate old Worker: `a7f1f6adf75256fa24c7958e30e74d9b774d8b21`, the previous main.
That commit is not asserted to be the deployed production Worker.

The candidate pre-PR28 Migration baseline is the 42-file SHA-256 allowlist
from commit `a7f1f6adf75256fa24c7958e30e74d9b774d8b21`, excluding exactly the
two signing probes and the 20261103 Test activation. Each filename, execution
order and byte digest is fixed in compatibility-contract.mjs. Only these files
are copied; additional, missing or altered baseline inputs fail closed. An
unknown future file in the current source directory also fails the candidate
profile rather than silently becoming part of the old schema. The seven pinned
upgrade migrations remain separate. Seeds/config are current synthetic test
fixtures, not an assertion of historical or Production runtime state.
No production credentials, connection, dump or data are inputs.

The driver first checks old DB/old Worker and old DB/new Worker. It applies each
hash-pinned structural migration in order, with lock/statement timeouts, then
checks new DB/old Worker (deployment failure / rollback simulation) and new
DB/new Worker. All Worker requests execute actual source against local PostgREST.
This is not a deployed Cloudflare runtime or browser E2E test.

Each combination requires exactly five named cases. Known cross-version
protocol refusals are asserted with exact status/RPC code and unchanged synthetic
business state, idempotency and audit counts. Passing the assertions is NOT a
claim that a mismatched combination supports writes. Section Titles is absent
from the candidate old Worker and candidate old DB. Files historical-reference
acceptance is checked against each schema, independently of Worker version.

Protocol tests temporarily set QA write modes/requirements, restore their full
prior records, and leave Restore disabled. Structural migration boundaries
compare modes, requirements, capabilities, membership, table RLS flags and
unaffected policies. Synthetic rows are destroyed with the owned project.
No activation migration is applied by this driver.

The exact old Awards/Skills request bodies survive in a temporary synthetic
fixture file across upgrade. New HTTP protocols must reject these old-shaped
requests without clearing prior database idempotency or changing business state.
New requests test baseline CAS, signature tampering, response-loss replay and
unique audit results. A synthetic audit failure proves transaction rollback.
Client Pending/account/snapshot/remount coverage is separately run as mock/
component tests, not represented as database integration evidence.

The supervisor suppresses child stdout/stderr and projects only fixed cases,
phases, statuses and bounded counts. No raw report/manifest is uploaded. The
25-minute process-group deadline leaves a separate 2-minute ownership-checked
fallback cleanup budget within a 29-minute step and 40-minute job. Cleanup
failure remains failure; its ownership manifest is retained on the temporary VM.
Runner VM disposal is the final isolation boundary. Never use global prune.

The unchanged normal SQL job still runs the 22-case integration suite and all
four runtime scripts. Both jobs are required by the final gate. Existing Restore
SQL skips remain skips. A failed rehearsal stops the one authorized CI; no retry
or automatic patch is allowed.
