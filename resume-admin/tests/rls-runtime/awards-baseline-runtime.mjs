// TEST ONLY: exercises the Awards baseline/idempotency transaction contract
// in the disposable local Supabase project created by stage-local-supabase.
// It accepts no remote URL or Supabase credentials and uses synthetic QA IDs.
/* global console, process, TextEncoder */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { withStagedLocalSupabase } from "./stage-local-supabase.mjs";

const testResumeId = "ea111111-1111-4111-8111-111111111111";
const testActorId = "10000000-0000-4000-8000-000000000002";
const awardId = "a3000000-0000-4000-8000-000000000091";
const secondAwardId = "a3000000-0000-4000-8000-000000000092";
const firstRequestId = "a4000000-0000-4000-8000-000000000091";
const staleRequestId = "a4000000-0000-4000-8000-000000000092";
const concurrentRequestId = "a4000000-0000-4000-8000-000000000093";
const deleteRequestId = "a4000000-0000-4000-8000-000000000094";
const forgedProofRequestId = "a4000000-0000-4000-8000-000000000095";

function psqlArgs(context) {
  assert.match(context.projectId, /^pr1-[0-9]+-[a-f0-9]+$/, "must use this run's disposable project");
  assert.match(context.dbContainer, new RegExp(`^supabase_db_${context.projectId.replaceAll("-", "[-_]")}`));
  return ["exec", "-i", context.dbContainer, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
}

function runSql(context, text, expectedStatus = 0) {
  const result = spawnSync("docker", psqlArgs(context), { input: text, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) throw new Error(`Disposable PostgreSQL returned ${result.status}: ${result.stderr || result.stdout}`);
  return (result.stdout ?? "").trim();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function authenticatedSql(query) {
  return `SELECT set_config('request.jwt.claim.sub',${sqlLiteral(testActorId)},false);
SELECT set_config('request.jwt.claims',${sqlLiteral(JSON.stringify({ sub: testActorId, role: "authenticated", email: "test@example.invalid" }))},false);
${query}`;
}

function startSession(context, text, keepOpen = false) {
  const child = spawn("docker", psqlArgs(context), { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  if (keepOpen) child.stdin.write(text);
  else child.stdin.end(text);
  return { child, closed, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

const fixtureSql = `
BEGIN;
DELETE FROM public.resume_award_translations WHERE resume_id='${testResumeId}';
DELETE FROM public.resume_award_entries WHERE resume_id='${testResumeId}';
INSERT INTO public.resume_award_entries(id,resume_id,position,source_key)
VALUES ('${awardId}','${testResumeId}',0,NULL),('${secondAwardId}','${testResumeId}',1,NULL);
INSERT INTO public.resume_award_translations(award_entry_id,resume_id,locale,name,year) VALUES
 ('${awardId}','${testResumeId}','zh','合成奖项','2025'),
 ('${awardId}','${testResumeId}','en','Synthetic Award','2025'),
 ('${secondAwardId}','${testResumeId}','zh','第二个合成奖项','2024'),
 ('${secondAwardId}','${testResumeId}','en','Second Synthetic Award','2024');
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode)
 VALUES ('${testResumeId}','awards','rpc')
 ON CONFLICT (resume_id,domain_key) DO UPDATE SET write_mode=EXCLUDED.write_mode;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
 VALUES ('${testResumeId}','activity_log',true)
 ON CONFLICT (resume_id,capability_key) DO UPDATE SET enabled=EXCLUDED.enabled;
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
 VALUES ('${testResumeId}','awards','trusted_network_context_v11',true)
 ON CONFLICT (resume_id,domain_key,requirement_key) DO UPDATE SET enabled=EXCLUDED.enabled;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
 VALUES ('${testResumeId}','restore',false)
 ON CONFLICT (resume_id,capability_key) DO UPDATE SET enabled=EXCLUDED.enabled;
COMMIT;

CREATE FUNCTION public.test_only_awards_call(
  target_resume uuid,target_request uuid,target_awards jsonb,target_baseline_digest text,target_baseline_proof text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE canonical text; context_value jsonb; key_value bytea; signature_value text;
BEGIN
  canonical := target_awards::text;
  context_value := pg_catalog.jsonb_build_object(
    'context_version',1,'key_id','activity_log_v11_hmac_v1','actor_user_id',(SELECT auth.uid())::text,
    'resume_id',target_resume::text,'domain','awards','operation','update','request_id',target_request::text,
    'mutation_digest',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(canonical,'UTF8'),'sha256'),'hex'),
    'expected_baseline_digest',target_baseline_digest,'baseline_proof',target_baseline_proof,
    'issued_at',pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint,
    'expires_at',pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint+300,
    'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL);
  key_value := cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
  signature_value := pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(context_value::text,'UTF8'),key_value,'sha256'),'hex');
  RETURN public.save_resume_awards_v1(target_resume,canonical,target_baseline_digest,target_baseline_proof,context_value::text,signature_value);
END
$function$;
REVOKE ALL ON FUNCTION public.test_only_awards_call(uuid,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
`;

function readState(context) {
  const raw = runSql(context, authenticatedSql(`SELECT pg_catalog.jsonb_build_object(
    'snapshot',awards_snapshot,'digest',awards_baseline_digest,'proof',awards_baseline_proof
  )::text FROM public.load_admin_awards_write_state('${testResumeId}');`));
  return JSON.parse(raw.split(/\r?\n/).at(-1));
}

function callExpression(requestId, payload, baseline) {
  return `SELECT public.test_only_awards_call('${testResumeId}','${requestId}',${sqlLiteral(JSON.stringify(payload))}::jsonb,
    '${baseline.digest}','${baseline.proof}')::text;`;
}

function eventCount(context) {
  const raw = runSql(context, `SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id='${testResumeId}' AND section_key='awards';`);
  return Number(raw);
}

function idempotencyCount(context) {
  return Number(runSql(context, `SELECT count(*) FROM cms_private.activity_log_idempotency
    WHERE resume_id='${testResumeId}' AND domain_key='awards';`));
}

function idempotencyResult(context, requestId) {
  const raw = runSql(context, `SELECT result_payload::text FROM cms_private.activity_log_idempotency
    WHERE actor_user_id='${testActorId}' AND resume_id='${testResumeId}' AND domain_key='awards' AND request_id='${requestId}';`);
  return JSON.parse(raw);
}

async function main() {
  await withStagedLocalSupabase(async (context, supabase) => {
    console.log(`Starting Awards transaction checks in disposable project ${context.projectId}.`);
    supabase(["db", "reset", "--local"]);
    console.log(`PostgreSQL ${runSql(context, "SHOW server_version;")}`);
    runSql(context, fixtureSql);
    const initial = readState(context);
    assert.equal(initial.snapshot.length, 2);
    assert.equal(initial.snapshot[0].id, awardId);
    assert.match(initial.digest, /^[a-f0-9]{64}$/);
    assert.match(initial.proof, /^[a-f0-9]{64}$/);
    assert.equal(eventCount(context), 0);

    const firstPayload = [
      { ...initial.snapshot[1], position: 0, en: { name: "Second Synthetic Award Updated", year: "2024" } },
      { ...initial.snapshot[0], position: 1, zh: { name: "合成奖项（已更新）", year: "2025" } },
      { id: null, position: 2, zh: { name: "新增合成奖项", year: "2026" }, en: { name: "Added Synthetic Award", year: "2026" } },
    ];
    const firstOutput = runSql(context, authenticatedSql(callExpression(firstRequestId, firstPayload, initial)));
    const firstResult = JSON.parse(firstOutput.split(/\r?\n/).at(-1));
    assert.equal(firstResult.awards.length, 3, "the full save must retain both existing Awards and the one added Award");
    assert.deepEqual(firstResult.awards[0], {
      id: secondAwardId,
      position: 0,
      zh: { name: "第二个合成奖项", year: "2024" },
      en: { name: "Second Synthetic Award Updated", year: "2024" },
    }, "the first existing Award must be reordered and retain its exact bilingual values");
    assert.deepEqual(firstResult.awards[1], {
      id: awardId,
      position: 1,
      zh: { name: "合成奖项（已更新）", year: "2025" },
      en: { name: "Synthetic Award", year: "2025" },
    }, "the second existing Award must retain identity while its Chinese value changes");
    assert.match(firstResult.awards[2].id, /^[0-9a-f-]{36}$/i, "the new Award must receive a server UUID");
    assert.ok(![awardId, secondAwardId].includes(firstResult.awards[2].id), "the new Award must not reuse an existing ID");
    assert.deepEqual(firstResult.awards[2], {
      id: firstResult.awards[2].id,
      position: 2,
      zh: { name: "新增合成奖项", year: "2026" },
      en: { name: "Added Synthetic Award", year: "2026" },
    }, "the newly created Award must preserve its exact bilingual values and final order");
    assert.deepEqual(Object.keys(firstResult).sort(), ["awards", "baseline_digest", "baseline_proof"]);
    assert.ok(Array.isArray(idempotencyResult(context, firstRequestId)), "idempotency storage must use the database JSON-array contract");
    const storedResult = idempotencyResult(context, firstRequestId);
    assert.equal(storedResult.length, 1, "Awards idempotency result must contain exactly one response envelope");
    assert.deepEqual(storedResult[0], firstResult, "stored array element must preserve the public top-level response object");
    assert.ok(new TextEncoder().encode(JSON.stringify(firstResult)).byteLength <= 8192, "public response must stay within its byte limit");
    assert.ok(new TextEncoder().encode(JSON.stringify(storedResult)).byteLength <= 8192, "stored response array must stay within the Writer byte limit");
    assert.ok(new TextEncoder().encode(JSON.stringify(storedResult)).byteLength <= 393216, "stored response array must satisfy the database bound");
    assert.equal(eventCount(context), 1, "one logical change must emit exactly one Activity Log event");
    const committedState = readState(context);
    assert.deepEqual(committedState.snapshot, firstResult.awards);

    const replayOutput = runSql(context, authenticatedSql(callExpression(firstRequestId, firstPayload, initial)));
    const replay = JSON.parse(replayOutput.split(/\r?\n/).at(-1));
    assert.deepEqual(replay, firstResult, "exact retry must return the original committed result");
    assert.equal(eventCount(context), 1, "idempotent retry must not emit a duplicate event");
    assert.equal(idempotencyCount(context), 1, "same request must retain exactly one idempotency row");
    assert.equal(runSql(context, `SELECT count(*) FROM public.resume_award_entries WHERE resume_id='${testResumeId}';`), "3",
      "retry must not create a duplicate award entry");
    assert.deepEqual(readState(context).snapshot, committedState.snapshot, "idempotent retry must not rewrite content");
    console.log("PASS: successful save, null-to-UUID create, exact response-loss replay, one event.");

    const deletionBaseline = readState(context);
    const deletionPayload = deletionBaseline.snapshot
      .filter((row) => row.id !== secondAwardId)
      .map((row, position) => ({ ...row, position }));
    const deletionOutput = runSql(context, authenticatedSql(callExpression(deleteRequestId, deletionPayload, deletionBaseline)));
    const deletionResult = JSON.parse(deletionOutput.split(/\r?\n/).at(-1));
    assert.equal(deletionResult.awards.length, 2, "delete request must leave exactly two records");
    assert.ok(deletionResult.awards.every((row) => row.id !== secondAwardId), "deleted award must not remain");
    assert.equal(eventCount(context), 2, "delete/reorder/save must produce one additional event");
    console.log("PASS: deletion and position normalization are recorded as one logical change.");

    const proofBaseline = readState(context);
    const forgedProofAttempt = runSql(context, authenticatedSql(callExpression(forgedProofRequestId, proofBaseline.snapshot,
      { ...proofBaseline, proof: "0".repeat(64) })), 3);
    assert.match(forgedProofAttempt, /Invalid signed Awards request/);
    assert.equal(idempotencyCount(context), 2, "untrusted client replacement of the baseline proof must not reserve a request");
    assert.equal(eventCount(context), 2, "untrusted baseline proof must not write an event");
    assert.deepEqual(readState(context).snapshot, proofBaseline.snapshot, "untrusted baseline proof must not change content");
    console.log("PASS: client-forged baseline proof is rejected without content, event, or idempotency writes.");

    const staleBaseline = readState(context);
    const stalePayload = staleBaseline.snapshot.map((row, index) => index === 0
      ? { ...row, zh: { ...row.zh, name: "stale request must not win" } } : row);
    runSql(context, `UPDATE public.resume_award_translations SET name='concurrent synthetic edit'
      WHERE resume_id='${testResumeId}' AND award_entry_id='${awardId}' AND locale='zh';`);
    const eventsBeforeStale = eventCount(context);
    const staleAttempt = runSql(context, authenticatedSql(callExpression(staleRequestId, stalePayload, staleBaseline)), 3);
    assert.match(staleAttempt, /Awards baseline changed since the request was created/);
    assert.equal(eventCount(context), eventsBeforeStale, "stale baseline failure must not create an event");
    assert.equal(idempotencyCount(context), 2, "stale baseline failure must roll back without reserving the request ID");
    assert.equal(readState(context).snapshot[0].zh.name, "concurrent synthetic edit", "stale request must not overwrite the concurrent update");

    const oldReplayOutput = runSql(context, authenticatedSql(callExpression(firstRequestId, firstPayload, initial)));
    const oldReplayAfterConcurrentEdit = JSON.parse(oldReplayOutput.split(/\r?\n/).at(-1));
    assert.deepEqual(oldReplayAfterConcurrentEdit, firstResult, "committed exact retry remains idempotent after a later edit");
    assert.equal(eventCount(context), eventsBeforeStale, "old committed retry must not add another event");
    assert.equal(readState(context).snapshot[0].zh.name, "concurrent synthetic edit", "old committed retry must not restore stale content");
    console.log("PASS: stale uncommitted request fails closed; committed retry cannot overwrite later content.");

    const concurrencyBaseline = readState(context);
    const concurrencyPayload = concurrencyBaseline.snapshot.map((row, index) => index === 0
      ? { ...row, en: { ...row.en, name: "must fail after concurrent edit" } } : row);
    const holder = startSession(context, `BEGIN;
SELECT id FROM public.resume_sites WHERE id='${testResumeId}' FOR UPDATE;
UPDATE public.resume_award_translations SET name='lock-holder synthetic edit'
 WHERE resume_id='${testResumeId}' AND award_entry_id='${awardId}' AND locale='en';
SELECT 'AWARDS_ROW_LOCK_READY';
`);
    const deadline = Date.now() + 5000;
    while (!holder.stdout.includes("AWARDS_ROW_LOCK_READY")) {
      if (Date.now() > deadline) { holder.child.kill("SIGKILL"); throw new Error(`Timed out acquiring disposable target row lock: ${holder.stderr}`); }
      const closed = await Promise.race([holder.closed.then((value) => value), delay(20).then(() => null)]);
      if (closed) throw new Error(`Lock holder exited before acquiring the test lock: ${closed.stderr}`);
    }
    const writer = startSession(context, authenticatedSql(callExpression(concurrentRequestId, concurrencyPayload, concurrencyBaseline)));
    try {
      const early = await Promise.race([writer.closed.then((value) => value), delay(250).then(() => null)]);
      assert.equal(early, null, "writer should wait on the target lock instead of bypassing it");
    } finally {
      holder.child.stdin.end("COMMIT;\n\\q\n");
      const holderResult = await holder.closed;
      assert.equal(holderResult.code, 0, `lock holder failed: ${holderResult.stderr}`);
    }
    const writerResult = await Promise.race([
      writer.closed,
      delay(5000).then(() => { writer.child.kill("SIGKILL"); throw new Error("writer timed out after target lock release (possible deadlock)"); }),
    ]);
    assert.notEqual(writerResult.code, 0, "writer with a stale baseline unexpectedly committed");
    assert.match(writerResult.stderr, /Awards baseline changed since the request was created/);
    assert.equal(eventCount(context), eventsBeforeStale, "concurrent stale request must not create an event");
    assert.equal(idempotencyCount(context), 2, "concurrent stale failure must not leave an idempotency row");
    assert.equal(readState(context).snapshot[0].en.name, "lock-holder synthetic edit");
    console.log("PASS: target lock serializes concurrent write; stale CAS fails promptly without deadlock or event.");

    const config = runSql(context, `SELECT jsonb_build_object(
      'mode',cms_private.get_resume_write_mode('${testResumeId}','awards'),
      'trusted',(SELECT enabled FROM cms_private.resume_domain_requirements WHERE resume_id='${testResumeId}' AND domain_key='awards' AND requirement_key='trusted_network_context_v11'),
      'activity',(SELECT enabled FROM cms_private.resume_capabilities WHERE resume_id='${testResumeId}' AND capability_key='activity_log'),
      'restore',(SELECT enabled FROM cms_private.resume_capabilities WHERE resume_id='${testResumeId}' AND capability_key='restore'))::text;`);
    assert.deepEqual(JSON.parse(config), { mode: "rpc", trusted: true, activity: true, restore: false });
    console.log("PASS: only synthetic Test Awards configuration used; Restore remains disabled.");
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
