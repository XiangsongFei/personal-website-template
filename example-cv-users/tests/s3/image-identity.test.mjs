// Offline mutation tests only. No Docker, socket, Auth or database calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {IMAGE,imageGate,launchImageGate,inspectedImageGate} from './clean-candidate/image-identity.mjs';
const launch=JSON.parse(readFileSync(new URL('./clean-candidate/launch.json',import.meta.url)));
test('image gate rejects every changed scalar, missing field and extra waiver',()=>{
 imageGate(structuredClone(IMAGE));
 for(const [key,value] of Object.entries(IMAGE)) {
  if(key==='layers')continue;
  const changed=structuredClone(IMAGE);
  changed[key]=typeof value==='boolean'?false:typeof value==='number'?value+1:typeof value==='string'&&value.startsWith('sha256:')?'sha256:'+'0'.repeat(64):String(value)+'-changed';
  assert.throws(()=>imageGate(changed),/IMAGE_UNVERIFIED/,key);
  const missing=structuredClone(IMAGE);delete missing[key];assert.throws(()=>imageGate(missing),/IMAGE_UNVERIFIED/,key);
 }
 assert.throws(()=>imageGate({...IMAGE,permission_override:true}),/IMAGE_UNVERIFIED/);
 assert.throws(()=>imageGate({...IMAGE,verified:1}),/IMAGE_UNVERIFIED/);
 assert(Object.isFrozen(IMAGE)&&Object.isFrozen(IMAGE.layers)&&Object.isFrozen(IMAGE.layers[0]));
});
test('all five ordered compressed layer digests, diff IDs and byte sizes remain sealed',()=>{
 for(let i=0;i<IMAGE.layers.length;i++)for(const key of Object.keys(IMAGE.layers[i])) {
  const changed=structuredClone(IMAGE);
  changed.layers[i][key]=typeof changed.layers[i][key]==='number'?0:'sha256:'+'0'.repeat(64);
  assert.throws(()=>imageGate(changed),/IMAGE_UNVERIFIED/,`${i}/${key}`);
 }
 for(const layers of [IMAGE.layers.slice(1),[...IMAGE.layers].reverse(),[...IMAGE.layers,IMAGE.layers[0]]])assert.throws(()=>imageGate({...IMAGE,layers}),/IMAGE_UNVERIFIED/);
 assert.notEqual(IMAGE.engine_image_id,IMAGE.config_digest);
 assert.notEqual(IMAGE.arm64_manifest_digest,IMAGE.archive_manifest_digest);
});
test('launch selects only the resident manifest ID and preserves explicit start approval',()=>{
 launchImageGate(launch,IMAGE);
 for(const image of [IMAGE.config_digest,IMAGE.arm64_manifest_digest,'node:24.22.1-bookworm-slim','node:latest',null])assert.throws(()=>launchImageGate({...launch,image},IMAGE),/LAUNCH_IMAGE_NOT_PINNED/);
 assert.throws(()=>launchImageGate({...launch,platform:'linux/amd64'},IMAGE),/LAUNCH_IMAGE_NOT_PINNED/);
 assert.throws(()=>launchImageGate({...launch,start_approval_required:false},IMAGE),/LAUNCH_IMAGE_NOT_PINNED/);
});
test('inspect gate rejects descriptor, architecture, version and layer substitution',()=>{
 const observed={Id:IMAGE.engine_image_id,Descriptor:{digest:IMAGE.archive_manifest_digest,mediaType:'application/vnd.oci.image.manifest.v1+json'},Os:'linux',Architecture:'arm64',Variant:'v8',RootFS:{Layers:IMAGE.layers.map(x=>x.diff_id)},Config:{Env:['NODE_VERSION=24.22.1']}};
 inspectedImageGate(observed);
 for(const change of [o=>o.Id=IMAGE.config_digest,o=>o.Descriptor.digest=IMAGE.arm64_manifest_digest,o=>o.Descriptor.mediaType='application/vnd.oci.image.index.v1+json',o=>o.Architecture='amd64',o=>delete o.Variant,o=>o.Config.Env=['NODE_VERSION=24.22.3'],o=>o.RootFS.Layers.reverse()]) {
  const changed=structuredClone(observed);change(changed);assert.throws(()=>inspectedImageGate(changed),/RESIDENT_IMAGE_NOT_PINNED/);
 }
});
