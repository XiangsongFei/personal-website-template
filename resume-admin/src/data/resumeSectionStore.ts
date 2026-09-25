import type {
  AwardItem, ContactSection, EducationItem, ExperienceItem, IntroItem, LinksSection,
  ProfileSection, ProjectItem, SkillItem,
} from "../model";
import type { OverviewResumeData, ResumeSiteMetadata } from "./resumeMapper";

export type SectionData = {
  overview: OverviewResumeData;
  profile: ProfileSection;
  introduction: IntroItem[];
  education: EducationItem[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  skills: SkillItem[];
  awards: AwardItem[];
  contact: ContactSection;
  links: LinksSection;
};

export type ResumeSectionKey = keyof SectionData;
export type SectionLoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; value: T }
  | { status: "error"; error: unknown };

type CacheEntry<T> = {
  state: SectionLoadState<T>;
  promise?: Promise<T>;
  generation: number;
  sessionKey: string;
};

export class StaleResumeSectionRequestError extends Error {
  constructor() {
    super("Resume section request belongs to an inactive session");
    this.name = "StaleResumeSectionRequestError";
  }
}

/** In-memory production data scoped to one authenticated session. */
export class ResumeSectionStore {
  private activeSessionKey: string | null = null;
  private generation = 0;
  private readonly sections = new Map<string, CacheEntry<unknown>>();
  private readonly sites = new Map<string, CacheEntry<ResumeSiteMetadata>>();

  /** Activate a verified session. Switching sessions invalidates every previous entry and request. */
  setSession(sessionKey: string | null): void {
    if (sessionKey === this.activeSessionKey) return;
    this.generation += 1;
    this.activeSessionKey = sessionKey;
    this.sections.clear();
    this.sites.clear();
  }

  /** Invalidate cached values and late requests on sign-out or an observed session transition. */
  invalidate(): void {
    this.generation += 1;
    this.activeSessionKey = null;
    this.sections.clear();
    this.sites.clear();
  }

  getSectionState<K extends ResumeSectionKey>(sessionKey: string, siteIdentity: string, section: K): SectionLoadState<SectionData[K]> {
    return this.sections.get(this.sectionCacheKey(sessionKey, siteIdentity, section))?.state as SectionLoadState<SectionData[K]> | undefined
      ?? { status: "idle" };
  }

  getSiteMetadataState(sessionKey: string, siteKey = "example-cv"): SectionLoadState<ResumeSiteMetadata> {
    return this.sites.get(this.siteCacheKey(sessionKey, siteKey))?.state ?? { status: "idle" };
  }

  /** Patch a loaded production section from a confirmed write response without replacing other slices. */
  patchSection<K extends ResumeSectionKey>(
    sessionKey: string,
    siteIdentity: string,
    section: K,
    patch: (current: SectionData[K]) => SectionData[K],
  ): boolean {
    if (!sessionKey || sessionKey !== this.activeSessionKey) return false;
    const key = this.sectionCacheKey(sessionKey, siteIdentity, section);
    const entry = this.sections.get(key) as CacheEntry<SectionData[K]> | undefined;
    if (!entry || entry.state.status !== "loaded") return false;
    entry.state = { status: "loaded", value: patch(entry.state.value) };
    return true;
  }

  loadSection<K extends ResumeSectionKey>(
    sessionKey: string,
    siteIdentity: string,
    section: K,
    loader: () => Promise<SectionData[K]>,
  ): Promise<SectionData[K]> {
    this.assertActiveSession(sessionKey);
    const key = this.sectionCacheKey(sessionKey, siteIdentity, section);
    const existing = this.sections.get(key) as CacheEntry<SectionData[K]> | undefined;
    if (existing?.state.status === "loaded") return Promise.resolve(existing.state.value);
    if (existing?.promise) return existing.promise;
    return this.startLoad(this.sections as Map<string, CacheEntry<SectionData[K]>>, key, sessionKey, loader);
  }

  /** Force a fresh read for one section while making any older in-flight response stale. */
  reloadSection<K extends ResumeSectionKey>(
    sessionKey: string,
    siteIdentity: string,
    section: K,
    loader: () => Promise<SectionData[K]>,
  ): Promise<SectionData[K]> {
    this.assertActiveSession(sessionKey);
    const key = this.sectionCacheKey(sessionKey, siteIdentity, section);
    this.sections.delete(key);
    return this.startLoad(this.sections as Map<string, CacheEntry<SectionData[K]>>, key, sessionKey, loader);
  }

  loadSiteMetadata(
    sessionKey: string,
    loader: () => Promise<ResumeSiteMetadata>,
    siteKey = "example-cv",
  ): Promise<ResumeSiteMetadata> {
    this.assertActiveSession(sessionKey);
    const key = this.siteCacheKey(sessionKey, siteKey);
    const existing = this.sites.get(key);
    if (existing?.state.status === "loaded") return Promise.resolve(existing.state.value);
    if (existing?.promise) return existing.promise;
    return this.startLoad(this.sites, key, sessionKey, loader);
  }

  private startLoad<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    sessionKey: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    const generation = this.generation;
    const entry: CacheEntry<T> = { state: { status: "loading" }, generation, sessionKey };
    cache.set(key, entry);
    const request = Promise.resolve().then(loader).then(value => {
      if (!this.isCurrent(cache, key, entry)) throw new StaleResumeSectionRequestError();
      entry.state = { status: "loaded", value };
      return value;
    }, error => {
      if (this.isCurrent(cache, key, entry)) entry.state = { status: "error", error };
      throw error;
    }).finally(() => {
      if (entry.promise === request) entry.promise = undefined;
    });
    entry.promise = request;
    return request;
  }

  private isCurrent<T>(cache: Map<string, CacheEntry<T>>, key: string, entry: CacheEntry<T>): boolean {
    return this.generation === entry.generation && this.activeSessionKey === entry.sessionKey && cache.get(key) === entry;
  }

  private assertActiveSession(sessionKey: string): void {
    if (!sessionKey || sessionKey !== this.activeSessionKey) throw new StaleResumeSectionRequestError();
  }

  private sectionCacheKey(sessionKey: string, siteIdentity: string, section: ResumeSectionKey): string {
    if (!siteIdentity) throw new Error("Missing resume site identity");
    return JSON.stringify([sessionKey, siteIdentity, section]);
  }

  private siteCacheKey(sessionKey: string, siteKey: string): string {
    if (!siteKey) throw new Error("Missing resume site key");
    return JSON.stringify([sessionKey, siteKey]);
  }
}

/** Shared only for the lifetime of this browser runtime; no persistent storage is used. */
export const resumeSectionStore = new ResumeSectionStore();
