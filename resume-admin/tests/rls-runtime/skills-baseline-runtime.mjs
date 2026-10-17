// TEST ONLY: PostgreSQL lock/CAS proof for Skills, using this run's disposable local Supabase project.
/* global console */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { withStagedLocalSupabase } from "./stage-local-supabase.mjs";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const actorId = "10000000-0000-4000-8000-000000000002";
const skillId = "a5000000-0000-4000-8000-000000000091";
const requestId = "a6000000-0000-4000-8000-000000000091";

function args(ctx) {
  assert.match(ctx.projectId, /^pr1-[0-9]+-[a-f0-9]+$/);
  assert.match(ctx.dbContainer, new RegExp(`^supabase_db_${ctx.projectId.replaceAll("-", "[-_]")}`));
  return ["exec", "-i", ctx.dbContainer, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
}
function sql(ctx, input) {
  const r = spawnSync("docker", args(ctx), { input, encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (r.status !== 0) throw new Error(`Disposable PostgreSQL failed (${r.status}): ${r.stderr || r.stdout}`);
  return (r.stdout || "").trim();
}
function session(ctx, input, hold = false) {
  const child = spawn("docker", args(ctx), { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", x => { stdout += x; });
  child.stderr.setEncoding("utf8").on("data", x => { stderr += x; });
  const closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr })));
  if (hold) child.stdin.write(input); else child.stdin.end(input);
  return { child, closed, get stdout() { return stdout; } };
}
function auth(q) {
  return `SELECT set_config('request.jwt.claim.sub','${actorId}',false);\nSELECT set_config('request.jwt.claims','{"sub":"${actorId}","role":"authenticated","email":"test@example.invalid"}',false);\n${q}`;
}
function quote(s) { return `'${String(s).replaceAll("'", "''")}'`; }
function baseline(ctx) {
  const out = sql(ctx, auth(`SELECT jsonb_build_object('digest',skills_baseline_digest,'proof',skills_baseline_proof,'snapshot',skills_snapshot)::text FROM public.load_admin_skills_write_state('${resumeId}');`));
  return JSON.parse(out.split(/\r?\n/).at(-1));
}
function call(ctx, req, payload, base) {
  const canonical = JSON.stringify(payload);
  // PostgreSQL receives the exact canonical payload text and the helper signs its matching digest.
  const sqlBody = `SELECT public.test_only_skills_writer('${resumeId}','${req}',${quote(canonical)}::text,'${base.digest}','${base.proof}')::text;`;
  return auth(sqlBody);
}
const fixture = `
BEGIN;
DELETE FROM public.resume_skill_group_translations WHERE resume_id='${resumeId}';
DELETE FROM public.resume_skill_groups WHERE resume_id='${resumeId}';
INSERT INTO public.resume_skill_groups(id,resume_id,source_key,position) VALUES ('${skillId}','${resumeId}',NULL,0);
INSERT INTO public.resume_skill_group_translations(skill_group_id,resume_id,locale,title,items) VALUES
 ('${skillId}','${resumeId}','zh','语言','中文'),('${skillId}','${resumeId}','en','Languages','English');
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode) VALUES ('${resumeId}','skills','rpc')
 ON CONFLICT(resume_id,domain_key) DO UPDATE SET write_mode='rpc';
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled) VALUES ('${resumeId}','activity_log',true)
 ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=true;
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
 VALUES ('${resumeId}','skills','trusted_network_context_v11',true)
 ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled) VALUES ('${resumeId}','restore',false)
 ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=false;
COMMIT;
CREATE FUNCTION public.test_only_skills_writer(target_resume uuid,target_request uuid,target_payload text,target_digest text,target_proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE ctx jsonb; signed text; signature text; key bytea;
BEGIN
 ctx:=jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1','actor_user_id',auth.uid()::text,
 'resume_id',target_resume::text,'domain','skills','operation','update','request_id',target_request::text,
 'mutation_digest',encode(extensions.digest(convert_to(target_payload,'UTF8'),'sha256'),'hex'),
 'expected_baseline_digest',target_digest,'baseline_proof',target_proof,'issued_at',floor(date_part('epoch',clock_timestamp()))::bigint,
 'expires_at',floor(date_part('epoch',clock_timestamp()))::bigint+240,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL);
 signed:=ctx::text; key:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
 signature:=encode(extensions.hmac(convert_to(signed,'UTF8'),key,'sha256'),'hex');
 RETURN public.save_resume_skills_v1(target_resume,target_payload,signed,signature);
END $function$;
REVOKE ALL ON FUNCTION public.test_only_skills_writer(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
`;

await withStagedLocalSupabase(async (ctx, supabase) => {
  console.log(`Starting Skills CAS concurrency checks in disposable project ${ctx.projectId}.`);
  supabase(["db", "reset", "--local"]);
  sql(ctx, fixture);
  const old = baseline(ctx);
  assert.equal(old.snapshot.length, 1);
  assert.match(old.digest, /^[a-f0-9]{64}$/);
  const stale = [{ ...old.snapshot[0], zh: { ...old.snapshot[0].zh, items: "stale" } }];
  const holder = session(ctx, `BEGIN; SELECT id FROM public.resume_sites WHERE id='${resumeId}' FOR UPDATE; UPDATE public.resume_skill_group_translations SET items='fresh concurrent edit' WHERE resume_id='${resumeId}' AND skill_group_id='${skillId}' AND locale='zh'; SELECT 'SKILLS_ROW_LOCK_READY';`, true);
  const deadline = Date.now() + 5000;
  while (!holder.stdout.includes("SKILLS_ROW_LOCK_READY")) {
    if (Date.now() > deadline) { holder.child.kill("SIGKILL"); throw new Error("Timed out acquiring Skills target lock."); }
    const done = await Promise.race([holder.closed, delay(20).then(() => null)]);
    if (done) throw new Error(`Skills lock-holder exited early: ${done.stderr}`);
  }
  const writer = session(ctx, call(ctx, requestId, stale, old));
  try {
    assert.equal(await Promise.race([writer.closed.then(x => x.code), delay(250).then(() => null)]), null,
      "writer must wait on the same target row lock");
  } finally {
    holder.child.stdin.end("COMMIT;\\q\n");
    const result = await holder.closed;
    assert.equal(result.code, 0, result.stderr);
  }
  const result = await Promise.race([writer.closed, delay(5000).then(() => { writer.child.kill("SIGKILL"); throw new Error("Skills writer timed out after lock release"); })]);
  assert.notEqual(result.code, 0, "stale Skills request unexpectedly committed");
  assert.match(result.stderr, /Skills baseline changed since the request was created/);
  assert.equal(sql(ctx, `SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id='${resumeId}' AND section_key='skills';`), "0");
  assert.equal(sql(ctx, `SELECT count(*) FROM cms_private.activity_log_idempotency WHERE resume_id='${resumeId}' AND domain_key='skills';`), "0");
  assert.equal(sql(ctx, `SELECT items FROM public.resume_skill_group_translations WHERE resume_id='${resumeId}' AND skill_group_id='${skillId}' AND locale='zh';`), "fresh concurrent edit");
  const config = JSON.parse(sql(ctx, `SELECT jsonb_build_object('restore',(SELECT enabled FROM cms_private.resume_capabilities WHERE resume_id='${resumeId}' AND capability_key='restore'),'mode',cms_private.get_resume_write_mode('${resumeId}','skills'))::text;`));
  assert.deepEqual(config, { restore: false, mode: "rpc" });
  console.log("PASS: two different request IDs sharing one baseline serialize; stale request rolls back without event or idempotency result.");
});
