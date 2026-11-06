"""Exercise only extracted policy/command functions; no Security framework or Keychain calls."""
import ast,datetime,hashlib,json,os,subprocess,tempfile,types
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=(root/'scripts/https/leaf-trust-control.py').read_text()
tree=ast.parse(source)
functions=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ['require_planned','record','native_once']],type_ignores=[])
class Value:
 @staticmethod
 def in_dll(lib,name):return types.SimpleNamespace(value=name)
 def __new__(cls,v):return v
baseline={n:{'status':-25300,'settings':None} for n in ['user','admin','system']}
def decode(v):return {'kSecPolicyOid':'oid','kSecPolicyAppleSSL':'ssl'}.get(v,v)
calls=[]
class Native:
 TimeoutExpired=subprocess.TimeoutExpired
 def run(self,args,**kw):
  calls.append(args)
  if fail_timeout[0]:raise self.TimeoutExpired(args,240)
  return types.SimpleNamespace(returncode=0,stdout='',stderr='')
fail_timeout=[False]
with tempfile.TemporaryDirectory(prefix='s2-trust-offline-') as d:
 g={'BASELINE':baseline,'V':Value,'sec':object(),'decode':decode,'BASE':Path(d),'os':os,'json':json,'datetime':datetime,'subprocess':Native(),'EXPECTED':'public-pin','owned_file':lambda p:b'before','hashlib':hashlib}
 exec(compile(functions,'extracted-existing-policy','exec'),g)
 valid={'kSecTrustSettingsPolicy':{'policyProperties':{'oid':'ssl'}},'kSecTrustSettingsResult':2,'kSecTrustSettingsPolicyName':'sslServer'}
 def domains(entry):return {**baseline,'user':{'status':0,'settings':[entry]}}
 g['require_planned'](domains(valid))
 for patch in [{'kSecTrustSettingsResult':1},{'kSecTrustSettingsPolicyString':'127.0.0.1'},{'kSecTrustSettingsPolicy':{'policyProperties':{'oid':'other'}}},{'kSecTrustSettingsPolicyName':'other'}]:
  try:g['require_planned'](domains({**valid,**patch}));raise RuntimeError('unsafe policy accepted')
  except AssertionError:pass
 changed=domains(valid);changed['admin']={'status':0,'settings':[]}
 try:g['require_planned'](changed);raise RuntimeError('admin policy accepted')
 except AssertionError:pass
 # Commands are intercepted before any process/Keychain call. Exclusive ledger prevents repetition.
 g['native_once']('test',['not-executed'])
 try:g['native_once']('test',['not-executed']);raise RuntimeError('second command accepted')
 except FileExistsError:pass
 assert len(calls)==1
 fail_timeout[0]=True
 try:g['native_once']('timeout',['not-executed']);raise RuntimeError('timeout did not stop')
 except SystemExit:pass
 assert json.loads((Path(d)/'timeout-result.json').read_text())['status']=='UNKNOWN'
 try:g['native_once']('timeout',['not-executed']);raise RuntimeError('timeout retried')
 except FileExistsError:pass
 assert len(calls)==2
for file in (root/'scripts/https').glob('*.py'):ast.parse(file.read_text())
assert 'set-trust-settings' not in source and 'SetTrustSettings' not in source
assert "'-p','ssl'" in source and "'-r','trustAsRoot'" in source
assert "'remove-trusted-cert'" in source and 'O_EXCL' in source
print('offline trust tests passed: policy scope, exclusive command reservation, UNKNOWN, no retry; Keychain writes=0')
