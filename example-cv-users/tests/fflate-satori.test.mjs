import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {deflateSync as zlibDeflate} from 'node:zlib';
import satori from 'satori';
const require=createRequire(import.meta.url);
const scoped=createRequire(require.resolve('satori'));
const fflate=scoped('fflate');
const {zipSync,unzipSync,strToU8,strFromU8}=fflate;
const font=readFileSync('node_modules/@vercel/og/dist/Geist-Regular.ttf');
const element={type:'div',props:{style:{display:'flex',color:'black',background:'white'},children:'Example CV 123'}};
const render=data=>satori(element,{width:380,height:100,fonts:[{name:'Geist',data,weight:400,style:'normal'}]});
function zip64(valid){
 const z=Buffer.from(zipSync({'hello.txt':strToU8('Example CV ZIP64')},{level:0}));
 const end=z.length-22,central=z.readUInt32LE(end+16),name=z.readUInt16LE(central+28),extraAt=central+46+name;
 const extra=valid?Buffer.alloc(28):Buffer.alloc(0);
 if(valid){extra.writeUInt16LE(1);extra.writeUInt16LE(24,2);extra.writeBigUInt64LE(BigInt(z.readUInt32LE(central+24)),4);extra.writeBigUInt64LE(BigInt(z.readUInt32LE(central+20)),12);}
 const out=Buffer.concat([z.subarray(0,extraAt),extra,z.subarray(extraAt)]);
 out.writeUInt32LE(0xffffffff,central+20);out.writeUInt32LE(0xffffffff,central+24);out.writeUInt32LE(0xffffffff,central+42);out.writeUInt16LE(extra.length,central+30);out.writeUInt32LE(z.readUInt32LE(end+12)+extra.length,end+extra.length+12);
 const zeAt=end+extra.length,ze=Buffer.alloc(56),loc=Buffer.alloc(20);ze.writeUInt32LE(0x06064b50);ze.writeBigUInt64LE(44n,4);ze.writeUInt16LE(45,12);ze.writeUInt16LE(45,14);ze.writeBigUInt64LE(1n,24);ze.writeBigUInt64LE(1n,32);ze.writeBigUInt64LE(BigInt(zeAt-central),40);ze.writeBigUInt64LE(BigInt(central),48);loc.writeUInt32LE(0x07064b50);loc.writeBigUInt64LE(BigInt(zeAt),8);loc.writeUInt32LE(1,16);const eocd=Buffer.from(out.subarray(zeAt));eocd.writeUInt16LE(65535,8);eocd.writeUInt16LE(65535,10);eocd.writeUInt32LE(0xffffffff,16);return Buffer.concat([out.subarray(0,zeAt),ze,loc,eocd]);
}
function woff(ttf){
 const n=ttf.readUInt16BE(4);let offset=44+n*20;const records=[];let compressed=0;
 for(let i=0;i<n;i++){const p=12+i*16;const raw=ttf.subarray(ttf.readUInt32BE(p+8),ttf.readUInt32BE(p+8)+ttf.readUInt32BE(p+12));const deflated=zlibDeflate(raw);const data=deflated.length<raw.length?deflated:raw;if(data!==raw)compressed++;records.push({tag:ttf.readUInt32BE(p),checksum:ttf.readUInt32BE(p+4),raw,data,offset});offset+=(data.length+3)&~3;}
 const b=Buffer.alloc(offset);b.write('wOFF');b.writeUInt32BE(ttf.readUInt32BE(0),4);b.writeUInt32BE(offset,8);b.writeUInt16BE(n,12);b.writeUInt32BE(12+16*n+records.reduce((s,r)=>s+((r.raw.length+3)&~3),0),16);b.writeUInt16BE(1,20);
 records.forEach((r,i)=>{const p=44+i*20;b.writeUInt32BE(r.tag,p);b.writeUInt32BE(r.offset,p+4);b.writeUInt32BE(r.data.length,p+8);b.writeUInt32BE(r.raw.length,p+12);b.writeUInt32BE(r.checksum,p+16);r.data.copy(b,r.offset);});assert.ok(compressed>0);return b;
}
test('Satori scoped override resolves exactly fflate 0.7.5; ordinary compression and ZIP roundtrip',()=>{
 const resolved=scoped.resolve('fflate');const version=JSON.parse(readFileSync(new URL('../package.json','file://'+resolved))).version;
 assert.equal(version,'0.7.5');const raw=strToU8('Example CV '.repeat(100));assert.deepEqual(fflate.decompressSync(fflate.compressSync(raw)),raw);assert.equal(strFromU8(unzipSync(zipSync({'x.txt':raw}))['x.txt']),strFromU8(raw));
});
test('small valid ZIP64 extended size records decompress correctly',()=>assert.equal(strFromU8(unzipSync(zip64(true))['hello.txt']),'Example CV ZIP64'));
test('malformed ZIP64 missing required extra field terminates within hard subprocess limit',()=>{
 const code=`const {unzipSync}=require(${JSON.stringify(scoped.resolve('fflate'))});try{unzipSync(Buffer.from(process.argv[1],'base64'));process.exitCode=2}catch{console.log('rejected')}`;
 const r=spawnSync(process.execPath,['-e',code,zip64(false).toString('base64')],{encoding:'utf8',timeout:2000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/rejected/);
});
test('Satori SVG renders real TTF; WOFF compressed tables load with identical glyph paths',async()=>{
 const a=await render(font),b=await render(woff(font));assert.match(a,/<svg/);assert.match(a,/<path/);assert.equal(b,a);
});
