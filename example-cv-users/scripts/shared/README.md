# Private PostgREST and recovery journal

These modules are opt-in helpers for independently approved, isolated runs. Importing them starts no process and sends no request. They use Node.js built-ins, a local PostgREST executable, and Python 3 with Unix `fcntl.flock`. The regular Users build and deploy entry points do not import them.

## Private PostgREST

The caller supplies the approved DSN, executable, JWT configuration, role names and target fingerprint. Obtain the fingerprint independently from the approved target before launch. The identity RPC must be read-only, use `SECURITY INVOKER`, and return `connection_role`, `execution_role` and `target_fingerprint`. Compute the fingerprint from the current backend on each probe. The local fixture uses the PostgreSQL system identifier and database OID. Binding an approved role and fingerprint also requires protecting the identity RPC and its result from the execution role.

Provide a canonical, user-owned 0700 directory enclosing the new per-launch socket directory. The launcher creates that child directory exclusively, checks the effective PostgREST settings, then probes over its 0600 Unix socket. A matching role pair and database fingerprint are required before returning ready. Each launch consumes its socket directory. The caller may remove that directory after independent confirmation that the launcher and database sessions are closed. Credentials are passed in memory and the configuration dump is discarded.

## Recovery journal

Supply a private 0700 directory and immutable scope digest, with separately allowlisted business and close operations. Include the approved target and operation contract in the scope. The runner holds a kernel lock across both phases. An intent is made durable before each effect. Its outcome is stored as an evidence digest bound to that same intent. On reopening, only close operations and reconciliation of existing intents are available.

The adapters must enforce their request deadlines and honour the supplied AbortSignal. A close lane waits for an in-flight effect to settle. If an adapter fails to settle, terminate the launcher and use the recovery path. A terminated launcher or released lock says nothing about a remote commit. Reconciliation must rule out a late commit or preserve the unknown state. The independent closure observer must check the actual target and preserve evidence outside the journal. The journal only marks closed after that observation and resolution of all previously dispatched intents.

Run the standard journal tests with `node --test tests/s3/shared-private-recovery.test.mjs` from `example-cv-users`. For the real smoke test, set `SHARED_TEST_PG17_BIN` to a local PostgreSQL 17.12 bin directory and `SHARED_TEST_POSTGREST` to a PostgREST 16.6 binary, then run `node --test tests/s3/support/shared-private-postgrest-integration.mjs`. The test creates a temporary Unix-only cluster with synthetic roles and checks independent database session termination.
