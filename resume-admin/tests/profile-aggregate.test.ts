import { describe, expect, it } from "vitest";
import { canonicalizeProfile, profileAggregateFromSection, profileSectionFromAggregate, validateProfileAggregate, type ProfileAggregate } from "../src/data/profileAggregate";
import { fixtureSections } from "../src/fixtures";

describe("Profile aggregate contract", () => {
  it("round-trips the complete shared and bilingual Profile shape without normalizing strings", () => {
    const aggregate = profileAggregateFromSection(fixtureSections.profile);
    expect(aggregate.shared).toMatchObject({ graduation_value: fixtureSections.profile.shared.graduationValue, photo_url: fixtureSections.profile.shared.photoUrl });
    expect(aggregate.translations.zh.avatar_label).toBe(fixtureSections.profile.translations.zh.avatarLabel);
    expect(profileSectionFromAggregate(aggregate)).toEqual(fixtureSections.profile);
    expect(canonicalizeProfile(aggregate)).toBe(JSON.stringify(aggregate));
  });

  it("preserves empty text and null photo values", () => {
    const profile = structuredClone(profileAggregateFromSection(fixtureSections.profile));
    profile.shared.copyright = "";
    profile.shared.photo_url = null;
    profile.translations.en.name = "  ";
    expect(validateProfileAggregate(profile)).toEqual(profile);
  });

  it.each([
    ["missing top-level key", ({ shared }: ProfileAggregate) => ({ shared })],
    ["extra shared key", (value: ProfileAggregate) => ({ ...value, shared: { ...value.shared, id: "x" } })],
    ["invalid translation field", (value: ProfileAggregate) => ({ ...value, translations: { ...value.translations, zh: { ...value.translations.zh, avatar_label: undefined } } })],
    ["NUL text", (value: ProfileAggregate) => ({ ...value, shared: { ...value.shared, copyright: "x\0y" } })],
    ["unpaired surrogate", (value: ProfileAggregate) => ({ ...value, shared: { ...value.shared, footer_name: "\ud800" } })],
    ["empty photo URL", (value: ProfileAggregate) => ({ ...value, shared: { ...value.shared, photo_url: "" } })],
    ["non-string text", (value: ProfileAggregate) => ({ ...value, translations: { ...value.translations, en: { ...value.translations.en, name: null as unknown as string } } })],
  ] as const)("rejects %s", (_label, transform) => {
    const base = profileAggregateFromSection(fixtureSections.profile);
    expect(() => validateProfileAggregate(transform(base))).toThrow("Profile");
  });

  it("leaves the byte bound to the caller while preserving the exact large payload", () => {
    const profile = profileAggregateFromSection(fixtureSections.profile);
    profile.translations.en.name = "x".repeat(196608);
    const canonical = canonicalizeProfile(profile);
    expect(new TextEncoder().encode(canonical).byteLength).toBeGreaterThan(196608);
    expect(JSON.parse(canonical).translations.en.name).toBe(profile.translations.en.name);
  });
});
