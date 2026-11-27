import { createHash } from 'node:crypto'

const bucket = 'users-site-assets-private'
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const digest = /^[0-9a-f]{64}$/
const verifyKey = '11111111-1111-4111-8111-111111111111'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export function versionReadTarget({ project, objectKey, nativeVersion, requestId }) {
  const segments = typeof objectKey === 'string' ? objectKey.split('/') : []
  if (!/^[a-z]{20}$/.test(project) || segments.length !== 3 || !segments[2].endsWith('.png') ||
      ![segments[0], segments[1], segments[2].slice(0, -4), nativeVersion].every(value => uuid.test(value)) ||
      requestId !== verifyKey) throw Error('invalid PNG Verifier scope')
  const url = new URL('https://' + project + '.supabase.co/storage/v1/object/authenticated/' + bucket + '/' + objectKey)
  url.searchParams.set('versionId', nativeVersion)
  // A distinct cache key, not a server vote about cache or version.
  url.searchParams.set('cacheNonce', requestId)
  return url.href
}

export async function verifyWirePng(response, { size, sha256, expectedUrl, decode }) {
  const headers = response.headers
  const cache = headers.get('cf-cache-status')
  const age = headers.get('age')
  const encoding = headers.get('content-encoding')
  if (!Number.isSafeInteger(size) || size < 1 || size > 65536 || !digest.test(sha256) ||
      response.status !== 200 || response.redirected || response.url !== expectedUrl || !response.body ||
      headers.get('content-type') !== 'image/png' || headers.get('content-length') !== String(size) ||
      headers.has('content-range') || headers.has('location') ||
      (cache !== null && !['BYPASS', 'DYNAMIC', 'MISS'].includes(cache)) ||
      (age !== null && age !== '0') || (encoding !== null && encoding !== 'identity')) {
    await response.body?.cancel()
    throw Error('unverified PNG wire response')
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  let ended = false
  try {
    while (!ended) {
      const { value, done } = await reader.read()
      ended = done
      if (done) break
      total += value.length
      if (total > size) throw Error('PNG body exceeds frozen size')
      chunks.push(value)
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks, total)
  if (total !== size || hash(bytes) !== sha256) throw Error('PNG bytes differ from frozen sample')
  await decode(bytes)
  return { bytes, wireRequestId: headers.get('sb-request-id') ?? headers.get('x-request-id'),
    cache, age }
}
