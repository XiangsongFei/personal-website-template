#!/usr/bin/env python3
"""Read only this public certificate's three trust domains; never read keys."""
import ctypes as C
import hashlib,json,ssl,sys
from pathlib import Path
V=C.c_void_p; L=C.c_long; I=C.c_int32
cf=C.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
sec=C.CDLL('/System/Library/Frameworks/Security.framework/Security')
def fn(lib,name,result,args):
 f=getattr(lib,name);f.restype=result;f.argtypes=args;return f
gettype=fn(cf,'CFGetTypeID',C.c_ulong,[V])
stringtype=fn(cf,'CFStringGetTypeID',C.c_ulong,[])
arraytype=fn(cf,'CFArrayGetTypeID',C.c_ulong,[])
dicttype=fn(cf,'CFDictionaryGetTypeID',C.c_ulong,[])
numbertype=fn(cf,'CFNumberGetTypeID',C.c_ulong,[])
booltype=fn(cf,'CFBooleanGetTypeID',C.c_ulong,[])
strlen=fn(cf,'CFStringGetLength',L,[V])
strget=fn(cf,'CFStringGetCString',C.c_bool,[V,C.c_char_p,L,C.c_uint32])
arrlen=fn(cf,'CFArrayGetCount',L,[V])
arrget=fn(cf,'CFArrayGetValueAtIndex',V,[V,L])
dictlen=fn(cf,'CFDictionaryGetCount',L,[V])
dictget=fn(cf,'CFDictionaryGetKeysAndValues',None,[V,C.POINTER(V),C.POINTER(V)])
numget=fn(cf,'CFNumberGetValue',C.c_bool,[V,C.c_int,V])
boolget=fn(cf,'CFBooleanGetValue',C.c_bool,[V])
policytype=fn(sec,'SecPolicyGetTypeID',C.c_ulong,[])
policyprops=fn(sec,'SecPolicyCopyProperties',V,[V])
release=fn(cf,'CFRelease',None,[V])
def decode(value):
 t=gettype(value)
 if t==stringtype():
  buf=C.create_string_buffer(strlen(value)*4+1)
  if not strget(value,buf,len(buf),0x08000100):raise RuntimeError('cf_string_failed')
  return buf.value.decode('utf8')
 if t==arraytype():return [decode(arrget(value,i)) for i in range(arrlen(value))]
 if t==dicttype():
  n=dictlen(value);ks=(V*n)();vs=(V*n)();dictget(value,ks,vs)
  return {decode(k):decode(v) for k,v in zip(ks,vs)}
 if t==numbertype():
  n=C.c_int64()
  if not numget(value,4,C.byref(n)):raise RuntimeError('cf_number_failed')
  return n.value
 if t==booltype():return boolget(value)
 if t==policytype():
  props=policyprops(value)
  try:return {'policyProperties':decode(props)}
  finally:release(props)
 raise RuntimeError('unexpected_trust_metadata_type')

import subprocess,re,datetime,os
# Public pins and fixed package-local material; never infer a certificate from Keychain.
import re, os
ROOT=Path(__file__).resolve().parents[2]
POLICY=json.loads((ROOT/'scripts/https/policy.json').read_text())
EXPECTED=POLICY['serverCertificateSha256']
def bound_run(value):
 if not re.fullmatch(r'[A-Za-z0-9-]{8,80}',value):raise SystemExit('invalid_local_run_id')
 path=ROOT/'.runtime/https-trust'/value
 # Every existing component must belong to this user and may not be a symlink.
 for item in [ROOT,ROOT/'.runtime',ROOT/'.runtime/https-trust',path]:
  if item.exists() and (item.is_symlink() or item.stat().st_uid!=os.getuid() or not item.is_dir()):raise SystemExit('unsafe_local_run_directory')
 return path
if len(sys.argv)!=3:raise SystemExit('usage: leaf-trust-control.py MODE RUN_ID')
mode,run_id=sys.argv[1:]
BASE=bound_run(run_id)
CERT=ROOT/'.runtime/tls/server.crt'
KEYCHAIN=str(Path.home()/'Library/Keychains/login.keychain-db')
# Rollback is bound to saved PUBLIC bytes, never to a live private key or date.
def owned_file(path):
 st=path.lstat()
 assert not path.is_symlink() and path.is_file() and st.st_uid==os.getuid() and st.st_nlink==1 and st.st_mode & 0o077==0,'unsafe_snapshot_file'
 return path.read_bytes()
def strict_preflight():
 node=Path(os.environ.get('S2_VERIFIED_NODE','/invalid-not-configured')).resolve()
 assert node.is_file() and node.stat().st_uid==os.getuid() and hashlib.sha256(node.read_bytes()).hexdigest()==POLICY['nodeExecutableSha256'],'node_identity_digest_denied'
 preflight=subprocess.run([str(node),str(ROOT/'scripts/https/preflight.mjs'),'--certificate-only'],capture_output=True,text=True,timeout=10)
 if preflight.returncode:raise SystemExit('bound_certificate_preflight_failed')
def save_public(name,content):
 with (BASE/name).open('xb') as f:f.write(content)
 os.chmod(BASE/name,0o600)
if mode not in ('snapshot','plan','install','inspect','restore','verify-restored'):raise SystemExit('unsupported_mode')
if mode in ('snapshot','plan','install'):strict_preflight()
if mode=='snapshot':
 if BASE.exists():raise SystemExit('run_already_exists')
 der=ssl.PEM_cert_to_DER_cert(CERT.read_text())
 assert hashlib.sha256(der).hexdigest().upper()==EXPECTED,'certificate_fingerprint_mismatch'
 BASE.mkdir(parents=True,mode=0o700)
 os.chmod(BASE.parent,0o700)
 # The strict Node preflight above proves non-CA, SAN, EKU, validity and private-key file protections.
 save_public('server.pem',ssl.DER_cert_to_PEM_cert(der).encode('ascii'))
 save_public('server.der',der)
 binding={'schema':2,'uid':os.getuid(),'leafSha256':EXPECTED,'caSha256':POLICY['issuerCertificateSha256'],'publicLeafCountInLoginKeychain':0,'originalDomains':{n:{'status':-25300,'settings':None} for n in ('user','admin','system')},'snapshotVerifiedNonCA':True,'scope':'current-user SSL exact-leaf'}
else:
 binding=json.loads(owned_file(BASE/'before.json'))
 assert binding['schema']==2 and binding['uid']==os.getuid() and binding['leafSha256']==EXPECTED and binding['caSha256']==POLICY['issuerCertificateSha256'],'snapshot_binding_mismatch'
 assert binding['snapshotVerifiedNonCA'] is True and binding['scope']=='current-user SSL exact-leaf','snapshot_scope_denied'
 assert binding['publicLeafCountInLoginKeychain']==0 and binding['originalDomains']=={n:{'status':-25300,'settings':None} for n in ('user','admin','system')},'unsupported_original_state'
 der=owned_file(BASE/'server.der')
 assert hashlib.sha256(der).hexdigest().upper()==EXPECTED and ssl.PEM_cert_to_DER_cert(owned_file(BASE/'server.pem').decode('ascii'))==der,'snapshot_fingerprint_mismatch'
 if mode in ('plan','install'):
  assert ssl.PEM_cert_to_DER_cert(CERT.read_text())==der,'live_certificate_changed'
CERT=BASE/'server.pem'
copysettings=fn(sec,'SecTrustSettingsCopyTrustSettings',I,[V,C.c_uint32,C.POINTER(V)])
def inspect():
 der=ssl.PEM_cert_to_DER_cert(CERT.read_text())
 data=fn(cf,'CFDataCreate',V,[V,V,L])(None,C.create_string_buffer(der),len(der))
 cert=fn(sec,'SecCertificateCreateWithData',V,[V,V])(None,data)
 out={}
 for index,name in enumerate(('user','admin','system')):
  value=V();status=copysettings(cert,index,C.byref(value))
  if status not in (0,-25300):raise RuntimeError('target_settings_read_unconfirmed')
  out[name]={'status':status,'settings':decode(value) if status==0 else None}
  if value:release(value)
 release(cert);release(data)
 return out
BASELINE={n:{'status':-25300,'settings':None} for n in ('user','admin','system')}
def require_planned(domains):
 assert all(domains[n]==BASELINE[n] for n in ('admin','system')),'non_user_scope'
 entries=domains['user']['settings'];assert domains['user']['status']==0 and isinstance(entries,list) and len(entries)==1,'wrong_setting_count'
 entry=entries[0]
 assert set(entry)<= {'kSecTrustSettingsPolicy','kSecTrustSettingsResult','kSecTrustSettingsPolicyName'},'unexpected_constraint'
 assert entry.get('kSecTrustSettingsResult')==2,'not_leaf_trustAsRoot'
 assert entry.get('kSecTrustSettingsPolicyName','sslServer')=='sslServer','not_ssl_server'
 props=entry['kSecTrustSettingsPolicy']['policyProperties']
 oidkey=decode(V.in_dll(sec,'kSecPolicyOid').value);ssl_oid=decode(V.in_dll(sec,'kSecPolicyAppleSSL').value)
 assert props.get(oidkey)==ssl_oid,'not_ssl_policy'
def public_count():
 r=subprocess.run(['/usr/bin/security','find-certificate','-a','-c','127.0.0.1','-p',KEYCHAIN],capture_output=True,text=True,timeout=10)
 if r.returncode not in (0,44):raise RuntimeError('public_certificate_query_failed')
 blocks=re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',r.stdout,re.S)
 return sum(hashlib.sha256(ssl.PEM_cert_to_DER_cert(x)).hexdigest().upper()==EXPECTED for x in blocks)
def record(name,obj):
 path=BASE/(name+'.json')
 with path.open('x') as f:f.write(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
 os.chmod(path,0o600)
def native_once(label,args):
 ledger=BASE/(label+'-attempt.json')
 fd=os.open(ledger,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as f:json.dump({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'operation':label,'fingerprint':EXPECTED,'scope':'current-user SSL exact-leaf','uid':os.getuid(),'beforeSha256':hashlib.sha256(owned_file(BASE/'before.json')).hexdigest()},f,indent=2)
 try:
  r=subprocess.run(['/usr/bin/sandbox-exec','-p','(version 1)(allow default)(deny network*)',*args],capture_output=True,text=True,timeout=240)
 except subprocess.TimeoutExpired:
  record(label+'-result',{'status':'UNKNOWN','reason':'native command timeout; inspect before further action'})
  raise SystemExit('UNKNOWN: native command timeout; no automatic retry')
 record(label+'-result',{'status':'RETURNED','exitCode':r.returncode,'diagnostic':'native output withheld; review locally if needed'})
 if r.returncode:raise SystemExit('STOP: native command returned '+str(r.returncode))
current=inspect()
if mode=='snapshot':
 assert current==BASELINE and public_count()==0,'existing_state_not_supported_do_not_overwrite'
 (BASE/'before.json').write_text(json.dumps(binding,indent=2)+'\n')
 os.chmod(BASE/'before.json',0o600)
 print(json.dumps({'snapshot':True,'writesToKeychain':0,'originalSettings':'absent-record','publicCertificateCount':0}))
elif mode=='plan':
 assert current==BASELINE and public_count()==binding['publicLeafCountInLoginKeychain']==0
 print(json.dumps({'mode':'plan','fingerprint':EXPECTED,'scope':'current user / SSL / exact non-CA certificate','policyStringAbsent':True,'currentSettings':current,'publicCertificateCount':0,'writes':0}))
elif mode=='install':
 baseline=json.loads((BASE/'baseline-effective.json').read_text())
 assert baseline['evaluationParameters']=={'suppliedChain':['leaf','ca'],'customAnchors':False,'exceptions':False,'networkFetchAllowed':False,'defaultSystemTrust':True}
 e=baseline['evaluations'][0]
 assert len(baseline['evaluations'])==1 and e['policy']=='ssl-server' and e['hostname']=='127.0.0.1' and e['success'] is False and e['error']['code']==-67843
 assert e['evaluatedChainSha256']==[EXPECTED,POLICY['issuerCertificateSha256']]
 assert current==BASELINE and public_count()==0,'baseline_changed'
 native_once('install',['/usr/bin/security','add-trusted-cert','-r','trustAsRoot','-p','ssl','-k',KEYCHAIN,str(CERT)])
 after=inspect();require_planned(after);assert public_count()==1,'target_certificate_not_unique'
 record('installed',{'fingerprint':EXPECTED,'domains':after,'publicCertificateCount':1,'scopeChecked':True})
 print(json.dumps({'installed':True,'scopeChecked':True,'publicCertificateCount':1}))
elif mode=='inspect':
 print(json.dumps({'fingerprint':EXPECTED,'domains':current,'publicCertificateCount':public_count()}))
elif mode in ('restore','verify-restored'):
 attempt=json.loads(owned_file(BASE/'install-attempt.json'))
 assert attempt['operation']=='install' and attempt['fingerprint']==EXPECTED and attempt['uid']==os.getuid() and attempt['scope']=='current-user SSL exact-leaf' and attempt['beforeSha256']==hashlib.sha256(owned_file(BASE/'before.json')).hexdigest(),'not_this_batch'
 # UNKNOWN is immutable; read-only verification may still establish current state.
 if mode=='restore':
  for label in ('install','remove-trust','remove-new-public-certificate'):
   result=BASE/(label+'-result.json')
   if (BASE/(label+'-attempt.json')).exists() and (not result.exists() or json.loads(owned_file(result)).get('status')!='RETURNED' or json.loads(owned_file(result)).get('exitCode')!=0):raise SystemExit('UNKNOWN: inspect only; no automatic retry')
 if current!=BASELINE:
  require_planned(current)
  if mode=='verify-restored':raise SystemExit('UNCONFIRMED: target settings still present')
  native_once('remove-trust',['/usr/bin/security','remove-trusted-cert',str(CERT)])
 after=inspect();assert after==BASELINE,'target_settings_not_restored'
 count=public_count()
 if count!=binding['publicLeafCountInLoginKeychain']:
  assert binding['publicLeafCountInLoginKeychain']==0 and count==1,'certificate_presence_changed'
  if mode=='verify-restored':raise SystemExit('UNCONFIRMED: new public certificate item still present')
  native_once('remove-new-public-certificate',['/usr/bin/security','delete-certificate','-Z',EXPECTED,KEYCHAIN])
 assert inspect()==BASELINE and public_count()==0,'baseline_not_restored'
 if not (BASE/'explicit-restored.json').exists():record('explicit-restored',{'settingsRestored':True,'publicPresenceRestored':True,'existingCertificatesDeleted':0,'newPublicLeafRemoved':True,'privateKeysTouched':False,'effectiveValidation':'SEPARATE_CHECK_REQUIRED'})
 print(json.dumps({'explicitSettingsRestored':True,'publicPresenceRestored':True,'effectiveValidation':'SEPARATE_CHECK_REQUIRED'}))
else:raise SystemExit('unsupported_mode')
