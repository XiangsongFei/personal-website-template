// Sealed public image identity. No Docker, registry, socket or startup capability.
// Docker 29/containerd identifies this docker-save image by its OCI manifest;
// the original registry manifest uses compressed layers. Both bind the SAME config.
function freeze(value) {
 for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);
 return Object.freeze(value);
}
export const IMAGE=freeze({
 repository:'docker.io/library/node',tag:'24.22.1-bookworm-slim',verified:true,
 status:'VERIFIED_IMPORTED_NOT_STARTED',platform:'linux/arm64/v8',
 engine_image_id:'sha256:49e909c0ea90b04854a897e81f28d3e77ccc697324c2eb9d58ba45521f672fc5',
 engine_identity_kind:'oci-image-manifest',
 archive_manifest_digest:'sha256:49e909c0ea90b04854a897e81f28d3e77ccc697324c2eb9d58ba45521f672fc5',
 index_digest:'sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c',
 arm64_manifest_digest:'sha256:932a44adcdb8f5dfbf00f00eb38da8d22b450b2ad258b6d1b2319beca823bfbd',
 config_digest:'sha256:7514f117ac7ae4c1e8b6e2b6fd3238157322e967eae9c0d53daf6174fe465a76',
 archive_sha256:'0edb19394c4086ed34806a1a85526f84ce3db52e8d310b1bad61749304cdb606',
 archive_bytes:254545920,
 node_elf_sha256:'c8c5721679d8d1a09e9987e345d5f9a64899bb85f7a384783ba8a93e6e62348a',
 layers:[
  {registry_digest:'sha256:f791e47cf52abf7b364878f2141547e3781072e437f599f6632849d88fca8ca4',registry_bytes:28137951,diff_id:'sha256:8197d9c14b22d4cd79198c0722a18035760a85613211f2127ee6f5888735ca98',uncompressed_bytes:100270080},
  {registry_digest:'sha256:1df5cdf85ecfbe1f91d38e11d14a8a71e573a7ad62d321a3366f18f628620032',registry_bytes:3312,diff_id:'sha256:fde76bf30a253c548f15113a5803e67a9afbdeb13371dc8c8b008d8c4a9aeb79',uncompressed_bytes:21504},
  {registry_digest:'sha256:99ad8657158dff09e9fd7a9fa071c9b663d4c3841ad00ddbdbd3c8ebb6a446e8',registry_bytes:51054040,diff_id:'sha256:188d87012ea39e65d5ab501361a6caf08db12510d50f8c63eb6369e8946862ca',uncompressed_bytes:147009536},
  {registry_digest:'sha256:92c5f1f753d32c7606b5f4ec086931d14e864bdedaa59d343b81e2da62f175c5',registry_bytes:1713014,diff_id:'sha256:c3b0be9c5f5bcb85baa312a56d3e04fddb0e829d1a6836b1f1d28922b5f8f869',uncompressed_bytes:7217152},
  {registry_digest:'sha256:baff30000c3659c6bb58cd94e81f7a015a84ab86af9fbc74f61c83f194339d49',registry_bytes:448,diff_id:'sha256:c3bfe17b5b487f4da22ee17bced0ced1c8096b53c68634f2b5cc8ac71b964614',uncompressed_bytes:3584}
 ]
});
function canonical(value) {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export function imageGate(image) {
 // Valid-looking SHA strings alone are insufficient; no field or layer may drift.
 if(canonical(image)!==canonical(IMAGE))throw Error('IMAGE_UNVERIFIED');
}
export function launchImageGate(launch,image) {
 imageGate(image);
 if(launch?.image!==IMAGE.engine_image_id||launch.platform!==IMAGE.platform||
    launch.start_approval_required!==true||launch.status!=='PREPARED_NOT_AUTHORIZED_IMAGE_VERIFIED')throw Error('LAUNCH_IMAGE_NOT_PINNED');
}
export function inspectedImageGate(inspect) {
 if(inspect?.Id!==IMAGE.engine_image_id||inspect.Descriptor?.digest!==IMAGE.archive_manifest_digest||
    inspect.Descriptor?.mediaType!=='application/vnd.oci.image.manifest.v1+json'||
    inspect.Os!=='linux'||inspect.Architecture!=='arm64'||inspect.Variant!=='v8'||
    canonical(inspect.RootFS?.Layers)!==canonical(IMAGE.layers.map(x=>x.diff_id))||
    !inspect.Config?.Env?.includes('NODE_VERSION=24.22.1'))throw Error('RESIDENT_IMAGE_NOT_PINNED');
 // Config bytes and layer bytes must ALSO be rehashed by the trusted host
 // collector. An inspect object, or passing this pure gate, is not that evidence.
}
