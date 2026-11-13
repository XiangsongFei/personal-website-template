"""Materialize public synthetic OFFLINE fixtures. Never loads real receipts or tools."""
from pathlib import Path
import hashlib,json,os,shutil
ROOT=Path(__file__).resolve().parents[3]
WORK=ROOT/'.s34-fixtures/work'
WORK.mkdir(parents=True,exist_ok=True)
T=json.loads((Path(__file__).parent/'templates.json').read_text())
assert T['version']==1
NOTICE='OFFLINE_SYNTHETIC_NOT_EXECUTION_AUTHORITY'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def expand(v):
 if isinstance(v,dict):return {k:expand(x) for k,x in v.items()}
 if isinstance(v,list):return [expand(x) for x in v]
 if isinstance(v,str):return v.replace('@ROOT@',str(ROOT)).replace('@WORK@',str(WORK))
 return v
objects=expand(T['jsonFiles']);by_path={str(ROOT/k):k for k in objects};done={};active=set()
def build(k):
 if k in done:return done[k]
 assert k not in active,('FIXTURE_REFERENCE_CYCLE',k)
 active.add(k);v=objects[k]
 def fix(x,parent=None):
  if isinstance(x,list):return [fix(z,parent) for z in x]
  if not isinstance(x,dict):return x
  x={a:fix(b,x) for a,b in x.items()}
  if isinstance(x.get('path'),str) and 'sha256' in x:
   path=x['path'];absolute=str(Path(path)) if Path(path).is_absolute() else str(Path(parent.get('directory',str((ROOT/k).parent)))/path) if isinstance(parent,dict) else str((ROOT/k).parent/path)
   if absolute in by_path:x['sha256']=sha(build(by_path[absolute]))
   elif x['sha256']=='@HASH@':raise AssertionError(('MISSING_FIXTURE_REFERENCE',k,path,absolute))
  return x
 v=fix(v)
 if k=='tests/s3/s34-execution-plan.json':v['fixture_contract']['sha256']=sha(build('tests/s3/s34-fixture-contract.json'))
 if k=='tests/s3/clean-candidate/frozen.json':
  v['files']={name:sha(build(name)) if name in objects else sha((ROOT/name).read_bytes()) for name in v['files']}
 if k=='tests/s3/driver/pins.json':
  for field,name in {'plan_sha256':'tests/s3/s34-execution-plan.json','fixture_sha256':'tests/s3/s34-fixture-contract.json','candidate_frozen_sha256':'tests/s3/clean-candidate/frozen.json','remaining_profile_sha256':'tests/s3/driver/remaining-profile.json','tail_profile_sha256':'tests/s3/driver/tail-profile.json','p14r_profile_sha256':'tests/s3/driver/p14r-profile.json'}.items():v[field]=sha(build(name))
  v['fixture_mode']=NOTICE;v['baseline_sha256']=sha(build('.s34-fixtures/work/s3-4-final-preparation-20261112T055926Z/baseline-final.json'))
 # Embedded fixture/plan contracts must bind the materialized fixture bytes.
 if k.startswith('tests/s3/driver/') and k.endswith('-profile.json'):
  if 'fixture_contract' in v['plan']:v['plan']['fixture_contract']['sha256']=sha(json.dumps(v['fixture'],ensure_ascii=False,indent=2).encode()+b'\n')
 raw=json.dumps(v,ensure_ascii=False,indent=2).encode()+b'\n';done[k]=raw;active.remove(k);return raw
for k in objects:build(k)
for k,raw in done.items():
 p=ROOT/k;p.parent.mkdir(parents=True,exist_ok=True);
 if k.startswith('.s34-fixtures/'):p.parent.chmod(0o700)
 p.write_bytes(raw)
for path,text in expand(T['dummyMountFiles']).items():
 p=Path(path.replace('@ROOT@',str(ROOT)).replace('@WORK@',str(WORK)));p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():assert p.read_text()==text
 else:p.write_text(text)
 p.chmod(0o400)
# A package is generated from reviewed source hashes, never from local run output.
frozen=json.loads(done['tests/s3/clean-candidate/frozen.json']);package=ROOT/'.s34-fixtures/package'
for name,digest in frozen['files'].items():
 source=ROOT/name;assert sha(source.read_bytes())==digest,(name,'PACKAGE_SOURCE_CHANGED')
 target=package/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
f=package/'tests/s3/clean-candidate/frozen.json';f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(done['tests/s3/clean-candidate/frozen.json'])
# Deliberately spent SYNTHETIC run opportunities exercise real CLI replay guards.
for label in ['remaining','tail']:
 p=json.loads(done['tests/s3/driver/'+label+'-profile.json']);path=WORK/('s3-4-live-run-'+p['runId']);marker=path/'SYNTHETIC-OFFLINE-ONLY.json'
 if path.exists():assert marker.is_file() and json.loads(marker.read_text())=={'fixtureOnly':True,'runId':p['runId']},'REFUSE_EXISTING_NON_FIXTURE_RUN'
 else:path.mkdir(mode=0o700);marker.write_text(json.dumps({'fixtureOnly':True,'runId':p['runId']}))
# An invalid historical name is also a consumed synthetic opportunity.
old=WORK/'s3-4-live-run-af888ec9-e695-4676-8d95-f3412af15694'
old.mkdir(mode=0o700,exist_ok=True)
Path(expand(T['jsonFiles']['tests/s3/driver/pins.json']['intent_directory'])).mkdir(mode=0o700,exist_ok=True)
# This is a per-checkout OFFLINE source-integrity fixture, not the historic real seal.
files=set(T['sealFiles'])|{'tests/s3/offline-driver-fixtures/prepare.py','tests/s3/offline-driver-fixtures/templates.json'}
seal={'version':1,'scope':NOTICE,'source_sha':objects['tests/s3/driver/pins.json']['source_sha'],'files':{name:sha((ROOT/name).read_bytes()) for name in sorted(files)}}
(ROOT/'tests/s3/driver/seal.json').write_text(json.dumps(seal,indent=2)+'\n')
print(json.dumps({'status':'SYNTHETIC_OFFLINE_FIXTURES_READY','files':len(done),'sourceFiles':len(files),'externalIo':0,'realEvidence':False,'realExecutionAuthority':False}))
