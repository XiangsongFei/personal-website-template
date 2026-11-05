#!/usr/bin/env python3
"""Read only the two pinned public certificates; never set trust or anchors."""
import ctypes as C
import datetime, hashlib, json, ssl
from pathlib import Path

P = C.c_void_p
I = C.c_int32
N = C.c_long
CF = C.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
SEC = C.CDLL('/System/Library/Frameworks/Security.framework/Security')

def bind(lib, name, result, args):
    fn = getattr(lib, name)
    fn.restype, fn.argtypes = result, args
    return fn

release = bind(CF, 'CFRelease', None, [P])
typeid = bind(CF, 'CFGetTypeID', C.c_ulong, [P])
arraytype = bind(CF, 'CFArrayGetTypeID', C.c_ulong, [])
arraycount = bind(CF, 'CFArrayGetCount', N, [P])
arrayitem = bind(CF, 'CFArrayGetValueAtIndex', P, [P, N])
arraycreate = bind(CF, 'CFArrayCreate', P, [P, C.POINTER(P), N, P])
data = bind(CF, 'CFDataCreate', P, [P, P, N])
datalen = bind(CF, 'CFDataGetLength', N, [P])
databytes = bind(CF, 'CFDataGetBytePtr', P, [P])
stringcreate = bind(CF, 'CFStringCreateWithCString', P, [P, C.c_char_p, C.c_uint32])
stringget = bind(CF, 'CFStringGetCString', C.c_bool, [P, C.c_char_p, N, C.c_uint32])
stringlen = bind(CF, 'CFStringGetLength', N, [P])
certcreate = bind(SEC, 'SecCertificateCreateWithData', P, [P, P])
certdata = bind(SEC, 'SecCertificateCopyData', P, [P])
settingscopy = bind(SEC, 'SecTrustSettingsCopyTrustSettings', I, [P, C.c_uint32, C.POINTER(P)])
sslpolicy = bind(SEC, 'SecPolicyCreateSSL', P, [C.c_bool, P])
basicpolicy = bind(SEC, 'SecPolicyCreateBasicX509', P, [])
trustcreate = bind(SEC, 'SecTrustCreateWithCertificates', I, [P, P, C.POINTER(P)])
network = bind(SEC, 'SecTrustSetNetworkFetchAllowed', I, [P, C.c_bool])
evaluate = bind(SEC, 'SecTrustEvaluateWithError', C.c_bool, [P, C.POINTER(P)])
trustresult = bind(SEC, 'SecTrustGetTrustResult', I, [P, C.POINTER(C.c_uint32)])
chaincopy = bind(SEC, 'SecTrustCopyCertificateChain', P, [P])
errcode = bind(CF, 'CFErrorGetCode', N, [P])
errdesc = bind(CF, 'CFErrorCopyDescription', P, [P])

def text(value):
    buf = C.create_string_buffer(stringlen(value) * 4 + 1)
    assert stringget(value, buf, len(buf), 0x08000100)
    return buf.value.decode()

def classify(status, present, count):
    if status == -25300 and not present: return 'absent-record'
    if status == 0 and present and count == 0: return 'valid-empty-array'
    if status == 0 and present and count is not None and count > 0: return 'nonempty-settings-array'
    return 'unexpected-structure'

assert classify(-25300, False, None) == 'absent-record'
assert classify(0, True, 0) == 'valid-empty-array'
assert classify(0, True, 1) == 'nonempty-settings-array'
assert classify(0, False, None) == 'unexpected-structure'
assert classify(-25300, True, 0) == 'unexpected-structure'

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
import subprocess,sys
if len(sys.argv) not in (2,3) or len(sys.argv)==3 and sys.argv[2] not in ('--baseline','--compare'):raise SystemExit('usage: read-leaf-effective.py RUN_ID [--baseline|--compare]')
base=bound_run(sys.argv[1])
bound_file=base/'before.json'
st=bound_file.lstat()
assert not bound_file.is_symlink() and bound_file.is_file() and st.st_uid==os.getuid() and st.st_nlink==1 and st.st_mode & 0o077==0,'unsafe_snapshot_file'
binding=json.loads(bound_file.read_text())
assert binding['uid']==os.getuid() and binding['leafSha256']==EXPECTED
# Rollback evaluation reads the saved public leaf; no private key is needed.
leaf=base/'server.pem'
for file in (base/'before.json',leaf,base/'server.der'):
 st=file.lstat()
 assert not file.is_symlink() and file.is_file() and st.st_uid==os.getuid() and st.st_nlink==1 and st.st_mode & 0o077==0,'unsafe_snapshot_file'
assert binding['schema']==2 and binding['snapshotVerifiedNonCA'] is True
assert hashlib.sha256((base/'server.der').read_bytes()).hexdigest().upper()==EXPECTED
assert ssl.PEM_cert_to_DER_cert(leaf.read_text())==(base/'server.der').read_bytes()
validity=ssl._ssl._test_decode_cert(str(leaf))
now=datetime.datetime.now(datetime.timezone.utc).timestamp()
assert ssl.cert_time_to_seconds(validity['notBefore'])<=now<ssl.cert_time_to_seconds(validity['notAfter']),'UNCONFIRMED: certificate validity changed; not evidence of trust restoration'
previous={'serverCertPath':str(leaf),'serverSha256':EXPECTED,'caPath':str(ROOT/'.runtime/tls/ca.crt'),'caSha256':POLICY['issuerCertificateSha256']}
assert binding['caSha256']==previous['caSha256']
certs = {}
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'classificationCases': 5, 'keychainWrites': 0, 'certificates': {},
          'evaluationParameters': {'suppliedChain': ['leaf','ca'], 'customAnchors': False,
          'exceptions': False, 'networkFetchAllowed': False, 'defaultSystemTrust': True},
          'evaluations': []}
for role, key, expected in [('leaf','serverCertPath',previous['serverSha256']), ('ca','caPath',previous['caSha256'])]:
    der = ssl.PEM_cert_to_DER_cert(Path(previous[key]).read_text())
    fp = hashlib.sha256(der).hexdigest().upper()
    assert fp == expected
    d = data(None, C.create_string_buffer(der), len(der))
    cert = certcreate(None, d); release(d)
    assert cert
    certs[role] = cert
    domains = {}
    for index, name in enumerate(('user','admin','system') if role == 'leaf' else ()):
        output = P()
        status = settingscopy(cert, index, C.byref(output))
        present = bool(output.value)
        isarray = present and typeid(output) == arraytype()
        count = int(arraycount(output)) if isarray else None
        domains[name] = {'osStatus': int(status), 'outputPointerPresent': present,
                         'isCFArray': bool(isarray), 'arrayCount': count,
                         'classification': classify(status, present, count)}
        if present: release(output)
    result['certificates'][role] = {'sha256': fp, 'domains': domains}

items = (P * 2)(certs['leaf'], certs['ca'])
certarray = arraycreate(None, items, 2, None)
for host in ('127.0.0.1',):
    hostref = stringcreate(None, host.encode(), 0x08000100) if host else None
    policy = sslpolicy(True, hostref) if host else basicpolicy()
    trust = P()
    assert trustcreate(certarray, policy, C.byref(trust)) == 0
    assert network(trust, False) == 0
    error = P()
    ok = bool(evaluate(trust, C.byref(error)))
    value = C.c_uint32()
    status = trustresult(trust, C.byref(value))
    c = chaincopy(trust); fps = []
    if c:
        for index in range(arraycount(c)):
            d = certdata(arrayitem(c,index))
            fps.append(hashlib.sha256(C.string_at(databytes(d),datalen(d))).hexdigest().upper())
            release(d)
        release(c)
    detail = None
    if error:
        desc = errdesc(error)
        detail = {'code': int(errcode(error)), 'description': text(desc)}
        release(desc); release(error)
    result['evaluations'].append({'policy':'ssl-server' if host else 'basic-x509',
        'hostname':host, 'success':ok, 'resultStatus':int(status),
        'trustResultValue':int(value.value),'error':detail,'evaluatedChainSha256':fps})
    release(trust); release(policy)
    if hostref: release(hostref)
release(certarray)
for cert in certs.values(): release(cert)
def signature(r):
 assert r['evaluationParameters']==result['evaluationParameters']
 assert r['evaluations'][0]['policy']=='ssl-server' and r['evaluations'][0]['hostname']=='127.0.0.1'
 e=r['evaluations'][0]
 assert e['evaluatedChainSha256']==[EXPECTED,POLICY['issuerCertificateSha256']]
 return {'success':e['success'],'errorCode':(e['error'] or {}).get('code'),'chain':e['evaluatedChainSha256']}
if len(sys.argv)==3:
 baseline=base/'baseline-effective.json'
 current=signature(result)
 if sys.argv[2]=='--baseline':
  assert current['success'] is False and current['errorCode']==-67843,'baseline_not_confirmed_untrusted'
  with baseline.open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2)
  os.chmod(baseline,0o600)
 else:
  assert current==signature(json.loads(baseline.read_text())),'effective_state_not_restored'
  result['effectiveMatchesBaseline']=True
print(json.dumps(result,ensure_ascii=False,indent=2))
