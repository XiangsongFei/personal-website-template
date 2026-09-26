import { resumeContent, type ResumeContent, type ResumeLocale, type ResumeLocaleContent } from "./resume";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

const hasKeys = (value: Record<string, unknown>, keys: string[]) =>
  keys.every(key => Object.prototype.hasOwnProperty.call(value, key));

const isLocalizedString = (value: unknown): value is Record<ResumeLocale, string> =>
  isRecord(value) && isString(value.zh) && isString(value.en);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

const hasUniqueIds = (items: unknown[]): boolean => {
  const ids = items.map(item => isRecord(item) ? item.id : undefined);
  return ids.every(isString) && new Set(ids).size === ids.length;
};

const isEducationEntry = (value: unknown): boolean => {
  if (!isRecord(value) || !hasKeys(value, ["id", "entryType", "title", "program", "period", "grade"])) return false;
  if (!["id", "title", "program", "period", "grade"].every(key => isString(value[key]))) return false;
  if (value.entryType !== "standard" && value.entryType !== "summerSchool") return false;
  return ["courseTitle", "courseDescription"].every(key => value[key] === undefined || isString(value[key]));
};

const isExperienceEntry = (value: unknown): boolean =>
  isRecord(value) &&
  hasKeys(value, ["id", "organization", "title", "period", "description"]) &&
  ["id", "organization", "title", "period", "description"].every(key => isString(value[key])) &&
  (value.location === undefined || isString(value.location));

const isProjectEntry = (value: unknown): boolean =>
  isRecord(value) &&
  hasKeys(value, ["id", "title", "subtitle", "period", "methods", "description", "href"]) &&
  ["id", "title", "subtitle", "period", "description", "href"].every(key => isString(value[key])) &&
  isStringArray(value.methods);

const isSkillGroup = (value: unknown): boolean =>
  isRecord(value) && hasKeys(value, ["id", "title", "items"]) && ["id", "title", "items"].every(key => isString(value[key]));

const isAward = (value: unknown): boolean =>
  isRecord(value) && hasKeys(value, ["id", "name", "year"]) && ["id", "name", "year"].every(key => isString(value[key]));

const isFocusItem = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 2 && value.every(isString);

const isStatusItem = (value: unknown): boolean =>
  isRecord(value) && hasKeys(value, ["type", "title", "detail"]) && ["type", "title", "detail"].every(key => isString(value[key]));

const localeKeys = [
  "intro", "nav", "education", "experience", "projectHeading", "skills", "honors", "edu", "jobs", "projects",
  "skillGroups", "honorsList", "contact", "availability", "portfolioLabel", "portfolioHref", "kaggleLabel", "updatedAt",
  "linkedInLabel", "linkedInHref", "contactFocusItems", "contactStatusItems",
];

const isLocaleContent = (value: unknown): value is ResumeLocaleContent => {
  if (!isRecord(value) || !hasKeys(value, localeKeys)) return false;
  if (!isStringArray(value.intro) || !isStringArray(value.nav) || value.nav.length !== 5) return false;
  if (!["education", "experience", "projectHeading", "skills", "honors", "contact", "availability", "portfolioLabel", "portfolioHref", "kaggleLabel", "updatedAt", "linkedInLabel", "linkedInHref"].every(key => isString(value[key]))) return false;
  return Array.isArray(value.edu) && value.edu.every(isEducationEntry) && hasUniqueIds(value.edu) &&
    Array.isArray(value.jobs) && value.jobs.every(isExperienceEntry) && hasUniqueIds(value.jobs) &&
    Array.isArray(value.projects) && value.projects.every(isProjectEntry) && hasUniqueIds(value.projects) &&
    Array.isArray(value.skillGroups) && value.skillGroups.every(isSkillGroup) && hasUniqueIds(value.skillGroups) &&
    Array.isArray(value.honorsList) && value.honorsList.every(isAward) && hasUniqueIds(value.honorsList) &&
    Array.isArray(value.contactFocusItems) && value.contactFocusItems.every(isFocusItem) &&
    Array.isArray(value.contactStatusItems) && value.contactStatusItems.every(isStatusItem);
};

export const isResumeContent = (value: unknown): value is ResumeContent => {
  if (!isRecord(value) || !hasKeys(value, ["profile", "publicLinks", "locales"])) return false;
  const { profile, publicLinks, locales } = value;
  if (!isRecord(profile) || !isRecord(publicLinks) || !isRecord(locales)) return false;
  if (!hasKeys(profile, ["name", "navAboutLabel", "emailActionLabel", "graduationLabel", "graduationValue", "avatarLabel", "avatarInitials", "contactFocusHeading", "contactStatusHeading", "footerName", "copyright"])) return false;
  if (!["name", "navAboutLabel", "emailActionLabel", "graduationLabel", "avatarLabel", "contactFocusHeading", "contactStatusHeading"].every(key => isLocalizedString(profile[key]))) return false;
  if (!["graduationValue", "avatarInitials", "footerName", "copyright"].every(key => isString(profile[key]))) return false;
  if (!hasKeys(publicLinks, ["email", "github", "githubLabel", "linkedInDisplayName", "emailLabel", "linkedInLabel"])) return false;
  if (!["email", "github", "githubLabel", "linkedInDisplayName", "emailLabel", "linkedInLabel"].every(key => isString(publicLinks[key]))) return false;
  if (!hasKeys(locales, ["zh", "en"]) || !isLocaleContent(locales.zh) || !isLocaleContent(locales.en)) return false;
  const zh = locales.zh;
  const en = locales.en;
  const sameOrderedIds = (left: { id: string }[], right: { id: string }[]) =>
    left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
  return sameOrderedIds(zh.edu, en.edu) && sameOrderedIds(zh.jobs, en.jobs) &&
    sameOrderedIds(zh.projects, en.projects) && sameOrderedIds(zh.skillGroups, en.skillGroups) &&
    sameOrderedIds(zh.honorsList, en.honorsList) && zh.contactFocusItems.length === en.contactFocusItems.length &&
    zh.contactStatusItems.length === en.contactStatusItems.length;
};

/** Fetches a complete normalized resume payload, returning the unchanged static model on any failure. */
export async function loadResumeContent(fetcher: typeof fetch, signal?: AbortSignal): Promise<ResumeContent> {
  try {
    const response = await fetcher("/api/resume", { method: "GET", signal, cache: "no-store" });
    if (!response.ok) return resumeContent;
    const payload: unknown = await response.json();
    return isResumeContent(payload) ? payload : resumeContent;
  } catch {
    return resumeContent;
  }
}
