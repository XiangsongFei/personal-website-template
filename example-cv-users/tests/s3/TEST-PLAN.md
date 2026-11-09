# S3.3-A candidate database test plan

Run database tests only under a separate approval for the pinned isolated target.
`static_check.py` is an offline source guard. PostgreSQL behavior requires a
separate runtime result recorded with the target and file digests.

## Execution prerequisites for a separate approved round

1. Approve an exact new local target, PostgreSQL 17 image/version, ports, volume,
   network and migration hashes. Check no connection/credential points to Users,
   CMS/Public, cloud or DR. No existing production/DR database may be reused.
2. Use the direct PostgreSQL 17 non-superuser `postgres` deployment session.
   Verify existing Auth INSERT privileges before loading constraints fixtures.
3. For a fresh migration replay, check empty `site_*` schemas and absent
   `ecv_s3_*` roles. For the test-only path, verify both migrations were already
   accepted and the deployed catalogs match. Do not replay them during tests.
4. Record Supabase CLI 2.119.0, server version, source/base SHA, file SHA-256,
   current_user/session_user and the target identity without logging credentials.
5. Apply migrations in filename order, with ON_ERROR_STOP and exact files only.
   They each contain BEGIN/COMMIT. Do not wrap both in an implicit nested transaction.
   First migration committed + second failed is PARTIAL, never full success.

## Replay and static-to-runtime bridge

- Fresh isolated target: apply M1, inspect closed state; then M2, inspect closed state.
- Run `constraints.test.sql` and `permissions.test.sql` in separate fresh psql
  sessions with ON_ERROR_STOP. The permission suite needs no Auth fixtures or
  deployment grant. It checks the clean role graph and switches to authenticated
  and anon for SQL denial probes.
- Only the constraint suite includes `fixtures.sql`. Resolve the include relative
  to that suite. Use only fictional no-password Auth rows and synthetic site data.
  After its BEGIN, use a separately approved transaction-local grant of
  `ecv_s3_owner` to `postgres` with ADMIN=false, SET=false, INHERIT=true and
  grantor `postgres`. Revoke that grant by grantor before the suite's ROLLBACK.
  On error, stop and verify that session teardown rolled back the transaction.
  In a fresh connection, verify that only bootstrap ADMIN membership remains,
  no effective SET/INHERIT was added and no fixture rows remain.
- Inspect actual ACLs including PUBLIC and inherited privileges, default ACLs for
  actual creator roles, function owners/search_path, role memberships and RLS flags.
- The helper's fixed `a`/`b` digests are deliberate synthetic placeholders. They
  do not validate canonicalization or prove a signed request. No JWT is fabricated.
- Direct duplicate receipts must report SQLSTATE 23505 from an approved
  idempotency index or constraint on `site_private.operation_requests`.
  The test prints the actual source. A primary-key conflict with a fresh
  request ID must be rejected by the attribution helper.
- Positive privileged A/B inserts first prove the constraints permit valid shapes.
  SET ROLE denial checks then prove the sealed foundation, not future Owner access.
- Verify original local Auth schema/table definitions and Storage config unchanged;
  only fixture rows were transiently written and rolled back.
- Reapplying either migration must fail on existing objects; no IF NOT EXISTS
  masks collisions. Atomic rollback of failed migration leaves previous state intact.
- Record all failures, SQLSTATE, final counts and rollback outcome. Stop on UNKNOWN;
  approve a forward candidate fix rather than automatically dropping roles/objects.

## Multi-connection concurrency protocols (prepared, not executed)

Use only the separately approved disposable target. Fixture setup/teardown that
must COMMIT is a distinct approval from the rollback-only SQL tests above.
Use real independent connections, lock_timeout/statement_timeout, and barriers.
The SQL tests above cover sequential uniqueness; they do NOT cover concurrency.

| Case | Session A | Session B while A uncommitted | Release / expected result |
|---|---|---|---|
| Same owner | BEGIN; insert site for synthetic Alice | BEGIN; insert a different site for same Alice | A inserts matching member/publication and COMMIT; B waits then 23505; ROLLBACK B; count exactly one |
| First writer aborts | BEGIN; insert Alice site | Same-owner insert | ROLLBACK A; B proceeds, inserts matching member/publication and COMMIT; exactly one complete site |
| Same hostname | Alice inserts reserved `shared.sites.example.test` | Bob attempts same hostname | A commits; B gets 23505; Bob transaction rolls back without orphan domain/site |
| Same request key | A inserts complete site and create receipt | B attempts same actor/operation/request with a different receipt id/digest | May block on owner uniqueness before receipt index; after A commit B must fail; independently inspect request index catalog and one unchanged receipt |
| Mirror deletion | Existing complete site; A deletes Owner mirror | B attempts conflicting mirror manipulation | At SET CONSTRAINTS/COMMIT no surviving site may lack matching active Owner; failures roll back |
| Lost response | Future create RPC COMMIT followed by transport response drop | Future authenticated operation lookup for same actor/request | Original site/result/digest recovered; no new request id. BLOCKED until verified grant + RPC exist |

Assert final state from an independent administrative connection AFTER transaction
completion, including sites, mirrors, domains, receipts, audit and publications.
Vary same/different request ids and digests and repeat with reversed commit order.
Do not call an owner-unique failure proof that the request index alone was exercised.

## Deferred business acceptance

BLOCKED: normal-login business grant issuance, proof signature/one-time consume,
real JWT Data API, recovery-token bypass, upstream revocation, successful Owner
read/create, same-request original-result API and UNKNOWN transport recovery.
No public policies/RPCs may be added merely to make these tests pass.
Storage, publication, CDN, S2 changes and cloud tests are outside S3.3-A.
