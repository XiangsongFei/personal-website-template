import type {
  AwardItem, Bilingual, ContactSection, EducationItem, ExperienceItem, IntroItem, LinksSection,
  ProfileSection, ProjectItem, SkillItem, SiteTextTranslation,
} from "../model";
import type { ResumeSiteMetadata } from "./resumeMapper";

export const ROUTE_SNAPSHOT_SCHEMA_VERSION = 2;
const STORAGE_PREFIX = "example-cv-cms:route-snapshot:v2:";

export type SnapshotRoute = "/profile" | "/introduction" | "/education" | "/experience" | "/projects" | "/skills" | "/awards" | "/contact" | "/links";
export type RouteSnapshotData = {
  "/profile": ProfileSection;
  "/introduction": IntroItem[];
  "/education": EducationItem[];
  "/experience": ExperienceItem[];
  "/projects": ProjectItem[];
  "/skills": SkillItem[];
  "/awards": AwardItem[];
  "/contact": ContactSection;
  "/links": LinksSection;
};
export type RouteSnapshot = {
  [R in SnapshotRoute]: {
    schemaVersion: typeof ROUTE_SNAPSHOT_SCHEMA_VERSION;
    route: R;
    savedAt: number;
    userId: string;
    site: ResumeSiteMetadata;
    data: RouteSnapshotData[R];
    sectionText?: Bilingual<SiteTextTranslation>;
  }
}[SnapshotRoute];

const routes = new Set<string>(["/profile", "/introduction", "/education", "/experience", "/projects", "/skills", "/awards", "/contact", "/links"]);
const sectionTextRoutes = new Set<SnapshotRoute>(["/education", "/experience", "/projects", "/skills", "/awards"]);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isBilingualRecord = (value: unknown, check: (entry: unknown) => boolean) => isRecord(value) && check(value.zh) && check(value.en);
const isOrderedItem = (value: unknown) => isRecord(value) && isString(value.id) && Number.isInteger(value.position);
const isTranslationRecord = (value: unknown) => isBilingualRecord(value, isRecord);

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every(item => isJsonValue(item, seen))
    : Object.getPrototypeOf(value) === Object.prototype && Object.values(value as Record<string, unknown>).every(item => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function isSite(value: unknown): value is ResumeSiteMetadata {
  return isRecord(value) && isString(value.resumeId) && value.resumeId.length > 0 && isString(value.siteKey) && value.siteKey.length > 0
    && typeof value.isPublished === "boolean" && isNullableString(value.updatedAt);
}

function isSectionText(value: unknown): value is Bilingual<SiteTextTranslation> {
  const textFields: (keyof SiteTextTranslation)[] = ["educationLabel", "experienceLabel", "projectHeading", "skillsLabel", "honorsLabel", "portfolioLabel", "portfolioHref", "kaggleLabel", "updatedAtLabel", "linkedInLabel", "linkedInHref"];
  return isBilingualRecord(value, entry => isRecord(entry) && textFields.every(key => isString(entry[key])));
}

function isRouteData(route: SnapshotRoute, value: unknown): boolean {
  if (route === "/profile") {
    return isRecord(value) && isRecord(value.shared) && isString(value.shared.graduationValue) && isString(value.shared.avatarInitials)
      && isNullableString(value.shared.photoUrl) && isString(value.shared.footerName) && isString(value.shared.copyright)
      && isTranslationRecord(value.translations);
  }
  if (!Array.isArray(value)) {
    if (route === "/contact") return isRecord(value) && isTranslationRecord(value.translations)
      && Array.isArray(value.focus) && value.focus.every(item => isOrderedItem(item) && isTranslationRecord(item.translations))
      && Array.isArray(value.status) && value.status.every(item => isOrderedItem(item) && ["study", "graduation", "open"].includes(String(item.statusType)) && isTranslationRecord(item.translations));
    if (route === "/links") return isRecord(value) && isRecord(value.shared) && isTranslationRecord(value.translations)
      && Array.isArray(value.navigation) && value.navigation.every(item => isOrderedItem(item) && isTranslationRecord(item.translations))
      && (value.resumePdfFilenames === undefined || isBilingualRecord(value.resumePdfFilenames, isString));
    return false;
  }
  if (route === "/contact" || route === "/links") return false;
  return value.every(item => {
    if (!isOrderedItem(item) || !isTranslationRecord(item.translations)) return false;
    if (route === "/projects") return isBilingualRecord(item.methods, entries => Array.isArray(entries) && entries.every(method => isOrderedItem(method) && isString(method.value)));
    return true;
  });
}

function parseSnapshot(route: SnapshotRoute, raw: string | null): RouteSnapshot | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.schemaVersion !== ROUTE_SNAPSHOT_SCHEMA_VERSION || value.route !== route
      || !Number.isFinite(value.savedAt) || (value.savedAt as number) <= 0 || !isString(value.userId) || !value.userId
      || !isSite(value.site) || !isRouteData(route, value.data) || !isJsonValue(value)) return null;
    if (value.site.resumeId.length === 0 || (value.sectionText !== undefined && !isSectionText(value.sectionText))) return null;
    if (sectionTextRoutes.has(route) && !isSectionText(value.sectionText)) return null;
    return value as RouteSnapshot;
  } catch {
    return null;
  }
}

export function isSnapshotRoute(route: string): route is SnapshotRoute {
  return routes.has(route);
}

export function readRouteSnapshot(route: string, userId?: string, resumeId?: string): RouteSnapshot | null {
  if (!isSnapshotRoute(route) || typeof window === "undefined") return null;
  if (!userId || !resumeId) return null;
  const key = `${STORAGE_PREFIX}${userId}:${resumeId}:${route}`;
  try {
    const raw = window.sessionStorage.getItem(key);
    const snapshot = parseSnapshot(route, raw);
    if (raw && !snapshot) window.sessionStorage.removeItem(key);
    if (snapshot && ((userId && snapshot.userId !== userId) || (resumeId && snapshot.site.resumeId !== resumeId))) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function writeRouteSnapshot(snapshot: RouteSnapshot): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (!isJsonValue(snapshot)) return false;
    const key = `${STORAGE_PREFIX}${snapshot.userId}:${snapshot.site.resumeId}:${snapshot.route}`;
    const serialized = JSON.stringify(snapshot);
    if (!parseSnapshot(snapshot.route, serialized)) return false;
    window.sessionStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearRouteSnapshot(route: string): void {
  if (!isSnapshotRoute(route) || typeof window === "undefined") return;
  try {
    const prefix = `${STORAGE_PREFIX}`;
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(prefix) && key.endsWith(`:${route}`)) window.sessionStorage.removeItem(key);
    }
  } catch { /* Cache cleanup is best effort. */ }
}

export function clearAllRouteSnapshots(): void {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch { /* Cache cleanup is best effort. */ }
}

export function routeRequiresSectionText(route: SnapshotRoute): boolean {
  return sectionTextRoutes.has(route);
}
