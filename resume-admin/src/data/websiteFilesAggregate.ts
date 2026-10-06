export type WebsiteLinksAggregate = {
  shared: { email: string; github: string; github_label: string; linkedin_display_name: string; email_label: string; linkedin_label: string };
  translations: Record<"zh" | "en", { linkedin_label: string; linkedin_href: string; portfolio_label: string; updated_at_label: string }>;
  navigation: Array<{ navigation_item_id: string; position: number; zh: { label: string }; en: { label: string } }>;
};
export type FilesAggregate = { translations: Record<"zh" | "en", { portfolio_href: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const text = (value: unknown) => typeof value === "string" && !value.includes("\0") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);

export function validateWebsiteLinksAggregate(value: unknown): WebsiteLinksAggregate {
  if (!object(value) || !exactKeys(value, ["shared", "translations", "navigation"]) || !object(value.shared)
    || !exactKeys(value.shared, ["email", "github", "github_label", "linkedin_display_name", "email_label", "linkedin_label"])
    || !Object.values(value.shared).every(text) || !object(value.translations) || !exactKeys(value.translations, ["zh", "en"])
    || !Array.isArray(value.navigation) || value.navigation.length !== 5) throw new Error("Invalid Website & Links aggregate");
  for (const locale of ["zh", "en"] as const) {
    const row = value.translations[locale];
    if (!object(row) || !exactKeys(row, ["linkedin_label", "linkedin_href", "portfolio_label", "updated_at_label"]) || !Object.values(row).every(text)) throw new Error("Invalid Website & Links translations");
  }
  const ids = new Set<string>(); const positions = new Set<number>(); let priorPosition = -1;
  for (const row of value.navigation) {
    if (!object(row) || !exactKeys(row, ["navigation_item_id", "position", "zh", "en"]) || typeof row.navigation_item_id !== "string"
      || !uuid.test(row.navigation_item_id) || ids.has(row.navigation_item_id.toLowerCase()) || !Number.isInteger(row.position)
      || (row.position as number) !== priorPosition + 1
      || positions.has(row.position as number) || !object(row.zh) || !exactKeys(row.zh, ["label"]) || !text(row.zh.label)
      || !object(row.en) || !exactKeys(row.en, ["label"]) || !text(row.en.label)) throw new Error("Invalid navigation aggregate");
    ids.add(row.navigation_item_id.toLowerCase()); positions.add(row.position as number); priorPosition = row.position as number;
  }
  return value as WebsiteLinksAggregate;
}

export function validateFilesAggregate(value: unknown): FilesAggregate {
  if (!object(value) || !exactKeys(value, ["translations"]) || !object(value.translations) || !exactKeys(value.translations, ["zh", "en"])) throw new Error("Invalid Files aggregate");
  for (const locale of ["zh", "en"] as const) {
    const row = value.translations[locale];
    if (!object(row) || !exactKeys(row, ["portfolio_href"]) || !text(row.portfolio_href)) throw new Error("Invalid Files reference state");
  }
  return value as FilesAggregate;
}

export function canonicalizeWebsiteLinks(value: unknown): string {
  const v = validateWebsiteLinksAggregate(value);
  return JSON.stringify({
    shared: { email: v.shared.email, github: v.shared.github, github_label: v.shared.github_label,
      linkedin_display_name: v.shared.linkedin_display_name, email_label: v.shared.email_label, linkedin_label: v.shared.linkedin_label },
    translations: Object.fromEntries((["zh", "en"] as const).map(locale => [locale, {
      linkedin_label: v.translations[locale].linkedin_label, linkedin_href: v.translations[locale].linkedin_href,
      portfolio_label: v.translations[locale].portfolio_label, updated_at_label: v.translations[locale].updated_at_label,
    }])) as WebsiteLinksAggregate["translations"],
    navigation: v.navigation.map(row => ({ navigation_item_id: row.navigation_item_id.toLowerCase(), position: row.position,
      zh: { label: row.zh.label }, en: { label: row.en.label } })),
  });
}
export function canonicalizeFiles(value: unknown): string {
  const v = validateFilesAggregate(value);
  return JSON.stringify({ translations: { zh: { portfolio_href: v.translations.zh.portfolio_href }, en: { portfolio_href: v.translations.en.portfolio_href } } });
}

/** Only UUID-scoped, immutable candidate PDFs are considered managed D-7 objects. */
export function managedResumePdfObjectPath(origin: string | undefined, resumeId: string, locale: "zh" | "en", reference: string | null | undefined): string | null {
  if (!origin || !uuid.test(resumeId) || !reference) return null;
  try {
    const base = new URL(origin); const url = new URL(reference);
    if (!/^https:$/.test(base.protocol) || base.username || base.password || base.search || base.hash || !["", "/"].includes(base.pathname)
      || url.origin !== base.origin || url.username || url.password || url.search || url.hash || reference.includes("%") || reference.includes("\\")) return null;
    const prefix = `/storage/v1/object/public/resume-files/${resumeId}/${locale}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const filename = url.pathname.slice(prefix.length);
    if (!new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.pdf$`).test(filename)
      || reference !== `${base.origin}${prefix}${filename}`) return null;
    return `${resumeId}/${locale}/${filename}`;
  } catch { return null; }
}
