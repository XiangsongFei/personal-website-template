import type { VersionHistoryDomain, VersionHistoryEntry, VersionHistoryJson, VersionHistoryScalar } from "./resumeRepository";

export type HistoryLocale = "en" | "zh" | "shared";
export type HistoryItemState = "added" | "removed" | "updated" | "reordered";
export type HistoryFieldValue = { recorded: true; value: VersionHistoryScalar } | { recorded: false } | { redacted: true };

export type HistoryFieldChange = {
  key: string;
  locale: HistoryLocale;
  kind: HistoryItemState;
  before: HistoryFieldValue;
  after: HistoryFieldValue;
};

export type HistoryItemChange = {
  /** A semantic key for the UI to localize; never an entity or event identifier. */
  itemType: string;
  state: HistoryItemState;
  /** A display label taken only from the historical event, or null for a localized neutral label. */
  label: string | null;
  fields: HistoryFieldChange[];
  children: HistoryItemChange[];
};

export type HistoryChangePresentation = {
  domain: VersionHistoryDomain;
  operation: VersionHistoryEntry["operation"];
  state: "changes" | "generic";
  items: HistoryItemChange[];
};

type Dict = Record<string, unknown>;
type ScalarMap = Record<string, VersionHistoryScalar>;
type LocaleMap = { en: ScalarMap; zh: ScalarMap };
type Row = { id: string; position: number; fields: LocaleMap; shared: ScalarMap; methods?: { en: Row[]; zh: Row[] } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDict = (value: unknown): value is Dict => typeof value === "object" && value !== null && !Array.isArray(value);
const isScalar = (value: unknown): value is VersionHistoryScalar => value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
const exactKeys = (value: Dict, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function generic(entry: VersionHistoryEntry): HistoryChangePresentation {
  return { domain: entry.domain, operation: entry.operation, state: "generic", items: [] };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (!isDict(left) || !isDict(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]));
}

function field(key: string, locale: HistoryLocale, before: VersionHistoryScalar | undefined, after: VersionHistoryScalar | undefined,
  beforePresent = true, afterPresent = true, kind: HistoryItemState = "updated"): HistoryFieldChange {
  return { key, locale, kind,
    before: beforePresent ? { recorded: true, value: before ?? null } : { recorded: false },
    after: afterPresent ? { recorded: true, value: after ?? null } : { recorded: false } };
}

function scalarFields(before: ScalarMap, after: ScalarMap, locale: HistoryLocale, aliases: Record<string, string> = {}): HistoryFieldChange[] {
  const result: HistoryFieldChange[] = [];
  for (const key of Object.keys({ ...before, ...after }).sort()) {
    if (!Object.hasOwn(before, key) || !Object.hasOwn(after, key)) throw new Error("field-set mismatch");
    const oldValue = before[key], newValue = after[key];
    if (!sameValue(oldValue, newValue)) result.push(field(aliases[key] ?? key, locale, oldValue, newValue));
  }
  return result;
}

function readScalarMap(value: unknown, keys: readonly string[], nullableKeys: readonly string[] = []): ScalarMap {
  if (!isDict(value) || !exactKeys(value, keys)) throw new Error("invalid fields");
  const result: ScalarMap = {};
  for (const key of keys) {
    const child = value[key];
    if (!isScalar(child) || (child === null && !nullableKeys.includes(key))) throw new Error("invalid scalar");
    result[key] = child;
  }
  return result;
}

function readLocaleFields(value: unknown, keys: readonly string[], nullableKeys: readonly string[] = []): LocaleMap {
  if (!isDict(value) || !exactKeys(value, ["en", "zh"])) throw new Error("invalid locales");
  return { en: readScalarMap(value.en, keys, nullableKeys), zh: readScalarMap(value.zh, keys, nullableKeys) };
}

function validateRowArray(value: unknown, domain: VersionHistoryDomain, denseOrder: boolean): Row[] {
  if (!Array.isArray(value)) throw new Error("invalid collection");
  const fieldsByDomain: Partial<Record<VersionHistoryDomain, readonly string[]>> = {
    awards: ["name", "year"],
    experience: ["organization", "title", "period", "description", "location"],
    skills: ["title", "items"],
    education: ["title", "program", "period", "grade", "course_title", "course_description", "custom_category_label"],
  };
  const keys = fieldsByDomain[domain];
  if (!keys || value.length > 64) throw new Error("unsupported collection");
  const ids = new Set<string>();
  const positions = new Set<number>();
  let priorPosition = -1;
  return value.map((raw, index) => {
    if (!isDict(raw)) throw new Error("invalid row");
    const education = domain === "education";
    const expected = ["id", "position", "en", "zh", ...(education ? ["entry_type", "education_category"] : [])];
    if (!exactKeys(raw, expected) || typeof raw.id !== "string" || !UUID.test(raw.id)
      || typeof raw.position !== "number" || !Number.isSafeInteger(raw.position) || raw.position < 0
      || ids.has(raw.id) || positions.has(raw.position) || raw.position <= priorPosition) throw new Error("invalid row identity/order");
    if (education && (raw.entry_type !== "standard" && raw.entry_type !== "summerSchool")) throw new Error("invalid education type");
    if (education && raw.education_category !== null && (typeof raw.education_category !== "string"
      || !["undergraduate", "graduate", "doctoral", "summerSchool", "custom"].includes(raw.education_category))) throw new Error("invalid education category");
    ids.add(raw.id); positions.add(raw.position);
    const nullable = domain === "experience" ? ["location"] : domain === "education" ? ["course_title", "course_description", "custom_category_label"] : [];
    const en = readScalarMap(raw.en, keys, nullable), zh = readScalarMap(raw.zh, keys, nullable);
    const shared: ScalarMap = {};
    if (education) {
      shared.entry_type = raw.entry_type as string;
      shared.education_category = raw.education_category as string | null;
    }
    // Some frozen writers permit gaps in BEFORE positions. The array must
    // remain strictly ordered; AFTER collections use dense positions.
    if (denseOrder && raw.position !== index) throw new Error("non-canonical order");
    priorPosition = raw.position;
    return { id: raw.id, position: raw.position, fields: { en, zh }, shared };
  });
}

function readProjectRows(value: unknown, denseOrder: boolean): Row[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error("invalid projects");
  const ids = new Set<string>();
  const positions = new Set<number>();
  let priorPosition = -1;
  return value.map((raw, index) => {
    if (!isDict(raw) || !exactKeys(raw, ["id", "position", "zh", "en", "methods"]) || typeof raw.id !== "string" || !UUID.test(raw.id)
      || typeof raw.position !== "number" || !Number.isSafeInteger(raw.position) || raw.position < 0
      || (denseOrder && raw.position !== index) || raw.position <= priorPosition || ids.has(raw.id) || positions.has(raw.position)) throw new Error("invalid project");
    ids.add(raw.id); positions.add(raw.position);
    priorPosition = raw.position;
    const keys = ["title", "subtitle", "period", "description", "href"];
    const fields = readLocaleFields({ en: raw.en, zh: raw.zh }, keys);
    if (!isDict(raw.methods) || !exactKeys(raw.methods, ["en", "zh"])) throw new Error("invalid methods");
    const methods = { en: readMethodRows(raw.methods.en, "en", denseOrder), zh: readMethodRows(raw.methods.zh, "zh", denseOrder) };
    return { id: raw.id, position: raw.position, fields, shared: {}, methods };
  });
}

function readMethodRows(value: unknown, locale: "en" | "zh", denseOrder: boolean): Row[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error("invalid methods");
  const ids = new Set<string>();
  const positions = new Set<number>();
  let priorPosition = -1;
  return value.map((raw, index) => {
    if (!isDict(raw) || !exactKeys(raw, ["id", "position", "value"]) || typeof raw.id !== "string" || !UUID.test(raw.id)
      || typeof raw.position !== "number" || !Number.isSafeInteger(raw.position) || raw.position < 0
      || (denseOrder && raw.position !== index) || raw.position <= priorPosition
      || typeof raw.value !== "string" || ids.has(raw.id) || positions.has(raw.position)) throw new Error("invalid method");
    ids.add(raw.id); positions.add(raw.position);
    priorPosition = raw.position;
    const fields: LocaleMap = locale === "en"
      ? { en: { value: raw.value }, zh: {} }
      : { en: {}, zh: { value: raw.value } };
    return { id: raw.id, position: raw.position, fields, shared: {} };
  });
}

function readContact(value: unknown, denseOrder: boolean): { translations: LocaleMap; focus: Row[]; status: Row[] } {
  if (!isDict(value) || !exactKeys(value, ["translations", "focus", "status"])) throw new Error("invalid contact");
  const translations = readLocaleFields(value.translations, ["contact_label", "availability"]);
  const readItems = (rawItems: unknown, kind: "focus" | "status"): Row[] => {
    if (!Array.isArray(rawItems) || rawItems.length > 32) throw new Error("invalid contact items");
    const ids = new Set<string>(), positions = new Set<number>();
    let priorPosition = -1;
    return rawItems.map((raw, index) => {
      const required = ["id", "position", "en", "zh", ...(kind === "status" ? ["status_type"] : [])];
      if (!isDict(raw) || !exactKeys(raw, required) || typeof raw.id !== "string" || !UUID.test(raw.id)
        || typeof raw.position !== "number" || !Number.isSafeInteger(raw.position) || raw.position < 0
        || (denseOrder && raw.position !== index) || raw.position <= priorPosition || ids.has(raw.id) || positions.has(raw.position)) throw new Error("invalid contact item");
      if (kind === "status" && !["study", "graduation", "open"].includes(String(raw.status_type))) throw new Error("invalid status type");
      ids.add(raw.id); positions.add(raw.position);
      priorPosition = raw.position;
      const shared: ScalarMap = kind === "status" ? { status_type: raw.status_type as string } : {};
      return { id: raw.id, position: raw.position, fields: readLocaleFields({ en: raw.en, zh: raw.zh }, ["title", "detail"]), shared };
    });
  };
  return { translations, focus: readItems(value.focus, "focus"), status: readItems(value.status, "status") };
}

function readWebsite(value: unknown): { shared: ScalarMap; translations: LocaleMap; navigation: Row[] } {
  if (!isDict(value) || !exactKeys(value, ["shared", "translations", "navigation"])) throw new Error("invalid links");
  const shared = readScalarMap(value.shared, ["email", "github", "github_label", "linkedin_display_name", "email_label", "linkedin_label"]);
  const translations = readLocaleFields(value.translations, ["linkedin_label", "linkedin_href", "portfolio_label", "updated_at_label"]);
  if (!Array.isArray(value.navigation) || value.navigation.length !== 5) throw new Error("invalid navigation");
  const ids = new Set<string>();
  const navigation = value.navigation.map((raw, index) => {
    if (!isDict(raw) || !exactKeys(raw, ["navigation_item_id", "position", "zh", "en"])
      || typeof raw.navigation_item_id !== "string" || !UUID.test(raw.navigation_item_id)
      || typeof raw.position !== "number" || !Number.isSafeInteger(raw.position) || raw.position !== index || ids.has(raw.navigation_item_id)) throw new Error("invalid navigation item");
    ids.add(raw.navigation_item_id);
    return { id: raw.navigation_item_id, position: raw.position,
      fields: readLocaleFields({ en: raw.en, zh: raw.zh }, ["label"]), shared: {} };
  });
  return { shared, translations, navigation };
}

function readProfile(value: unknown): { shared: ScalarMap; translations: LocaleMap } {
  if (!isDict(value) || !exactKeys(value, ["shared", "translations"]) || !isDict(value.shared)) throw new Error("invalid profile");
  const sharedKeys = ["graduation_value", "avatar_initials", "footer_name", "copyright", "photo_url"];
  const profileShared = value.shared;
  if (!exactKeys(profileShared, sharedKeys) || !["graduation_value", "avatar_initials", "footer_name", "copyright"].every(key => typeof profileShared[key] === "string")
    || !(profileShared.photo_url === null || (typeof profileShared.photo_url === "string" && profileShared.photo_url.length > 0))) throw new Error("invalid profile fields");
  const shared = { graduation_value: profileShared.graduation_value as string, avatar_initials: profileShared.avatar_initials as string,
    footer_name: profileShared.footer_name as string, copyright: profileShared.copyright as string };
  const translations = readLocaleFields(value.translations, ["name", "nav_about_label", "email_action_label", "graduation_label", "avatar_label", "contact_focus_heading", "contact_status_heading"]);
  return { shared, translations };
}

function labelFor(domain: VersionHistoryDomain, before: Row | null, after: Row | null, locale: HistoryLocale = "en"): string | null {
  const orderByDomain: Partial<Record<VersionHistoryDomain, string[]>> = {
    awards: ["name"], experience: ["title", "organization"], skills: ["title"], education: ["title", "program"],
    projects: ["title"], contact: ["title", "detail"], website_links: ["label"],
  };
  const candidates: unknown[] = [];
  for (const row of [after, before]) {
    if (!row) continue;
    const locales = locale === "shared" ? [] : [locale, locale === "en" ? "zh" : "en"] as const;
    for (const currentLocale of locales) {
      for (const key of orderByDomain[domain] ?? []) candidates.push(row.fields[currentLocale]?.[key]);
    }
  }
  for (const candidate of candidates) if (typeof candidate === "string" && candidate.trim() && candidate.length <= 160) return candidate.trim();
  return null;
}

function neutralItemType(entry: VersionHistoryEntry): string {
  const known: Record<string, string> = {
    award_entry: "award", award_list: "awards", experience_entry: "experience_entry", experience_list: "experience",
    skill_group: "skill_group", skill_group_list: "skills", education_entry: "education_entry", education_list: "education",
    project_entry: "project", project_list: "projects", contact_focus_item: "contact_focus", contact_status_item: "contact_status",
    contact_section: "contact", profile_settings: "profile_details", profile_image: "profile_photo", public_link: "public_link",
    website_links_settings: "website_links",
  };
  return known[entry.entityType] ?? "recorded_item";
}

function itemState(operation: VersionHistoryEntry["operation"]): HistoryItemState {
  if (operation === "create" || operation === "upload") return "added";
  if (operation === "delete" || operation === "remove") return "removed";
  if (operation === "reorder") return "reordered";
  return "updated";
}

function presentV1(entry: VersionHistoryEntry): HistoryChangePresentation {
  if (entry.comparison.kind !== "entity_fields" || !Object.keys(entry.comparison.changes).length || entry.domain === "files") return generic(entry);
  const changes = entry.comparison.changes;
  if (Object.values(changes).some(change => !isDict(change) || !exactKeys(change, ["before", "after"])
    || !isScalar(change.before) || !isScalar(change.after))) return generic(entry);
  if (entry.domain === "profile" && entry.entityType === "profile_image") {
    if (entry.operation !== "update" || Object.keys(changes).length !== 1 || !Object.hasOwn(changes, "object_key")) return generic(entry);
    return { domain: entry.domain, operation: "update", state: "changes", items: [{ itemType: "profile_photo", state: "updated", label: null,
      fields: [{ key: "photo", locale: "shared", kind: "updated", before: { redacted: true }, after: { redacted: true } }], children: [] }] };
  }
  const allowedByEntity: Record<string, readonly string[]> = {
    award_entry: ["name", "year", "position"],
    experience_entry: ["organization", "role", "period", "description", "location", "position"],
    skill_group: ["title", "items", "position"],
    education_entry: ["institution", "title", "program", "date", "grade", "course_name", "course_description", "position"],
    project_entry: ["title", "course_title", "description", "url", "methods", "position"],
    contact_focus_item: ["title", "detail", "position"],
    contact_status_item: ["title", "detail", "status_type", "date", "position"],
    public_link: ["email_address", "email_label", "github_url", "github_label", "linkedin_url", "linkedin_label", "linkedin_display_name", "linkedin_homepage_label"],
    profile_settings: ["graduation_value", "avatar_initials", "footer_name", "copyright"],
  };
  const domainByEntity: Record<string, VersionHistoryDomain> = {
    award_entry: "awards", experience_entry: "experience", skill_group: "skills", education_entry: "education",
    project_entry: "projects", contact_focus_item: "contact", contact_status_item: "contact",
    public_link: "website_links", profile_settings: "profile",
  };
  const allowed = allowedByEntity[entry.entityType];
  if (!allowed || domainByEntity[entry.entityType] !== entry.domain
    || Object.keys(changes).some(key => !allowed.includes(key) || key === "object_key" || key === "photo_url")) return generic(entry);
  const fields: HistoryFieldChange[] = [];
  let reordered = false;
  for (const [rawKey, change] of Object.entries(changes).sort(([a], [b]) => a.localeCompare(b))) {
    const key = rawKey;
    const locale: HistoryLocale = "shared";
    if (key === "position") { reordered = !sameValue(change.before, change.after); continue; }
    fields.push({ key, locale, kind: itemState(entry.operation), before: { recorded: true, value: change.before }, after: { recorded: true, value: change.after } });
  }
  const rowType = neutralItemType(entry);
  const labelCandidate = fields.find(change => ["name", "title", "organization", "role", "program", "institution"].includes(change.key));
  const candidate = labelCandidate && "recorded" in labelCandidate.after && labelCandidate.after.recorded && typeof labelCandidate.after.value === "string" ? labelCandidate.after.value
    : labelCandidate && "recorded" in labelCandidate.before && labelCandidate.before.recorded && typeof labelCandidate.before.value === "string" ? labelCandidate.before.value : null;
  const item: HistoryItemChange = { itemType: rowType, state: reordered && fields.length === 0 ? "reordered" : itemState(entry.operation),
    label: candidate?.trim() || null, fields, children: [] };
  const items = [item];
  if (reordered && fields.length > 0) items.push({ itemType: rowType, state: "reordered", label: item.label, fields: [], children: [] });
  return { domain: entry.domain, operation: entry.operation, state: "changes", items };
}

function rowItem(domain: VersionHistoryDomain, entry: VersionHistoryEntry, before: Row | null, after: Row | null): HistoryItemChange {
  const state: HistoryItemState = before === null ? "added" : after === null ? "removed" : "updated";
  const fields: HistoryFieldChange[] = [];
  const methodChildren: HistoryItemChange[] = [];
  for (const locale of ["en", "zh"] as const) {
    if (!before || !after) {
      const row = after ?? before!;
      for (const key of Object.keys(row.fields[locale]).sort()) {
        fields.push(field(key, locale, before ? row.fields[locale][key] : undefined, after ? row.fields[locale][key] : undefined,
          before !== null, after !== null, state));
      }
    } else {
      fields.push(...scalarFields(before.fields[locale], after.fields[locale], locale));
    }
  }
  for (const key of Object.keys({ ...(before?.shared ?? {}), ...(after?.shared ?? {}) }).sort()) {
    const oldValue = before?.shared[key], newValue = after?.shared[key];
    if (before && after && sameValue(oldValue, newValue)) continue;
    if (!before || !after) fields.push(field(key, "shared", oldValue, newValue, Boolean(before), Boolean(after), state));
    else fields.push(field(key, "shared", oldValue, newValue));
  }
  if (before?.methods || after?.methods) {
    for (const locale of ["en", "zh"] as const) methodChildren.push(...compareRows("projects", entry, before?.methods?.[locale] ?? [], after?.methods?.[locale] ?? [], "project_method"));
  }
  const label = labelFor(domain, before, after);
  const kind = state === "updated" && fields.length === 0 && methodChildren.length ? "updated" : state;
  return { itemType: neutralItemType(entry), state: kind, label, fields, children: methodChildren };
}

function orderChanged(before: Row[], after: Row[]): Set<string> {
  const beforeCommon = before.map(row => row.id).filter(id => after.some(row => row.id === id));
  const afterCommon = after.map(row => row.id).filter(id => before.some(row => row.id === id));
  const moved = new Set<string>();
  for (let left = 0; left < beforeCommon.length; left++) for (let right = left + 1; right < beforeCommon.length; right++) {
    const first = beforeCommon[left]!, second = beforeCommon[right]!;
    if (afterCommon.indexOf(first) > afterCommon.indexOf(second)) { moved.add(first); moved.add(second); }
  }
  return moved;
}

function compareRows(domain: VersionHistoryDomain, entry: VersionHistoryEntry, before: Row[], after: Row[], methodType?: string): HistoryItemChange[] {
  const beforeById = new Map(before.map(row => [row.id, row]));
  const afterById = new Map(after.map(row => [row.id, row]));
  const moved = orderChanged(before, after);
  const result: HistoryItemChange[] = [];
  for (const row of after) {
    const old = beforeById.get(row.id) ?? null;
    const item = rowItem(domain, entry, old, row);
    if (!old || item.fields.length || item.children.length) result.push(methodType ? { ...item, itemType: methodType } : item);
  }
  for (const row of before) if (!afterById.has(row.id)) result.push(rowItem(domain, entry, row, null));
  for (const id of moved) {
    const row = afterById.get(id)!;
    result.push({ itemType: methodType ?? neutralItemType(entry), state: "reordered", label: labelFor(domain, beforeById.get(id)!, row), fields: [], children: [] });
  }
  return result;
}

function diffRows(domain: VersionHistoryDomain, entry: VersionHistoryEntry, before: unknown, after: unknown): HistoryItemChange[] {
  if (domain === "projects") {
    const oldRows = readProjectRows(before, false), newRows = readProjectRows(after, true);
    return compareRows(domain, entry, oldRows, newRows);
  }
  const oldRows = validateRowArray(before, domain, domain !== "contact"), newRows = validateRowArray(after, domain, true);
  return compareRows(domain, entry, oldRows, newRows);
}

function itemForObject(domain: VersionHistoryDomain, entry: VersionHistoryEntry, before: unknown, after: unknown, itemType: string): HistoryItemChange {
  if (!isDict(before) || !isDict(after)) throw new Error("invalid aggregate");
  if (domain === "profile") {
    const oldProfile = readProfile(before), newProfile = readProfile(after);
    const rowBefore: Row = { id: "internal", position: 0, fields: oldProfile.translations, shared: oldProfile.shared };
    const rowAfter: Row = { id: "internal", position: 0, fields: newProfile.translations, shared: newProfile.shared };
    const fields = rowItem(domain, entry, rowBefore, rowAfter).fields;
    const oldPhoto = (before.shared as Dict).photo_url, newPhoto = (after.shared as Dict).photo_url;
    if (!sameValue(oldPhoto, newPhoto)) fields.push({ key: "photo", locale: "shared", kind: "updated", before: { redacted: true }, after: { redacted: true } });
    return { itemType, state: "updated", label: null, fields, children: [] };
  }
  if (domain === "contact") {
    const oldContact = readContact(before, false), newContact = readContact(after, true);
    const fields = scalarFields(oldContact.translations.en, newContact.translations.en, "en")
      .concat(scalarFields(oldContact.translations.zh, newContact.translations.zh, "zh"));
    const children = compareRows(domain, entry, oldContact.focus, newContact.focus, "contact_focus")
      .concat(compareRows(domain, entry, oldContact.status, newContact.status, "contact_status"));
    const keep = fields.length > 0 || children.length > 0;
    return { itemType, state: "updated", label: null, fields: keep ? fields : [], children };
  }
  if (domain === "website_links") {
    const oldLinks = readWebsite(before), newLinks = readWebsite(after);
    const fields = scalarFields(oldLinks.shared, newLinks.shared, "shared")
      .concat(scalarFields(oldLinks.translations.en, newLinks.translations.en, "en"), scalarFields(oldLinks.translations.zh, newLinks.translations.zh, "zh"));
    const children = compareRows(domain, entry, oldLinks.navigation, newLinks.navigation, "navigation_item");
    return { itemType, state: "updated", label: null, fields, children };
  }
  throw new Error("unsupported object aggregate");
}

function presentV2(entry: VersionHistoryEntry): HistoryChangePresentation {
  if (entry.comparison.kind !== "aggregate" || entry.operation !== "update" || entry.domain === "files") return generic(entry);
  let items: HistoryItemChange[];
  const before: VersionHistoryJson = entry.comparison.before, after: VersionHistoryJson = entry.comparison.after;
  if (["awards", "experience", "skills", "education", "projects"].includes(entry.domain)) {
    items = diffRows(entry.domain, entry, before, after);
  } else if (entry.domain === "contact") {
    items = [itemForObject(entry.domain, entry, before, after, "contact")];
  } else if (entry.domain === "website_links") {
    items = [itemForObject(entry.domain, entry, before, after, "website_links")];
  } else if (entry.domain === "profile") {
    items = [itemForObject(entry.domain, entry, before, after, "profile_details")];
  } else return generic(entry);
  items = items.filter(item => item.state !== "updated" || item.fields.length > 0 || item.children.length > 0);
  if (items.length === 0) return generic(entry);
  return { domain: entry.domain, operation: entry.operation, state: "changes", items };
}

/** Build a safe, deterministic, client-only summary from this event's historical typed payload. */
export function presentVersionHistoryChange(entry: VersionHistoryEntry): HistoryChangePresentation {
  try {
    if (entry.payloadVersion === 1) return presentV1(entry);
    if (entry.payloadVersion === 2) return presentV2(entry);
    return generic(entry);
  } catch {
    return generic(entry);
  }
}
