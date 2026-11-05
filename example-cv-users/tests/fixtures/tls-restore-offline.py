"""Actual CLI dispatch with native framework reads/commands intercepted; no Keychain."""
import ast,copy,hashlib,json,os,ssl,subprocess,sys,tempfile,types,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SOURCE=(ROOT/'scripts/https/leaf-trust-control.py').read_text()
tree=ast.parse(SOURCE)
start=next(i for i,n in enumerate(tree.body) if isinstance(n,ast.Import) and any(a.name=='subprocess' for a in n.names))
body=[n for n in tree.body[start:] if not (isinstance(n,ast.FunctionDef) and n.name in ('inspect','public_count')) and not (isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='copysettings' for x in n.targets))]
PROGRAM=compile(ast.Module(body=body,type_ignores=[]),'actual-trust-cli-offline','exec')
BASELINE={n:{'status':-25300,'settings':None} for n in ('user','admin','system')}
PLANNED={**BASELINE,'user':{'status':0,'settings':[{'kSecTrustSettingsPolicy':{'policyProperties':{'oid':'ssl'}},'kSecTrustSettingsResult':2,'kSecTrustSettingsPolicyName':'sslServer'}]}}
class Value:
 @staticmethod
 def in_dll(lib,name):return types.SimpleNamespace(value=name)
 def __new__(cls,v):return v
class Harness:
 def __init__(self,path):
  path=path.resolve();self.root=path;self.domains=copy.deepcopy(BASELINE);self.count=0;self.calls=[];self.preflights=0;self.valid=True;self.timeout=None
  (path/'scripts/https').mkdir(parents=True);(path/'.runtime/tls').mkdir(parents=True)
  self.der=b'offline-public-leaf';self.fp=hashlib.sha256(self.der).hexdigest().upper()
  (path/'.runtime/tls/server.crt').write_text(ssl.DER_cert_to_PEM_cert(self.der))
  (path/'.runtime/tls/server.key').write_text('synthetic non-key marker')
  self.node=path/'node';self.node.write_bytes(b'synthetic executable marker')
  (path/'scripts/https/policy.json').write_text(json.dumps({'serverCertificateSha256':self.fp,'issuerCertificateSha256':'A'*64,'nodeExecutableSha256':hashlib.sha256(self.node.read_bytes()).hexdigest()}))
  self.base=path/'.runtime/https-trust/offline-run'
 def run_command(self,args,**kw):
  if '--certificate-only' in args:
   self.preflights+=1
   return types.SimpleNamespace(returncode=0 if self.valid and (self.root/'.runtime/tls/server.key').exists() else 1)
  self.calls.append(args)
  assert args[:3]==['/usr/bin/sandbox-exec','-p','(version 1)(allow default)(deny network*)']
  action=args[4]
  if action==self.timeout:raise subprocess.TimeoutExpired(args,240)
  if action=='add-trusted-cert':
   assert '-d' not in args and args[args.index('-p',3)+1]=='ssl' and '-s' not in args
   assert args[-1]==str(self.base/'server.pem')
   self.domains=copy.deepcopy(PLANNED);self.count=1
  elif action=='remove-trusted-cert':
   assert len(args)==6 and args[-1]==str(self.base/'server.pem')
   self.domains=copy.deepcopy(BASELINE)
  elif action=='delete-certificate':
   assert args[5:7]==['-Z',self.fp] and args[-1]==str(Path.home()/'Library/Keychains/login.keychain-db')
   self.count=0
  else:raise AssertionError('unexpected native operation')
  return types.SimpleNamespace(returncode=0)
 def execute(self,mode):
  previous_argv=sys.argv;previous_run=subprocess.run;previous_node=os.environ.get('S2_VERIFIED_NODE')
  sys.argv=['leaf-trust-control.py',mode,'offline-run'];subprocess.run=self.run_command;os.environ['S2_VERIFIED_NODE']=str(self.node)
  try:
   exec(PROGRAM,{'__file__':str(self.root/'scripts/https/leaf-trust-control.py'),'Path':Path,'hashlib':hashlib,'ssl':ssl,'json':json,'sys':sys,'inspect':lambda:copy.deepcopy(self.domains),'public_count':lambda:self.count,'V':Value,'sec':object(),'decode':lambda v:{'kSecPolicyOid':'oid','kSecPolicyAppleSSL':'ssl'}.get(v,v)})
  finally:
   sys.argv=previous_argv;subprocess.run=previous_run
   if previous_node is None:os.environ.pop('S2_VERIFIED_NODE',None)
   else:os.environ['S2_VERIFIED_NODE']=previous_node
 def installed(self):
  self.execute('snapshot');self.execute('plan')
  b={'evaluationParameters':{'suppliedChain':['leaf','ca'],'customAnchors':False,'exceptions':False,'networkFetchAllowed':False,'defaultSystemTrust':True},'evaluations':[{'policy':'ssl-server','hostname':'127.0.0.1','success':False,'error':{'code':-67843},'evaluatedChainSha256':[self.fp,'A'*64]}]}
  (self.base/'baseline-effective.json').write_text(json.dumps(b));self.execute('install')
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='s2-trust-cli-offline-');self.h=Harness(Path(self.tmp.name))
 def tearDown(self):self.tmp.cleanup()
 def test_normal_and_repeated_restore(self):
  h=self.h;h.installed();h.execute('restore');h.execute('verify-restored');h.execute('restore');self.assertEqual(len(h.calls),3)
 def test_expired_after_install(self):
  h=self.h;h.installed();h.valid=False;before=h.preflights
  with self.assertRaises(SystemExit):h.execute('plan')
  h.execute('restore');h.execute('verify-restored');self.assertEqual(h.preflights,before+1)
 def test_missing_private_key_and_live_certificate(self):
  h=self.h;h.installed();(h.root/'.runtime/tls/server.key').unlink();(h.root/'.runtime/tls/server.crt').unlink();h.node.unlink()
  h.execute('restore');h.execute('verify-restored');self.assertEqual(len(h.calls),3)
 def test_wrong_fingerprint(self):
  h=self.h;h.installed();(h.base/'server.der').write_bytes(b'wrong')
  with self.assertRaises(AssertionError):h.execute('restore')
  self.assertEqual(len(h.calls),1)
 def test_other_user(self):
  h=self.h;h.installed();p=h.base/'before.json';j=json.loads(p.read_text());j['uid']+=1;p.write_text(json.dumps(j))
  with self.assertRaises(AssertionError):h.execute('restore')
  self.assertEqual(len(h.calls),1)
 def test_ca_or_wrong_batch_record(self):
  h=self.h;h.installed();p=h.base/'install-attempt.json';j=json.loads(p.read_text());j['fingerprint']='A'*64;p.write_text(json.dumps(j))
  with self.assertRaises(AssertionError):h.execute('restore')
  self.assertEqual(len(h.calls),1)
 def test_admin_or_system_or_broader_trust(self):
  for scope in ('admin','system','user'):
   with self.subTest(scope=scope),tempfile.TemporaryDirectory() as d:
    h=Harness(Path(d));h.installed();h.domains[scope]={'status':0,'settings':[]}
    with self.assertRaises(AssertionError):h.execute('restore')
    self.assertEqual(len(h.calls),1)
 def test_existing_certificate_preserved(self):
  h=self.h;h.count=1
  with self.assertRaises(AssertionError):h.execute('snapshot')
  self.assertEqual(h.calls,[])
 def test_ca_attestation_denied(self):
  h=self.h;h.installed();p=h.base/'before.json';j=json.loads(p.read_text());j['snapshotVerifiedNonCA']=False;p.write_text(json.dumps(j))
  with self.assertRaises(AssertionError):h.execute('restore')
  self.assertEqual(len(h.calls),1)
 def test_unknown_install_not_automatically_retried_or_removed(self):
  h=self.h;h.installed();p=h.base/'install-result.json';p.write_text(json.dumps({'status':'UNKNOWN'}))
  with self.assertRaises(SystemExit):h.execute('restore')
  self.assertEqual(len(h.calls),1);self.assertEqual(json.loads(p.read_text())['status'],'UNKNOWN')
 def test_snapshot_symlink_denied(self):
  h=self.h;h.installed();p=h.base/'server.der';target=h.base/'public-copy';p.rename(target);p.symlink_to(target)
  with self.assertRaises(AssertionError):h.execute('restore')
  self.assertEqual(len(h.calls),1)
 def test_timeout_keeps_unknown_no_retry(self):
  h=self.h;h.installed();h.timeout='remove-trusted-cert'
  with self.assertRaises(SystemExit):h.execute('restore')
  result=(h.base/'remove-trust-result.json').read_bytes()
  with self.assertRaises(SystemExit):h.execute('restore')
  self.assertEqual(len(h.calls),2);self.assertEqual((h.base/'remove-trust-result.json').read_bytes(),result);self.assertEqual(json.loads(result)['status'],'UNKNOWN')
if __name__=='__main__':unittest.main()
