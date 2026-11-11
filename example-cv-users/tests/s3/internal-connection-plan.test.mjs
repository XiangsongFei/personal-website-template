import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHba, connectionPlan, hbaObservationSql, privatePostgrestPlan, serviceObservationSql
} from './internal-connection-plan.mjs';
import { privateOrigin, registrarHost } from './fixtures/binding.mjs';

const api='ecv_s3_internal_api_login', registration='ecv_s3_registration_login';
const source='172.30.22.18'; // synthetic planner input; no real client address is frozen
const row=(n,mode,changes={})=>({n,link:'exact',db:'exact',principal:'exact',
  address:mode==='peer'?'local':'exact',method_ok:true,...changes});
const receipt=(service,mode,changes={})=>({
  database:'postgres',service:service==='api'?api:registration,version:170011,mode,
  source:mode==='peer'?null:source,tls_enabled:mode==='tls',errors:0,total:1,
  rules:[row(1,mode)],...changes
});
for(const service of ['api','registration']) {
  for(const mode of ['peer','tls']) {
    test('fixed '+service+' '+mode+' descriptor depends on exact first rule and yields no live authorization',()=>{
      const addr=mode==='peer'?undefined:source;
      const r=receipt(service,mode);
      assert.equal(classifyHba(service,mode,addr,r).decision,'FILE_MATCH');
      const c=connectionPlan(service,mode,addr,r);
      assert.equal(c.scope,'PLAN_ONLY'); assert.equal(c.options.user,r.service);
      assert.equal(c.options.dbname,'postgres');assert.equal(c.options.passfile,'/dev/null');
      assert.equal(c.options.port,5432); assert.ok(Object.isFrozen(c.options));
      assert.ok(!('password' in c.options));
      if(mode==='peer'){
        assert.equal(c.options.host,'/var/run/postgresql');
        assert.equal(c.options.requirepeer,'postgres');assert.ok(!('sslmode' in c.options));
      } else {
        assert.equal(c.options.host,registrarHost);assert.equal(c.options.sslmode,'verify-full');
        assert.equal(c.options.sslcertmode,'require');assert.equal(c.options.gssencmode,'disable');
        for(const field of ['sslcert','sslkey','sslrootcert'])
          assert.ok(c.options[field].startsWith('/run/ecv-s33-credentials/'+service+'/'));
      }
      const probe=serviceObservationSql(service,mode,addr);
      assert.ok(probe.startsWith('BEGIN READ ONLY;') && probe.endsWith('ROLLBACK;'));
      assert.ok(probe.includes("current_setting('role')='none'") && probe.includes("session_user='"+r.service+"'"));
      assert.ok(probe.includes(mode==='peer' ? "SYSTEM_USER='peer:"+r.service+"'" : "s.client_dn='/CN="+r.service+"'"));
    });
  }
}
for(const [label,patch] of Object.entries({
  namespace:{database:'other'},other_role:{service:api},other_ip:{source:'172.30.22.19'},
  release:{version:170010},parse_error:{errors:1},unobserved:{tls_enabled:null},partial:{total:3},
  gap:{rules:[row(2,'tls')]},untyped:{rules:[row(1,'tls',{method_ok:1})]},
  trailing_gap:{total:2,rules:[row(1,'tls'),row(3,'tls')]},method:{rules:[row(1,'tls',{method_ok:false})]},
  trust_before:{total:2,rules:[row(1,'tls',{method_ok:false}),row(2,'tls')]},
  broad_cidr:{rules:[row(1,'tls',{address:'broad'})]},broad_role:{rules:[row(1,'tls',{principal:'broad'})]},
  no_match:{rules:[row(1,'tls',{principal:'miss'})]},disk_or_mapping_uncertain:{rules:[row(1,'tls',{principal:'unknown'})]},
  ssl_off:{tls_enabled:false}
})) {
  test('a safe plan refuses '+label,()=>{
    const r=receipt('registration','tls',patch);
    assert.notEqual(classifyHba('registration','tls',source,r).decision,'FILE_MATCH');
    assert.throws(()=>connectionPlan('registration','tls',source,r));
  });
}
test('known earlier nonmatch may be skipped; unresolved possible first match stops',()=>{
  const inspect=(first)=>classifyHba('registration','peer',undefined,receipt('registration','peer',{
    total:2,rules:[row(1,'peer',first),row(2,'peer')]}));
  assert.deepEqual(inspect({principal:'miss',link:'unknown'}),
    {decision:'FILE_MATCH',reason:'EXACT_RULE_REQUIRES_LIVE_CONFIRMATION',firstRule:2});
  assert.equal(inspect({principal:'unknown'}).decision,'UNKNOWN');
  assert.equal(inspect({principal:'broad'}).decision,'BLOCKED');
});
test('invalid sources, external modes and privileged roles cannot enter the SQL text',()=>{
  for(const svc of ['postgres','authenticated','ecv_s3_proof_registrar','__proto__'])
    assert.throws(()=>hbaObservationSql(svc,'peer'));
  for(const addr of ['localhost','172.1.2.3','127.0.0.1','192.168.0.1,192.168.0.2','/var/run/postgresql','1.2.3.4','a; SELECT'])
    assert.throws(()=>hbaObservationSql('api','tls',addr));
  for(const mode of ['disable','prefer','require','peer']) assert.throws(()=>serviceObservationSql('api',mode,source));
});
test('privileged HBA observer projects scope and option presence without emitting options or secrets',()=>{
  const text=hbaObservationSql('registration','tls',source);
  assert.ok(text.startsWith('BEGIN READ ONLY;') && text.endsWith('ROLLBACK;'));
  assert.match(text,/coalesce\(cardinality\(options\),0\)=0/);
  assert.match(text,/ORDER BY n/);assert.match(text,/FROM h WHERE error IS NOT NULL/);
  assert.ok(!/rolpassword|pg_read_file|pg_reload_conf|SET ROLE|file_name|WHERE error IS NULL LIMIT/.test(text));
  assert.ok(!/auth\.users|auth\.sessions|register_business_ticket/.test(text));
});
test('private PostgREST plan always uses user service identity, required peer and isolated URL',()=>{
  assert.throws(()=>privatePostgrestPlan('peer',undefined,receipt('registration','peer')));
  for(const mode of ['tls','peer']){
    const cfg=privatePostgrestPlan(mode,mode==='peer'?undefined:source,receipt('api',mode));
    assert.equal(cfg.PGRST_DB_SCHEMAS,'site_api');
    assert.equal(cfg.PGRST_SERVER_UNIX_SOCKET,'/run/ecv-s33a-internal/postgrest.sock');
    assert.equal(cfg.PGRST_SERVER_UNIX_SOCKET_MODE,'660');
    assert.equal(cfg.PGRST_DB_CONFIG,'false');assert.equal(cfg.PGRST_DB_POOL_AUTOMATIC_RECOVERY,'false');
    assert.equal(cfg.PGRST_JWT_AUD,'authenticated');assert.equal(cfg.PGRST_OPENAPI_MODE,'disabled');
    const opts=new URL(cfg.PGRST_DB_URI).searchParams;
    assert.equal(opts.get('user'),api);assert.equal(opts.get('port'),'5432');
    assert.ok(!opts.has('password'));assert.ok(!cfg.PGRST_DB_ANON_ROLE);
    assert.ok(!JSON.stringify(cfg).includes(privateOrigin));
    assert.equal(opts.get('sslmode'),mode==='tls'?'verify-full':null);
    assert.equal(opts.get('requirepeer'),mode==='peer'?'postgres':null);
  }
});
