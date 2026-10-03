import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type V13SignedFields = {
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
  issuedAtEpoch: bigint | null;
  ipNetwork: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
};

export const V13_TEST_KEY_HEX =
  "a4c8f16d2b9037e5a1c6d8f04b2e9a73c5d1f8064a2e9b7c3d5f1086a2c4e9b7";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizedUuid(value: string | null): string | null {
  if (value === null) return null;
  if (!uuidPattern.test(value)) throw new TypeError("Invalid V1.3 UUID");
  return value.toLowerCase();
}

function assertUnicodeScalars(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("Invalid V1.3 Unicode scalar sequence");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("Invalid V1.3 Unicode scalar sequence");
    }
  }
}

function expandedIpv6(address: string): number[] {
  let input = address.toLowerCase();
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon < 0 || isIP(input.slice(lastColon + 1)) !== 4) throw new TypeError("Invalid V1.3 IPv6 address");
    const octets = input.slice(lastColon + 1).split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    input = `${input.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const compressed = input.includes("::");
  if (compressed && input.indexOf("::") !== input.lastIndexOf("::")) throw new TypeError("Invalid V1.3 IPv6 compression");
  const [leftText, rightText = ""] = compressed ? input.split("::") : [input, ""];
  const left = leftText === "" ? [] : leftText.split(":");
  const right = rightText === "" ? [] : rightText.split(":");
  const zeroCount = compressed ? 8 - left.length - right.length : 0;
  if ((compressed && zeroCount < 1) || (!compressed && left.length !== 8)) throw new TypeError("Invalid V1.3 IPv6 group count");
  const groups = [...left, ...Array.from({ length: zeroCount }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) throw new TypeError("Invalid V1.3 IPv6 group");
  return groups.map((part) => Number.parseInt(part, 16));
}

export function normalizeV13Cidr(value: string | null): string | null {
  if (value === null) return null;
  const slash = value.lastIndexOf("/");
  if (slash < 0) throw new TypeError("V1.3 CIDR requires an explicit prefix");
  const address = value.slice(0, slash);
  const prefixText = value.slice(slash + 1);
  if (!/^(0|[1-9][0-9]*)$/.test(prefixText)) throw new TypeError("Invalid V1.3 CIDR prefix");
  const prefix = Number(prefixText);

  if (isIP(address) === 4) {
    if (prefix !== 24) throw new TypeError("V1.3 IPv4 network must be /24");
    const octets = address.split(".").map(Number);
    octets[3] = 0;
    return `${octets.join(".")}/24`;
  }
  if (isIP(address) !== 6 || prefix !== 48) throw new TypeError("V1.3 IPv6 network must be /48");
  const groups = expandedIpv6(address);
  groups.fill(0, 3);
  return `${groups.map((group) => group.toString(16).padStart(4, "0")).join(":")}/48`;
}

function normalizeFieldValues(fields: V13SignedFields): (string | null)[] {
  if (fields.protocolVersion !== null && !Number.isInteger(fields.protocolVersion)) {
    throw new TypeError("V1.3 protocol version must be an integer");
  }
  return [
    fields.protocolVersion === null ? null : String(fields.protocolVersion),
    fields.purpose,
    fields.keyId,
    normalizedUuid(fields.eventId),
    normalizedUuid(fields.requestId),
    normalizedUuid(fields.actorUserId),
    normalizedUuid(fields.resumeId),
    fields.eventKind,
    fields.outcome,
    fields.sectionKey,
    fields.operation,
    fields.failureStage,
    fields.failureCode,
    fields.issuedAtEpoch === null ? null : fields.issuedAtEpoch.toString(10),
    normalizeV13Cidr(fields.ipNetwork),
    fields.countryCode,
    fields.region,
    fields.city,
  ];
}

/** V1.3 protocol v1 framing: NULL is ASCII `N;`; values are
 * ASCII `V<byteLength>:` followed by exactly that many UTF-8 bytes.
 * Fields are concatenated in the fixed protocol order above. */
export function canonicalizeV13(fields: V13SignedFields): Buffer {
  const chunks: Buffer[] = [];
  for (const value of normalizeFieldValues(fields)) {
    if (value === null) {
      chunks.push(Buffer.from("N;", "ascii"));
    } else {
      assertUnicodeScalars(value);
      const bytes = Buffer.from(value, "utf8");
      chunks.push(Buffer.from(`V${bytes.byteLength}:`, "ascii"), bytes);
    }
  }
  return Buffer.concat(chunks);
}

export function signV13(fields: V13SignedFields, keyHex = V13_TEST_KEY_HEX): string {
  return createHmac("sha256", Buffer.from(keyHex, "hex")).update(canonicalizeV13(fields)).digest("hex");
}
