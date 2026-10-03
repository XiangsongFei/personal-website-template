import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = "migrations/20261005_activity_log_v11_context.sql";
const migration = readFileSync(resolve(migrationPath), "utf8");
const mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261005000000_activity_log_v11_context.sql"), "utf8");
const testProvider = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261005000001_test_only_v11_key_provider.sql"), "utf8");
const vaultAdapter = readFileSync(resolve("migrations/20261006_activity_log_v11_vault_key_adapter.sql"), "utf8");
const vaultAdapterMirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261006000000_activity_log_v11_vault_key_adapter.sql"), "utf8");
const vaultTestSeed = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261006000001_test_only_v11_vault_key.sql"), "utf8");
const phase1Corrective = readFileSync(resolve("migrations/20261004_activity_log_phase1_introduction_conflict_target.sql"), "utf8");

function migrationFunction(source: string, name: string): string {
  const escaped = name.replaceAll(".", "\\.");
  return source.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${escaped}\\([\\s\\S]*?\\$function\\$;`))?.[0] ?? "";
}

describe("Activity Log V1.1 additive local foundation", () => {
  it("preserves all frozen migration hashes", () => {
    const expected = new Map([
      ["20261002_activity_log_foundation.sql", "643b04a5ca134d5be41d73af118a72886320965e6f2b59b04754d9bef098471d"],
      ["20261003_activity_log_phase1_introduction.sql", "824f28533336505b5a60c2ecd6bae5ab2234e0a2ca7b5afadd64db781cc797be"],
      ["20261004_activity_log_phase1_introduction_conflict_target.sql", "cf5bab463a6e964004f230e5b5b40f16d802eeb7327cf8637c554de41d8c4671"],
      ["20261005_activity_log_v11_context.sql", "a26835c1a05c06c339a14f6b521fc2548be685d09f814233296c009e4daae794"],
    ]);
    for (const [name, hash] of expected) {
      const contents = readFileSync(resolve(`migrations/${name}`));
      expect(createHash("sha256").update(contents).digest("hex"), name).toBe(hash);
    }
  });

  it("keeps the runtime migration byte-identical to the canonical migration", () => {
    expect(mirror).toBe(migration);
  });

  it("adds only nullable event context fields and constrains their representation", () => {
    expect(migration).toContain("ADD COLUMN ip_network cidr");
    expect(migration).toContain("ADD COLUMN country_code text");
    expect(migration).toContain("ADD COLUMN region text");
    expect(migration).toContain("ADD COLUMN city text");
    expect(migration).toContain("family(ip_network) = 4 AND pg_catalog.masklen(ip_network) = 24");
    expect(migration).toContain("family(ip_network) = 6 AND pg_catalog.masklen(ip_network) = 48");
    expect(migration).toContain("octet_length(region) BETWEEN 1 AND 128");
    expect(migration).toContain("octet_length(city) BETWEEN 1 AND 128");
    expect(migration).not.toMatch(/ADD COLUMN (?:key_id|audit_context_version|network_context_source|request_id|signature|mutation_digest|jwt|full_ip)/i);
    expect(migration).not.toMatch(/UPDATE cms_private\.activity_log_events/i);
  });

  it("leaves the domain requirement absent/off and separate from capability and write mode", () => {
    expect(migration).toContain("CREATE TABLE cms_private.resume_domain_requirements");
    expect(migration).toContain("PRIMARY KEY (resume_id, domain_key, requirement_key)");
    expect(migration).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("trusted_network_context_v11");
    expect(migration).not.toMatch(/INSERT\s+INTO\s+cms_private\.resume_domain_requirements/i);
    expect(migration).not.toMatch(/UPDATE\s+cms_private\.resume_domain_requirements/i);
    expect(migration).not.toMatch(/ALTER TABLE cms_private\.resume_capabilities/i);
    expect(migration).not.toMatch(/ALTER TABLE cms_private\.resume_write_modes/i);
  });

  it("keeps Phase 1 mutation behavior with only the targeted generated-ID cleanup correction", () => {
    const source = migrationFunction(phase1Corrective, "public.save_resume_introduction");
    const shared = migrationFunction(migration, "cms_private.apply_resume_introduction");
    expect(source).not.toBe("");
    const sourceInsert = source.match(/INSERT INTO cms_private\.activity_log_events\([\s\S]*?changes_value\);/)?.[0] ?? "";
    const sharedInsert = shared.match(/INSERT INTO cms_private\.activity_log_events\([\s\S]*?context_value->>'city'\);/)?.[0] ?? "";
    const normalizedShared = shared
      .replace("CREATE FUNCTION cms_private.apply_resume_introduction(target_resume_id uuid, target_items jsonb, context_value jsonb)",
        "CREATE OR REPLACE FUNCTION public.save_resume_introduction(target_resume_id uuid, target_items jsonb)")
      .replace("  v11_generated_ids uuid[] := ARRAY[]::uuid[];\n", "")
      .replace("      v11_generated_ids := pg_catalog.array_append(v11_generated_ids,saved_id);\n", "")
      .replace("    AND NOT (p.id = ANY(v11_generated_ids))\n", "")
      .replace(sharedInsert, sourceInsert);
    expect(sourceInsert).not.toBe("");
    expect(sharedInsert).not.toBe("");
    expect(normalizedShared).toBe(source);
    expect(shared).toContain("ON CONFLICT(paragraph_id,locale)");
    expect(sharedInsert).toContain("ip_network,country_code,region,city");
    expect(shared).toContain("v11_generated_ids := pg_catalog.array_append(v11_generated_ids,saved_id);");
    expect(shared).toContain("AND NOT (p.id = ANY(v11_generated_ids))");
  });

  it("locks the target before the legacy wrapper checks the V1.1 requirement", () => {
    const legacy = migrationFunction(migration, "public.save_resume_introduction");
    expect(legacy).not.toBe("");
    expect(legacy.indexOf("FOR UPDATE")).toBeGreaterThan(-1);
    expect(legacy.indexOf("FOR UPDATE")).toBeLessThan(legacy.indexOf("SELECT requirement.enabled"));
    expect(legacy).toContain("IF COALESCE(gate_enabled, false)");
    expect(legacy).toContain("RETURN cms_private.apply_resume_introduction");
    expect(migration).toContain("any future activation/deactivation must lock the same resume_sites row");
  });

  it("stores and replays the original bounded canonical result and rejects expired keys", () => {
    expect(migration).toContain("result_payload jsonb");
    expect(migration).toContain("completed_at IS NULL AND result_payload IS NULL");
    expect(migration).toContain("completed_at IS NOT NULL AND result_payload IS NOT NULL");
    expect(migration).toContain("octet_length(pg_catalog.convert_to(result_payload::text, 'UTF8')) <= 393216");
    const writer = migrationFunction(migration, "public.save_resume_introduction_v11");
    expect(writer).toContain("prior.expires_at");
    expect(writer).toContain("existing_expires_at <= pg_catalog.clock_timestamp()");
    expect(writer).toContain("Idempotency request has expired; use a new request ID");
    expect(writer).toContain("RETURN existing_result");
    expect(writer).not.toContain("RETURN cms_private.read_resume_introduction(target_resume_id)");
    expect(writer).toContain("SET result_payload = canonical_result");
  });

  it("defines a fail-closed production key-provider boundary and an isolated synthetic-only local provider", () => {
    const provider = migrationFunction(migration, "cms_private.activity_log_v11_key");
    expect(provider).toContain("RAISE EXCEPTION 'Invalid signed context'");
    expect(provider).not.toContain("vault.decrypted_secrets");
    expect(testProvider).toContain("TEST ONLY");
    expect(testProvider).toContain("target_key_id text DEFAULT 'activity_log_v11_hmac_v1'");
    expect(testProvider).toContain("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
    const signer = migrationFunction(testProvider, "public.test_only_sign_activity_log_v11_context");
    expect(signer).not.toContain("cms_private.activity_log_v11_key");
    expect(signer).toContain("pg_catalog.decode(");
    expect(signer).toContain("'00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'");
  });

  it("adds a Vault-backed adapter without changing the frozen foundation and mirrors it exactly", () => {
    expect(vaultAdapterMirror).toBe(vaultAdapter);
    expect(vaultAdapter).toContain("CREATE OR REPLACE FUNCTION cms_private.activity_log_v11_key(target_key_id text)");
    expect(vaultAdapter).toContain("RETURNS bytea");
    expect(vaultAdapter).toContain("LANGUAGE plpgsql");
    expect(vaultAdapter).toContain("SECURITY DEFINER");
    expect(vaultAdapter).toContain("SET search_path = ''");
    expect(vaultAdapter).toContain("target_key_id IS DISTINCT FROM 'activity_log_v11_hmac_v1'");
    expect(vaultAdapter).toContain("INTO STRICT decrypted_value");
    expect(vaultAdapter).toContain("FROM vault.decrypted_secrets");
    expect(vaultAdapter).toContain("pg_catalog.char_length(decrypted_value) <> 64");
    expect(vaultAdapter).toContain("'^[0-9a-f]{64}$'");
    expect(vaultAdapter).toContain("pg_catalog.decode(decrypted_value, 'hex')");
    expect(vaultAdapter).toContain("pg_catalog.octet_length(decoded_value) <> 32");
    expect(vaultAdapter.match(/RAISE EXCEPTION 'Invalid signed context' USING ERRCODE = '22023';/g)).toHaveLength(4);
    expect(vaultAdapter).toContain("WHEN OTHERS THEN");
    expect(vaultAdapter).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(vaultAdapter).not.toContain("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
    expect(vaultTestSeed).toContain("TEST ONLY");
    expect(vaultTestSeed).toContain("vault.create_secret");
    expect(vaultTestSeed).toContain("activity_log_v11_hmac_v1");
    expect(testProvider).not.toContain("cms_private.activity_log_v11_key(target_key_id)");
  });

  it("adds only authenticated public RPCs and keeps all private helpers inaccessible", () => {
    expect(migration).toContain("CREATE FUNCTION public.load_admin_feature_state_v11");
    expect(migration).toContain("CREATE FUNCTION public.save_resume_introduction_v11");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.load_admin_feature_state_v11(uuid) TO authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.save_resume_introduction_v11(uuid, text, text, text) TO authenticated");
    expect(migration).toContain("REVOKE ALL ON FUNCTION cms_private.verify_resume_introduction_v11_context(uuid, text, text, text)");
    expect(migration).toContain("REVOKE ALL ON FUNCTION cms_private.apply_resume_introduction(uuid, jsonb, jsonb)");
    expect(migration).not.toMatch(/GRANT\s+EXECUTE[^;]+TO\s+service_role/i);
    expect(migration).not.toMatch(/service_role[^;]*GRANT/i);
  });

  it("binds raw canonical UTF-8 bytes to HMAC and validates timing, scope, IP, geo, and item bounds", () => {
    const verifier = migrationFunction(migration, "cms_private.verify_resume_introduction_v11_context");
    expect(verifier).toContain("convert_to(canonical_items, 'UTF8')");
    expect(verifier).toContain("extensions.digest");
    expect(verifier).toContain("extensions.hmac");
    expect(verifier).toContain("issued_seconds > now_seconds + 60");
    expect(verifier).toContain("expires_seconds - issued_seconds > 300");
    expect(verifier).toContain("family(ip_value) = 4");
    expect(verifier).toContain("octet_length(pg_catalog.convert_to(canonical_items, 'UTF8')) > 262144");
    expect(verifier).toContain("<> 'introduction'");
    expect(verifier).toContain("<> 'update'");
    expect(verifier).toContain("actor_user_id");
    expect(verifier).toContain("target_resume_id");
  });
});
