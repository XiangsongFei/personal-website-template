# Controlled Production procedure: P0 identity-scoped authorization

This runbook covers only `20261031120001_p0_identity_scoped_activity_log.sql`.
It is a forward-only authorization migration. It does not modify application
data, Activity Log event history, storage objects, or capability rows.

## Reviewed migration artifact

- Canonical source: `resume-admin/migrations/20261031120001_p0_identity_scoped_activity_log.sql`
- CLI staging copy: `resume-admin/supabase/migrations/20261031120001_p0_identity_scoped_activity_log.sql`
- Runtime-test copy: `resume-admin/tests/rls-runtime/supabase/migrations/20261031120001_p0_identity_scoped_activity_log.sql`
- Expected SHA-256: `da5a755e903a10693e7c5ba3924afaf0218aec156f8d86421e3aba2819186950`
- The CLI staging directory must contain this one SQL migration only. The
  runtime-only `20261031110000_test_only_installed_baseline_delta.sql` must
  remain outside it.

## Before execution

1. Confirm the approved Production project explicitly by its project ref. Do
   not rely on an implicit or stale local link.
2. Read and save the live ledger without changing it:

   ```sh
   supabase migration list --project-ref tkehttvppaqkybqehjbn \
     --workdir resume-admin --output-format json
   ```

3. Stop if the ledger is unavailable, contains an unexpected version, or
   already contains `20261031120001`. Do not repair the ledger to make the
   migration appear unapplied.
4. Verify the current production schema against the installed definitions
   reviewed for this migration: the six authorization functions, the
   `cms_owner_manage_resume_sites` policy, function signatures/owners/grants,
   `SECURITY DEFINER`, and secure `search_path`. Stop on any difference that
   has not been reviewed.
5. Verify the live targets and memberships: the single Owner maps to
   `example-cv`; the Test identity maps to
   `example-cv-qa-activity-log`; that Test target is unpublished; and neither
   approved target has the `restore` capability enabled. Do not change these
   records or capabilities as part of this procedure.
6. Verify and record the artifact hash before execution:

   ```sh
   shasum -a 256 resume-admin/migrations/20261031120001_p0_identity_scoped_activity_log.sql
   ```

   It must match the hash above, and all three copies must be byte-identical.
7. Confirm the executor runs the SQL with `current_user = 'postgres'`; the
   migration intentionally aborts otherwise. Use an approved SQL execution
   path that submits only this file and preserves its transaction boundary.

## Execution boundary

- Apply only the exact SQL file above, once.
- Do not run `supabase db push` as a substitute for this reviewed procedure.
  The Admin project has no root `supabase/config.toml` or checked-in release
  migration runner; the test runtime config is not a Production config.
- Do not copy or stage `resume-admin/migrations` wholesale. It contains
  historical migrations that are already represented in the remote ledger.
- Do not execute or stage any migration from
  `resume-admin/tests/rls-runtime/supabase/migrations`.
- If the SQL aborts, stop and inspect the transaction result. Do not record the
  version as applied. If SQL succeeds through the approved manual executor and
  all schema and behavior checks pass, record that already-applied version in
  Supabase's migration ledger with the authenticated CLI:

  ```sh
  supabase migration repair --status applied 20261031120001 \
    --project-ref tkehttvppaqkybqehjbn --workdir resume-admin
  ```

  This is a ledger reconciliation step, not a SQL execution step. Re-read the
  ledger afterward. Do not run it if SQL failed, partially applied, or has not
  been independently verified.

At the time this procedure was prepared, the read-only ledger showed remote
versions `20261014000000`, `20261014120000`, and `20261031120000`; the target
`20261031120001` was local-only and unapplied. Re-read the ledger immediately
before execution; this observation is not a substitute for that check.

## After execution

1. Re-read the migration ledger and confirm exactly one new applied version:
   `20261031120001`; confirm the earlier remote versions are unchanged.
2. Inspect the installed function definitions, security properties, ownership,
   grants, and policy expression. Confirm the migration hash recorded for the
   release matches the reviewed artifact.
3. Using authenticated Owner and Test sessions, verify target enumeration is
   exactly one row each: `(owner, example-cv)` and
   `(qa, example-cv-qa-activity-log)`. Verify unknown identities receive none.
4. Verify Activity Log reads and direct event-table access remain
   identity-scoped, including both cross-target denials. Verify the legacy
   `example-cv-qa` target is not exposed.
5. Verify Owner content operations still work and Test content operations are
   confined to the unpublished Test resume. Confirm Storage reads/writes stay
   scoped to the same target.
6. Confirm Restore remains disabled for both targets and fails closed.
7. Compare Activity Log event counts/IDs before and after; the migration must
   not alter history.
8. Record executor, timestamp, project ref, migration version/hash, checks,
   and rollback Worker version in the release record.

## Recovery

The SQL is transactional and has a schema precondition guard. If it fails
before commit, stop and investigate; no partial transaction should be treated
as successful. After a successful commit, do not replay historical migrations
or manually restore old function/policy definitions. If a defect is found,
keep the current Worker rollback version available and prepare a reviewed
forward corrective migration. Application rollback does not roll back the
database schema; re-verify Owner access and keep Test access blocked until the
forward correction is verified.
