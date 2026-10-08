/** Runtime contract shared by the Worker and repository Restore preview trust boundaries. */
export type RestorePreviewDomain = "awards" | "experience" | "skills" | "education" | "projects" | "contact" | "website_links";
export type RestorePreviewJson = null | string | number | boolean | RestorePreviewJson[] | { [key: string]: RestorePreviewJson };
export type RestorePreviewContract = {
  status: "ready" | "no_change";
  source_event_id: string;
  source_occurred_at: string;
  domain: RestorePreviewDomain;
  historical_state: RestorePreviewJson;
  current_state: RestorePreviewJson;
  comparison: { before: RestorePreviewJson; after: RestorePreviewJson };
  expected_current_digest: string;
};

const DOMAINS: readonly RestorePreviewDomain[] = ["awards", "experience", "skills", "education", "projects", "contact", "website_links"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length
  && Object.keys(value).every(key => keys.includes(key));
const isText = (value: unknown): value is string => typeof value === "string" && !value.includes("\0")
  && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isPosition = (value: unknown) => Number.isInteger(value) && typeof value === "number" && value >= 0;

export function isRestorePreviewTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (day < 1 || day > days) return false;
  if (zone !== "Z") {
    const offsetHours = Number(zone.slice(1, 3)), offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function exactTextObject(value: unknown, keys: readonly string[], nullable: readonly string[] = []): value is Record<string, string | null> {
  return isRecord(value) && exactKeys(value, keys) && keys.every(key => nullable.includes(key)
    ? value[key] === null || isText(value[key]) : isText(value[key]));
}

function validLocalizedPair(value: Record<string, unknown>, keys: readonly string[], nullable: readonly string[] = []): boolean {
  return exactTextObject(value.zh, keys, nullable) && exactTextObject(value.en, keys, nullable);
}

function validRows(value: unknown, validate: (row: unknown, index: number) => row is Record<string, unknown>): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 10_000) return false;
  let priorPosition = -1;
  return value.every((row, index) => {
    if (!validate(row, index) || !isRecord(row) || !isPosition(row.position) || (index > 0 && (row.position as number) <= priorPosition)) return false;
    priorPosition = row.position as number;
    return true;
  });
}

function validIdPosition(row: Record<string, unknown>, seen: Set<string>): boolean {
  if (!isUuid(row.id) || !isPosition(row.position)) return false;
  const id = row.id.toLowerCase();
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}

function validAwards(value: unknown): boolean {
  const ids = new Set<string>();
  return validRows(value, (raw): raw is Record<string, unknown> => isRecord(raw)
    && exactKeys(raw, ["id", "position", "zh", "en"]) && validIdPosition(raw, ids)
    && validLocalizedPair(raw, ["name", "year"]));
}

function validExperience(value: unknown): boolean {
  const ids = new Set<string>();
  return validRows(value, (raw): raw is Record<string, unknown> => isRecord(raw)
    && exactKeys(raw, ["id", "position", "zh", "en"]) && validIdPosition(raw, ids)
    && validLocalizedPair(raw, ["organization", "title", "period", "description", "location"], ["location"]));
}

function validSkills(value: unknown): boolean {
  const ids = new Set<string>();
  return validRows(value, (raw): raw is Record<string, unknown> => isRecord(raw)
    && exactKeys(raw, ["id", "position", "zh", "en"]) && validIdPosition(raw, ids)
    && validLocalizedPair(raw, ["title", "items"]));
}

function validEducation(value: unknown): boolean {
  const ids = new Set<string>();
  const categories = ["undergraduate", "graduate", "doctoral", "summerSchool", "custom"];
  return validRows(value, (raw): raw is Record<string, unknown> => {
    if (!isRecord(raw) || !exactKeys(raw, ["id", "position", "entry_type", "education_category", "zh", "en"])
      || !validIdPosition(raw, ids) || (raw.entry_type !== "standard" && raw.entry_type !== "summerSchool")) return false;
    const category = raw.education_category;
    if (category !== null && !categories.includes(String(category))) return false;
    if (category !== null && ((category === "summerSchool") !== (raw.entry_type === "summerSchool"))) return false;
    return validLocalizedPair(raw, ["title", "program", "period", "grade", "course_title", "course_description", "custom_category_label"],
      ["course_title", "course_description", "custom_category_label"]);
  });
}

function validProjects(value: unknown): boolean {
  const projectIds = new Set<string>(), methodIds = new Set<string>();
  return validRows(value, (raw): raw is Record<string, unknown> => {
    if (!isRecord(raw) || !exactKeys(raw, ["id", "position", "zh", "en", "methods"]) || !validIdPosition(raw, projectIds)
      || !validLocalizedPair(raw, ["title", "subtitle", "period", "description", "href"]) || !isRecord(raw.methods)
      || !exactKeys(raw.methods, ["zh", "en"])) return false;
    const methods = raw.methods;
    return (["zh", "en"] as const).every(locale => {
      if (!Array.isArray(methods[locale]) || methods[locale].length > 10_000) return false;
      let priorPosition = -1;
      return methods[locale].every((entry: unknown) => {
        if (!isRecord(entry) || !exactKeys(entry, ["id", "position", "value"]) || !isUuid(entry.id)
          || !isPosition(entry.position) || (entry.position as number) <= priorPosition || !isText(entry.value)) return false;
        const id = entry.id.toLowerCase();
        if (methodIds.has(id)) return false;
        methodIds.add(id);
        priorPosition = entry.position as number;
        return true;
      });
    });
  });
}

function validContact(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ["translations", "focus", "status"]) || !isRecord(value.translations)
    || !exactKeys(value.translations, ["zh", "en"]) || !validLocalizedPair(value.translations, ["contact_label", "availability"])) return false;
  const focusIds = new Set<string>(), statusIds = new Set<string>();
  const validEntries = (rows: unknown, status: boolean): boolean => validRows(rows, (raw): raw is Record<string, unknown> => {
    const keys = status ? ["id", "position", "status_type", "zh", "en"] : ["id", "position", "zh", "en"];
    if (!isRecord(raw) || !exactKeys(raw, keys) || !validIdPosition(raw, status ? statusIds : focusIds)
      || !validLocalizedPair(raw, ["title", "detail"])) return false;
    return !status || raw.status_type === "study" || raw.status_type === "graduation" || raw.status_type === "open";
  });
  return validEntries(value.focus, false) && validEntries(value.status, true);
}

function validWebsiteLinks(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ["shared", "translations", "navigation"])
    || !exactTextObject(value.shared, ["email", "github", "github_label", "linkedin_display_name", "email_label", "linkedin_label"])
    || !isRecord(value.translations) || !exactKeys(value.translations, ["zh", "en"]) || !Array.isArray(value.navigation)
    || value.navigation.length !== 5) return false;
  if (!("zh" in value.translations && "en" in value.translations)
    || !exactTextObject(value.translations.zh, ["linkedin_label", "linkedin_href", "portfolio_label", "updated_at_label"])
    || !exactTextObject(value.translations.en, ["linkedin_label", "linkedin_href", "portfolio_label", "updated_at_label"])) return false;
  const ids = new Set<string>();
  return value.navigation.every((raw: unknown, index: number) => {
    if (!isRecord(raw) || !exactKeys(raw, ["navigation_item_id", "position", "zh", "en"]) || !isUuid(raw.navigation_item_id)
      || raw.position !== index || !validLocalizedPair(raw, ["label"])) return false;
    const id = raw.navigation_item_id.toLowerCase();
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
}

export function isRestorePreviewAggregate(domain: RestorePreviewDomain, value: unknown): value is RestorePreviewJson {
  switch (domain) {
    case "awards": return validAwards(value);
    case "experience": return validExperience(value);
    case "skills": return validSkills(value);
    case "education": return validEducation(value);
    case "projects": return validProjects(value);
    case "contact": return validContact(value);
    case "website_links": return validWebsiteLinks(value);
  }
}

function isBoundedJson(value: unknown, depth = 0): value is RestorePreviewJson {
  if (depth > 24) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 10_000 && value.every(item => isBoundedJson(item, depth + 1));
  return isRecord(value) && Object.keys(value).length <= 256 && Object.values(value).every(item => isBoundedJson(item, depth + 1));
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((item, index) => equalJson(item, right[index]));
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && equalJson(left[key], right[key]));
}

function sameWebsiteIdentities(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right) || !Array.isArray(left.navigation) || !Array.isArray(right.navigation)) return false;
  const leftNavigation = left.navigation, rightNavigation = right.navigation;
  return leftNavigation.length === rightNavigation.length && leftNavigation.every((row, index) => isRecord(row)
    && isRecord(rightNavigation[index]) && typeof row.navigation_item_id === "string"
    && typeof rightNavigation[index].navigation_item_id === "string"
    && row.navigation_item_id.toLowerCase() === rightNavigation[index].navigation_item_id.toLowerCase());
}

export function validateRestorePreviewContract(value: unknown, expectedEventId: string): RestorePreviewContract | null {
  const keys = ["status", "source_event_id", "source_occurred_at", "domain", "historical_state", "current_state", "comparison", "expected_current_digest"];
  if (!isRecord(value) || !exactKeys(value, keys) || (value.status !== "ready" && value.status !== "no_change")
    || !isUuid(value.source_event_id) || value.source_event_id.toLowerCase() !== expectedEventId.toLowerCase()
    || !isRestorePreviewTimestamp(value.source_occurred_at) || typeof value.domain !== "string" || !DOMAINS.includes(value.domain as RestorePreviewDomain)) return null;
  const domain = value.domain as RestorePreviewDomain;
  if (!isRestorePreviewAggregate(domain, value.historical_state) || !isRestorePreviewAggregate(domain, value.current_state)
    || !isRecord(value.comparison) || !exactKeys(value.comparison, ["before", "after"])
    || !isBoundedJson(value.comparison.before) || !isBoundedJson(value.comparison.after)
    || !equalJson(value.comparison.before, value.current_state) || !equalJson(value.comparison.after, value.historical_state)
    || typeof value.expected_current_digest !== "string" || !/^[0-9a-f]{64}$/.test(value.expected_current_digest)) return null;
  const unchanged = equalJson(value.historical_state, value.current_state);
  if ((value.status === "no_change") !== unchanged) return null;
  if (domain === "website_links" && !sameWebsiteIdentities(value.historical_state, value.current_state)) return null;
  return value as RestorePreviewContract;
}
