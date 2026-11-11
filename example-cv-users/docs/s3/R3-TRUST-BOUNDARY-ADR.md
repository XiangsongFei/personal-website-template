# R3 registered Proof trust-boundary decision

Status: accepted for the local isolated S3.3 validation; production adoption is NOT authorized.

## Contract change

S3.2 required the database to independently verify the Proof MAC. M3 preserves an experimental
SQL HMAC/XOR comparator in history; its timing properties were not established and it is not an
accepted security verifier. M5 replaces that same verification function with exact trusted-ticket
matching, removes the grant writer's keyring SELECT, and keeps both runtime gates hard-disabled.
M7 restricts session_user for the dedicated business and registrar connections. No ordinary API
role can set or inherit registrar capability. The public Data API exposes only public.

The accepted model B is:

1. A trusted server verifies the original signed user JWT and real Auth user, then the database
   independently checks UID, live Session, password AMR, confirmed identity, epoch and hold.
2. The protected signer binds a durable, previously approved one-time intent before native HMAC signing.
   Its nonextractable 256-bit HMAC-SHA256 key is server-only. Standard WebCrypto computes the MAC;
   fixed 32-byte Node crypto.timingSafeEqual verifies it. HMAC calculation alone is not claimed
   to provide constant-time comparison. No SQL string equality is presented as constant-time MAC verification.
3. A separate mTLS-authenticated service login inherits only the NOLOGIN registrar role, with
   INHERIT=true, SET=false, ADMIN=false. It registers exact, immutable claims through one parameterized SQL function.
4. An independent business login may take only authenticated's five approved RPC permissions.
   It forwards the original JWT through protected PostgREST; caller-selected claims/GUCs are not authentication.
5. In the business transaction the database compares the exact registered claims, checks project,
   UID, Session, epoch, action, generation, digest and validity, consumes once and changes the Grant atomically.
   Recovery, hold, stale epoch, expired/revoked grants and replay are denied. Unknown outcomes never re-sign or retry.

## Changed threat model

A compromised trusted signer/registrar can register false statements: the database no longer proves
MAC validity independently. The registrar identity, mTLS/CA/SAN/HBA, source network, key store and
server composition are therefore authorization boundaries. The database still independently
checks business eligibility and atomic consumption. verified=true, browser keys, service_role,
postgres connections or a public wrapper are never substitutes.

JavaScript binding.mjs supplies an immutable, branded server-composition scope; there is no global
fixture project. Issuer, private authority, registrar SAN and Unix socket are fixed there, not read
from a request. Signer/verifier must share that same binding. Async admission captures dependencies
before awaiting and rechecks identity/freshness before registration. All factories default closed.

## Evidence and limits

Isolated real tests covered M1–M7 replay, independent Vault/TLS, session authentication, tickets,
Grant consumption, replay/revocation/concurrency, two-site ownership and cross-tenant refusal,
and natural 30-minute expiry with the same valid JWT and open runtime. See final acceptance.
The final generic binding/admission snapshot integration was subsequently tested offline and in
locked workerd; it was not deployed or used to repeat live business writes.

The private Node service requires a read-only shared UDS mount, startup ownership/type/inode checks,
TLS client-chain validation and the exact trusted client fingerprint. Kong metadata is discarded;
only the original bearer reaches PostgREST. Public PostgREST never exposes the private schemas.

## Deployment and rollback boundary

S2 is unchanged; no S3 routes or new DO bindings are added to its production Worker. Public exposure,
production credentials and production migration remain a separate approval. Do not apply historical
isolated SQL as a production rollout. Deploying model B requires explicit acceptance of this changed
trust boundary, independent service identities and a target-bound production migration plan.

Containment is to terminate the ephemeral signer and execute the audited gate-closing transaction,
restore CHECK(NOT proof_verifier_ready), then independently verify roles and data. Do not delete
consumed tickets, reset the database, resurrect a revoked Grant or silently fall back to M3 SQL MAC.
Changing the trust model back requires a new reviewed migration and verification, not a flag toggle.
