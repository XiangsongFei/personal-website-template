import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { verifyWirePng, versionReadTarget } from './version-read.mjs'

const field = {
  project: 'zzzzzzzzzzzzzzzzzzzz',
  objectKey: '22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.png',
  nativeVersion: '55555555-5555-4555-8555-555555555555',
  requestId: '11111111-1111-4111-8111-111111111111',
}
const url = versionReadTarget(field)
const sample = Buffer.from('wire test')
const proof = {
  size: sample.length,
  sha256: createHash('sha256').update(sample).digest('hex'),
  expectedUrl: url,
  decode(bytes) { assert.deepEqual(bytes, sample) },
}
function received(body = sample, extra = {}, actualUrl = url) {
  const r = new Response(body, { headers: {
    'content-type':'image/png','content-length':String(sample.length), ...extra
  } })
  Object.defineProperty(r,'url',{value:actualUrl})
  return r
}
test('exact version, new cache key and no signing parameters', () => {
  assert.deepEqual([...new URL(url).searchParams], [['versionId',field.nativeVersion],['cacheNonce',field.requestId]])
  for (const delta of [{nativeVersion:'../'}, {objectKey:'../png'}, {requestId:field.nativeVersion}])
    assert.throws(()=>versionReadTarget({...field,...delta}))
})
test('never turns missing wire metadata into version/identity attestation', async () => {
  const observed = await verifyWirePng(received(),proof)
  assert.deepEqual(observed,{bytes:sample,wireRequestId:null,cache:null,age:null})
})
test('cache hit, changed target, partial bytes and wrong full digest fail closed', async () => {
  const cases = [
    received(sample,{'cf-cache-status':'HIT'}),
    received(sample,{age:'5'}),
    received(sample,{},url+'-changed'),
    received(sample,{'content-range':'0-2/3'}),
    received(sample.subarray(1)),
    received(Buffer.alloc(sample.length)),
    received(Buffer.alloc(sample.length+1)),
  ]
  for (const r of cases) await assert.rejects(verifyWirePng(r,proof))
})
