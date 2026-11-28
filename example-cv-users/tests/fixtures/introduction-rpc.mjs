// In-memory transaction model behind the built Worker. No network or database.
import assert from 'node:assert/strict';
import {initialTextPublication, planTextPublication, readTextPublicationOperation} from '../../lib/business/text-publication.mjs';
import {BusinessError} from '../../lib/business/protocol.mjs';
import {runtime} from '../runtime.mjs';
import {realAuthority, TEST_KEY, TEST_ORIGIN} from '../auth-fixture.mjs';

const save = 'save_text_draft';
const lookup = 'read_text_publication_operation';
const siteIds = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'];
const recordIds = ['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'];

export async function introductionRuntime({port, enabled = true, origin = TEST_ORIGIN, receiptRecovery = false} = {}) {
  const auth = await realAuthority();
  const accounts = [auth.ids.A, auth.ids.B];
  const sites = new Map(await Promise.all(accounts.map(async (uid, i) => [
    uid, await initialTextPublication({site_id: siteIds[i], owner_uid: uid, payload: {schema_version: 1, entries: [
      {id: recordIds[i], position: 0, translations: i === 0 ?
        {zh: '请填写个人介绍。', en: 'Add your introduction.'} : {zh: '合成乙', en: 'Synthetic B'}},
    ]}}),
  ])));
  const controls = {denied: new Set(), readsFail: false, rollback: false, lost: false, corrupt: false, normalize: false, delay: 0};
  const hits = [];
  let writes = Promise.resolve();
  async function rpc(request) {
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://users.draft.example.invalid');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.has('Cookie'), false);
    const operation = url.pathname.replace('/rpc/', '');
    const principal = auth.principal(request);
    if (!principal || controls.denied.has(principal.id)) return Response.json({code: '42501'}, {status:403});
    const who = {uid: principal.id, sid: principal.sid};
    const args = await request.json();
    hits.push({operation, who, args});
    const site = sites.get(who.uid);
    if (operation === 'get_my_site') {
      if (controls.readsFail) return Response.json({code:'UNAVAILABLE'}, {status:503});
      return Response.json({schema_version: 1, site: site ? {id: site.site_id, draft_revision: site.draft_revision} : null,
        capabilities: {read: true, edit: false, publish: false}});
    }
    if (!site || args.target !== site.site_id) return Response.json({code: '42501'}, {status:403});
    if (operation === 'read_introduction') {
      const entries = structuredClone(site.draft_revisions.at(-1).payload.entries);
      // Simulate a canonical response differing from input for the UI merge test.
      if (controls.normalize && site.draft_revision > 0) {
        for (const entry of entries) for (const locale of Object.keys(entry.translations))
          entry.translations[locale] = entry.translations[locale].trim();
      }
      return Response.json({schema_version: 1, site_id: site.site_id, section_revision: site.draft_revision,
        draft_revision: site.draft_revision, entries});
    }
    assert.ok([save, lookup].includes(operation));
    assert.equal(args.canonical_request, JSON.stringify({operation: save, ...args.input}));
    try {
      if (operation === lookup) {
        assert.equal(args.operation, save);
        const receipt = await readTextPublicationOperation(site, who, save, args.input);
        return Response.json(receipt.status === 'succeeded' ?
          {status: 'succeeded', result: receipt.result} : {status:'not_observed'});
      }
      const planned = writes.then(async () => {
        const plan = await planTextPublication(sites.get(who.uid), who, save, args.input, {now:1});
        if (controls.rollback) return Response.json({code:'FAULT'}, {status:503});
        sites.set(who.uid, plan.next);
        if (controls.delay) await new Promise(resolve => setTimeout(resolve, controls.delay));
        if (controls.lost || (controls.loseFor !== undefined && args.input.payload.entries[0]?.translations.zh === controls.loseFor)) {
          controls.lost = false;
          delete controls.loseFor;
          return Response.json({code:'RESULT_UNKNOWN'}, {status:503});
        }
        return Response.json(controls.corrupt ? {...plan.result, request_id:crypto.randomUUID()} : plan.result);
      });
      writes = planned.catch(() => {});
      return await planned;
    } catch (error) {
      if (!(error instanceof BusinessError)) throw error;
      return Response.json({code: new Map([[409,'PT409'], [403,'42501'], [400,'22023']]).get(error.status)}, {status:error.status});
    }
  }
  async function receiptRpc(request){
    const url=new URL(request.url);
    assert.equal(url.origin,'https://users.resume.example.invalid');
    const actor=auth.principal(request);
    if(!actor||controls.denied.has(actor.id))return Response.json({code:'42501'},{status:403});
    const site=sites.get(actor.id);
    if(url.pathname==='/rpc/get_my_site')return Response.json({schema_version:1,site:{id:site.site_id}});
    const {target,operation_id,request_digest,basis,section_key}=await request.json();
    if(site?.site_id!==target)return Response.json({code:'42501'},{status:403});
    if(url.pathname==='/rpc/read_resume_text' && section_key==='site-text')
      return Response.json({siteId:target,section:section_key,revision:0,content:null});
    assert.equal(url.pathname,'/rpc/read_introduction_receipt');
    const operation=site.operations.find(o=>o.request_id===operation_id&&o.actor_uid===actor.id&&o.actor_sid===actor.sid&&o.state==='succeeded');
    if(!operation)return Response.json({state:'unknown'});
    if(operation.payload_digest!==request_digest||operation.basis.draft_revision!==basis)
      return Response.json({code:'PT409'},{status:409});
    const revision=operation.result.draft_revision;
    const history=site.draft_revisions.find(r=>r.site_revision===revision);
    return Response.json({state:'saved',requestId:operation_id,digest:request_digest,
      draft:{state:'ready',siteId:target,revision,record:history.payload.entries[0]??null}});
  }
  const mf = runtime({
    ...(port === undefined ? {} : {port}), https:origin.startsWith('https:'),
    bindings: {USERS_CURRENT_PASSWORD_POLICY:'ON', USERS_MODE:'isolated', USERS_PROJECT_REF:'isolated-users',
      USERS_SUPABASE_URL:'https://users.auth.example.invalid', USERS_PUBLISHABLE_KEY:TEST_KEY, USERS_APP_ORIGIN:origin,
      ...(enabled ? {USERS_INTRODUCTION_MODE:'synthetic'} : {}),
      ...(receiptRecovery?{USERS_RESUME_TEXT_MODE:'synthetic'}:{})},
    serviceBindings:{USERS_INTRODUCTION_RPC:rpc,...(receiptRecovery?{USERS_RESUME_TEXT_RPC:receiptRpc}:{})}, outboundService:request=>auth.fetch(request),
  });
  return {mf, auth, jar:new Map(), sites, siteIds, recordIds, hits, controls};
}
