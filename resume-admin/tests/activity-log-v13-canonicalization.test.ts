import { describe, expect, it } from "vitest";
import { canonicalizeV13, normalizeV13Cidr, signV13 } from "./activity-log-v13-canonical";
import { v13GoldenVectors } from "./activity-log-v13-vectors";

describe("Activity Log V1.3 canonical byte protocol", () => {
  it.each(v13GoldenVectors)("matches the independent fixed golden vector: $name", ({ fields, canonicalHex, hmacHex }) => {
    expect(canonicalizeV13(fields).toString("hex")).toBe(canonicalHex);
    expect(signV13(fields)).toBe(hmacHex);
  });

  it("uses UTF-8 byte length and preserves text without Unicode normalization", () => {
    const vector = v13GoldenVectors[1];
    expect(Buffer.from("深圳 🧭", "utf8").byteLength).toBe(11);
    expect(canonicalizeV13(vector.fields).toString("hex")).toContain("5631313ae6b7b1e59cb320f09fa7ad");
    expect("é".normalize("NFD")).not.toBe("é".normalize("NFC"));
    expect(() => canonicalizeV13({ ...vector.fields, city: "\ud800" })).toThrow("Invalid V1.3 Unicode scalar sequence");
  });

  it("keeps NULL distinct from empty text and literal null while framing delimiter/newline text", () => {
    const bytes = canonicalizeV13(v13GoldenVectors[2].fields);
    expect(bytes.toString("hex")).toContain("56303a4e3b");
    expect(bytes.toString("hex")).toContain("56343a6e756c6c");
    expect(bytes.toString("hex")).toContain("5c0a");
  });

  it("normalizes CIDRs to network form and an expanded IPv6 representation", () => {
    expect(normalizeV13Cidr("188.253.112.99/24")).toBe("188.253.112.0/24");
    expect(normalizeV13Cidr("2001:0DB8:0001:abcd::1/48")).toBe(
      "2001:0db8:0001:0000:0000:0000:0000:0000/48",
    );
    expect(() => normalizeV13Cidr("203.0.113.0/32")).toThrow();
    expect(() => normalizeV13Cidr("2001:db8::/64")).toThrow();
  });

  it("changes the signature when any signed field changes", () => {
    const base = v13GoldenVectors[0].fields;
    const changes: Partial<typeof base>[] = [
      { protocolVersion: 2 },
      { purpose: "other-purpose" },
      { keyId: "other-key" },
      { eventId: "aaaaaaaa-0000-4000-8000-000000000999" },
      { requestId: "bbbbbbbb-0000-4000-8000-000000000999" },
      { actorUserId: "10000000-0000-4000-8000-000000000003" },
      { resumeId: "20000000-0000-4000-8000-000000000001" },
      { eventKind: "system_change" },
      { outcome: "applied" },
      { sectionKey: "education" },
      { operation: "delete" },
      { failureStage: "idempotency" },
      { failureCode: "idempotency_conflict" },
      { issuedAtEpoch: (base.issuedAtEpoch ?? 0n) + 1n },
      { ipNetwork: "203.0.113.0/24" },
      { countryCode: "US" },
      { region: "California" },
      { city: "San Francisco" },
    ];
    const originalSignature = signV13(base);
    for (const change of changes) {
      expect(signV13({ ...base, ...change })).not.toBe(originalSignature);
    }
  });
});
