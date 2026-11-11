import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessBinding,businessBinding} from '../../lib/business/binding.mjs';
import {createRpcRepository} from '../../lib/business/repository.mjs';
import {assertPrivateSocket,startPrivateRpcService,privateRpcPreflight,handlePrivateRpc} from '../../lib/business/private-ingress.node.mjs';
const input={project:'delivery-fixture',authIssuer:'https://auth.fixture.invalid/auth/v1',privateOrigin:'https://api.fixture.invalid:9443',registrarHost:'pg.fixture.invalid'};
test('no implicit project and no request-shaped binding can enable a repository',async()=>{
 assert.throws(()=>createBusinessBinding(),{code:'NOT_CONFIGURED'});
 assert.equal(businessBinding(Object.freeze(input)),undefined);
 await assert.rejects(createRpcRepository({enabled:true,binding:Object.freeze(input)}).mine({}),{code:'NOT_CONFIGURED'});
});
test('server scope is immutable and preserves exact private authority',()=>{
 const value=createBusinessBinding(input);assert(Object.isFrozen(value));assert.equal(value.privateAuthority,'api.fixture.invalid:9443');assert.equal(value.privateOrigin,input.privateOrigin);
 assert.throws(()=>createBusinessBinding({...input,authIssuer:'http://untrusted.invalid/auth/v1'}),{code:'NOT_CONFIGURED'});
 for(const bad of ['https://u:p@api.fixture.invalid','https://api.fixture.invalid/path','https://api.fixture.invalid?q=x'])assert.throws(()=>createBusinessBinding({...input,privateOrigin:bad}),{code:'NOT_CONFIGURED'});
});
const info=(dir,changes={})=>({uid:100,gid:1000,mode:dir?0o770:0o660,dev:1,ino:dir?1:2,isSymbolicLink:()=>false,isDirectory:()=>dir,isSocket:()=>!dir,...changes});
test('read-only private UDS startup accepts only exact owner, mode and stable inode',async()=>{
 const value=createBusinessBinding(input),policy={uid:100,gid:1000};
 await assertPrivateSocket(value,policy,async path=>info(!path.endsWith('.sock')));
 for(const changes of [{uid:999},{mode:0o777},{isSymbolicLink:()=>true}])await assert.rejects(assertPrivateSocket(value,policy,async path=>info(!path.endsWith('.sock'),changes)),{code:'PRIVATE_SOCKET_UNSAFE'});
 let calls=0;await assert.rejects(assertPrivateSocket(value,policy,async path=>info(!path.endsWith('.sock'),{ino:++calls})),{code:'PRIVATE_SOCKET_UNSAFE'});
 await assert.rejects(startPrivateRpcService({binding:value}),{code:'NOT_CONFIGURED'});
});

test('private service checks and uses one snapshot despite mutation during lstat',async()=>{
 const first=createBusinessBinding(input),second=createBusinessBinding({...input,privateOrigin:'https://other.fixture.invalid',socketPath:'/run/other/postgrest.sock'});
 const policy={uid:100,gid:1000},options={enabled:true,binding:first,peerPolicy:policy,listenHost:'fixture-host',listenPort:9443,tls:{ca:'first-ca',cert:'first-cert',key:'first-key'},identity:{},trustedFingerprint:'first-fingerprint'};const paths=[];
 const config=await privateRpcPreflight(options,async path=>{paths.push(path);options.binding=second;options.tls={ca:'wrong',cert:'wrong',key:'wrong'};options.listenPort=9999;policy.uid=999;return info(!path.endsWith('.sock'));});
 assert(paths.every(p=>!p.startsWith('/run/other')));assert.equal(config.binding,first);assert.equal(config.tls.key,'first-key');assert.equal(config.listenPort,9443);assert.equal(config.peerPolicy.uid,100);assert(Object.isFrozen(config));
});
