# Local Admin RLS runtime lab

This is a disposable, test-only Supabase project. The tracked `supabase/` tree is a template and is not a shared local database. Do not run `supabase start`, `supabase db reset`, or `supabase test db` directly from this directory.

## Run SQL tests

From the repository root, run:

```sh
node resume-admin/tests/rls-runtime/stage-local-supabase.mjs --sql
```

The staging utility copies the project into a newly created temporary directory, assigns a unique Supabase project ID and five free local ports, and validates the migration manifest before starting Docker. It retains migrations in their original order except for `20261031130000_test_profile_signing_probe.sql` and `20261031140000_retire_test_profile_signing_probe.sql`. The source migration files and static consistency tests remain in the repository unchanged. No replacement database state is added. The resulting schema must have no `verify_test_profile_signing_probe_v1` function while retaining the shared Activity Log key provider and normal Profile Save RPC and grant.

The utility verifies that Supabase reports the selected loopback API and database ports before issuing `db reset` or SQL tests. Every Docker resource is recorded by exact ID/name and must have the run's unique Compose project label and must not have existed before startup before the utility can stop or remove it. It never uses global stop, reset, prune, or volume cleanup commands. If ownership cannot be proven, cleanup stops and the resources and ownership manifest are left for inspection.

## Run the opt-in Worker/PostgREST integration test

Install the Admin dependencies from the existing lockfile in the isolated development checkout, then run from the repository root:

```sh
node resume-admin/tests/run-v11-local-integration.mjs
```

The runner uses the same staging utility, resets only that run's temporary database, obtains local test signing material from that run's Auth container, and passes only loopback API settings to the Worker test. The test runner refuses any API URL outside `127.0.0.1`, any Worker Supabase origin other than its local fixture origin, or any database container that does not match the generated `pr1-` project. It does not reset the database afterward; the isolated project and its immutable local test events are removed through ownership-verified resource cleanup.

## Fixture and safety notes

The bootstrap reconstructs only the schema required by this security lab; it is not a production schema dump. It uses synthetic Owner-like and Test identities, an unpublished Test resume, and synthetic rows. The fixture's reset behavior applies only to its deterministic synthetic Test UUID in the disposable database. No Production URL, linked project reference, credential, Owner/Test account, or Production content is used.

The `20261031130000_test_profile_signing_probe.sql` creation migration and `20261031140000_retire_test_profile_signing_probe.sql` retirement migration remain preserved as historical files, together with their static migration consistency tests. The stage excludes both so a local reset cannot replay creation of the retired probe. The SQL assertion checks the intended final schema directly and confirms normal signing and Profile Save behavior remain installed.

If Docker, the Supabase CLI, loopback endpoint verification, or exact resource ownership checks fail, stop. Do not clean up existing Supabase projects or manually substitute a database state.
