import type { ProfileSection } from "../model";

export type ProfileAggregate = {
  shared: {
    graduation_value: string;
    avatar_initials: string;
    footer_name: string;
    copyright: string;
    photo_url: string | null;
  };
  translations: Record<"zh" | "en", {
    name: string;
    nav_about_label: string;
    email_action_label: string;
    graduation_label: string;
    avatar_label: string;
    contact_focus_heading: string;
    contact_status_heading: string;
  }>;
};

const PROFILE_KEYS = "shared,translations";
const SHARED_KEYS = "avatar_initials,copyright,footer_name,graduation_value,photo_url";
const TRANSLATION_KEYS = "avatar_label,contact_focus_heading,contact_status_heading,email_action_label,graduation_label,name,nav_about_label";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validText(value: unknown): value is string {
  if (typeof value !== "string" || value.includes("\0")) return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

export function validateProfileAggregate(value: unknown): ProfileAggregate {
  if (!isPlainObject(value) || Object.keys(value).sort().join(",") !== PROFILE_KEYS
    || !isPlainObject(value.shared) || Object.keys(value.shared).sort().join(",") !== SHARED_KEYS
    || !isPlainObject(value.translations) || Object.keys(value.translations).sort().join(",") !== "en,zh") {
    throw new Error("Profile aggregate has an invalid shape.");
  }
  const shared = value.shared;
  if (!validText(shared.graduation_value) || !validText(shared.avatar_initials)
    || !validText(shared.footer_name) || !validText(shared.copyright)
    || !(shared.photo_url === null || (validText(shared.photo_url) && shared.photo_url.length > 0))) {
    throw new Error("Profile shared fields are invalid.");
  }
  const translations = {} as ProfileAggregate["translations"];
  for (const locale of ["zh", "en"] as const) {
    const raw = value.translations[locale];
    if (!isPlainObject(raw) || Object.keys(raw).sort().join(",") !== TRANSLATION_KEYS
      || !Object.values(raw).every(validText)) throw new Error("Profile translations are invalid.");
    translations[locale] = {
      name: raw.name as string,
      nav_about_label: raw.nav_about_label as string,
      email_action_label: raw.email_action_label as string,
      graduation_label: raw.graduation_label as string,
      avatar_label: raw.avatar_label as string,
      contact_focus_heading: raw.contact_focus_heading as string,
      contact_status_heading: raw.contact_status_heading as string,
    };
  }
  return {
    shared: {
      graduation_value: shared.graduation_value as string,
      avatar_initials: shared.avatar_initials as string,
      footer_name: shared.footer_name as string,
      copyright: shared.copyright as string,
      photo_url: shared.photo_url as string | null,
    },
    translations,
  };
}

export function profileAggregateFromSection(section: ProfileSection): ProfileAggregate {
  return validateProfileAggregate({
    shared: {
      graduation_value: section.shared.graduationValue,
      avatar_initials: section.shared.avatarInitials,
      footer_name: section.shared.footerName,
      copyright: section.shared.copyright,
      photo_url: section.shared.photoUrl,
    },
    translations: Object.fromEntries((["zh", "en"] as const).map(locale => [locale, {
      name: section.translations[locale].name,
      nav_about_label: section.translations[locale].navAboutLabel,
      email_action_label: section.translations[locale].emailActionLabel,
      graduation_label: section.translations[locale].graduationLabel,
      avatar_label: section.translations[locale].avatarLabel,
      contact_focus_heading: section.translations[locale].contactFocusHeading,
      contact_status_heading: section.translations[locale].contactStatusHeading,
    }])) as ProfileAggregate["translations"],
  });
}

export function profileSectionFromAggregate(value: unknown): ProfileSection {
  const profile = validateProfileAggregate(value);
  const translation = (locale: "zh" | "en") => ({
    name: profile.translations[locale].name,
    navAboutLabel: profile.translations[locale].nav_about_label,
    emailActionLabel: profile.translations[locale].email_action_label,
    graduationLabel: profile.translations[locale].graduation_label,
    avatarLabel: profile.translations[locale].avatar_label,
    contactFocusHeading: profile.translations[locale].contact_focus_heading,
    contactStatusHeading: profile.translations[locale].contact_status_heading,
  });
  return {
    shared: {
      graduationValue: profile.shared.graduation_value,
      avatarInitials: profile.shared.avatar_initials,
      footerName: profile.shared.footer_name,
      copyright: profile.shared.copyright,
      photoUrl: profile.shared.photo_url,
    },
    translations: { zh: translation("zh"), en: translation("en") },
  };
}

export function canonicalizeProfile(value: unknown): string {
  return JSON.stringify(validateProfileAggregate(value));
}
