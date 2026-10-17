// TEST ONLY: exercises the Test Awards/Skills routing migration in a fresh,
// run-owned disposable Supabase database. It never accepts a remote database URL.
/* global console, process */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { withStagedLocalSupabase } from "./stage-local-supabase.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../../migrations/20261108000000_awards_skills_test_rpc_routing.sql");
const migration = readFileSync(migrationPath, "utf8");
const ownerId = "10000000-0000-4000-8000-000000000001";
const testId = "f6000000-0000-4000-8000-000000000001";
const bootstrapOwnerId = "20000000-0000-4000-8000-000000000001";
const bootstrapTestId = "ea111111-1111-4111-8111-111111111111";

// Guard against widening fixture reads/writes: the runner uses only the two
// synthetic target UUIDs plus exact known bootstrap roots inside its disposable DB.
assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
assert.match(migration, /10000000-0000-4000-8000-000000000001/);
assert.match(migration, /f6000000-0000-4000-8000-000000000001/);
assert.doesNotMatch(migration, /\bINSERT\s+INTO\s+(?:public\.)?resume_(?:award|skill)/i);
assert.doesNotMatch(migration, /\bDELETE\s+FROM\s+(?:public\.)?resume_(?:award|skill)/i);
const migrationSql = migration.replace(/^--.*$/gm, "");
const configUpdates = [...migrationSql.matchAll(/\bUPDATE\s+cms_private\.resume_(?:write_modes|domain_requirements)\b[\s\S]*?;/gi)];
assert.equal(configUpdates.length, 1, "migration must contain only the intended write-mode update");
assert.match(configUpdates[0][0], /WHERE\s+resume_id\s*=\s*test_id\s+AND\s+domain_key\s+IN\s*\('awards','skills'\)/i,
  "write-mode update must target only synthetic Test Awards/Skills");
const requirementsUpserts = [...migrationSql.matchAll(/\bINSERT\s+INTO\s+cms_private\.resume_domain_requirements\b[\s\S]*?;/gi)];
assert.equal(requirementsUpserts.length, 1, "migration must contain only the intended trusted-context upsert");
assert.match(requirementsUpserts[0][0], /VALUES\s*\(test_id,'awards',[\s\S]*\(test_id,'skills'/i,
  "trusted-context upsert must target only synthetic Test Awards/Skills");
assert.doesNotMatch(migrationSql, /\b(?:UPDATE|DELETE)\s+(?:public\.)?resume_(?:intro|education|experience|project|profile|contact|locale|site)/i);

const fixtureSql = `
BEGIN;
-- Remove only the two deterministic base-schema roots in this disposable DB.
DELETE FROM public.resume_sites WHERE id IN ('${bootstrapOwnerId}','${bootstrapTestId}');
INSERT INTO public.resume_sites(id,site_key,is_published) VALUES
  ('${ownerId}','example-cv',true), ('${testId}','example-cv-qa-activity-log',false);

INSERT INTO public.resume_locale_content(resume_id,locale,education_label,experience_label,project_heading,skills_label,
  honors_label,contact_label,availability,portfolio_label,portfolio_href,kaggle_label,updated_at_label,linkedin_label,linkedin_href)
SELECT target.id, locale.locale, 'Education', 'Experience', 'Projects', 'Skills', 'Awards', 'Contact', 'Synthetic',
  'Resume', 'https://example.invalid/resume.pdf', 'Projects', 'Updated', 'LinkedIn', ''
FROM public.resume_sites AS target CROSS JOIN (VALUES ('zh'),('en')) AS locale(locale)
WHERE target.id IN ('${ownerId}','${testId}');

INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
SELECT target.id, capability.capability_key, capability.enabled
FROM public.resume_sites AS target
CROSS JOIN (VALUES ('activity_log',true),('restore',false)) AS capability(capability_key,enabled)
WHERE target.id IN ('${ownerId}','${testId}');

INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode)
SELECT target.id, domain.domain_key,
  CASE WHEN target.id='${testId}'::uuid AND domain.domain_key IN ('introduction','education','experience')
    THEN 'rpc' ELSE 'direct' END
FROM public.resume_sites AS target
CROSS JOIN (VALUES ('introduction'),('education'),('experience'),('awards'),('skills'),
  ('projects'),('contact'),('website_links'),('profile'),('files')) AS domain(domain_key)
WHERE target.id IN ('${ownerId}','${testId}');

INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
SELECT target.id, domain.domain_key, 'trusted_network_context_v11',
  target.id='${testId}'::uuid AND domain.domain_key IN ('introduction','education','experience')
FROM public.resume_sites AS target
CROSS JOIN (VALUES ('introduction'),('education'),('experience'),('awards'),('skills'),
  ('projects'),('contact'),('website_links'),('profile'),('files')) AS domain(domain_key)
WHERE target.id IN ('${ownerId}','${testId}')
  AND NOT (target.id='${testId}'::uuid AND domain.domain_key IN ('awards','skills'));

INSERT INTO public.resume_award_entries(id,resume_id,source_key,position) VALUES
  ('a1100000-0000-4000-8000-000000000001','${ownerId}','synthetic-owner-award',0),
  ('a1200000-0000-4000-8000-000000000001','${testId}','synthetic-test-award',0);
INSERT INTO public.resume_award_translations(award_entry_id,resume_id,locale,name,year)
SELECT e.id,e.resume_id,locale.locale,
  CASE WHEN e.resume_id='${ownerId}'::uuid THEN '合成 Owner 奖项' ELSE '合成 Test 奖项' END,
  CASE WHEN locale.locale='zh' THEN '测试年份' ELSE 'Synthetic year' END
FROM public.resume_award_entries AS e CROSS JOIN (VALUES ('zh'),('en')) AS locale(locale)
WHERE e.resume_id IN ('${ownerId}','${testId}');

INSERT INTO public.resume_skill_groups(id,resume_id,source_key,position) VALUES
  ('a2100000-0000-4000-8000-000000000001','${ownerId}','synthetic-owner-skill',0),
  ('a2200000-0000-4000-8000-000000000001','${testId}','synthetic-test-skill',0);
INSERT INTO public.resume_skill_group_translations(skill_group_id,resume_id,locale,title,items)
SELECT g.id,g.resume_id,locale.locale,
  CASE WHEN locale.locale='zh' THEN '合成技能' ELSE 'Synthetic Skills' END,
  CASE WHEN g.resume_id='${ownerId}'::uuid THEN 'Owner fixture' ELSE 'Test fixture' END
FROM public.resume_skill_groups AS g CROSS JOIN (VALUES ('zh'),('en')) AS locale(locale)
WHERE g.resume_id IN ('${ownerId}','${testId}');
COMMIT;
`;

const snapshotSql = `SELECT jsonb_build_object(
  'targets',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'site_key',site_key,'is_published',is_published) ORDER BY id)
    FROM public.resume_sites WHERE id IN ('${ownerId}','${testId}')),'[]'::jsonb),
  'config',jsonb_build_object(
    'modes',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY resume_id,domain_key)
      FROM cms_private.resume_write_modes AS r WHERE resume_id IN ('${ownerId}','${testId}')),'[]'::jsonb),
    'requirements',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY resume_id,domain_key,requirement_key)
      FROM cms_private.resume_domain_requirements AS r WHERE resume_id IN ('${ownerId}','${testId}')),'[]'::jsonb),
    'capabilities',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY resume_id,capability_key)
      FROM cms_private.resume_capabilities AS r WHERE resume_id IN ('${ownerId}','${testId}')),'[]'::jsonb)
  ),
  'content',jsonb_build_object(
    'awardEntries',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY resume_id,id)
      FROM public.resume_award_entries AS r WHERE resume_id IN ('${ownerId}','${testId}')),'[]'::jsonb),
    'awardTranslations',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY resume_id,award_entry_id,locale)
      FROM public.resume_award_translations AS r WHERE resume_id IN ('${ownerId}','${testId}')),'[]'::jsonb),
    'skillGroups',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY resume_id,id)
      FROM public.resume_skill_groups AS r WHERE resume_id IN ('${ownerId}','${testId}')),'[]'::jsonb),
    'skillTranslations',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY resume_id,skill_group_id,locale)
      FROM public.resume_skill_group_translations AS r WHERE resume_id IN ('${ownerId}','${testId}')),'[]'::jsonb)
  ),
  'events',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY id)
    FROM cms_private.activity_log_events AS r WHERE resume_id IN ('${ownerId}','${testId}')),'[]'::jsonb),
  'systemEvents',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY event_id)
    FROM cms_private.activity_log_system_events AS r WHERE resume_id IN ('${ownerId}','${testId}')),'[]'::jsonb)
)::text;`;

function psqlArgs(context) {
  assert.match(context.projectId, /^pr1-[0-9]+-[a-f0-9]+$/, "expected the runner-owned disposable project");
  assert.match(context.dbContainer, new RegExp(`^supabase_db_${context.projectId.replaceAll("-", "[-_]")}`));
  return ["exec", "-i", context.dbContainer, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
}

function sql(context, text) {
  const result = spawnSync("docker", psqlArgs(context), { input: text, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function sqlOk(context, text, label) {
  const result = sql(context, text);
  assert.equal(result.status, 0, `${label} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function sqlFails(context, text, expected, label) {
  const result = sql(context, text);
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.match(`${result.stdout}\n${result.stderr}`, expected, `${label} failed for an unexpected reason`);
}

function snapshot(context) {
  return JSON.parse(sqlOk(context, snapshotSql, "target-scoped snapshot query"));
}

function arraysFor(value, key, target) {
  return value.config[key].filter((row) => row.resume_id === target);
}

function assertActivated(before, after) {
  assert.deepEqual(after.targets, before.targets, "Owner/Test target mapping changed");
  assert.deepEqual(after.content, before.content, "Owner/Test Awards or Skills content changed");
  assert.deepEqual(after.events, before.events, "Activity Log events changed");
  assert.deepEqual(after.systemEvents, before.systemEvents, "Activity Log system events changed");

  const ownerModesBefore = arraysFor(before, "modes", ownerId);
  const ownerModesAfter = arraysFor(after, "modes", ownerId);
  assert.deepEqual(ownerModesAfter, ownerModesBefore, "Owner write modes changed");
  const ownerRequirementsBefore = arraysFor(before, "requirements", ownerId);
  const ownerRequirementsAfter = arraysFor(after, "requirements", ownerId);
  assert.deepEqual(ownerRequirementsAfter, ownerRequirementsBefore, "Owner trusted-context requirements changed");
  assert.ok(ownerModesAfter.filter((row) => ["awards", "skills"].includes(row.domain_key))
    .every((row) => row.write_mode === "direct"));
  assert.ok(ownerRequirementsAfter.filter((row) => ["awards", "skills"].includes(row.domain_key))
    .every((row) => row.enabled === false));

  const testModesBefore = arraysFor(before, "modes", testId);
  const testModesAfter = arraysFor(after, "modes", testId);
  const testModeMap = new Map(testModesAfter.map((row) => [row.domain_key, row.write_mode]));
  assert.equal(testModeMap.get("awards"), "rpc");
  assert.equal(testModeMap.get("skills"), "rpc");
  for (const row of testModesBefore.filter((row) => !["awards", "skills"].includes(row.domain_key))) {
    assert.deepEqual(testModesAfter.find((candidate) => candidate.domain_key === row.domain_key), row,
      `Test ${row.domain_key} write mode changed`);
  }

  const testRequirementsBefore = arraysFor(before, "requirements", testId);
  const testRequirementsAfter = arraysFor(after, "requirements", testId);
  for (const row of testRequirementsBefore.filter((item) => !(["awards", "skills"].includes(item.domain_key)
    && item.requirement_key === "trusted_network_context_v11"))) {
    assert.deepEqual(testRequirementsAfter.find((candidate) => candidate.domain_key === row.domain_key
      && candidate.requirement_key === row.requirement_key), row, `Test ${row.domain_key} requirements changed`);
  }
  assert.deepEqual(testRequirementsAfter.filter((row) => ["awards", "skills"].includes(row.domain_key)
    && row.requirement_key === "trusted_network_context_v11").map((row) => [row.domain_key, row.enabled]),
  [["awards", true], ["skills", true]]);
  assert.deepEqual(after.config.capabilities, before.config.capabilities, "Activity Log or Restore capabilities changed");
  assert.ok(after.config.capabilities.filter((row) => row.capability_key === "activity_log")
    .every((row) => row.enabled === true));
  assert.ok(after.config.capabilities.filter((row) => row.capability_key === "restore")
    .every((row) => row.enabled === false), "Restore must remain disabled for both targets");
}

async function startLockedSession(context, sqlText, marker) {
  const child = spawn("docker", psqlArgs(context), { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code) => resolveClose({ code, stderr: () => stderr }));
  });
  child.stdin.write(`${sqlText}\nSELECT '${marker}';\n`);
  const deadline = Date.now() + 5000;
  while (!stdout.includes(marker)) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`Timed out waiting for disposable DB lock marker ${marker}: ${stderr}`);
    }
    const result = await Promise.race([closed, delay(25).then(() => null)]);
    if (result) throw new Error(`Lock session exited before marker ${marker}: ${result.stderr()}`);
  }
  return {
    async release() {
      child.stdin.end("ROLLBACK;\n\\q\n");
      const result = await closed;
      assert.equal(result.code, 0, `lock session failed: ${result.stderr()}`);
    },
  };
}

async function main() {
  await withStagedLocalSupabase(async (context, supabase) => {
    console.log("Resetting only this invocation's disposable local Supabase database.");
    supabase(["db", "reset", "--local"]);
    const serverVersion = sqlOk(context, "SHOW server_version;", "PostgreSQL version");
    console.log(`PostgreSQL ${serverVersion}`);
    sqlOk(context, fixtureSql, "synthetic Owner/Test Awards/Skills fixture");
    const baseline = snapshot(context);
    assert.equal(baseline.targets.length, 2);
    assert.equal(baseline.content.awardEntries.length, 2);
    assert.equal(baseline.content.awardTranslations.length, 4);
    assert.equal(baseline.content.skillGroups.length, 2);
    assert.equal(baseline.content.skillTranslations.length, 4);
    assert.equal(baseline.events.length, 0);
    assert.equal(baseline.systemEvents.length, 0);
    assert.ok(arraysFor(baseline, "modes", ownerId).filter((row) => ["awards", "skills"].includes(row.domain_key))
      .every((row) => row.write_mode === "direct"));
    assert.ok(arraysFor(baseline, "modes", testId).filter((row) => ["awards", "skills"].includes(row.domain_key))
      .every((row) => row.write_mode === "direct"));
    assert.equal(arraysFor(baseline, "requirements", testId).filter((row) => ["awards", "skills"].includes(row.domain_key)).length, 0,
      "fixture should exercise missing rows as the established default-false trusted-context state");
    console.log("Fixture PASS: exact synthetic Owner/Test IDs, bilingual Awards/Skills, and no history rows.");

    // Failure before any activation write must leave the invalid baseline intact.
    sqlOk(context, `UPDATE cms_private.resume_write_modes SET write_mode='rpc'
      WHERE resume_id='${testId}' AND domain_key='skills';`, "precondition failure setup");
    const invalidBaseline = snapshot(context);
    sqlFails(context, migration, /Test Awards\/Skills modes are not at the expected direct baseline/, "precondition failure");
    assert.deepEqual(snapshot(context), invalidBaseline, "precondition failure partially changed the database");
    sqlOk(context, `UPDATE cms_private.resume_write_modes SET write_mode='direct'
      WHERE resume_id='${testId}' AND domain_key='skills';`, "restore synthetic Test baseline");
    assert.deepEqual(snapshot(context), baseline, "synthetic baseline did not return to its original state");
    console.log("PASS: invalid Test mode precondition rolls back without partial changes.");

    // Inject a late Test-only requirement failure after modes have been updated.
    sqlOk(context, `CREATE SCHEMA awards_skills_activation_test;
      CREATE FUNCTION awards_skills_activation_test.reject_test_requirement() RETURNS trigger
      LANGUAGE plpgsql AS $f$ BEGIN
        IF NEW.resume_id='${testId}'::uuid AND NEW.domain_key='skills' AND NEW.enabled IS TRUE THEN
          RAISE EXCEPTION 'injected disposable Test rollback check';
        END IF;
        RETURN NEW;
      END $f$;
      CREATE TRIGGER awards_skills_activation_rollback_probe
      BEFORE INSERT OR UPDATE ON cms_private.resume_domain_requirements
      FOR EACH ROW EXECUTE FUNCTION awards_skills_activation_test.reject_test_requirement();`, "rollback probe setup");
    const beforeInjectedFailure = snapshot(context);
    sqlFails(context, migration, /injected disposable Test rollback check/, "post-update rollback probe");
    assert.deepEqual(snapshot(context), beforeInjectedFailure, "late failure did not roll back all activation updates");
    sqlOk(context, "DROP TRIGGER awards_skills_activation_rollback_probe ON cms_private.resume_domain_requirements; DROP SCHEMA awards_skills_activation_test CASCADE;",
      "rollback probe cleanup");
    assert.deepEqual(snapshot(context), baseline, "rollback probe changed state after cleanup");
    console.log("PASS: injected failure after mode updates rolls back the complete transaction.");

    // SHARE locks used by the migration conflict with direct content DML on
    // only the four Awards/Skills tables.
    const shareSession = await startLockedSession(context,
      "BEGIN; LOCK TABLE public.resume_award_entries, public.resume_award_translations, public.resume_skill_groups, public.resume_skill_group_translations IN SHARE MODE;",
      "AWARDS_SKILLS_SHARE_LOCK_READY");
    try {
      for (const [table, column, label] of [
        ["resume_award_entries", "position", "Awards entries"],
        ["resume_award_translations", "year", "Awards translations"],
        ["resume_skill_groups", "position", "Skills groups"],
        ["resume_skill_group_translations", "items", "Skills translations"],
      ]) {
        const blockedWrite = sql(context, `SET lock_timeout='700ms'; UPDATE public.${table} SET ${column}=${column}
          WHERE resume_id IN ('${ownerId}','${testId}');`);
        assert.notEqual(blockedWrite.status, 0, `${label} direct write unexpectedly passed the SHARE lock`);
        assert.match(`${blockedWrite.stdout}\n${blockedWrite.stderr}`, /55P03|lock timeout|could not obtain lock/i,
          `${label} direct write failed for a reason other than the lock timeout`);
      }
    } finally {
      await shareSession.release();
    }
    assert.deepEqual(snapshot(context), baseline, "SHARE-lock test changed target content or history");
    console.log("PASS: direct Awards/Skills DML conflicts with the scoped SHARE locks and leaves state unchanged.");

    // Simulate an in-flight RPC holding the Test site's row lock. Migration must
    // abort at NOWAIT rather than wait or deadlock, and must roll back its locks.
    const rowLockSession = await startLockedSession(context,
      `BEGIN; SELECT id FROM public.resume_sites WHERE id='${testId}' FOR UPDATE;`, "TEST_SITE_RPC_LOCK_READY");
    try {
      const startedAt = Date.now();
      sqlFails(context, migration, /55P03|could not obtain lock on row/i, "NOWAIT against in-flight Test RPC");
      assert.ok(Date.now() - startedAt < 2000, "NOWAIT migration attempt waited unexpectedly");
    } finally {
      await rowLockSession.release();
    }
    assert.deepEqual(snapshot(context), baseline, "NOWAIT failure changed target configuration, content, or events");
    console.log("PASS: FOR UPDATE NOWAIT aborts promptly against the Test site lock without deadlock or state changes.");

    // Normal one-shot activation.
    sqlOk(context, migration, "Test Awards/Skills activation migration");
    const activated = snapshot(context);
    assertActivated(baseline, activated);
    console.log("PASS: only Test Awards/Skills switched to RPC/trusted context; Owner and all other state stayed unchanged.");

    // A repeated execution must reject the already activated baseline safely.
    sqlFails(context, migration, /Test Awards\/Skills modes are not at the expected direct baseline/, "duplicate migration execution");
    assert.deepEqual(snapshot(context), activated, "duplicate migration execution changed state");
    console.log("PASS: duplicate execution fails safely without state changes.");
  });
}

if (process.argv.includes("--static")) {
  console.log("PASS: migration transaction, fixed target IDs, and scoped-write static guards.");
} else {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Awards/Skills Test activation runtime test failed.");
    process.exitCode = 1;
  });
}
