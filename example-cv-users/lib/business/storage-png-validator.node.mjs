// Strict bounded PNG subset decoder.
import { inflateSync } from 'node:zlib';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const channels = Object.freeze({ 0: 1, 2: 3, 4: 2, 6: 4 });
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export function pngCRC(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateBoundedPNG(bytes, {
  mime_type, maxPixels = 20_000_000, maxFrames = 1, validatorVersion = 'png-strict-v1',
} = {}) {
  const reject = code => Object.freeze({ valid: false, code, validatorVersion, mime_type });
  if (mime_type !== 'image/png') return reject('CONTENT_DECODER_UNAVAILABLE');
  const invalid = () => reject('INVALID_CONTENT');
  if (!(bytes instanceof Uint8Array) || bytes.length > 5_242_880 || bytes.length < 45 ||
      maxFrames !== 1 || !Number.isSafeInteger(maxPixels) || maxPixels < 1 ||
      maxPixels > 20_000_000 || validatorVersion !== 'png-strict-v1') return invalid();

  const raw = Buffer.from(bytes);
  if (!raw.subarray(0, 8).equals(signature)) return invalid();
  const compressed = [];
  let width, height, bytesPerPixel;
  let ended = false;
  let chunkCount = 0;
  let offset = 8;
  while (offset < raw.length) {
    if (++chunkCount > 256 || offset + 12 > raw.length) return invalid();
    const size = raw.readUInt32BE(offset);
    const dataEnd = offset + 8 + size;
    if (dataEnd + 4 > raw.length) return invalid();
    const type = raw.toString('latin1', offset + 4, offset + 8);
    const data = raw.subarray(offset + 8, dataEnd);
    if (pngCRC(raw.subarray(offset + 4, dataEnd)) !== raw.readUInt32BE(dataEnd)) return invalid();

    if (type === 'IHDR') {
      if (offset !== 8 || size !== 13) return invalid();
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bytesPerPixel = channels[data[9]];
      if (!width || !height || width * height > Math.min(maxPixels, 2_000_000) ||
          data[8] !== 8 || !bytesPerPixel || data[10] || data[11] || data[12]) return invalid();
    } else if (type === 'IDAT') {
      if (width === undefined || !size) return invalid();
      compressed.push(data);
    } else if (type === 'IEND') {
      if (!compressed.length || size || dataEnd + 4 !== raw.length) return invalid();
      ended = true;
    } else {
      // Reject animation, metadata, unsupported color modes and other chunks.
      return invalid();
    }
    offset = dataEnd + 4;
  }
  if (!ended) return invalid();

  const input = Buffer.concat(compressed);
  const stride = width * bytesPerPixel + 1;
  const decodedLength = stride * height;
  if (decodedLength > 10 * 1024 ** 2) return invalid();
  let decoded;
  try {
    decoded = inflateSync(input, { maxOutputLength: decodedLength, info: true });
  } catch {
    return invalid();
  }
  if (decoded.buffer.length !== decodedLength || decoded.engine.bytesWritten !== input.length) return invalid();
  for (let row = 0; row < height; row++) {
    if (decoded.buffer[row * stride] > 4) return invalid();
  }
  return Object.freeze({ valid: true, validatorVersion, mime_type, width, height, frames: 1 });
}
