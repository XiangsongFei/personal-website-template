// TEST ONLY: exercises the Owner routing migration against the disposable
// Supabase project created by stage-local-supabase.mjs. Never accepts a remote
// database URL and never uses Supabase project credentials.
/* global console, process */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { withStagedLocalSupabase } from "./stage-local-supabase.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../../migrations/20261104000000_owner_three_domain_rpc_routing.sql");
const migration = readFileSync(migrationPath, "utf8");
const ownerId = "10000000-0000-4000-8000-000000000001";
const testId = "f6000000-0000-4000-8000-000000000001";

const fixtureSql = `
BEGIN;
DELETE FROM public.resume_sites WHERE site_key IN ('example-cv', 'example-cv-qa-activity-log');
INSERT INTO public.resume_sites(id,site_key,is_published) VALUES
  ('${ownerId}','example-cv',true), ('${testId}','example-cv-qa-activity-log',false);
INSERT INTO public.resume_locale_content(resume_id,locale,education_label,experience_label,project_heading,skills_label,
  honors_label,contact_label,availability,portfolio_label,portfolio_href,kaggle_label,updated_at_label,linkedin_label,linkedin_href)
SELECT target.id, locale.locale, 'Education', 'Experience', 'Projects', 'Skills', 'Awards', 'Contact', 'Synthetic',
  'Resume', 'https://example.invalid/resume.pdf', 'Projects', 'Updated', 'LinkedIn', ''
FROM public.resume_sites AS target CROSS JOIN (VALUES ('zh'),('en')) AS locale(locale)
WHERE target.id IN ('${ownerId}','${testId}');
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled) VALUES
  ('${ownerId}','activity_log',true), ('${testId}','activity_log',true),
  ('${ownerId}','restore',false), ('${testId}','restore',false);
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode)
SELECT target.id, domain.domain_key, CASE WHEN target.id='${ownerId}'::uuid THEN 'direct' ELSE 'rpc' END
FROM public.resume_sites AS target CROSS JOIN (VALUES ('introduction'),('education'),('experience')) AS domain(domain_key)
WHERE target.id IN ('${ownerId}','${testId}');
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
SELECT target.id, domain.domain_key, 'trusted_network_context_v11', target.id='${testId}'::uuid
FROM public.resume_sites AS target CROSS JOIN (VALUES ('introduction'),('education'),('experience')) AS domain(domain_key)
WHERE target.id IN ('${ownerId}','${testId}');

INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key) VALUES
 ('a1000000-0000-4000-8000-000000000001','${ownerId}',0,'synthetic-owner-intro'),
 ('a2000000-0000-4000-8000-000000000001','${testId}',0,'synthetic-test-intro');
INSERT INTO public.resume_intro_paragraph_translations(paragraph_id,resume_id,locale,text)
SELECT p.id,p.resume_id,locale.locale,CASE WHEN p.resume_id='${ownerId}'::uuid THEN 'Synthetic Owner' ELSE 'Synthetic Test' END
FROM public.resume_intro_paragraphs AS p CROSS JOIN (VALUES ('zh'),('en')) AS locale(locale)
WHERE p.resume_id IN ('${ownerId}','${testId}');

INSERT INTO public.resume_education_entries(id,resume_id,position,entry_type,education_category) VALUES
 ('b1000000-0000-4000-8000-000000000001','${ownerId}',0,'standard','undergraduate'),
 ('b2000000-0000-4000-8000-000000000001','${testId}',0,'standard','undergraduate');
INSERT INTO public.resume_education_translations(education_entry_id,resume_id,locale,title,program,period,grade)
SELECT e.id,e.resume_id,locale.locale,'Synthetic school','Synthetic program','2020-2024','A'
FROM public.resume_education_entries AS e CROSS JOIN (VALUES ('zh'),('en')) AS locale(locale)
WHERE e.resume_id IN ('${ownerId}','${testId}');

INSERT INTO public.resume_experience_entries(id,resume_id,position) VALUES
 ('c1000000-0000-4000-8000-000000000001','${ownerId}',0),
 ('c2000000-0000-4000-8000-000000000001','${testId}',0);
INSERT INTO public.resume_experience_translations(experience_entry_id,resume_id,locale,organization,title,period,description,location)
SELECT e.id,e.resume_id,locale.locale,'Synthetic organization','Synthetic role','2024','Synthetic description','Remote'
FROM public.resume_experience_entries AS e CROSS JOIN (VALUES ('zh'),('en')) AS locale(locale)
WHERE e.resume_id IN ('${ownerId}','${testId}');
COMMIT;
`;

const snapshotSql = `SELECT jsonb_build_object(
  'targets', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'site_key',site_key,'is_published',is_published) ORDER BY id)
    FROM public.resume_sites WHERE id IN ('${ownerId}','${testId}')), '[]'::jsonb),
  'config', jsonb_build_object(
    'modes', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY resume_id,domain_key)
      FROM cms_private.resume_write_modes AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb),
    'requirements', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY resume_id,domain_key,requirement_key)
      FROM cms_private.resume_domain_requirements AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb),
    'capabilities', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY resume_id,capability_key)
      FROM cms_private.resume_capabilities AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb)
  ),
  'content', jsonb_build_object(
    'intro', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY resume_id,id) FROM public.resume_intro_paragraphs AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb),
    'introTranslations', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY resume_id,paragraph_id,locale) FROM public.resume_intro_paragraph_translations AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb),
    'education', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY resume_id,id) FROM public.resume_education_entries AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb),
    'educationTranslations', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY resume_id,education_entry_id,locale) FROM public.resume_education_translations AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb),
    'experience', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY resume_id,id) FROM public.resume_experience_entries AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb),
    'experienceTranslations', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY resume_id,experience_entry_id,locale) FROM public.resume_experience_translations AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb)
  ),
  'events', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY id) FROM cms_private.activity_log_events AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb),
  'systemEvents', COALESCE((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY event_id) FROM cms_private.activity_log_system_events AS row_value WHERE resume_id IN ('${ownerId}','${testId}')), '[]'::jsonb)
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
  return JSON.parse(sqlOk(context, snapshotSql, "snapshot query"));
}

function sameExceptOwnerActivation(before, after) {
  assert.deepEqual(after.targets, before.targets, "Owner/Test target identity changed");
  assert.deepEqual(after.content, before.content, "synthetic Owner/Test content changed");
  assert.deepEqual(after.events, before.events, "Activity Log events changed");
  assert.deepEqual(after.systemEvents, before.systemEvents, "Activity Log system events changed");
}

function ownerModeRows(value) {
  return value.config.modes.filter((row) => row.resume_id === ownerId);
}

function assertOwnerActivated(value) {
  assert.deepEqual(ownerModeRows(value).map((row) => [row.domain_key, row.write_mode]), [
    ["education", "rpc"], ["experience", "rpc"], ["introduction", "rpc"],
  ]);
  const ownerRequirements = value.config.requirements.filter((row) => row.resume_id === ownerId);
  assert.deepEqual(ownerRequirements.map((row) => [row.domain_key, row.enabled]), [
    ["education", true], ["experience", true], ["introduction", true],
  ]);
  const restoreCaps = value.config.capabilities.filter((row) => row.capability_key === "restore");
  assert.equal(restoreCaps.length, 2);
  assert.ok(restoreCaps.every((row) => row.enabled === false), "Restore must remain disabled for both synthetic targets");
}

function assertTestConfigUnchanged(before, after) {
  for (const key of ["modes", "requirements", "capabilities"]) {
    const beforeRows = before.config[key].filter((row) => row.resume_id === testId);
    const afterRows = after.config[key].filter((row) => row.resume_id === testId);
    assert.deepEqual(afterRows, beforeRows, `Test ${key} changed`);
  }
}

async function startLockedSession(context, sqlText, marker) {
  const child = spawn("docker", psqlArgs(context), { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code) => resolveClose({ code, stdout: () => stdout, stderr: () => stderr }));
  });
  child.stdin.write(`${sqlText}\nSELECT '${marker}';\n`);
  const deadline = Date.now() + 5000;
  while (!stdout.includes(marker)) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`Timed out waiting for disposable database lock marker ${marker}: ${stderr}`);
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
    console.log("Resetting only this run's disposable local Supabase database.");
    supabase(["db", "reset", "--local"]);
    const serverVersion = sqlOk(context, "SHOW server_version;", "PostgreSQL version");
    console.log(`PostgreSQL ${serverVersion}`);
    sqlOk(context, fixtureSql, "synthetic Owner/Test fixture");
    const initial = snapshot(context);
    assert.equal(initial.content.intro.length, 2);
    assert.equal(initial.content.education.length, 2);
    assert.equal(initial.content.experience.length, 2);
    assert.equal(initial.events.length, 0);
    assert.equal(initial.systemEvents.length, 0);
    console.log("Fixture: two synthetic targets, bilingual rows in all three domains, no events.");

    // B1: fail a documented precondition and prove the already-invalid
    // baseline is byte-for-byte unchanged by the failed migration attempt.
    sqlOk(context, `UPDATE cms_private.resume_write_modes SET write_mode='rpc'
      WHERE resume_id='${ownerId}' AND domain_key='education';`, "precondition setup");
    const invalidBaseline = snapshot(context);
    sqlFails(context, migration, /Owner modes are not at the expected direct baseline/, "failed precondition");
    assert.deepEqual(snapshot(context), invalidBaseline, "precondition failure partially changed database state");
    sqlOk(context, `UPDATE cms_private.resume_write_modes SET write_mode='direct'
      WHERE resume_id='${ownerId}' AND domain_key='education';`, "restore synthetic baseline");
    console.log("PASS: failed precondition leaves all state unchanged.");

    // B2: inject a test-only failure after the migration updates Owner modes;
    // the enclosing migration transaction must roll those writes back.
    sqlOk(context, `CREATE SCHEMA owner_activation_test;
      CREATE FUNCTION owner_activation_test.reject_requirement() RETURNS trigger
      LANGUAGE plpgsql AS $f$ BEGIN
        IF NEW.resume_id='${ownerId}'::uuid THEN RAISE EXCEPTION 'injected isolated rollback check'; END IF;
        RETURN NEW;
      END $f$;
      CREATE TRIGGER owner_activation_rollback_probe BEFORE INSERT OR UPDATE ON cms_private.resume_domain_requirements
      FOR EACH ROW EXECUTE FUNCTION owner_activation_test.reject_requirement();`, "rollback probe setup");
    const beforeInjectedFailure = snapshot(context);
    sqlFails(context, migration, /injected isolated rollback check/, "post-update rollback probe");
    assert.deepEqual(snapshot(context), beforeInjectedFailure, "migration exception failed to roll back earlier configuration updates");
    sqlOk(context, "DROP TRIGGER owner_activation_rollback_probe ON cms_private.resume_domain_requirements; DROP SCHEMA owner_activation_test CASCADE;", "rollback probe cleanup");
    console.log("PASS: injected failure after activation writes rolls the transaction back completely.");

    // C1: SHARE table locks block direct content DML without changing rows.
    const shareSession = await startLockedSession(context,
      `BEGIN; LOCK TABLE public.resume_education_entries IN SHARE MODE;`, "SHARE_LOCK_READY");
    try {
      const blockedWrite = sql(context, `SET lock_timeout='700ms'; UPDATE public.resume_education_entries
        SET position=position WHERE resume_id='${ownerId}';`);
      assert.notEqual(blockedWrite.status, 0, "direct content write unexpectedly passed a SHARE table lock");
      assert.match(`${blockedWrite.stdout}\n${blockedWrite.stderr}`, /55P03|lock timeout|could not obtain lock/i);
    } finally {
      await shareSession.release();
    }
    sqlOk(context, `BEGIN; UPDATE public.resume_education_entries SET position=position
      WHERE resume_id='${ownerId}'; ROLLBACK;`, "write after SHARE lock release");
    assert.deepEqual(snapshot(context), initial, "content or events changed during SHARE-lock test");
    console.log("PASS: SHARE lock blocks direct Education DML, then releases cleanly.");

    // C2: model an in-flight RPC holding a site row lock. The migration must
    // fail at FOR UPDATE NOWAIT, promptly and without a deadlock or writes.
    const rowLockSession = await startLockedSession(context,
      `BEGIN; SELECT id FROM public.resume_sites WHERE id='${ownerId}' FOR UPDATE;`, "RPC_SITE_ROW_LOCK_READY");
    try {
      const startedAt = Date.now();
      sqlFails(context, migration, /55P03|could not obtain lock on row/i, "NOWAIT against in-flight RPC row lock");
      assert.ok(Date.now() - startedAt < 2000, "NOWAIT migration attempt waited unexpectedly");
    } finally {
      await rowLockSession.release();
    }
    assert.deepEqual(snapshot(context), initial, "NOWAIT failure changed configuration, content, or events");
    console.log("PASS: FOR UPDATE NOWAIT fails promptly against the held site row; no deadlock or state change.");

    // A: run the exact checked-in migration against synthetic data.
    sqlOk(context, migration, "normal Owner activation migration");
    const afterActivation = snapshot(context);
    assertOwnerActivated(afterActivation);
    assertTestConfigUnchanged(initial, afterActivation);
    sameExceptOwnerActivation(initial, afterActivation);
    console.log("PASS: Owner three-domain RPC/trusted-context activation; Test config, content, Activity Log, and Restore unchanged/disabled.");

    // D: the one-shot activation is expected to reject a replay, and that
    // rejection must leave the successful state intact.
    sqlFails(context, migration, /Owner modes are not at the expected direct baseline/, "duplicate migration execution");
    assert.deepEqual(snapshot(context), afterActivation, "duplicate execution changed state");
    console.log("PASS: duplicate execution fails safely with no state change.");
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Owner activation runtime test failed.");
  process.exitCode = 1;
});
