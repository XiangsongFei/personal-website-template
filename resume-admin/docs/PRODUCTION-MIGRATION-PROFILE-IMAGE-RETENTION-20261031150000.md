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
