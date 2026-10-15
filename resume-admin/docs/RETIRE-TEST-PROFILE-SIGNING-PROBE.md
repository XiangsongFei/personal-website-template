# Retire the Test Profile signing probe

The temporary signing compatibility probe returned `HTTP 200, PASS` and has
completed its purpose. This procedure removes only that diagnostic surface.
It preserves the shared HMAC signing helpers and normal `save_resume_profile_v1`
workflow. Test Profile remains in RPC mode with its existing trusted-network
requirement; Restore stays disabled.

## Reviewed changes

- Source: merge the reviewed Admin-only Worker code removal first. No Public
  Worker change is needed.
- Database cleanup migration:
  `20261031140000_retire_test_profile_signing_probe.sql`
- Canonical SQL:
  `resume-admin/migrations/20261031140000_retire_test_profile_signing_probe.sql`
- Local SQL-test mirror:
  `resume-admin/tests/rls-runtime/supabase/migrations/20261031140000_retire_test_profile_signing_probe.sql`
- SHA-256: `8958190bcc4c5ee4475a93dc6cba6602b7a7fd6f01549e92b205afd15baba84a`
- Verify the checksum from the merged release before execution; do not edit
  either copy after review.

## Release order

1. Review and merge this PR. Do not automatically deploy from the merge.
2. In a clean checkout of the reviewed merge commit, run Worker and frontend
   tests, lint, type checking, production build, and the local SQL runtime lab.
   Deploy only `example-cv-admin` after separate approval. Record the source
   commit, built artifact hash, and Cloudflare version. The removed route should
   return the ordinary API `404`; normal Profile RPC saves continue to use the
   shared signing path.
3. After verifying the new Worker version, seek separate approval for the
   database cleanup. Reconfirm the Production project, migration ledger,
   checksum, and that the exact probe function is still installed.
4. Execute only the checksum-verified cleanup SQL as `postgres`, preserving its
   explicit transaction. It guards against a missing function and does not use
   `CASCADE`; an unexpected dependency or state aborts the transaction.
5. Verify the function is absent, the shared key provider and
   `save_resume_profile_v1` are unchanged, and the migration ledger contains
   only the intended new version. Recheck Test Profile mode, trusted-network
   requirement, Restore-disabled state, and Owner/legacy QA isolation.

Do not run `supabase db push`, replay historical migrations, reconcile multiple
versions, or apply the runtime-test mirror to Production. Use the repository's
reviewed one-version ledger-reconciliation runbook only after the SQL
transaction is confirmed committed and the installed state is verified.

## Stop and recovery

Stop before either release step if the source commit, checksum, project,
function definition, or migration ledger differs from the reviewed state. If
SQL execution fails or has an uncertain outcome, do not retry or repair the
ledger; inspect the installed function and transaction outcome read-only.

Deploying the code first leaves the database verifier temporarily installed but
unreachable through the Admin Worker. If the Worker must be rolled back, the
diagnostic route may return but normal Profile saving remains independent. If
the database function has already been dropped, do not roll back or recreate it
without separate review and approval. The migration does not change Profile
data, write mode, signing secrets, Activity Log, Version History, capabilities,
trusted-network requirements, memberships, or Restore.
