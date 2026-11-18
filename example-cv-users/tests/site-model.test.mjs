import test from 'node:test';
import assert from 'node:assert/strict';
import {siteViewModel, validSiteSlug} from '../lib/site/model.ts';
import {readCurrentSiteStatus, readWithSiteAdapter} from '../lib/site/server.ts';
const account='verified-account-a', siteId='a1404a42-f2be-4d87-b863-2a79c8ff4a21';
const receipt=extra=>({version:1,accountId:account,complete:true,...extra});

test('default read stays closed; no network, credentials, site creation or false empty result',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('network must not be called')});
  assert.deepEqual(await readCurrentSiteStatus(account),{state:'unavailable',reason:'not-connected',source:'not-connected',creationEnabled:false});
});
test('only an explicit complete account-scoped empty receipt confirms no site',()=>{
  assert.equal(siteViewModel(receipt({state:'empty',sites:[]}),account,'synthetic').state,'empty');
  for(const value of [null,undefined,[],{}, {site:null},receipt({state:'ready',sites:[]}),receipt({state:'empty',sites:[],complete:false}),receipt({state:'empty',sites:[],accountId:'another-account'})])assert.equal(siteViewModel(value,account,'synthetic').state,'unavailable');
});
test('denied and revoked are distinct; raw upstream data is not projected',()=>{
  for(const state of ['denied','revoked'])assert.deepEqual(siteViewModel(receipt({state,sites:[{siteId}],secret:'DO_NOT_PROJECT'}),account,'synthetic'),{state,source:'synthetic',creationEnabled:false});
});
test('owned projection retains trusted site_id and strips unrecognized privileges and URLs',()=>{
  const vm=siteViewModel(receipt({state:'ready',sites:[{siteId,name:'Synthetic portfolio',slug:'synthetic-portfolio',contentLanguage:'en',publicUrl:'https://not-real.invalid',owner:'hidden',canPublish:true}]}),account,'synthetic');
  assert.deepEqual(vm,{state:'ready',source:'synthetic',creationEnabled:false,sites:[{siteId,name:'Synthetic portfolio',slug:'synthetic-portfolio',contentLanguage:'en'}]});
});
test('invalid IDs, slugs and account capacity never become a selectable website',()=>{
  for(const site of [{siteId:'slug-is-not-identity'},{siteId,slug:'https://unsafe.invalid'},{siteId,contentLanguage:'fr'},{siteId,name:'x'.repeat(81)}])assert.equal(siteViewModel(receipt({state:'ready',sites:[site]}),account,'synthetic').state,'unavailable');
  assert.equal(siteViewModel(receipt({state:'ready',sites:[{siteId},{siteId}]}),account,'synthetic').state,'unavailable');
  assert.equal(siteViewModel(receipt({state:'empty',sites:[{siteId}]}),account,'synthetic').state,'unavailable');
});
test('adapter exceptions, wrong account, partial and malformed receipts cannot be downgraded to empty',async()=>{
  for(const reader of [async()=>{throw Error('upstream private error')},async()=>null,async()=>receipt({state:'empty',sites:[],accountId:'another-account'})]) {
    const vm=await readWithSiteAdapter(account,{readForCurrentAccount:reader});assert.equal(vm.state,'unavailable');assert.ok(!JSON.stringify(vm).includes('private error'));
  }
});
test('receipt projection is copied so later adapter mutation cannot change the returned site',()=>{
  const raw=receipt({state:'ready',sites:[{siteId,name:'Original'}]}),vm=siteViewModel(raw,account,'synthetic');raw.sites[0].siteId='replaced';assert.equal(vm.sites[0].siteId,siteId);
});
test('slug check is syntax only, bounded, candidate-compatible and rejects reserved names',()=>{
  for(const value of ['ab','Upper','-abc','abc-','1abc','admin','api','support','x'.repeat(49),'https://host.invalid','has space'])assert.equal(validSiteSlug(value),false,value);
  for(const value of ['abc','my-portfolio','x'.repeat(48)])assert.equal(validSiteSlug(value),true,value);
});
