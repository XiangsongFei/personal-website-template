export type ActivityLogV13Fields = {
  protocolVersion: number | null;
  purpose: string | null;
  keyId: string | null;
  eventId: string | null;
  requestId: string | null;
  actorUserId: string | null;
  resumeId: string | null;
  eventKind: string | null;
  outcome: string | null;
  sectionKey: string | null;
  operation: string | null;
  failureStage: string | null;
  failureCode: string | null;
  issuedAtEpoch: number | bigint | null;
  ipNetwork: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
};

const UTF8 = new TextEncoder();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalUuid(value: string | null): string | null {
  if (value === null) return null;
  if (!UUID_PATTERN.test(value)) throw new TypeError("Invalid V1.3 UUID");
  return value.toLowerCase();
}

function assertUnicodeScalars(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("Invalid V1.3 Unicode scalar sequence");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("Invalid V1.3 Unicode scalar sequence");
    }
  }
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.some((octet) => octet > 255) ? null : octets;
}

function parseIpv6(address: string): number[] | null {
  if (!address.includes(":") || address.includes("%")) return null;
  let input = address.toLowerCase();
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon < 0) return null;
    const octets = parseIpv4(input.slice(lastColon + 1));
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    input = `${input.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const compressed = input.includes("::");
  if (compressed && input.indexOf("::") !== input.lastIndexOf("::")) return null;
  const [leftText, rightText = ""] = compressed ? input.split("::") : [input, ""];
  const left = leftText === "" ? [] : leftText.split(":");
  const right = rightText === "" ? [] : rightText.split(":");
  const zeroCount = compressed ? 8 - left.length - right.length : 0;
  if ((compressed && zeroCount < 1) || (!compressed && left.length !== 8)) return null;
  const groups = [...left, ...Array.from({ length: zeroCount }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

export function normalizeActivityLogV13Cidr(value: string | null): string | null {
  if (value === null) return null;
  const slash = value.lastIndexOf("/");
  if (slash < 0) throw new TypeError("V1.3 CIDR requires a prefix");
  const address = value.slice(0, slash);
  const prefix = value.slice(slash + 1);
  if (!/^(0|[1-9][0-9]*)$/.test(prefix)) throw new TypeError("Invalid V1.3 CIDR prefix");
  const prefixNumber = Number(prefix);

  const ipv4 = parseIpv4(address);
  if (ipv4) {
    if (prefixNumber !== 24) throw new TypeError("V1.3 IPv4 network must be /24");
    ipv4[3] = 0;
    return `${ipv4.join(".")}/24`;
  }

  if (prefixNumber !== 48) throw new TypeError("V1.3 IPv6 network must be /48");
  const groups = parseIpv6(address);
  if (!groups) throw new TypeError("Invalid V1.3 IPv6 address");
  groups.fill(0, 3);
  return `${groups.map((group) => group.toString(16).padStart(4, "0")).join(":")}/48`;
}

function integerText(value: number | bigint | null): string | null {
  if (value === null) return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new TypeError("V1.3 integer must be safe");
  return value.toString(10);
}

function normalizedValues(fields: ActivityLogV13Fields): (string | null)[] {
  if (fields.protocolVersion !== null && !Number.isSafeInteger(fields.protocolVersion)) {
    throw new TypeError("V1.3 protocol version must be an integer");
  }
  return [
    integerText(fields.protocolVersion),
    fields.purpose,
    fields.keyId,
    canonicalUuid(fields.eventId),
    canonicalUuid(fields.requestId),
    canonicalUuid(fields.actorUserId),
    canonicalUuid(fields.resumeId),
    fields.eventKind,
    fields.outcome,
    fields.sectionKey,
    fields.operation,
    fields.failureStage,
    fields.failureCode,
    integerText(fields.issuedAtEpoch),
    normalizeActivityLogV13Cidr(fields.ipNetwork),
    fields.countryCode,
    fields.region,
    fields.city,
  ];
}

/** V1.3 protocol v1: fixed-order UTF-8 byte-length framing; text is not normalized. */
export function canonicalizeActivityLogV13(fields: ActivityLogV13Fields): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const value of normalizedValues(fields)) {
    if (value === null) {
      chunks.push(UTF8.encode("N;"));
      continue;
    }
    assertUnicodeScalars(value);
    const bytes = UTF8.encode(value);
    chunks.push(UTF8.encode(`V${bytes.byteLength}:`), bytes);
  }
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function decodeActivityLogV13Key(keyHex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new TypeError("Invalid V1.3 signing configuration");
  const key = new Uint8Array(32);
  for (let index = 0; index < keyHex.length; index += 2) {
    key[index / 2] = Number.parseInt(keyHex.slice(index, index + 2), 16);
  }
  return key;
}

export async function signActivityLogV13(fields: ActivityLogV13Fields, key: Uint8Array): Promise<string> {
  if (key.byteLength !== 32) throw new TypeError("Invalid V1.3 signing key length");
  const keyBuffer = new ArrayBuffer(key.byteLength);
  new Uint8Array(keyBuffer).set(key);
  const canonicalBytes = canonicalizeActivityLogV13(fields);
  const messageBuffer = new ArrayBuffer(canonicalBytes.byteLength);
  new Uint8Array(messageBuffer).set(canonicalBytes);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageBuffer);
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** UUIDv8 (RFC 9562 custom layout) from a domain-separated, safe identity tuple. */
export async function deriveActivityLogV13FailureEventId(input: {
  resumeId: string;
  actorUserId: string;
  requestId: string;
  failureStage: string;
  failureCode: string;
}): Promise<string> {
  const identity = [
    "example-cv:activity-log:v13b:event-id:v1",
    canonicalUuid(input.resumeId),
    canonicalUuid(input.actorUserId),
    canonicalUuid(input.requestId),
    input.failureStage,
    input.failureCode,
  ].join("\0");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", UTF8.encode(identity)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
