# Retired Production procedure: Test Profile signing probe

> **Retired. Do not use this runbook or invoke the probe.** The signing
> compatibility check completed successfully. The Admin Worker probe endpoint
> is being removed, and its database verifier is scheduled for removal by the
> forward-only migration documented in
> [RETIRE-TEST-PROFILE-SIGNING-PROBE.md](RETIRE-TEST-PROFILE-SIGNING-PROBE.md).
> The historical migration and this record are retained for audit purposes.

This runbook covers only migration
`20261031130000_test_profile_signing_probe.sql`. It adds the read-only,
Test-identity-only verification function; it does not enable RPC Profile
saves or change existing data, authorization functions, policies, capabilities,
or Restore settings.

## Reviewed release artifact

- Repository: `XiangsongFei/personal-website-template`
- Source commit: `e512cded65f4d52696a158fa687b3e2559a31110`
- Production project ref: `tkehttvppaqkybqehjbn`
- Canonical migration:
  `resume-admin/migrations/20261031130000_test_profile_signing_probe.sql`
- Runtime-test mirror:
  `resume-admin/tests/rls-runtime/supabase/migrations/20261031130000_test_profile_signing_probe.sql`
- Expected SHA-256 for both files:
  `8ca22ce3f3bf5c5a4b0805d914bbd9e6b283e3bd86b814e2eac1a47329dab855`
- Exact Test target: `example-cv-qa-activity-log`
- Exact Test resume ID: `f6000000-0000-4000-8000-000000000001`
- Expected key ID: `activity_log_v11_hmac_v1` (identifier only; never retrieve
  or print decrypted Vault or Worker secret material).

The SQL is additive and transactional. It creates only
`public.verify_test_profile_signing_probe_v1(text,text)`, owned by `postgres`,
as `SECURITY DEFINER` with an empty `search_path`. It revokes execution from
`PUBLIC`, `anon`, and `service_role`, and grants execution to `authenticated`.
The function hard-binds authorization to the single unpublished Test target,
validates the caller and short-lived purpose-separated signed context, invokes
the existing Vault key provider, and returns only a boolean. It does not write
Profile data, Activity Log events, Version History, idempotency data, or any
capability/configuration rows. It changes no existing function, grant, RLS
policy, membership, or content.

The legacy `example-cv-qa` target has an enabled Restore capability. This is a
pre-existing observation outside this migration's scope. This runbook does not
change that target or its capability.

## Preflight — immediately before execution

Run each check against Production and save its output in the release record.
Do not expose credentials, tokens, decrypted secrets, signatures, or signing
material in logs or the record.

1. Confirm GitHub `main` contains the approved commit and the operator's
   checkout is clean and pinned to it:

   ```sh
   git fetch origin
   git rev-parse HEAD
   git status --short
   git ls-remote origin refs/heads/main
   ```

   Stop unless the migration comes from the reviewed commit and the checkout
   has no uncommitted changes.

2. Confirm the project ref explicitly and reread the live migration ledger:

   ```sh
   supabase migration list --project-ref tkehttvppaqkybqehjbn \
     --workdir resume-admin --output-format json
   ```

   The current reviewed ledger ended at `20261031120001`; treat that only as
   historical context. Stop if the live ledger is unavailable, differs in an
   unreviewed way, or already contains `20261031130000`.

3. Verify the exact migration bytes and mirror parity:

   ```sh
   shasum -a 256 resume-admin/migrations/20261031130000_test_profile_signing_probe.sql
   cmp resume-admin/migrations/20261031130000_test_profile_signing_probe.sql \
     resume-admin/tests/rls-runtime/supabase/migrations/20261031130000_test_profile_signing_probe.sql
   ```

   Stop unless the hash matches the expected SHA-256 above and `cmp` succeeds.

4. Confirm the Production project in the authenticated Supabase operator
   session is `tkehttvppaqkybqehjbn`. Do not rely on a stale local link or
   environment variable. Check the SQL executor identity with a read-only
   query before loading the migration:

   ```sql
   SELECT current_database(), current_user;
   ```

   Stop unless the project is the approved Production project and the SQL
   execution role is `postgres`.

5. Confirm the target and membership remain exactly as reviewed:

   ```sql
   SELECT s.id, s.site_key, s.is_published,
          a.role, a.user_id,
          (SELECT count(*) FROM public.cms_admins a2
           WHERE a2.user_id = a.user_id) AS caller_membership_count,
          (SELECT count(*) FROM public.cms_admins a3
           WHERE a3.resume_id = s.id) AS target_membership_count
   FROM public.resume_sites s
   JOIN public.cms_admins a ON a.resume_id = s.id
   WHERE s.id = 'f6000000-0000-4000-8000-000000000001'::uuid
     AND s.site_key = 'example-cv-qa-activity-log';
   ```

   Require exactly one row, `role = 'qa'`, `is_published = false`, and one
   membership for both that identity and target. Stop on any mismatch.

6. Confirm the authorization and key-provider prerequisites exist, without
   reading decrypted secrets:

   ```sql
   SELECT
     to_regclass('public.cms_admins') IS NOT NULL AS cms_admins_exists,
     to_regclass('public.resume_sites') IS NOT NULL AS resume_sites_exists,
     to_regprocedure('public.can_manage_resume(uuid)') IS NOT NULL AS target_guard_exists,
     to_regprocedure('cms_private.activity_log_v11_key(text)') IS NOT NULL AS key_provider_exists,
     to_regprocedure('public.verify_test_profile_signing_probe_v1(text,text)') IS NULL AS probe_not_already_installed,
     EXISTS (
       SELECT 1 FROM vault.secrets
       WHERE name = 'activity_log_v11_hmac_v1'
     ) AS expected_key_id_metadata_exists;
   ```

   The Vault query reads metadata only. Never query
   `vault.decrypted_secrets` or a decrypted secret column. The metadata check
   does not prove Worker/Vault key-material compatibility; only the later
   authenticated probe can do that.

7. Record the current Test configuration without changing it:

   ```sql
   SELECT resume_id, domain_key, write_mode
   FROM cms_private.resume_write_modes
   WHERE resume_id = 'f6000000-0000-4000-8000-000000000001'::uuid
     AND domain_key = 'profile';

   SELECT resume_id, requirement_key, enabled
   FROM cms_private.resume_domain_requirements
   WHERE resume_id = 'f6000000-0000-4000-8000-000000000001'::uuid
     AND requirement_key = 'trusted_network_context_v11';

   SELECT resume_id, capability_key, enabled
   FROM cms_private.resume_capabilities
   WHERE resume_id IN (
     'f6000000-0000-4000-8000-000000000001'::uuid
   ) AND capability_key = 'restore';
   ```

   Profile must remain `direct`; trusted-network context and Restore must
   remain disabled. Missing rows represent disabled state only where the
   reviewed configuration contract defines absence as disabled. Stop if any
   value differs from the approved baseline. Separately confirm Owner and
   legacy QA bindings/capabilities have not changed; this migration must not
   touch them.

8. Read the migration and confirm it is the reviewed file. It must include its
   own `BEGIN`/`COMMIT`, the `current_user = 'postgres'` guard, and no changes
   beyond the new verification function and its grants. Do not edit it while
   executing.

## Execute exactly one migration

Proceed only after every preflight passes and the Production migration has
separate explicit approval.

Use the Supabase CLI's file-based SQL execution against the explicit project
ref, with the exact checksum-verified file. The executor must submit the file
as one SQL request and preserve its explicit transaction:

```sh
supabase db query --project-ref tkehttvppaqkybqehjbn \
  --workdir resume-admin \
  --file resume-admin/migrations/20261031130000_test_profile_signing_probe.sql
```

The migration guard independently aborts unless `current_user` is `postgres`.
Do not remove its transaction statements, split the file into statements, copy
or stage the entire historical migration directory, run `supabase db push`, or
execute any other migration. In particular, do not replay
`20261014000000`, `20261014120000`, `20261031120000`, or
`20261031120001`.

If the command reports an error or its outcome is unclear, stop. Do not retry,
repair the ledger, or run another SQL command until the database state has been
read and the transaction outcome established.

## Verify the committed function before ledger reconciliation

First verify that the transaction committed and the installed function has
the expected security attributes and grants:

```sql
SELECT
  p.oid::regprocedure AS signature,
  p.proowner::regrole AS owner,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS settings,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute,
  pg_get_functiondef(p.oid) AS installed_definition
FROM pg_proc p
WHERE p.oid = to_regprocedure(
  'public.verify_test_profile_signing_probe_v1(text,text)'
);
```

Require one function, owner `postgres`, `SECURITY DEFINER`, volatility
`STABLE`, `search_path=""`, execute granted only to `authenticated`, and an
installed definition matching the reviewed migration. The definition must
remain bound to the exact Test target and purpose. Stop on any difference.

Rerun the target/configuration checks from preflight. Confirm the Owner
membership and target, legacy QA target and capability, all content, Profile
write modes, existing functions, policies, and capability rows are unchanged.
The migration itself must create no Activity Log, Version History, content, or
idempotency records.

## One-version migration ledger reconciliation

This migration is intentionally not present in
`resume-admin/supabase/migrations`; do not add it to CLI staging and do not
invoke a bulk migration command. The SQL is applied manually as the single
reviewed file above.

### Why a temporary staging directory is required

Supabase CLI `2.119.0` requires a local file matching
`supabase/migrations/<version>_*.sql` when `migration repair --status applied`
is used. It reads that file to derive the migration name and statement list,
then upserts the requested version into `supabase_migrations.schema_migrations`.
It does not execute the migration SQL. In this CLI version, repair first probes
the migration ledger table and may create/add its schema or columns if they are
missing; it then resolves and reads the local file before beginning the
version-row transaction. The prior command using `--workdir resume-admin`
failed because the canonical file is under `resume-admin/migrations`, not
`resume-admin/supabase/migrations`. This behavior was checked against the
[v2.119.0 repair handler](https://github.com/supabase/cli/blob/v2.119.0/apps/cli/src/commands/migration/repair/repair.handler.ts)
and [migration history implementation](https://github.com/supabase/cli/blob/v2.119.0/apps/cli/src/command-internal/migration-history.ts).

Use a temporary work directory outside the repository with exactly one SQL
file in its `supabase/migrations` directory. Do not add this migration to the
canonical CLI migration directory. Set `RELEASE_CHECKOUT` to the clean checkout
of the reviewed commit:

```sh
set -eu
PROJECT_REF=tkehttvppaqkybqehjbn
VERSION=20261031130000
FILENAME=20261031130000_test_profile_signing_probe.sql
EXPECTED_SHA256=8ca22ce3f3bf5c5a4b0805d914bbd9e6b283e3bd86b814e2eac1a47329dab855
RELEASE_CHECKOUT=/absolute/path/to/clean/commit-125c24cffb859f2c6fbea5b0e3325521f9be8f67
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/test-profile-probe-ledger.XXXXXX")"

cd "$RELEASE_CHECKOUT"
test "$(git rev-parse HEAD)" = "125c24cffb859f2c6fbea5b0e3325521f9be8f67"
test -z "$(git status --porcelain)"
mkdir -p "$STAGE_DIR/supabase/migrations"
cp "$RELEASE_CHECKOUT/resume-admin/migrations/$FILENAME" \
  "$STAGE_DIR/supabase/migrations/$FILENAME"
cmp "$RELEASE_CHECKOUT/resume-admin/migrations/$FILENAME" \
  "$STAGE_DIR/supabase/migrations/$FILENAME"
test "$(shasum -a 256 "$STAGE_DIR/supabase/migrations/$FILENAME" | awk '{print $1}')" = "$EXPECTED_SHA256"
test "$(find "$STAGE_DIR/supabase/migrations" -type f -name '*.sql' | wc -l | tr -d '[:space:]')" = 1
```

Before repair, verify the exact project, live ledger, and installed function as
above. Also verify that the migration ledger table already has all columns the
CLI requires; `migration repair` runs an idempotent setup probe and can issue
ledger-table DDL if the table is missing or incomplete. Stop if this check is
false so the approved operation remains limited to one version record:

```sql
SELECT
  to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ledger_exists,
  (SELECT count(*) = 3
   FROM pg_catalog.pg_attribute
   WHERE attrelid = to_regclass('supabase_migrations.schema_migrations')
     AND attname IN ('version', 'name', 'statements')
     AND NOT attisdropped) AS ledger_columns_ready;
```

With the temporary stage in place, capture another live ledger listing
immediately before repair:

```sh
supabase migration list --project-ref "$PROJECT_REF" \
  --workdir "$STAGE_DIR" --output-format json
```

Require `20261031130000` to appear only in the local column and not in the
remote column, with all previously observed remote versions unchanged. If it
is already remote, stop without running repair.

Use the exact staged directory and one version argument. The explicit project
ref is required; never omit the version, because a no-version repair is a
repair-all operation. Do not run `db push` before or after this command:

```sh
supabase migration repair --status applied "$VERSION" \
  --project-ref "$PROJECT_REF" --workdir "$STAGE_DIR"
```

For this specific version and CLI behavior, the repair transaction inserts or
updates only the requested `schema_migrations.version` row, with the name and
parsed statements from the staged file. Because the version must be absent in
the immediate preflight, it inserts one new row. It does not execute those
statements or replay any migration. The temporary migration directory contains
no historical files, so it cannot supply another version to this single-version
command. Never substitute `supabase db push`, `migration repair` without a
version, or a list of versions.

Then reread the remote ledger using the same temporary work directory:

```sh
supabase migration list --project-ref tkehttvppaqkybqehjbn \
  --workdir "$STAGE_DIR" --output-format json
```

Require `20261031130000` exactly once with matching local and remote entries.
Confirm the earlier remote versions are unchanged. The other remote versions
will have no matching local files in this temporary directory; that is expected.
If SQL execution failed, was uncertain, the installed function did not match,
the ledger table was incomplete, or any preflight differs, do not run ledger
repair. Do not run `db push` to resolve the expected local/remote difference.
Also confirm exactly one row for the version with a read-only query:

```sh
supabase db query --linked --project-ref "$PROJECT_REF" \
  --workdir "$STAGE_DIR" --output-format json \
  "SELECT count(*) = 1 AS recorded_once FROM supabase_migrations.schema_migrations WHERE version = '$VERSION'"
```

## Post-migration checks

1. Repeat the function security/grant and Test identity/configuration queries
   above.
2. Confirm the ledger has one new version only and the reviewed SQL SHA-256 is
   recorded in the release evidence.
3. Confirm no content, Activity Log, Version History, idempotency, membership,
   capability, existing function, or RLS policy changed. Preserve before/after
   read-only counts or snapshots for the Test target; verify Owner and legacy
   QA remain unchanged.
4. After a separately approved Admin Worker deployment, use the existing
   authenticated Test account to call the probe once. Record only generic
   PASS/FAIL and sanitized transport status. Do not log or retain signed
   contexts, signatures, secret values, hashes, or fingerprints. A successful
   probe verifies signing compatibility for this purpose; it does not authorize
   changing Profile mode.
5. Keep Profile mode `direct`, Restore disabled for Owner and Test, and the
   separate QA Worker unused. Treat the probe as temporary diagnostic
   functionality and remove it through a separately reviewed change after
   verification.

## Stop conditions and recovery

Stop before execution for any project, ledger, checksum, schema, identity,
membership, publication, key metadata, write-mode, trusted-context, capability,
or SQL-role mismatch. Do not auto-correct any precondition.

If execution fails before commit, the explicit transaction should leave no
partial function or grant. Verify that the function is absent and the ledger is
unchanged before considering a separately reviewed retry.

If the outcome is uncertain, do not retry and do not reconcile the ledger.
Read the installed function definition/security metadata and migration ledger
to determine whether the transaction committed. Escalate if they disagree.

If the migration committed but the function fails verification, stop probe
use. Do not replay or edit historical migrations. A rollback would require a
separate approval for a forward compensating transaction that removes only
`public.verify_test_profile_signing_probe_v1(text,text)`, followed by
one-version ledger reconciliation to `reverted`. Do not roll back Profile
settings, capabilities, Restore, content, or any historical migration; this
migration changes none of them.

Record project ref, source commit, checksum, operator, timestamps, preflight
results, execution result, ledger result, function verification, and any
rollback Worker version. Never record credentials or signing material.
