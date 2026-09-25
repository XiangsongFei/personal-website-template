import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { App } from "../App";
import type { LoadedResume, OverviewResumeData, ResumeSiteMetadata } from "./resumeMapper";
import type {
  ResumeRepository, ResumeSectionRepository, UpdatedProfileRow, UpdatedProfileTranslationRow,
} from "./resumeRepository";
import { resumeSectionStore, type ResumeSectionStore } from "./resumeSectionStore";
import type { EducationItem, ExperienceItem, IntroItem, ProfileSection, SkillItem, AwardItem, ProjectItem, ContactSection, LinksSection, EditorSections } from "../model";

const pendingLoads = new WeakMap<ResumeRepository, Map<string, Promise<LoadedResume>>>();

function loadOnce(repository: ResumeRepository, sessionKey: string): Promise<LoadedResume> {
  let sessions = pendingLoads.get(repository);
  if (!sessions) { sessions = new Map(); pendingLoads.set(repository, sessions); }
  const existing = sessions.get(sessionKey);
  if (existing) return existing;
  const request = repository.load();
  sessions.set(sessionKey, request);
  const clear = () => { if (sessions?.get(sessionKey) === request) sessions.delete(sessionKey); };
  void request.then(clear, clear);
  return request;
}

type ProfileReadRepository = ResumeRepository & Pick<ResumeSectionRepository, "loadSiteMetadata" | "loadProfile">;
function supportsProfileReads(repository: ResumeRepository | null): repository is ProfileReadRepository {
  if (!repository) return false;
  const candidate = repository as ResumeRepository & Partial<ResumeSectionRepository>;
  return typeof candidate.loadSiteMetadata === "function" && typeof candidate.loadProfile === "function";
}

type EducationReadRepository = ResumeRepository & Pick<ResumeSectionRepository, "loadSiteMetadata" | "loadEducation">;
function supportsEducationReads(repository: ResumeRepository | null): repository is EducationReadRepository {
  if (!repository) return false;
  const candidate = repository as ResumeRepository & Partial<ResumeSectionRepository>;
  return typeof candidate.loadSiteMetadata === "function" && typeof candidate.loadEducation === "function";
}

type OverviewReadRepository = ResumeRepository & Pick<ResumeSectionRepository, "loadSiteMetadata" | "loadOverview">;
function supportsOverviewReads(repository: ResumeRepository | null): repository is OverviewReadRepository {
  if (!repository) return false;
  const candidate = repository as ResumeRepository & Partial<ResumeSectionRepository>;
  return typeof candidate.loadSiteMetadata === "function" && typeof candidate.loadOverview === "function";
}

type AdditionalRouteKey = "introduction" | "experience" | "projects" | "skills" | "awards" | "contact" | "links";
type AdditionalRouteValue = IntroItem[] | ExperienceItem[] | ProjectItem[] | SkillItem[] | AwardItem[] | ContactSection | LinksSection;
type AdditionalRouteSections = Partial<Pick<EditorSections, AdditionalRouteKey>>;
type AdditionalRouteResult = { key: AdditionalRouteKey; resumeId: string; value: AdditionalRouteValue };
const routeKeys: Record<string, AdditionalRouteKey> = {
  "/introduction": "introduction", "/experience": "experience", "/projects": "projects", "/skills": "skills", "/awards": "awards", "/contact": "contact", "/links": "links",
};

function supportsAdditionalReads(repository: ResumeRepository | null, key: AdditionalRouteKey | null): boolean {
  if (!repository || !key) return false;
  const candidate = repository as ResumeRepository & Partial<ResumeSectionRepository>;
  const methods: Record<AdditionalRouteKey, keyof ResumeSectionRepository> = {
    introduction: "loadIntroduction", experience: "loadExperience", projects: "loadProjects", skills: "loadSkills", awards: "loadAwards", contact: "loadContact", links: "loadLinks",
  };
  return typeof candidate.loadSiteMetadata === "function" && typeof candidate[methods[key]] === "function";
}

async function loadAdditionalFromStore(sessionKey: string, repository: ResumeRepository, store: ResumeSectionStore, key: AdditionalRouteKey, reload = false): Promise<AdditionalRouteResult> {
  const metadata = await store.loadSiteMetadata(sessionKey, () => (repository as ResumeRepository & ResumeSectionRepository).loadSiteMetadata());
  const sectionRepository = repository as ResumeRepository & ResumeSectionRepository;
  switch (key) {
    case "introduction": return { key, resumeId: metadata.resumeId, value: await (reload ? store.reloadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadIntroduction(metadata.resumeId)) : store.loadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadIntroduction(metadata.resumeId))) };
    case "experience": return { key, resumeId: metadata.resumeId, value: await (reload ? store.reloadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadExperience(metadata.resumeId)) : store.loadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadExperience(metadata.resumeId))) };
    case "projects": return { key, resumeId: metadata.resumeId, value: await (reload ? store.reloadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadProjects(metadata.resumeId)) : store.loadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadProjects(metadata.resumeId))) };
    case "skills": return { key, resumeId: metadata.resumeId, value: await (reload ? store.reloadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadSkills(metadata.resumeId)) : store.loadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadSkills(metadata.resumeId))) };
    case "awards": return { key, resumeId: metadata.resumeId, value: await (reload ? store.reloadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadAwards(metadata.resumeId)) : store.loadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadAwards(metadata.resumeId))) };
    case "contact": return { key, resumeId: metadata.resumeId, value: await (reload ? store.reloadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadContact(metadata.resumeId)) : store.loadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadContact(metadata.resumeId))) };
    case "links": return { key, resumeId: metadata.resumeId, value: await (reload ? store.reloadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadLinks(metadata.resumeId)) : store.loadSection(sessionKey, metadata.resumeId, key, () => sectionRepository.loadLinks(metadata.resumeId))) };
  }
}

type ProfileLoadState =
  | { kind: "idle" | "loading" | "error" }
  | { kind: "loaded"; resumeId: string; profile: ProfileSection };

async function loadProfileFromStore(sessionKey: string, repository: ProfileReadRepository, store: ResumeSectionStore): Promise<{ resumeId: string; profile: ProfileSection }> {
  const metadata = await store.loadSiteMetadata(sessionKey, () => repository.loadSiteMetadata());
  const profile = await store.loadSection(sessionKey, metadata.resumeId, "profile", () => repository.loadProfile(metadata.resumeId));
  return { resumeId: metadata.resumeId, profile };
}

async function loadEducationFromStore(sessionKey: string, repository: EducationReadRepository, store: ResumeSectionStore, reload = false): Promise<{ resumeId: string; education: EducationItem[] }> {
  const metadata = await store.loadSiteMetadata(sessionKey, () => repository.loadSiteMetadata());
  const education = await (reload
    ? store.reloadSection(sessionKey, metadata.resumeId, "education", () => repository.loadEducation(metadata.resumeId))
    : store.loadSection(sessionKey, metadata.resumeId, "education", () => repository.loadEducation(metadata.resumeId)));
  return { resumeId: metadata.resumeId, education };
}

type OverviewLoadResult = { metadata: ResumeSiteMetadata; overview: OverviewResumeData };
type OverviewLoadState =
  | { kind: "idle" | "loading" | "error" }
  | ({ kind: "loaded" } & OverviewLoadResult);

async function loadOverviewFromStore(sessionKey: string, repository: OverviewReadRepository, store: ResumeSectionStore): Promise<OverviewLoadResult> {
  const metadata = await store.loadSiteMetadata(sessionKey, () => repository.loadSiteMetadata());
  const overview = await store.loadSection(sessionKey, metadata.resumeId, "overview", () => repository.loadOverview(metadata.resumeId));
  return { metadata, overview };
}

export function ResumeLoader({ repository, sessionKey, identityEmail, onSignOut, signOutPending, signOutError, sectionStore = resumeSectionStore }: {
  repository: ResumeRepository | null;
  sessionKey: string;
  identityEmail: string | null;
  onSignOut: () => void;
  signOutPending: boolean;
  signOutError: string;
  sectionStore?: ResumeSectionStore;
}) {
  const location = useLocation();
  const isProfileRoute = location.pathname === "/profile";
  const isEducationRoute = location.pathname === "/education";
  const isOverviewRoute = location.pathname === "/" || location.pathname === "/overview";
  const useSectionOverview = isOverviewRoute && supportsOverviewReads(repository);
  const additionalRouteKey = routeKeys[location.pathname] ?? null;
  const useSectionAdditional = supportsAdditionalReads(repository, additionalRouteKey);
  const useSectionProfile = isProfileRoute && supportsProfileReads(repository);
  const useSectionEducation = isEducationRoute && supportsEducationReads(repository);
  const [resume, setResume] = useState<LoadedResume | null>(null);
  const [fullSnapshotState, setFullSnapshotState] = useState<"idle" | "loading" | "error">("idle");
  const [fullAttempt, setFullAttempt] = useState(0);
  const [profileState, setProfileState] = useState<ProfileLoadState>({ kind: "idle" });
  const [profileAttempt, setProfileAttempt] = useState(0);
  const profileLoaded = useRef(false);
  const failedProfileAttempt = useRef<number | null>(null);
  const [educationState, setEducationState] = useState<{ kind: "idle" | "loading" | "error" } | { kind: "loaded"; resumeId: string; education: EducationItem[] }>({ kind: "idle" });
  const [educationAttempt, setEducationAttempt] = useState(0);
  const educationLoaded = useRef(false);
  const failedEducationAttempt = useRef<number | null>(null);
  const [overviewState, setOverviewState] = useState<OverviewLoadState>({ kind: "idle" });
  const overviewStateRef = useRef(overviewState);
  overviewStateRef.current = overviewState;
  const [overviewAttempt, setOverviewAttempt] = useState(0);
  const failedOverviewAttempt = useRef<number | null>(null);
  const [additionalStates, setAdditionalStates] = useState<Partial<Record<AdditionalRouteKey, { kind: "idle" | "loading" | "error" } | ({ kind: "loaded" } & AdditionalRouteResult)>>>({});
  const additionalStatesRef = useRef(additionalStates);
  additionalStatesRef.current = additionalStates;
  const [additionalAttempts, setAdditionalAttempts] = useState<Partial<Record<AdditionalRouteKey, number>>>({});
  const failedAdditionalAttempts = useRef<Partial<Record<AdditionalRouteKey, number>>>({});

  // Non-Profile routes keep the existing complete snapshot and start it only when visited.
  useEffect(() => {
    if ((isProfileRoute && supportsProfileReads(repository)) || (isEducationRoute && supportsEducationReads(repository)) || useSectionAdditional || useSectionOverview) return;
    let active = true;
    if (!repository) { setFullSnapshotState("error"); return () => { active = false; }; }
    if (resume) return () => { active = false; };
    setFullSnapshotState("loading");
    loadOnce(repository, sessionKey).then(value => {
      if (!active) return;
      setResume(value);
      setFullSnapshotState("idle");
    }, () => {
      if (active) setFullSnapshotState("error");
    });
    return () => { active = false; };
  }, [isProfileRoute, isEducationRoute, useSectionAdditional, useSectionOverview, repository, sessionKey, fullAttempt, resume]);

  useEffect(() => {
    if (!useSectionOverview || !repository || !supportsOverviewReads(repository) || resume) return;
    if (overviewStateRef.current.kind === "loaded" || failedOverviewAttempt.current === overviewAttempt) return;
    let active = true;
    setOverviewState(current => current.kind === "loaded" ? current : { kind: "loading" });
    loadOverviewFromStore(sessionKey, repository, sectionStore).then(value => {
      if (active) setOverviewState({ kind: "loaded", ...value });
    }, () => {
      if (!active) return;
      failedOverviewAttempt.current = overviewAttempt;
      setOverviewState({ kind: "error" });
    });
    return () => { active = false; };
  }, [useSectionOverview, repository, sessionKey, sectionStore, overviewAttempt, resume]);

  // Profile reads only site metadata and the two Profile tables, through the session cache.
  useEffect(() => {
    if (!useSectionProfile || !repository || !supportsProfileReads(repository)) return;
    if (profileLoaded.current || failedProfileAttempt.current === profileAttempt) return;
    let active = true;
    setProfileState(current => current.kind === "loaded" ? current : { kind: "loading" });
    loadProfileFromStore(sessionKey, repository, sectionStore).then(value => {
      if (!active) return;
      profileLoaded.current = true;
      setProfileState({ kind: "loaded", ...value });
    }, () => {
      if (!active) return;
      failedProfileAttempt.current = profileAttempt;
      setProfileState({ kind: "error" });
    });
    return () => { active = false; };
  }, [useSectionProfile, repository, sessionKey, sectionStore, profileAttempt]);

  useEffect(() => {
    if (!useSectionEducation || !repository || !supportsEducationReads(repository)) return;
    if (resume) return;
    if (educationLoaded.current || failedEducationAttempt.current === educationAttempt) return;
    let active = true;
    setEducationState(current => current.kind === "loaded" ? current : { kind: "loading" });
    loadEducationFromStore(sessionKey, repository, sectionStore).then(value => {
      if (!active) return;
      educationLoaded.current = true;
      setEducationState({ kind: "loaded", ...value });
    }, () => {
      if (!active) return;
      failedEducationAttempt.current = educationAttempt;
      setEducationState({ kind: "error" });
    });
    return () => { active = false; };
  }, [useSectionEducation, repository, sessionKey, sectionStore, educationAttempt, resume]);

  useEffect(() => {
    if (!useSectionAdditional || !additionalRouteKey || !repository || resume) return;
    const attempt = additionalAttempts[additionalRouteKey] ?? 0;
    if (additionalStatesRef.current[additionalRouteKey]?.kind === "loaded"
      || failedAdditionalAttempts.current[additionalRouteKey] === attempt) return;
    let active = true;
    setAdditionalStates(current => ({ ...current, [additionalRouteKey]: { kind: "loading" } }));
    loadAdditionalFromStore(sessionKey, repository, sectionStore, additionalRouteKey).then(value => {
      if (active) setAdditionalStates(current => ({ ...current, [additionalRouteKey]: { kind: "loaded", ...value } }));
    }, () => {
      if (!active) return;
      failedAdditionalAttempts.current[additionalRouteKey] = attempt;
      setAdditionalStates(current => ({ ...current, [additionalRouteKey]: { kind: "error" } }));
    });
    return () => { active = false; };
  }, [useSectionAdditional, additionalRouteKey, repository, sessionKey, sectionStore, additionalAttempts, resume]);

  function retryProfile() {
    profileLoaded.current = false;
    failedProfileAttempt.current = null;
    setProfileState({ kind: "loading" });
    setProfileAttempt(value => value + 1);
  }

  function retryFullSnapshot() {
    setResume(null);
    setFullSnapshotState("loading");
    setFullAttempt(value => value + 1);
  }

  function retryOverview() {
    failedOverviewAttempt.current = null;
    setOverviewState({ kind: "loading" });
    setOverviewAttempt(value => value + 1);
  }

  function retryEducation() {
    educationLoaded.current = false;
    failedEducationAttempt.current = null;
    setEducationState({ kind: "loading" });
    setEducationAttempt(value => value + 1);
  }


  async function reloadAdditional(key: AdditionalRouteKey): Promise<AdditionalRouteResult> {
    if (!repository || !supportsAdditionalReads(repository, key)) throw new Error("Section reload is unavailable");
    const value = await loadAdditionalFromStore(sessionKey, repository, sectionStore, key, true);
    setAdditionalStates(current => ({ ...current, [key]: { kind: "loaded", ...value } }));
    return value;
  }

  function patchAdditional(key: AdditionalRouteKey, resumeId: string, value: AdditionalRouteValue) {
    sectionStore.patchSection(sessionKey, resumeId, key, () => value as never);
    setAdditionalStates(current => {
      const existing = current[key];
      return existing?.kind === "loaded" && existing.resumeId === resumeId
        ? { ...current, [key]: { ...existing, value } } : current;
    });
  }

  function retryAdditional(key: AdditionalRouteKey) {
    failedAdditionalAttempts.current[key] = undefined;
    setAdditionalStates(current => ({ ...current, [key]: { kind: "loading" } }));
    setAdditionalAttempts(current => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
  }

  function patchEducation(resumeId: string, education: EducationItem[]) {
    sectionStore.patchSection(sessionKey, resumeId, "education", () => education);
    setEducationState(current => current.kind === "loaded" && current.resumeId === resumeId ? { ...current, education } : current);
    setResume(current => current?.resumeId === resumeId ? { ...current, sections: { ...current.sections, education } } : current);
  }

  function removeEducation(resumeId: string, entryId: string) {
    sectionStore.patchSection(sessionKey, resumeId, "education", current => current.filter(item => item.id !== entryId));
    setEducationState(current => current.kind === "loaded" && current.resumeId === resumeId
      ? { ...current, education: current.education.filter(item => item.id !== entryId) } : current);
    setResume(current => current?.resumeId === resumeId
      ? { ...current, sections: { ...current.sections, education: current.sections.education.filter(item => item.id !== entryId) } } : current);
  }

  async function reloadEducation(): Promise<EducationItem[]> {
    if (!repository || !supportsEducationReads(repository)) throw new Error("Education reads are unavailable");
    const value = await loadEducationFromStore(sessionKey, repository, sectionStore, true);
    educationLoaded.current = true;
    setEducationState({ kind: "loaded", ...value });
    setResume(current => current?.resumeId === value.resumeId ? { ...current, sections: { ...current.sections, education: value.education } } : current);
    return value.education;
  }

  function profileSaved(row: UpdatedProfileRow) {
    sectionStore.patchSection(sessionKey, row.resumeId, "profile", current => ({ ...current, shared: row.shared }));
    setResume(current => current?.resumeId === row.resumeId ? {
      ...current, sections: { ...current.sections, profile: { ...current.sections.profile, shared: row.shared } },
    } : current);
  }

  function profileTranslationSaved(row: UpdatedProfileTranslationRow) {
    sectionStore.patchSection(sessionKey, row.resumeId, "profile", current => ({
      ...current, translations: { ...current.translations, [row.locale]: row.translation },
    }));
    setResume(current => current?.resumeId === row.resumeId ? {
      ...current, sections: { ...current.sections, profile: {
        ...current.sections.profile,
        translations: { ...current.sections.profile.translations, [row.locale]: row.translation },
      } },
    } : current);
  }

  const profile = profileState.kind === "loaded" ? profileState.profile : resume?.sections.profile ?? null;
  const overview = overviewState.kind === "loaded" ? overviewState.overview : null;
  const overviewMetadata = overviewState.kind === "loaded" ? overviewState.metadata : null;
  const overviewLoadState = overviewState.kind === "error" ? "error" : "loading";
  const profileResumeId = profileState.kind === "loaded" ? profileState.resumeId : resume?.resumeId ?? null;
  const profileLoadState = profileState.kind === "error" || (isProfileRoute && !supportsProfileReads(repository) && fullSnapshotState === "error")
    ? "error" : "loading";
  const education = educationState.kind === "loaded" ? educationState.education : resume?.sections.education ?? null;
  const educationResumeId = educationState.kind === "loaded" ? educationState.resumeId : resume?.resumeId ?? null;
  const educationLoadState = educationState.kind === "error" || (isEducationRoute && !supportsEducationReads(repository) && fullSnapshotState === "error")
    ? "error" : "loading";
  const additionalRouteState = additionalRouteKey ? additionalStates[additionalRouteKey] : undefined;
  const additionalRouteLoadState = additionalRouteState?.kind === "error"
    || (additionalRouteKey && !useSectionAdditional && fullSnapshotState === "error") ? "error" : "loading";
  const additionalRoute = additionalRouteState?.kind === "loaded" ? additionalRouteState : null;
  const additionalSections = additionalRoute ? { [additionalRoute.key]: additionalRoute.value } as AdditionalRouteSections : {};

  return <App identityEmail={identityEmail} onSignOut={onSignOut} signOutPending={signOutPending} signOutError={signOutError}
    productionMode={true} repository={repository} resume={resume} profileSection={profile} profileResumeId={profileResumeId}
    overviewData={overview} overviewSiteMetadata={overviewMetadata} overviewLoadState={overviewLoadState}
    overviewRouteFirst={useSectionOverview} onRetryOverview={useSectionOverview ? retryOverview : retryFullSnapshot}
    profileLoadState={profileLoadState} onRetryProfile={supportsProfileReads(repository) ? retryProfile : retryFullSnapshot}
    educationSection={education} educationResumeId={educationResumeId} educationLoadState={educationLoadState}
    onRetryEducation={supportsEducationReads(repository) ? retryEducation : retryFullSnapshot}
    onEducationChanged={patchEducation} onReloadEducation={reloadEducation}
    onEducationDeleted={removeEducation}
    additionalSections={additionalSections}
    additionalRouteKey={additionalRouteKey}
    additionalRouteFirst={useSectionAdditional}
    additionalRouteLoadState={additionalRouteLoadState}
    onRetryAdditionalRoute={additionalRouteKey && useSectionAdditional ? () => retryAdditional(additionalRouteKey) : retryFullSnapshot}
    additionalResumeId={additionalRoute?.resumeId ?? null} onAdditionalChanged={(key, id, value) => patchAdditional(key as AdditionalRouteKey, id, value as AdditionalRouteValue)} onReloadAdditional={async key => (await reloadAdditional(key)).value as (IntroItem | ExperienceItem | SkillItem | AwardItem)[]}
    fullSnapshotState={fullSnapshotState} onRetryFullSnapshot={retryFullSnapshot}
    onProfileSaved={profileSaved} onProfileTranslationSaved={profileTranslationSaved} />;
}
