# Production migration: retain historical Profile images

Migration: `20261031150000_profile_image_history_retention.sql`

SHA-256: `089c08a2da05bb881368faedb4d078a39f26d456d78c0f39381959be567212d3`
Scope: remove authenticated UPDATE and DELETE policies on `storage.objects` for `profile-images`. The existing scoped SELECT and INSERT policies remain in place. This does not touch any Storage objects, application data, history, capabilities, or other buckets.

## Release order

1. Review and merge this change through GitHub. CI verifies the canonical, CLI-staged, and runtime-test SQL are byte-identical.
2. Before any deployment, use the approved Production project and inspect `storage.objects` policies. Stop unless the four expected `cms_admin_scoped_profile_images_{select,insert,update,delete}` policies exist with the scoped `can_manage_resume_storage_object` predicate, authenticated role, and permissive mode, and no additional applicable permissive UPDATE/DELETE policy exists. The migration repeats these checks transactionally and aborts on a mismatch.
3. Record the SHA-256 of the canonical SQL and compare it to the reviewed release record. Apply only this SQL file as `postgres` in one transaction through the reviewed manual migration procedure. Do not use `supabase db push`, replay historical migrations, or stage unrelated migrations.
4. Verify the UPDATE/DELETE policies are absent; scoped SELECT/INSERT remain; no other permissive policy permits authenticated/public UPDATE/DELETE for `profile-images`; and Owner/Test scoped reads and unique-path inserts still work. Stop if any result differs.
5. Deploy only the reviewed Admin Worker release after the policy change. The policy should precede the application change so stale clients cannot remove/overwrite history-referenced images.

## Rollback and failure handling

The migration is transactional and contains fail-closed pre/post assertions. If preflight or execution fails, stop; do not manually alter policies. If the Admin deployment fails, roll back only the Worker to its verified previous version while leaving UPDATE/DELETE denied. Do not restore destructive policies as a rollback. Recovery requiring a different Storage policy is a separately reviewed database change.

## Behavior and retention

Profile image uploads continue using unique object paths and `upsert: false`. Profile Save no longer deletes superseded or removed image objects. A failed save may leave a new unreferenced upload; no automatic cleanup or history pruning is performed. Storage consumption can therefore grow. An older open client may show an image-cleanup warning if it tries the now-denied delete, while its data save can still succeed.


## Controlled SQL execution and one-version ledger reconciliation

This procedure is documentation only; it does not authorize Production
execution. Obtain separate approval before any Production SQL or ledger write.

### 1. Prepare and verify the release inputs

Use a clean checkout pinned to the reviewed commit. Confirm the canonical,
CLI-staged, and runtime-test copies have this SHA-256:

`089c08a2da05bb881368faedb4d078a39f26d456d78c0f39381959be567212d3`

Confirm all three copies are byte-identical. Use the canonical file as the SQL
input. Do not edit it or the copies.

Verify the linked project before any database command. The CLI's linked
project metadata must identify ref `tkehttvppaqkybqehjbn`; the authenticated
project list must also contain that exact project ref (project name
`example-cv-cms`). For example, resolve and check the linked ref, then list
the authenticated projects:

```sh
set -eu
PROJECT_REF=tkehttvppaqkybqehjbn
RELEASE_CHECKOUT=/absolute/path/to/clean/reviewed-checkout
LINKED_REF="$(jq -r '.ref // empty' \
  "$RELEASE_CHECKOUT/resume-admin/supabase/.temp/linked-project.json")"
test "$LINKED_REF" = "$PROJECT_REF"
supabase projects list --output-format json
```

In the JSON output, confirm a project entry has both `id` equal to
`tkehttvppaqkybqehjbn` and name `example-cv-cms`. Stop if the link metadata is
missing, either check cannot be completed, the ref differs, or the expected
project cannot be identified unambiguously. Do not infer the linked project
from a successful connection or project name alone.

With that same workdir and explicit ref, run this read-only identity query. The
`--linked` flag is required by Supabase CLI 2.119.0 when `--project-ref` is
provided. Require both returned values to equal `postgres`; stop on any other
result:

```sh
supabase db query --linked --project-ref "$PROJECT_REF" \
  --workdir "$RELEASE_CHECKOUT/resume-admin" \
  "SELECT current_user AS current_user, current_database() AS current_database;" \
  --output-format json
```

Confirm the target version `20261031150000` is absent from the live migration
ledger. Record the full remote migration list before execution. Do not change
any existing ledger row.

Verify the live `storage.objects` policy catalog immediately before execution.
Require exactly the four reviewed `cms_admin_scoped_profile_images_{select,
insert,update,delete}` policies, each permissive and scoped to the
authenticated role with the `can_manage_resume_storage_object` predicate.
Require no other applicable permissive authenticated/public `ALL`, `UPDATE`,
or `DELETE` policy. Confirm the scoped Profile SELECT/INSERT policies and
the reviewed resume-files UPDATE/DELETE baseline remain present. The migration
contains the same fail-closed assertions; stop on any difference.

Capture the read-only policy snapshot:

```sql
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;
```

Also confirm the ledger table is already complete. The repair step below must
not be allowed to create or alter the ledger schema:

```sql
SELECT
  to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ledger_exists,
  (SELECT count(*) = 3
   FROM pg_catalog.pg_attribute
   WHERE attrelid = to_regclass('supabase_migrations.schema_migrations')
     AND attname IN ('version', 'name', 'statements')
     AND NOT attisdropped) AS ledger_columns_ready;
```

Stop unless the table exists and all three columns are present.

### 2. Execute only the reviewed SQL transaction

Verify the installed Supabase CLI version is `2.119.0`, the version whose
file-based query and one-version repair behavior this procedure relies on.
If another version is installed, stop for review rather than assuming identical
behavior.

Run exactly this file-based SQL command from the clean release checkout. Both
`--linked` and the explicit `--project-ref` are required by the verified
Supabase CLI 2.119.0 invocation; do not remove either flag:

```sh
PROJECT_REF=tkehttvppaqkybqehjbn
RELEASE_CHECKOUT=/absolute/path/to/clean/reviewed-checkout
SQL_FILE="$RELEASE_CHECKOUT/resume-admin/migrations/20261031150000_profile_image_history_retention.sql"

supabase db query --linked --project-ref "$PROJECT_REF" \
  --workdir "$RELEASE_CHECKOUT/resume-admin" \
  --file "$SQL_FILE"
```

This is the database SQL execution step. Submit the file intact as one request
so its `BEGIN`/`COMMIT` remains a single transaction. Do not split the file,
use `supabase db push`, execute another migration, or run the
`20261031140000_retire_test_profile_signing_probe.sql` migration.

If the command fails or its transaction outcome is uncertain, stop. Establish
the outcome with read-only catalog and ledger checks. Do not retry and do not
record the version as applied unless the committed policy state is verified.

### 3. Verify the committed Storage policy state

After a successful SQL transaction, reread the complete policy snapshot and
verify:

- The two scoped `profile-images` UPDATE and DELETE policies are absent.
- The scoped `profile-images` SELECT and INSERT policies remain present with
  their reviewed predicates.
- No other applicable permissive authenticated/public policy permits
  `profile-images` UPDATE or DELETE.
- The resume-files policy definitions are unchanged.
- No Storage objects, application data, history, capabilities, or other bucket
  policies were changed.

Stop on any mismatch. Do not reconcile the migration ledger before these
postconditions pass.

### 4. Record only version 20261031150000 as applied

The SQL execution and ledger update are separate operations. A successful SQL
transaction changes the Storage policies; it does not by itself establish that
the CLI migration ledger contains this version.

Use a temporary work directory with exactly one SQL file so the repair command
has no historical migration files available. Stage the canonical SQL without
changing its bytes:

```sh
set -eu
PROJECT_REF=tkehttvppaqkybqehjbn
VERSION=20261031150000
FILENAME=20261031150000_profile_image_history_retention.sql
EXPECTED_SHA256=089c08a2da05bb881368faedb4d078a39f26d456d78c0f39381959be567212d3
RELEASE_CHECKOUT=/absolute/path/to/clean/reviewed-checkout
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/profile-image-retention-ledger.XXXXXX")"

mkdir -p "$STAGE_DIR/supabase/migrations"
cp "$RELEASE_CHECKOUT/resume-admin/migrations/$FILENAME" \
  "$STAGE_DIR/supabase/migrations/$FILENAME"
cmp "$RELEASE_CHECKOUT/resume-admin/migrations/$FILENAME" \
  "$STAGE_DIR/supabase/migrations/$FILENAME"
test "$(shasum -a 256 "$STAGE_DIR/supabase/migrations/$FILENAME" | awk '{print $1}')" = "$EXPECTED_SHA256"
test "$(find "$STAGE_DIR/supabase/migrations" -type f -name '*.sql' | wc -l | tr -d '[:space:]')" = 1
```

Immediately before repair, reread the live ledger using this isolated directory:

```sh
supabase migration list --project-ref "$PROJECT_REF" \
  --workdir "$STAGE_DIR" --output-format json
```

Require version `20261031150000` to be local-only and absent remotely; require
all previously observed remote versions to remain unchanged. The lower-numbered
signing-probe cleanup version `20261031140000`, whether absent or present,
must not be executed or modified by this procedure.

Only after the SQL transaction has committed and the Storage postconditions
have passed, record the single version:

```sh
supabase migration repair --status applied "$VERSION" \
  --project-ref "$PROJECT_REF" --workdir "$STAGE_DIR"
```

The explicit version is mandatory. With CLI `2.119.0`, this repair reads the
single staged file to derive its name and statements and records only the
requested version in `supabase_migrations.schema_migrations`; it does not
execute that SQL. The complete ledger table/column preflight above prevents the
CLI setup probe from needing to create or alter the ledger schema. Never use
repair without a version, multiple versions, or `db push`.

### 5. Verify the ledger after repair

Reread the ledger and require `20261031150000` exactly once, with matching
local/remote entries. Confirm all pre-existing remote versions remain unchanged.
Then verify the row directly:

```sql
SELECT version, name, count(*) AS row_count
FROM supabase_migrations.schema_migrations
WHERE version = '20261031150000'
GROUP BY version, name;
```

Require one row named `profile_image_history_retention`. If repair fails or
its outcome is uncertain, stop and inspect the ledger read-only; do not rerun
repair automatically. At no point run pending historical migrations or the
separate `20261031140000` cleanup migration.
