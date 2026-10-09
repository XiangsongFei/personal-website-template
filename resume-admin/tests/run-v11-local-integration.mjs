// TEST ONLY: injects credentials from the named local Supabase Auth container
// into one opt-in Vitest process. Nothing from this script is printed except
// the test result; no remote endpoint is accepted.
/* global Buffer, console, process */
import { spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const authContainer = "supabase_auth_example-cv-admin-rls-local-test";
const dbContainer = "supabase_db_example-cv-admin-rls-local-test";
const targetId = "ea111111-1111-4111-8111-111111111111";
const officialId = "20000000-0000-4000-8000-000000000001";
function psql(sql) {
  const result = spawnSync("docker", ["exec", dbContainer, "psql", "-X", "-U", "postgres", "-d", "postgres", "-At", "-c", sql], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Local-only test fixture SQL failed");
  return result.stdout.trim();
}
if (spawnSync("docker", ["inspect", "--format", "{{.State.Running}}", dbContainer], { encoding: "utf8" }).stdout.trim() !== "true") {
  throw new Error("The named local database container is not running");
}
const inspected = spawnSync("docker", ["inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", authContainer], { encoding: "utf8" });
if (inspected.status !== 0) throw new Error("Required local Supabase Auth container is unavailable");
const jwtSecret = inspected.stdout.split(/\r?\n/).find((line) => line.startsWith("GOTRUE_JWT_SECRET="))?.slice("GOTRUE_JWT_SECRET=".length);
if (!jwtSecret) throw new Error("Local Supabase JWT signer is unavailable");
const priorRequirement = psql(`SELECT COALESCE((SELECT enabled::text FROM cms_private.resume_domain_requirements WHERE resume_id='${targetId}'::uuid AND domain_key='introduction' AND requirement_key='trusted_network_context_v11'),'absent')`);
if (!new Set(["absent", "true", "false"]).has(priorRequirement)) throw new Error("Unexpected local V1.1 requirement state");
const officialBaseline = psql(`SELECT cms_private.get_resume_write_mode('${officialId}'::uuid,'introduction') || ':' || COALESCE((SELECT enabled::text FROM cms_private.resume_capabilities WHERE resume_id='${officialId}'::uuid AND capability_key='activity_log'),'absent') || ':' || COALESCE((SELECT enabled::text FROM cms_private.resume_domain_requirements WHERE resume_id='${officialId}'::uuid AND domain_key='introduction' AND requirement_key='trusted_network_context_v11'),'absent')`);
if (officialBaseline !== "direct:absent:absent" && officialBaseline !== "direct:false:absent") throw new Error("Official-like local fixture is not in the expected direct/off baseline");

function token(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
  return `${input}.${createHmac("sha256", jwtSecret).update(input).digest("base64url")}`;
}

const now = Math.floor(Date.now() / 1000);
const childEnv = {
  ...process.env,
  V11_LOCAL_INTEGRATION: "1",
  V11_LOCAL_DB_CONTAINER: dbContainer,
  V11_LOCAL_API_URL: "http://127.0.0.1:55421",
  V11_LOCAL_WORKER_SUPABASE_URL: "https://local.supabase.invalid",
  V11_LOCAL_PUBLISHABLE_KEY: token({ aud: "authenticated", role: "anon", iss: "local-test", iat: now, exp: now + 3600 }),
  V11_LOCAL_JWT_SECRET: jwtSecret,
  V11_LOCAL_USER_JWT: token({
    aud: "authenticated", role: "authenticated", iss: "local-test", iat: now, exp: now + 3600,
    sub: "10000000-0000-4000-8000-000000000002", email: "qa-local@example.invalid",
    session_id: randomUUID(), app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
  }),
  V11_LOCAL_OWNER_JWT: token({
    aud: "authenticated", role: "authenticated", iss: "local-test", iat: now, exp: now + 3600,
    sub: "10000000-0000-4000-8000-000000000001", email: "owner-local@example.invalid",
    session_id: randomUUID(), app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
  }),
};
const vitest = resolve(adminRoot, "node_modules/.bin/vitest");
const result = spawnSync(vitest, ["run", "tests/activity-log-v11-local-integration.test.ts"], {
  cwd: adminRoot, env: childEnv, stdio: "inherit",
});
let networkCheckPassed = false;
let cleanupPassed = true;
try {
  const networkVerified = psql(`WITH privacy_events AS (
    SELECT actor_user_id, operation, section_key, entity_type, entity_id, entity_snapshot,
      ip_network, country_code, region, city,
      CASE
        WHEN entity_snapshot @> '{"paragraphs":[{"text_zh":"D integration local item","text_en":"D integration local item"}]}'::jsonb THEN 'ipv4-input'
        WHEN entity_snapshot @> '{"paragraphs":[{"text_zh":"D integration local item IPv6","text_en":"D integration local item"}]}'::jsonb THEN 'ipv6-input'
      END AS input_case
    FROM cms_private.activity_log_events
    WHERE resume_id='${targetId}'::uuid
      AND site_key_snapshot='example-cv-qa'
      AND entity_type='introduction_paragraph'
      AND entity_id='introduction'
      AND (entity_snapshot @> '{"paragraphs":[{"text_zh":"D integration local item","text_en":"D integration local item"}]}'::jsonb
        OR entity_snapshot @> '{"paragraphs":[{"text_zh":"D integration local item IPv6","text_en":"D integration local item"}]}'::jsonb)
  )
  SELECT count(*) = 2
    AND count(*) FILTER (WHERE input_case='ipv4-input') = 1
    AND count(*) FILTER (WHERE input_case='ipv6-input') = 1
    AND bool_and(actor_user_id='10000000-0000-4000-8000-000000000002'::uuid AND operation='update'
      AND section_key='introduction' AND entity_type='introduction_paragraph' AND entity_id='introduction'
      AND ip_network IS NULL AND country_code IS NULL AND region IS NULL AND city IS NULL)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='cms_private.activity_log_events'::regclass
      AND attnum>0 AND NOT attisdropped AND attname ~* '(signature|hmac|secret|key_material|signed_context)')
  FROM privacy_events`);
  networkCheckPassed = networkVerified === "t";
} catch {
  networkCheckPassed = false;
}
try {
  if (priorRequirement === "absent") {
    psql(`DELETE FROM cms_private.resume_domain_requirements WHERE resume_id='${targetId}'::uuid AND domain_key='introduction' AND requirement_key='trusted_network_context_v11'`);
  } else {
    psql(`UPDATE cms_private.resume_domain_requirements SET enabled=${priorRequirement} WHERE resume_id='${targetId}'::uuid AND domain_key='introduction' AND requirement_key='trusted_network_context_v11'`);
  }
  psql(`DELETE FROM cms_private.resume_domain_requirements WHERE resume_id='${officialId}'::uuid AND domain_key='introduction' AND requirement_key='trusted_network_context_v11'; UPDATE cms_private.resume_write_modes SET write_mode='direct' WHERE resume_id='${officialId}'::uuid AND domain_key='introduction'; ${officialBaseline.endsWith(":absent:absent") ? `DELETE FROM cms_private.resume_capabilities WHERE resume_id='${officialId}'::uuid AND capability_key='activity_log'` : `UPDATE cms_private.resume_capabilities SET enabled=false WHERE resume_id='${officialId}'::uuid AND capability_key='activity_log'`}`);
} catch {
  cleanupPassed = false;
}
if (!networkCheckPassed) console.error("Local Worker network-context persistence check failed.");
if (!cleanupPassed) console.error("Local requirement cleanup failed; reset only the isolated local test database before reuse.");
// The immutable event table cannot be pruned by cleanup. Reset only this
// documented, unlinked local runtime project so following SQL suites start
// from the same clean seed and no D-generated event history remains.
const reset = spawnSync("supabase", ["db", "reset", "--local"], {
  cwd: resolve(adminRoot, "tests/rls-runtime/supabase"),
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  stdio: "inherit",
});
if (reset.status !== 0) console.error("Isolated local database cleanup reset failed.");
process.exit(cleanupPassed && networkCheckPassed && reset.status === 0 ? (result.status ?? 1) : 1);
