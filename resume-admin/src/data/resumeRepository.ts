import type { SupabaseClient } from "@supabase/supabase-js";
import { readAdminTarget } from "../auth/supabase";
import { createBatch6BRepositoryWrites, type Batch6BWriteRepository } from "./resumeBatch6bRepository";
import { canonicalizeProfile, profileAggregateFromSection, profileSectionFromAggregate, validateProfileAggregate, type ProfileAggregate } from "./profileAggregate";
import { canonicalizeFiles, canonicalizeWebsiteLinks, managedResumePdfObjectPath, type FilesAggregate, type WebsiteLinksAggregate, validateFilesAggregate, validateWebsiteLinksAggregate } from "./websiteFilesAggregate";
import { validateRestorePreviewContract, type RestorePreviewDomain, type RestorePreviewJson } from "./restorePreviewContract";
import { validateRestoreMutationResult, type RestoreMutationResult } from "./restoreMutationContract";
import {
  mapAwardRows, mapContactRows, mapEducationRows, mapExperienceRows, mapIntroductionRows,
  mapLinksRows, mapOverviewRows, mapProfileRows, mapProjectRows, mapResumeRows, mapResumeSiteMetadata, mapSiteTextRows,
  mapSkillRows, type LoadedResume, type OverviewResumeData, type ResumeRows, type ResumeSiteMetadata, type ResumeTable,
} from "./resumeMapper";
import type {
  AwardItem, Bilingual, ContactSection, EducationCategory, EducationItem, ExperienceItem, IntroItem, LinksSection,
  Locale, ProfileSection, ProfileTranslation, ProjectItem, SiteTextTranslation, SkillItem,
} from "../model";

export const resumeTables = [
  "resume_profile", "resume_profile_translations", "resume_public_links", "resume_locale_content",
  "resume_intro_paragraphs", "resume_intro_paragraph_translations",
  "resume_navigation_items", "resume_navigation_item_translations",
  "resume_education_entries", "resume_education_translations",
  "resume_experience_entries", "resume_experience_translations",
  "resume_project_entries", "resume_project_translations", "resume_project_methods",
  "resume_skill_groups", "resume_skill_group_translations",
  "resume_award_entries", "resume_award_translations",
  "resume_contact_focus_items", "resume_contact_focus_translations",
  "resume_contact_status_items", "resume_contact_status_translations",
] as const satisfies readonly ResumeTable[];

export interface ResumeRepository extends Partial<Batch6BWriteRepository> {
  load(): Promise<LoadedResume>;
  loadEducation?(resumeId: string): Promise<EducationItem[]>;
  loadExperience?(resumeId: string): Promise<ExperienceItem[]>;
  loadProjects?(resumeId: string): Promise<ProjectItem[]>;
  loadSkills?(resumeId: string): Promise<SkillItem[]>;
  loadAwards?(resumeId: string): Promise<AwardItem[]>;
  loadContact?(resumeId: string): Promise<ContactSection>;
  loadLinks?(resumeId: string): Promise<LinksSection>;
  loadAdminFeatureState?(resumeId: string): Promise<AdminFeatureState>;
  loadAdminAwardsWriteState?(resumeId: string): Promise<AdminAwardsWriteState>;
  saveAwardsWithWorker?(resumeId: string, items: AwardItem[]): Promise<AwardItem[]>;
  hasPendingAwardsWorkerSave?(resumeId: string): boolean;
  discardPendingAwardsSave?(resumeId?: string): void;
  loadAdminExperienceWriteState?(resumeId: string): Promise<AdminDomainWriteState<"experience">>;
  saveExperienceWithWorker?(resumeId: string, items: ExperienceItem[]): Promise<ExperienceItem[]>;
  hasPendingExperienceWorkerSave?(resumeId: string): boolean;
  discardPendingExperienceSave?(resumeId?: string): void;
  loadAdminSkillsWriteState?(resumeId: string): Promise<AdminDomainWriteState<"skills">>;
  saveSkillsWithWorker?(resumeId: string, items: SkillItem[]): Promise<SkillItem[]>;
  hasPendingSkillsWorkerSave?(resumeId: string): boolean;
  discardPendingSkillsSave?(resumeId?: string): void;
  loadAdminEducationWriteState?(resumeId: string): Promise<AdminEducationWriteState>;
  saveEducationWithWorker?(resumeId: string, items: EducationItem[]): Promise<EducationItem[]>;
  hasPendingEducationWorkerSave?(resumeId: string): boolean;
  discardPendingEducationSave?(resumeId?: string): void;
  loadAdminProjectsWriteState?(resumeId: string): Promise<AdminDomainWriteState<"projects">>;
  saveProjectsWithWorker?(resumeId: string, items: ProjectItem[]): Promise<ProjectItem[]>;
  hasPendingProjectsWorkerSave?(resumeId: string): boolean;
  discardPendingProjectsSave?(resumeId?: string): void;
  loadAdminContactWriteState?(resumeId: string): Promise<AdminContactWriteState>;
  saveContactWithWorker?(resumeId: string, contact: ContactSection): Promise<ContactSection>;
  hasPendingContactWorkerSave?(resumeId: string): boolean;
  discardPendingContactSave?(resumeId?: string): void;
  loadAdminProfileWriteState?(resumeId: string): Promise<AdminProfileWriteState>;
  saveProfileWithWorker?(resumeId: string, profile: ProfileSection, baselinePhotoUrl: string | null): Promise<ProfileSection>;
  hasPendingProfileWorkerSave?(resumeId: string): boolean;
  discardPendingProfileSave?(resumeId?: string): void;
  loadAdminWebsiteLinksWriteState?(resumeId: string, operation?: FilesSaveOperation): Promise<AdminDomainWriteState<"website_links">>;
  saveWebsiteLinksWithWorker?(resumeId: string, links: LinksSection, operation?: FilesSaveOperation): Promise<LinksSection>;
  hasPendingWebsiteLinksWorkerSave?(resumeId: string): boolean;
  loadAdminFilesWriteState?(resumeId: string, operation?: FilesSaveOperation): Promise<AdminFilesWriteState>;
  saveFilesWithWorker?(resumeId: string, files: FilesAggregate, uploadRequestIds?: Partial<Record<Locale, string>>, operation?: FilesSaveOperation): Promise<{ files: FilesAggregate; cleanupWarning: boolean }>;
  uploadResumePdfWithWorker?(resumeId: string, locale: Locale, file: File, operation?: FilesSaveOperation): Promise<{ reference: string; uploadRequestId: string }>;
  cleanupResumePdfCandidatesWithWorker?(resumeId: string, uploadRequestIds: string[], operation?: FilesSaveOperation): Promise<boolean>;
  clearPendingResumePdfUpload?(resumeId: string, locale: Locale, requestId: string): void;
  restoreFilesFromEvent?(resumeId: string, sourceEventId: string, locale: Locale): Promise<{ files: FilesAggregate; cleanupWarning: boolean }>;
  hasPendingFilesWorkerSave?(resumeId: string): boolean;
  retryPendingFilesWithWorker?(resumeId: string, operation?: FilesSaveOperation): Promise<{ files: FilesAggregate; cleanupWarning: boolean }>;
  saveIntroductionAtomically?(resumeId: string, items: IntroItem[]): Promise<IntroItem[]>;
  saveIntroductionWithWorker?(resumeId: string, items: IntroItem[]): Promise<IntroItem[]>;
  hasPendingIntroductionWorkerSave?(resumeId: string, items: IntroItem[]): boolean;
  discardPendingIntroductionSave?(resumeId?: string): void;
  loadActivityLogAuthorizedTargets?(): Promise<ActivityLogAuthorizedTarget[]>;
  loadActivityLogPage?(resumeId: string, pageSize: number, cursor?: ActivityLogCursor): Promise<ActivityLogEvent[]>;
  loadActivityLogPageV12?(resumeId: string, pageSize: number, filters: ActivityLogFilters, cursor?: ActivityLogCursor): Promise<ActivityLogEvent[]>;
  loadActivityLogPageV13C?(resumeId: string, pageSize: number, filters: ActivityLogV13CFilters, cursor?: ActivityLogV13CCursor): Promise<ActivityLogV13CEvent[]>;
  loadVersionHistoryPage?(resumeId: string, pageSize: number, cursor?: VersionHistoryCursor): Promise<VersionHistoryPage>;
  previewRestore?(input: RestorePreviewRequest): Promise<RestorePreview>;
  getPendingRestoreAttempt?(resumeId: string, sourceEventId: string): RestoreMutationRequest | null;
  restoreDomain?(input: RestoreMutationRequest, mode: "new" | "retry"): Promise<RestoreMutationResult>;
  updateProfileSharedDetails(resumeId: string, shared: ProfileSection["shared"]): Promise<UpdatedProfileRow>;
  updateProfileTranslation(resumeId: string, locale: Locale, translation: ProfileTranslation): Promise<UpdatedProfileTranslationRow>;
  updateEducationEntry?(resumeId: string, entryId: string, changes: Partial<Pick<EducationItem, "position" | "entryType" | "category">>): Promise<UpdatedEducationEntryRow>;
  updateEducationTranslation?(resumeId: string, entryId: string, locale: Locale, translation: EducationItem["translations"][Locale]): Promise<UpdatedEducationTranslationRow>;
  insertEducationEntry?(resumeId: string, position: number, entryType: EducationItem["entryType"], category?: EducationCategory | null): Promise<UpdatedEducationEntryRow>;
  insertEducationTranslation?(resumeId: string, entryId: string, locale: Locale, translation: EducationItem["translations"][Locale]): Promise<UpdatedEducationTranslationRow>;
  readEducationTranslation?(resumeId: string, entryId: string, locale: Locale): Promise<UpdatedEducationTranslationRow | null>;
  deleteEducationEntry?(resumeId: string, entryId: string): Promise<void>;
  updateEditableEntryPosition?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string, position: number): Promise<EditableEntryRow>;
  insertEditableEntry?<K extends EditableRepeatableSection>(section: K, resumeId: string, position: number): Promise<EditableEntryRow>;
  updateEditableTranslation?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string, locale: Locale, translation: EditableTranslation<K>): Promise<EditableTranslationRow<K>>;
  insertEditableTranslation?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string, locale: Locale, translation: EditableTranslation<K>): Promise<EditableTranslationRow<K>>;
  readEditableTranslation?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string, locale: Locale): Promise<EditableTranslationRow<K> | null>;
  deleteEditableTranslation?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string, locale: Locale): Promise<void>;
  deleteEditableEntry?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string): Promise<void>;
}

export type AdminFeatureState = {
  resumeId: string;
  activityLogEnabled: boolean;
  introductionWriteMode: "direct" | "rpc";
  introductionTrustedContextRequired: boolean;
};
export type AdminAwardsWriteState = { resumeId: string; activityLogEnabled: boolean; awardsWriteMode: "direct" | "rpc"; awardsTrustedContextRequired: boolean };
export type AdminDomainWriteState<D extends "experience" | "skills" | "projects" | "website_links" | "files"> = { resumeId: string; activityLogEnabled: boolean; writeMode: "direct" | "rpc"; trustedContextRequired: boolean; domain: D };
export type AdminFilesWriteState = AdminDomainWriteState<"files"> & { storageProtocol: "legacy" | "intent_v1" };
export type AdminEducationWriteState = { resumeId: string; activityLogEnabled: boolean; educationWriteMode: "direct" | "rpc"; educationTrustedContextRequired: boolean };
export type AdminContactWriteState = { resumeId: string; activityLogEnabled: boolean; contactWriteMode: "direct" | "rpc"; contactTrustedContextRequired: boolean };
export type AdminProfileWriteState = { resumeId: string; activityLogEnabled: boolean; profileWriteMode: "direct" | "rpc"; profileTrustedContextRequired: boolean };

export class IntroductionWorkerSaveError extends Error {
  constructor(message: string) { super(message); this.name = "IntroductionWorkerSaveError"; }
}
export class AwardsWorkerSaveError extends Error { constructor(message: string) { super(message); this.name = "AwardsWorkerSaveError"; } }
export class AggregateWorkerSaveError extends Error { constructor(message: string, readonly uncertain = false) { super(message); this.name = "AggregateWorkerSaveError"; } }
export type RestorePreviewErrorCode = "unauthenticated" | "target_not_authorized" | "activity_log_disabled" | "restore_disabled"
  | "restore_configuration_disabled" | "source_ineligible" | "current_state_ineligible" | "preview_unavailable" | "invalid_response";
export class RestorePreviewError extends Error {
  constructor(readonly code: RestorePreviewErrorCode) {
    super(code === "unauthenticated" ? "Sign in to preview this history entry."
      : code === "target_not_authorized" ? "This target is not available for Restore preview."
        : code === "activity_log_disabled" ? "Version History is not enabled for this target."
          : code === "restore_disabled" ? "Restore preview is not enabled for this target."
          : code === "restore_configuration_disabled" ? "Restore preview is not available for this domain."
            : code === "source_ineligible" ? "This history entry is not eligible for Restore preview."
              : code === "current_state_ineligible" ? "The current domain state cannot be previewed safely."
                : code === "invalid_response" ? "The Restore preview response could not be verified."
                  : "Restore preview could not be prepared.");
    this.name = "RestorePreviewError";
  }
}

export type FilesSaveOperation = { signal: AbortSignal; isActive(): boolean; abandon(): void };

export function createFilesSaveOperation(): FilesSaveOperation {
  const controller = new AbortController();
  let active = true;
  return {
    signal: controller.signal,
    isActive: () => active,
    abandon() { if (!active) return; active = false; controller.abort(); },
  };
}

const FILE_PREFLIGHT_TIMEOUT_MS = 15_000;
const FILE_AUTH_TIMEOUT_MS = 10_000;
const FILE_UPLOAD_TIMEOUT_MS = 60_000;
const FILE_UPLOAD_FILENAME_HEADER = "X-Original-Filename-UTF8-Percent-Encoded";
const FILE_UPLOAD_FILENAME_HEADER_MAX_LENGTH = 1536;
const FILE_SAVE_TIMEOUT_MS = 30_000;
const FILE_CLEANUP_TIMEOUT_MS = 30_000;

function assertFilesSaveOperation(operation: FilesSaveOperation): void {
  if (!operation.isActive() || operation.signal.aborted)
    throw new AggregateWorkerSaveError("The Files request was not sent because this save was cancelled. Keep the selected file and retry when ready.");
}

function awaitFilesPreflight<T>(promise: PromiseLike<T> | T, operation: FilesSaveOperation, step: string, timeoutMs: number): Promise<T> {
  assertFilesSaveOperation(operation);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation.signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => finish(() => reject(new AggregateWorkerSaveError(`The Files ${step} did not finish; no request was sent. Keep the selected file and retry.`)));
    const timer = setTimeout(() => {
      finish(() => {
        operation.abandon();
        reject(new AggregateWorkerSaveError(`The Files ${step} timed out before a request was sent. Keep the selected file and retry.`));
      });
    }, timeoutMs);
    operation.signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(value => finish(() => {
      try { assertFilesSaveOperation(operation); resolve(value); } catch (error) { reject(error); }
    }), error => finish(() => reject(error)));
  });
}

function awaitFilesRequest<T>(promiseFactory: (signal: AbortSignal) => PromiseLike<T> | T, operation: FilesSaveOperation,
  step: string, timeoutMs: number): Promise<T> {
  assertFilesSaveOperation(operation);
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation.signal.removeEventListener("abort", onAbort);
      action();
    };
    const fail = (message: string) => finish(() => {
      controller.abort();
      reject(new AggregateWorkerSaveError(message, true));
    });
    const onAbort = () => fail(`The ${step} result is uncertain because this save was cancelled after its request was issued. Retry only the exact pending request.`);
    const timer = setTimeout(() => finish(() => {
      controller.abort();
      operation.abandon();
      reject(new AggregateWorkerSaveError(`The ${step} result is uncertain because the request timed out. Retry only the exact pending request.`, true));
    }), timeoutMs);
    operation.signal.addEventListener("abort", onAbort, { once: true });
    let request: PromiseLike<T> | T;
    try { request = promiseFactory(controller.signal); }
    catch { fail(`The ${step} result is uncertain after the request was issued. Retry only the exact pending request.`); return; }
    Promise.resolve(request).then(value => finish(() => {
      try { assertFilesSaveOperation(operation); resolve(value); }
      catch { reject(new AggregateWorkerSaveError(`The ${step} result is uncertain because this save was cancelled after its request was issued. Retry only the exact pending request.`, true)); }
    }), () => fail(`The ${step} result is uncertain after the request was issued. Retry only the exact pending request.`));
  });
}

export function runFilesSaveRequest<T>(operation: FilesSaveOperation, step: string, request: () => PromiseLike<T> | T,
  timeoutMs = FILE_SAVE_TIMEOUT_MS): Promise<T> {
  return awaitFilesRequest(() => request(), operation, step, timeoutMs);
}

export function runFilesSavePreflight<T>(operation: FilesSaveOperation, step: string, pending: PromiseLike<T> | T,
  timeoutMs = FILE_PREFLIGHT_TIMEOUT_MS): Promise<T> {
  return awaitFilesPreflight(pending, operation, step, timeoutMs);
}
export type ActivityLogCursor = { occurredAt: string; id: string };
export type ActivityLogFilters = {
  section: string;
  operation: ActivityLogEvent["operation"] | "";
  actorEmail: string;
  dateFrom: string | null;
  dateToExclusive: string | null;
  search: string;
};
export type ActivityLogV13CCursor = { occurredAt: string; id: string; sourceRank: 1 | 2 };
export type ActivityLogEventFilter = "all" | "successful" | "rejected";
export type ActivityLogV13CFilters = ActivityLogFilters & { eventFilter: ActivityLogEventFilter };
export type ActivityLogAuthorizedTarget = { resumeId: string; siteKey: "example-cv" | "example-cv-qa"; role: "owner" | "qa" };
export type ActivityLogEvent = {
  id: string; occurredAt: string; actorEmail: string | null; actorRole: "owner" | "qa";
  operation: "create" | "update" | "delete" | "reorder" | "upload" | "remove";
  section: string; entityType: string; entityId: string | null;
  entitySnapshot: Record<string, unknown>; changes: Record<string, { before: unknown; after: unknown }>;
  ipNetwork: string | null; countryCode: string | null; region: string | null; city: string | null;
};
type ActivityLogV13CCommon = Pick<ActivityLogEvent,
  "id" | "occurredAt" | "actorEmail" | "actorRole" | "operation" | "section" |
  "ipNetwork" | "countryCode" | "region" | "city"
>;
export type ActivityLogV13CSuccessEvent = ActivityLogV13CCommon & {
  eventSource: "activity";
  sourceRank: 1;
  entityType: string;
  entityId: string | null;
  entitySnapshot: Record<string, unknown>;
  changes: ActivityLogEvent["changes"];
  payloadVersion: 1 | 2;
};
export type ActivityLogV13CRejectedEvent = ActivityLogV13CCommon & {
  eventSource: "system";
  sourceRank: 2;
  eventKind: "operation_failure";
  outcome: "rejected";
  failureStage: string;
  failureCode: string;
  requestId: string;
  entityType: null;
  entityId: null;
  entitySnapshot: null;
  changes: null;
  payloadVersion: null;
};
export type ActivityLogV13CEvent = ActivityLogV13CSuccessEvent | ActivityLogV13CRejectedEvent;

export type VersionHistoryDomain = "awards" | "experience" | "skills" | "education" | "projects" | "contact" | "profile" | "website_links" | "files";
export type VersionHistoryOperation = ActivityLogEvent["operation"];
export type VersionHistoryCursor = { occurredAt: string; eventId: string };
export type VersionHistoryScalar = string | number | boolean | null;
export type VersionHistoryJson = VersionHistoryScalar | VersionHistoryJson[] | { [key: string]: VersionHistoryJson };
export type VersionHistoryComparison =
  | { kind: "entity_fields"; changes: Record<string, { before: VersionHistoryScalar; after: VersionHistoryScalar }> }
  | { kind: "aggregate"; before: VersionHistoryJson; after: VersionHistoryJson }
  | { kind: "unavailable" };
export type VersionHistoryEntry = {
  eventId: string;
  occurredAt: string;
  actorAccountLabel: string;
  actorRole: "owner" | "qa";
  domain: VersionHistoryDomain;
  operation: VersionHistoryOperation;
  payloadVersion: number;
  entityType: string;
  entityId: string | null;
  comparison: VersionHistoryComparison;
};
export type VersionHistoryPage = {
  entries: VersionHistoryEntry[];
  hasMore: boolean;
  nextCursor: VersionHistoryCursor | null;
};

export type { RestorePreviewDomain, RestorePreviewJson } from "./restorePreviewContract";
export type RestorePreviewRequest = { resumeId: string; sourceEventId: string };
export type RestorePreview = {
  status: "ready" | "no_change";
  sourceEventId: string;
  sourceOccurredAt: string;
  domain: RestorePreviewDomain;
  historicalState: RestorePreviewJson;
  currentState: RestorePreviewJson;
  comparison: { before: RestorePreviewJson; after: RestorePreviewJson };
  expectedCurrentDigest: string;
};
export type RestoreMutationRequest = { resumeId: string; sourceEventId: string; expectedCurrentDigest: string; requestId: string };
export type RestoreMutationErrorCode = "unauthenticated" | "target_not_authorized" | "restore_disabled" | "restore_configuration_disabled"
  | "restore_ineligible" | "stale_preview" | "idempotency_conflict" | "restore_request_pending" | "restore_request_expired"
  | "restore_signing_unavailable" | "restore_unavailable" | "outcome_unknown" | "invalid_response" | "pending_conflict" | "storage_unavailable";
export class RestoreMutationError extends Error {
  constructor(readonly code: RestoreMutationErrorCode, readonly uncertain = false) {
    super(code === "unauthenticated" ? "Sign in again before restoring this history entry."
      : code === "target_not_authorized" || code === "restore_disabled" ? "Restore is not available for this target."
        : code === "restore_configuration_disabled" ? "Restore is not available for this domain."
          : code === "restore_ineligible" ? "This history entry or current state cannot be restored safely."
            : code === "stale_preview" ? "The content changed after Preview. Get a fresh Preview before restoring."
              : code === "idempotency_conflict" ? "This request conflicts with an earlier Restore attempt. Do not retry with a changed request."
                : code === "restore_request_pending" ? "The Restore request is still unresolved. Retry only the exact same request."
                  : code === "restore_request_expired" ? "This Restore request expired. Get a fresh Preview to start again."
                    : code === "restore_signing_unavailable" ? "The Restore request could not be verified."
                      : code === "pending_conflict" ? "An earlier Restore attempt for this entry must be resolved first."
                        : code === "storage_unavailable" ? "This browser cannot safely retain the exact Restore request; nothing was submitted."
                          : code === "outcome_unknown" ? "The Restore result is unknown. Retry only the exact same request."
                            : code === "invalid_response" ? "The Restore result could not be verified. Retry only the exact same request."
                              : "Restore could not be completed safely.");
    this.name = "RestoreMutationError";
  }
}

/** Additional typed reads for future route-first loading; the current loader still calls load(). */
export interface ResumeSectionRepository {
  loadSiteMetadata(): Promise<ResumeSiteMetadata>;
  loadOverview(resumeId: string): Promise<OverviewResumeData>;
  loadProfile(resumeId: string): Promise<ProfileSection>;
  loadIntroduction(resumeId: string): Promise<IntroItem[]>;
  loadEducation(resumeId: string): Promise<EducationItem[]>;
  loadExperience(resumeId: string): Promise<ExperienceItem[]>;
  loadProjects(resumeId: string): Promise<ProjectItem[]>;
  loadSkills(resumeId: string): Promise<SkillItem[]>;
  loadAwards(resumeId: string): Promise<AwardItem[]>;
  loadContact(resumeId: string): Promise<ContactSection>;
  loadLinks(resumeId: string): Promise<LinksSection>;
  loadSiteText?(resumeId: string): Promise<Bilingual<SiteTextTranslation>>;
}

export type CompleteResumeRepository = ResumeRepository & ResumeSectionRepository;

/** Wrap the repository boundary so no non-read operation can run before the current route is fresh and writable. */
export function createWriteReadinessRepository(repository: ResumeRepository, canWrite: () => boolean): ResumeRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      const name = String(property);
      if (/^(load|read|hasPending|discardPending)/.test(name)) return value.bind(target);
      return (...args: unknown[]) => {
        if (!canWrite()) return Promise.reject(new Error("Admin writes are unavailable until fresh route data is confirmed"));
        return value.apply(target, args);
      };
    },
  });
}

export type UpdatedProfileRow = {
  resumeId: string;
  shared: ProfileSection["shared"];
  updatedAt: string | null;
};

export type UpdatedProfileTranslationRow = {
  resumeId: string;
  locale: Locale;
  translation: ProfileTranslation;
  updatedAt: string | null;
};

export type UpdatedEducationEntryRow = { resumeId: string; entryId: string; position: number; entryType: EducationItem["entryType"]; category: EducationCategory | null; sourceKey: string | null };
export type UpdatedEducationTranslationRow = { resumeId: string; entryId: string; locale: Locale; translation: EducationItem["translations"][Locale] };

export type EditableRepeatableSection = "introduction" | "experience" | "projects" | "skills" | "awards";
type EditableSectionItem = { introduction: IntroItem; experience: ExperienceItem; projects: ProjectItem; skills: SkillItem; awards: AwardItem };
export type EditableTranslation<K extends EditableRepeatableSection> = EditableSectionItem[K]["translations"][Locale];
export type EditableEntryRow = { resumeId: string; entryId: string; position: number; sourceKey: string | null };
export type EditableTranslationRow<K extends EditableRepeatableSection> = {
  resumeId: string; entryId: string; locale: Locale; translation: EditableTranslation<K>;
};

function rows(value: unknown, table: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`Invalid ${table} response`);
  }
  return value as Record<string, unknown>[];
}

function mapActivityLogRows(value: unknown): ActivityLogEvent[] {
  return rows(value, "Activity Log event").map(row => {
    if (typeof row.id !== "string" || typeof row.occurred_at !== "string"
      || (row.actor_role_snapshot !== "owner" && row.actor_role_snapshot !== "qa")
      || !["create", "update", "delete", "reorder", "upload", "remove"].includes(String(row.operation))
      || typeof row.section_key !== "string" || typeof row.entity_type !== "string"
      || (row.actor_email_snapshot !== null && typeof row.actor_email_snapshot !== "string")
      || (row.entity_id !== null && typeof row.entity_id !== "string")
      || ([row.ip_network, row.country_code, row.region, row.city].some(item => item !== undefined && item !== null && typeof item !== "string"))
      || !row.entity_snapshot || typeof row.entity_snapshot !== "object" || Array.isArray(row.entity_snapshot)
      || !row.changes || typeof row.changes !== "object" || Array.isArray(row.changes)) throw new Error("Invalid Activity Log response");
    const changes: ActivityLogEvent["changes"] = {};
    for (const [key, raw] of Object.entries(row.changes as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object" || !("before" in raw) || !("after" in raw)) throw new Error("Invalid Activity Log response");
      const change = raw as { before: unknown; after: unknown };
      changes[key] = { before: change.before, after: change.after };
    }
    return { id: row.id, occurredAt: row.occurred_at, actorEmail: row.actor_email_snapshot as string | null,
      actorRole: row.actor_role_snapshot, operation: row.operation as ActivityLogEvent["operation"], section: row.section_key,
      entityType: row.entity_type, entityId: row.entity_id as string | null,
      entitySnapshot: row.entity_snapshot as Record<string, unknown>, changes,
      ipNetwork: typeof row.ip_network === "string" ? row.ip_network : null,
      countryCode: typeof row.country_code === "string" ? row.country_code : null,
      region: typeof row.region === "string" ? row.region : null,
      city: typeof row.city === "string" ? row.city : null };
  });
}

function mapActivityLogV13CRows(value: unknown): ActivityLogV13CEvent[] {
  const nullableStrings = ["actor_email_snapshot", "ip_network", "country_code", "region", "city"] as const;
  return rows(value, "Activity Log event").map(row => {
    if (typeof row.id !== "string" || typeof row.occurred_at !== "string"
      || (row.actor_role_snapshot !== "owner" && row.actor_role_snapshot !== "qa")
      || !["create", "update", "delete", "reorder", "upload", "remove"].includes(String(row.operation))
      || typeof row.section_key !== "string"
      || nullableStrings.some(key => row[key] !== null && typeof row[key] !== "string")) {
      throw new Error("Invalid Activity Log response");
    }

    const common: ActivityLogV13CCommon = {
      id: row.id,
      occurredAt: row.occurred_at,
      actorEmail: row.actor_email_snapshot as string | null,
      actorRole: row.actor_role_snapshot,
      operation: row.operation as ActivityLogEvent["operation"],
      section: row.section_key,
      ipNetwork: row.ip_network as string | null,
      countryCode: row.country_code as string | null,
      region: row.region as string | null,
      city: row.city as string | null,
    };

    if (row.event_source === "activity") {
      if (row.source_rank !== 1 || row.event_kind !== null || row.outcome !== null
        || row.failure_stage !== null || row.failure_code !== null || row.request_id !== null
        || typeof row.entity_type !== "string"
        || (row.entity_id !== null && typeof row.entity_id !== "string")
        || !row.entity_snapshot || typeof row.entity_snapshot !== "object" || Array.isArray(row.entity_snapshot)
        || !row.changes || typeof row.changes !== "object" || Array.isArray(row.changes)
        || typeof row.payload_version !== "number") {
        throw new Error("Invalid Activity Log response");
      }
      if (!((row.payload_version === 1 && row.entity_type !== "award_list")
          || (row.payload_version === 2 && row.entity_id === null && row.operation === "update"
            && ((row.section_key === "awards" && row.entity_type === "award_list")
              || (row.section_key === "experience" && row.entity_type === "experience_list")
              || (row.section_key === "skills" && row.entity_type === "skill_group_list")
              || (row.section_key === "education" && row.entity_type === "education_list")
              || (row.section_key === "projects" && row.entity_type === "project_list")
              || (row.section_key === "contact" && row.entity_type === "contact_section")
              || (row.section_key === "profile" && row.entity_type === "profile_settings")
              || (row.section_key === "website_links" && row.entity_type === "website_links_settings")
              || (row.section_key === "files" && row.entity_type === "resume_file_set"))))) {
        throw new Error("Invalid Activity Log response");
      }
      const changes: ActivityLogEvent["changes"] = {};
      for (const [key, raw] of Object.entries(row.changes as Record<string, unknown>)) {
        if (!raw || typeof raw !== "object" || !("before" in raw) || !("after" in raw)) {
          throw new Error("Invalid Activity Log response");
        }
        const change = raw as { before: unknown; after: unknown };
        changes[key] = { before: change.before, after: change.after };
      }
      if (row.payload_version === 2) {
        const snapshot = row.entity_snapshot as Record<string, unknown>;
        const key = row.section_key as "awards" | "experience" | "skills" | "education" | "projects" | "contact" | "profile" | "website_links" | "files";
        const change = changes[key];
        if (key === "website_links" || key === "files") {
          const snapshot = row.entity_snapshot as Record<string, unknown>;
          if (Object.keys(snapshot).join(",") !== key || Object.keys(changes).join(",") !== key || !change
            ) throw new Error("Invalid Activity Log response");
          if (key === "website_links") canonicalizeWebsiteLinks(change.before); else canonicalizeFiles(change.before);
          const canonicalAfter = key === "website_links" ? canonicalizeWebsiteLinks(change.after) : canonicalizeFiles(change.after);
          const canonicalSnapshot = key === "website_links" ? canonicalizeWebsiteLinks(snapshot[key]) : canonicalizeFiles(snapshot[key]);
          if (canonicalAfter !== canonicalSnapshot) throw new Error("Invalid Activity Log response");
        }
        const validContact = (raw: unknown, requireDensePositions: boolean): boolean => {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
          const aggregate = raw as Record<string, unknown>;
          if (Object.keys(aggregate).sort().join(",") !== "focus,status,translations" || !aggregate.translations
            || typeof aggregate.translations !== "object" || Array.isArray(aggregate.translations)) return false;
          const translations = aggregate.translations as Record<string, unknown>;
          if (Object.keys(translations).sort().join(",") !== "en,zh") return false;
          for (const locale of ["zh", "en"] as const) {
            const value = translations[locale];
            if (!value || typeof value !== "object" || Array.isArray(value)
              || Object.keys(value).sort().join(",") !== "availability,contact_label"
              || typeof (value as Record<string, unknown>).contact_label !== "string"
              || typeof (value as Record<string, unknown>).availability !== "string") return false;
          }
          const validList = (value: unknown, kind: "focus" | "status"): boolean => {
            if (!Array.isArray(value) || value.length > 32) return false;
            const ids = new Set<string>(); let priorPosition = -1;
            return value.every((rawItem, index) => {
              if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return false;
              const item = rawItem as Record<string, unknown>;
              const expected = kind === "focus" ? "en,id,position,zh" : "en,id,position,status_type,zh";
              if (Object.keys(item).sort().join(",") !== expected || typeof item.id !== "string"
                || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.id)
                || ids.has(item.id) || !Number.isInteger(item.position) || (item.position as number) < 0
                || (requireDensePositions ? item.position !== index : index > 0 && (item.position as number) <= priorPosition)
                || (kind === "status" && !(item.status_type === "study" || item.status_type === "graduation" || item.status_type === "open"))) return false;
              ids.add(item.id); priorPosition = item.position as number;
              for (const locale of ["zh", "en"] as const) {
                const rawText = item[locale];
                if (!rawText || typeof rawText !== "object" || Array.isArray(rawText)) return false;
                const text = rawText as Record<string, unknown>;
                if (Object.keys(text).sort().join(",") !== "detail,title" || typeof text.title !== "string" || typeof text.detail !== "string") return false;
              }
              return true;
            });
          };
          return validList(aggregate.focus, "focus") && validList(aggregate.status, "status");
        };
        const validArray = (raw: unknown, domain: "awards" | "experience" | "skills" | "education" | "projects", requireDensePositions = true): boolean => {
          if (!Array.isArray(raw) || raw.length > (domain === "awards" ? 32 : 16)) return false;
          const ids = new Set<string>();
          return raw.every((entry, position) => {
            if (!entry || typeof entry !== "object") return false;
            const item = entry as Record<string, unknown>;
            const expectedKeys = domain === "education" ? "education_category,en,entry_type,id,position,zh" : domain === "projects" ? "en,id,methods,position,zh" : "en,id,position,zh";
            if (Object.keys(item).sort().join(",") !== expectedKeys || typeof item.id !== "string"
              || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.id)
              || ids.has(item.id) || !Number.isInteger(item.position) || (item.position as number) < 0
              || (requireDensePositions ? item.position !== position
                : (position > 0 && (item.position as number) <= ((raw[position - 1] as Record<string, unknown>).position as number)))) return false;
            if (domain === "education") {
              const validCategory = item.education_category === null || ["undergraduate", "graduate", "doctoral", "summerSchool", "custom"].includes(String(item.education_category));
              if (!validCategory || (item.entry_type !== "standard" && item.entry_type !== "summerSchool")
                || (item.education_category !== null && ((item.education_category === "summerSchool") !== (item.entry_type === "summerSchool")))) return false;
            }
            const validTranslation = (value: unknown): boolean => {
              if (!value || typeof value !== "object" || Array.isArray(value)) return false;
              const locale = value as Record<string, unknown>;
              if (domain === "projects") {
                const bytes = (value: string) => new TextEncoder().encode(value).length;
                return Object.keys(locale).sort().join(",") === "description,href,period,subtitle,title"
                  && typeof locale.title === "string" && bytes(locale.title) <= 2048
                  && typeof locale.subtitle === "string" && bytes(locale.subtitle) <= 2048
                  && typeof locale.period === "string" && bytes(locale.period) <= 1024
                  && typeof locale.description === "string" && bytes(locale.description) <= 16384
                  && typeof locale.href === "string" && bytes(locale.href) <= 2048;
              }
              if (domain === "awards") return Object.keys(locale).sort().join(",") === "name,year"
                && typeof locale.name === "string" && typeof locale.year === "string";
              if (domain === "skills") return Object.keys(locale).sort().join(",") === "items,title"
                && typeof locale.title === "string" && typeof locale.items === "string";
              if (domain === "education") {
                if (Object.keys(locale).sort().join(",") !== "course_description,course_title,custom_category_label,grade,period,program,title"
                  || !["title", "program", "period", "grade"].every(field => typeof locale[field] === "string")) return false;
                const byteLength = (value: string) => new TextEncoder().encode(value).length;
                const bounded = (field: string, max: number) => typeof locale[field] === "string" && byteLength(locale[field] as string) <= max;
                return bounded("title", 256) && bounded("program", 256) && bounded("period", 128) && bounded("grade", 256)
                  && ((locale.course_title === null || bounded("course_title", 256))
                    && (locale.course_description === null || bounded("course_description", 2048))
                    && (locale.custom_category_label === null || bounded("custom_category_label", 256)));
              }
              return Object.keys(locale).sort().join(",") === "description,location,organization,period,title"
                && ["organization", "title", "period", "description"].every(field => typeof locale[field] === "string")
                && (locale.location === null || typeof locale.location === "string");
            };
            if (!validTranslation(item.zh) || !validTranslation(item.en)) return false;
            if (domain === "projects") {
              const methods = item.methods as Record<string, unknown> | undefined;
              if (!methods || Object.keys(methods).sort().join(",") !== "en,zh") return false;
              const methodIds = new Set<string>();
              for (const locale of ["zh", "en"] as const) {
                const list = methods[locale];
                if (!Array.isArray(list) || list.length > 64 || list.some((rawMethod, methodPosition) => {
                  if (!rawMethod || typeof rawMethod !== "object" || Array.isArray(rawMethod)) return true;
                  const method = rawMethod as Record<string, unknown>;
                  if (Object.keys(method).sort().join(",") !== "id,position,value" || typeof method.id !== "string"
                    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(method.id)
                    || methodIds.has(method.id) || !Number.isInteger(method.position) || (method.position as number) < 0
                    || (requireDensePositions ? method.position !== methodPosition
                      : (methodPosition > 0 && (method.position as number) <= ((list[methodPosition - 1] as Record<string, unknown>).position as number)))
                    || typeof method.value !== "string"
                    || new TextEncoder().encode(method.value).length > 2048) return true;
                  methodIds.add(method.id); return false;
                })) return false;
              }
            }
            ids.add(item.id); return true;
          });
        };
        if (!change || JSON.stringify(snapshot[key]) !== JSON.stringify(change.after)) throw new Error("Invalid Activity Log response");
        if (key === "contact") {
          if (Object.keys(snapshot).sort().join(",") !== "contact" || Object.keys(changes).sort().join(",") !== "contact"
            || !validContact(change.before, false) || !validContact(change.after, true)) throw new Error("Invalid Activity Log response");
        } else if (key === "profile") {
          const validProfile = (raw: unknown): boolean => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
            const profile = raw as Record<string, unknown>;
            if (Object.keys(profile).sort().join(",") !== "shared,translations") return false;
            const shared = profile.shared as Record<string, unknown> | null;
            const translations = profile.translations as Record<string, unknown> | null;
            if (!shared || typeof shared !== "object" || Array.isArray(shared)
              || Object.keys(shared).sort().join(",") !== "avatar_initials,copyright,footer_name,graduation_value,photo_url"
              || !["graduation_value", "avatar_initials", "footer_name", "copyright"].every(field => typeof shared[field] === "string")
              || !(shared.photo_url === null || (typeof shared.photo_url === "string" && shared.photo_url.length > 0))
              || !translations || typeof translations !== "object" || Array.isArray(translations)
              || Object.keys(translations).sort().join(",") !== "en,zh") return false;
            const fields = "avatar_label,contact_focus_heading,contact_status_heading,email_action_label,graduation_label,name,nav_about_label";
            return (["zh", "en"] as const).every(locale => {
              const value = translations[locale];
              return Boolean(value && typeof value === "object" && !Array.isArray(value)
                && Object.keys(value).sort().join(",") === fields
                && Object.values(value as Record<string, unknown>).every(field => typeof field === "string"));
            });
          };
          if (Object.keys(snapshot).sort().join(",") !== "profile" || Object.keys(changes).sort().join(",") !== "profile"
            || JSON.stringify(snapshot.profile) !== JSON.stringify(change.after)
            || !validProfile(change.before) || !validProfile(change.after)) throw new Error("Invalid Activity Log response");
        } else if (key === "awards" || key === "experience" || key === "skills" || key === "education" || key === "projects") {
          if (Object.keys(snapshot).sort().join(",") !== key || Object.keys(changes).sort().join(",") !== key
            || !Array.isArray(change.before) || !Array.isArray(change.after)
            || !validArray(change.before, key, key !== "projects") || !validArray(change.after, key)) throw new Error("Invalid Activity Log response");
        } else if (key !== "website_links" && key !== "files") throw new Error("Invalid Activity Log response");
      }
      return {
        ...common,
        eventSource: "activity",
        sourceRank: 1,
        entityType: row.entity_type,
        entityId: row.entity_id as string | null,
        entitySnapshot: row.entity_snapshot as Record<string, unknown>,
        changes,
        payloadVersion: row.payload_version,
      };
    }

    if (row.event_source === "system") {
      if (row.source_rank !== 2 || row.event_kind !== "operation_failure" || row.outcome !== "rejected"
        || typeof row.failure_stage !== "string" || typeof row.failure_code !== "string"
        || typeof row.request_id !== "string"
        || row.entity_type !== null || row.entity_id !== null || row.entity_snapshot !== null
        || row.changes !== null || row.payload_version !== null) {
        throw new Error("Invalid Activity Log response");
      }
      return {
        ...common,
        eventSource: "system",
        sourceRank: 2,
        eventKind: "operation_failure",
        outcome: "rejected",
        failureStage: row.failure_stage,
        failureCode: row.failure_code,
        requestId: row.request_id,
        entityType: null,
        entityId: null,
        entitySnapshot: null,
        changes: null,
        payloadVersion: null,
      };
    }

    throw new Error("Invalid Activity Log response");
  });
}

const VERSION_HISTORY_ROW_KEYS = ["event_id", "occurred_at", "actor_account_label", "actor_role", "domain_key",
  "operation", "payload_version", "entity_type", "entity_id", "comparison_kind", "comparison", "has_more"] as const;
const VERSION_HISTORY_DOMAINS: readonly VersionHistoryDomain[] = ["awards", "experience", "skills", "education", "projects", "contact", "profile", "website_links", "files"];
const VERSION_HISTORY_OPERATIONS: readonly VersionHistoryOperation[] = ["create", "update", "delete", "reorder", "upload", "remove"];
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const isVersionHistoryScalar = (value: unknown): value is VersionHistoryScalar => value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
function isVersionHistoryJson(value: unknown): value is VersionHistoryJson {
  if (isVersionHistoryScalar(value)) return true;
  if (Array.isArray(value)) return value.every(isVersionHistoryJson);
  return isRecord(value) && Object.values(value).every(isVersionHistoryJson);
}

const RESTORE_PREVIEW_ERROR_CODES: readonly RestorePreviewErrorCode[] = ["unauthenticated", "target_not_authorized", "activity_log_disabled", "restore_disabled",
  "restore_configuration_disabled", "source_ineligible", "current_state_ineligible", "preview_unavailable"];
const RESTORE_MUTATION_ERROR_CODES: readonly RestoreMutationErrorCode[] = ["unauthenticated", "target_not_authorized", "restore_disabled",
  "restore_configuration_disabled", "restore_ineligible", "stale_preview", "idempotency_conflict", "restore_request_pending",
  "restore_request_expired", "restore_signing_unavailable", "restore_unavailable", "outcome_unknown", "invalid_response"];
const RESTORE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function restorePendingKey(resumeId: string, sourceEventId: string): string {
  return `admin-restore-v1-pending:${resumeId.toLowerCase()}:${sourceEventId.toLowerCase()}`;
}
function restoreRequestBody(input: RestoreMutationRequest) {
  return { resume_id: input.resumeId.toLowerCase(), source_event_id: input.sourceEventId.toLowerCase(),
    expected_current_digest: input.expectedCurrentDigest, request_id: input.requestId.toLowerCase() };
}
function readRestorePending(key: string): RestoreMutationRequest | null {
  let raw: string | null;
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) throw new Error("Storage unavailable");
    raw = storage.getItem(key);
  } catch { throw new RestoreMutationError("storage_unavailable"); }
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || !hasExactKeys(value, ["resumeId", "sourceEventId", "expectedCurrentDigest", "requestId"])
      || typeof value.resumeId !== "string" || !RESTORE_UUID.test(value.resumeId)
      || typeof value.sourceEventId !== "string" || !RESTORE_UUID.test(value.sourceEventId)
      || typeof value.requestId !== "string" || !RESTORE_UUID.test(value.requestId)
      || typeof value.expectedCurrentDigest !== "string" || !/^[0-9a-f]{64}$/.test(value.expectedCurrentDigest)) {
      throw new RestoreMutationError("pending_conflict");
    }
    return { resumeId: value.resumeId.toLowerCase(), sourceEventId: value.sourceEventId.toLowerCase(),
      expectedCurrentDigest: value.expectedCurrentDigest, requestId: value.requestId.toLowerCase() };
  } catch (error) {
    if (error instanceof RestoreMutationError) throw error;
    throw new RestoreMutationError("pending_conflict");
  }
}
function restoreMutationErrorCode(value: unknown): RestoreMutationErrorCode | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.code !== "string") return null;
  return RESTORE_MUTATION_ERROR_CODES.includes(value.error.code as RestoreMutationErrorCode)
    ? value.error.code as RestoreMutationErrorCode : null;
}

function mapRestorePreviewResponse(value: unknown, expectedEventId: string): RestorePreview {
  const validated = validateRestorePreviewContract(value, expectedEventId);
  if (!validated || new TextEncoder().encode(JSON.stringify(validated)).byteLength > 256 * 1024) throw new RestorePreviewError("invalid_response");
  return {
    status: validated.status,
    sourceEventId: validated.source_event_id,
    sourceOccurredAt: validated.source_occurred_at,
    domain: validated.domain,
    historicalState: validated.historical_state,
    currentState: validated.current_state,
    comparison: { before: validated.comparison.before, after: validated.comparison.after },
    expectedCurrentDigest: validated.expected_current_digest,
  };
}

function restorePreviewErrorCode(value: unknown): RestorePreviewErrorCode | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.code !== "string") return null;
  return RESTORE_PREVIEW_ERROR_CODES.includes(value.error.code as RestorePreviewErrorCode)
    ? value.error.code as RestorePreviewErrorCode : null;
}

function versionHistoryEntityMatches(domain: VersionHistoryDomain, entityType: string, version: number): boolean {
  const contracts = {
    awards: { v1: ["award_entry"], v2: ["award_list"] },
    experience: { v1: ["experience_entry"], v2: ["experience_list"] },
    skills: { v1: ["skill_group"], v2: ["skill_group_list"] },
    education: { v1: ["education_entry"], v2: ["education_list"] },
    projects: { v1: ["project_entry"], v2: ["project_list"] },
    contact: { v1: ["contact_focus_item", "contact_status_item"], v2: ["contact_section"] },
    profile: { v1: ["profile_settings", "profile_image"], v2: ["profile_settings"] },
    website_links: { v1: ["public_link"], v2: ["website_links_settings"] },
    files: { v1: ["resume_file"], v2: ["resume_file_set"] },
  } satisfies Record<VersionHistoryDomain, { v1: string[]; v2: string[] }>;
  if (version === 1) {
    return contracts[domain].v1.includes(entityType);
  }
  if (version === 2) {
    return contracts[domain].v2.includes(entityType);
  }
  return [...contracts[domain].v1, ...contracts[domain].v2].includes(entityType);
}

function mapVersionHistoryRows(value: unknown): { entries: VersionHistoryEntry[]; hasMore: boolean } {
  const rawRows = rows(value, "Version History event");
  if (rawRows.some(row => !hasExactKeys(row, VERSION_HISTORY_ROW_KEYS))) throw new Error("Invalid Version History response");
  let pageHasMore = false;
  const entries = rawRows.map(row => {
    if (typeof row.event_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.event_id)
      || typeof row.occurred_at !== "string" || !Number.isFinite(Date.parse(row.occurred_at))
      || typeof row.actor_account_label !== "string" || !row.actor_account_label.trim()
      || (row.actor_role !== "owner" && row.actor_role !== "qa")
      || typeof row.domain_key !== "string" || !VERSION_HISTORY_DOMAINS.includes(row.domain_key as VersionHistoryDomain)
      || typeof row.operation !== "string" || !VERSION_HISTORY_OPERATIONS.includes(row.operation as VersionHistoryOperation)
      || typeof row.payload_version !== "number" || !Number.isInteger(row.payload_version) || row.payload_version < 1
      || typeof row.entity_type !== "string" || (row.entity_id !== null && typeof row.entity_id !== "string")
      || typeof row.has_more !== "boolean") throw new Error("Invalid Version History response");

    const domain = row.domain_key as VersionHistoryDomain;
    const version = row.payload_version;
    const entityType = row.entity_type;
    if (!versionHistoryEntityMatches(domain, entityType, version)) throw new Error("Invalid Version History response");
    pageHasMore = row.has_more;

    let comparison: VersionHistoryComparison;
    if (row.comparison_kind === "unavailable") {
      if (row.comparison !== null) throw new Error("Invalid Version History response");
      comparison = { kind: "unavailable" };
    } else if (row.comparison_kind === "entity_fields" && version === 1 && isRecord(row.comparison)
      && hasExactKeys(row.comparison, ["changes"]) && isRecord(row.comparison.changes)) {
      const changes: Record<string, { before: VersionHistoryScalar; after: VersionHistoryScalar }> = {};
      for (const [field, rawChange] of Object.entries(row.comparison.changes)) {
        if (!isRecord(rawChange) || !hasExactKeys(rawChange, ["before", "after"])
          || !isVersionHistoryScalar(rawChange.before) || !isVersionHistoryScalar(rawChange.after)) {
          throw new Error("Invalid Version History response");
        }
        changes[field] = { before: rawChange.before, after: rawChange.after };
      }
      if (Object.keys(changes).length === 0) throw new Error("Invalid Version History response");
      if ((domain === "files" && entityType === "resume_file"
          && Object.keys(changes).some(field => field !== "locale" && field !== "object_key"))
        || (domain === "profile" && entityType === "profile_image"
          && Object.keys(changes).some(field => field !== "object_key"))) {
        throw new Error("Invalid Version History response");
      }
      comparison = { kind: "entity_fields", changes };
    } else if (row.comparison_kind === "aggregate" && version === 2 && isRecord(row.comparison)
      && hasExactKeys(row.comparison, ["before", "after"])
      && isVersionHistoryJson(row.comparison.before) && isVersionHistoryJson(row.comparison.after)
      && (Array.isArray(row.comparison.before) || isRecord(row.comparison.before))
      && (Array.isArray(row.comparison.after) || isRecord(row.comparison.after))) {
      comparison = { kind: "aggregate", before: row.comparison.before, after: row.comparison.after };
    } else {
      throw new Error("Invalid Version History response");
    }

    return {
      eventId: row.event_id, occurredAt: row.occurred_at, actorAccountLabel: row.actor_account_label,
      actorRole: row.actor_role as "owner" | "qa", domain, operation: row.operation as VersionHistoryOperation,
      payloadVersion: version, entityType, entityId: row.entity_id as string | null, comparison,
    };
  });
  if (rawRows.some(row => row.has_more !== pageHasMore)) throw new Error("Invalid Version History response");
  return { entries, hasMore: pageHasMore };
}

async function readSiteRow(supabase: SupabaseClient): Promise<Record<string, unknown>> {
  const target = await readAdminTarget(supabase);
  const { data: site, error } = await supabase
    .from("resume_sites").select("*").eq("id", target.resumeId).maybeSingle();
  if (error) throw new Error("Unable to load target resume site");
  if (!site || typeof site.id !== "string" || site.id !== target.resumeId || site.site_key !== target.siteKey
    || (target.role === "owner" && target.siteKey !== "example-cv")
    || (target.role === "qa" && (target.siteKey !== "example-cv-qa" || site.is_published !== false))) {
    throw new Error("Target resume site not found or does not match the authorized Admin target");
  }
  return site;
}

async function readResumeRows(supabase: SupabaseClient, table: ResumeTable, resumeId: string): Promise<Record<string, unknown>[]> {
  if (typeof resumeId !== "string" || !resumeId) throw new Error("Missing resume ID");
  const { data, error } = await supabase.from(table).select("*").eq("resume_id", resumeId);
  if (error) throw new Error(`Unable to load ${table}`);
  return rows(data, table);
}

const resumePdfPath = (resumeId: string, locale: Locale) => `${resumeId}/${locale === "zh" ? "resume_zh.pdf" : "resume_en.pdf"}`;

function pdfFilenameFallback(href: string): string {
  return href ? href.split(/[?#]/, 1)[0].split("/").filter(Boolean).at(-1) || href : "";
}

async function readResumePdfFilename(supabase: SupabaseClient, resumeId: string, siteKey: string, locale: Locale, href: string): Promise<string> {
  const fallback = pdfFilenameFallback(href);
  if (!href) return fallback;
  const storage = supabase.storage as unknown as { from?: (bucket: string) => { info?: (path: string) => Promise<{ data: unknown; error: unknown }> } } | undefined;
  if (!storage || typeof storage.from !== "function") return fallback;
  const bucket = storage.from("resume-files");
  // Some lightweight repository test doubles and older SDKs may not expose info().
  if (typeof bucket.info !== "function") return fallback;
  try {
    let path = resumePdfPath(resumeId, locale);
    if (siteKey === "example-cv") {
      try {
        const url = new URL(href);
        const legacySuffix = `/example-cv/${locale === "zh" ? "resume_zh.pdf" : "resume_en.pdf"}`;
        if (url.pathname.endsWith(legacySuffix)) path = `example-cv/${locale === "zh" ? "resume_zh.pdf" : "resume_en.pdf"}`;
      } catch { /* The resume link may be a relative or non-Storage URL. */ }
    }
    const { data, error } = await bucket.info(path);
    if (error) return fallback;
    const metadata = data && typeof data === "object" ? (data as { metadata?: unknown }).metadata : undefined;
    if (metadata && typeof metadata === "object" && typeof (metadata as Record<string, unknown>).originalFilename === "string"
      && (metadata as Record<string, string>).originalFilename.length > 0) {
      return (metadata as Record<string, string>).originalFilename;
    }
  } catch {
    // Preserve access to the stable public link when metadata is missing or unavailable.
  }
  return fallback;
}

/** Site-scoped reads plus the explicitly allowlisted Profile and Education write paths. */
export function createResumeRepository(supabase: SupabaseClient, supabaseUrl?: string): CompleteResumeRepository {
  let pendingIntroductionRequest: { resumeId: string; fingerprint: string; requestId: string; inFlight?: Promise<IntroItem[]>; discardWhenSettled?: boolean } | null = null;
  type AwardsRequest = { requestId: string; resumeId: string; fingerprint: string; awards: Array<{ id: string | null; position: number; zh: { name: string; year: string }; en: { name: string; year: string } }> };
  const awardsStorageKey = (resumeId: string) => `admin-awards-rpc-pending-v1:${resumeId}`;
  const readAwardsPending = (resumeId: string): AwardsRequest | null => {
    try {
      const raw = globalThis.sessionStorage?.getItem(awardsStorageKey(resumeId));
      if (!raw) return null;
      if (new TextEncoder().encode(raw).byteLength > 8192) throw new Error("oversize");
      const value = JSON.parse(raw) as AwardsRequest;
      const validAwards = Array.isArray(value?.awards) && value.awards.length <= 32 && value.awards.every((award, position) => {
        if (!award || Object.keys(award).sort().join(",") !== "en,id,position,zh" || award.position !== position
          || !(award.id === null || (typeof award.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(award.id)))) return false;
        const validTranslation = (translation: unknown) => Boolean(translation && typeof translation === "object"
          && Object.keys(translation).sort().join(",") === "name,year"
          && typeof (translation as { name?: unknown }).name === "string" && typeof (translation as { year?: unknown }).year === "string");
        return validTranslation(award.zh) && validTranslation(award.en);
      });
      const serializedAwards = validAwards ? JSON.stringify(value.awards) : "";
      if (value && value.resumeId === resumeId && typeof value.requestId === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
        && typeof value.fingerprint === "string" && value.fingerprint === serializedAwards
        && new TextEncoder().encode(serializedAwards).byteLength <= 4096) return value;
      throw new Error("invalid");
    } catch { throw new AwardsWorkerSaveError("A pending Awards request could not be verified safely. Do not save a different payload until it is resolved."); }
  };
  const writeAwardsPending = (request: AwardsRequest) => {
    try {
      const raw = JSON.stringify(request);
      if (new TextEncoder().encode(raw).byteLength > 8192) throw new Error("oversize");
      if (!globalThis.sessionStorage) throw new Error("unavailable");
      globalThis.sessionStorage.setItem(awardsStorageKey(request.resumeId), raw);
    } catch { throw new AwardsWorkerSaveError("The exact pending Awards request could not be stored safely. Do not retry with changed content; keep this page open and retry."); }
  };
  const clearAwardsPending = (resumeId: string) => { try { globalThis.sessionStorage?.removeItem(awardsStorageKey(resumeId)); } catch { /* Retain a safe failure state when storage is unavailable. */ } };
  const collectionPendingKey = (domain: "experience" | "skills" | "education" | "projects", resumeId: string) => `admin-${domain}-rpc-pending-v1:${resumeId}`;
  const saveSignedCollection = async (domain: "experience" | "skills" | "education" | "projects", resumeId: string, payload: unknown[], decode: (value: unknown[]) => unknown[]) => {
    const fingerprint = JSON.stringify(payload);
    if (new TextEncoder().encode(fingerprint).byteLength > 196608) throw new AggregateWorkerSaveError(`${domain} content exceeds the allowed request size.`);
    const storageKey = collectionPendingKey(domain, resumeId);
    let pending: { requestId: string; resumeId: string; payload: unknown[] } | null = null;
    try {
      const raw = globalThis.sessionStorage?.getItem(storageKey);
      if (raw) {
        if (new TextEncoder().encode(raw).byteLength > 220 * 1024) throw new Error("oversize");
        const value = JSON.parse(raw) as Record<string, unknown>;
        if (Object.keys(value).sort().join(",") !== "payload,requestId,resumeId" || value.resumeId !== resumeId
          || typeof value.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
          || !Array.isArray(value.payload) || JSON.stringify(value.payload) !== fingerprint) throw new Error("invalid");
        pending = { requestId: value.requestId, resumeId, payload: value.payload };
      }
    } catch { throw new AggregateWorkerSaveError(`A pending ${domain} request cannot be verified safely. Keep the draft unchanged and retry.`); }
    if (!pending) {
      if (!globalThis.crypto?.randomUUID) throw new AggregateWorkerSaveError(`Secure ${domain} saving is unavailable. Refresh the Admin and try again.`);
      pending = { requestId: globalThis.crypto.randomUUID(), resumeId, payload };
      try {
        const raw = JSON.stringify(pending);
        if (!globalThis.sessionStorage || new TextEncoder().encode(raw).byteLength > 220 * 1024) throw new Error("unavailable");
        globalThis.sessionStorage.setItem(storageKey, raw);
      } catch { throw new AggregateWorkerSaveError(`The exact pending ${domain} request could not be stored safely. Keep this page open and retry.`); }
    }
    try {
      const { data, error } = await supabase.auth.getSession();
      const token = data.session?.access_token; const expiresAt = data.session?.expires_at;
      if (error || typeof token !== "string" || !token || typeof expiresAt !== "number" || expiresAt <= Date.now() / 1000)
        throw new AggregateWorkerSaveError("Your session could not be verified. Sign in again, then retry the unchanged request.");
      let response: Response;
      try { response = await fetch(`/api/admin/v1/${domain}/save`, { method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ request_id: pending.requestId, resume_id: resumeId, [domain]: pending.payload }), signal: AbortSignal.timeout(30_000) }); }
      catch { throw new AggregateWorkerSaveError(`The ${domain} save result is uncertain. Retry the exact pending request.`); }
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 409) {
          try { globalThis.sessionStorage?.removeItem(storageKey); } catch { /* Keep the failure visible if storage is unavailable. */ }
        }
        throw new AggregateWorkerSaveError(response.status === 409
          ? `The ${domain} request ID conflicts with a different payload. Keep the pending draft and contact an administrator.`
          : response.status >= 500 ? `The ${domain} save result is uncertain. Retry the exact pending request.`
            : `${domain} could not be saved. Your draft remains available for correction and retry.`);
      }
      let value: unknown;
      try { value = await response.json(); } catch { throw new AggregateWorkerSaveError(`The ${domain} save result is uncertain. Retry the exact pending request.`); }
      if (!Array.isArray(value) || new TextEncoder().encode(JSON.stringify(value)).byteLength > 212992)
        throw new AggregateWorkerSaveError(`The ${domain} save result could not be confirmed. Retry the exact pending request.`);
      const canonical = decode(value);
      try { globalThis.sessionStorage?.removeItem(storageKey); } catch { /* A replay remains safe with the same request ID. */ }
      return canonical;
    } catch (cause) {
      if (cause instanceof AggregateWorkerSaveError) throw cause;
      throw new AggregateWorkerSaveError(`The ${domain} save result could not be confirmed. Retry the exact pending request.`);
    }
  };
  const profilePendingKey = (resumeId: string) => `admin-profile-rpc-pending-v1:${resumeId}`;
  const saveSignedProfile = async (resumeId: string, rawProfile: ProfileAggregate, baselinePhotoUrl: string | null): Promise<ProfileSection> => {
    const profile = validateProfileAggregate(rawProfile);
    const canonical = canonicalizeProfile(profile);
    if (new TextEncoder().encode(canonical).byteLength > 196608) throw new AggregateWorkerSaveError("Profile content exceeds the allowed request size.");
    const storageKey = profilePendingKey(resumeId);
    let pending: { requestId: string; resumeId: string; profile: ProfileAggregate; baselinePhotoUrl: string | null } | null = null;
    try {
      const raw = globalThis.sessionStorage?.getItem(storageKey);
      if (raw) {
        if (new TextEncoder().encode(raw).byteLength > 220 * 1024) throw new Error("oversize");
        const value = JSON.parse(raw) as Record<string, unknown>;
        if (Object.keys(value).sort().join(",") !== "baselinePhotoUrl,profile,requestId,resumeId" || value.resumeId !== resumeId
          || typeof value.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
          || (value.baselinePhotoUrl !== null && typeof value.baselinePhotoUrl !== "string")
          || canonicalizeProfile(value.profile) !== canonical || value.baselinePhotoUrl !== baselinePhotoUrl) throw new Error("invalid");
        pending = { requestId: value.requestId, resumeId, profile: validateProfileAggregate(value.profile), baselinePhotoUrl: value.baselinePhotoUrl as string | null };
      }
    } catch { throw new AggregateWorkerSaveError("A pending Profile request cannot be verified safely. Keep the draft unchanged and retry."); }
    if (!pending) {
      if (!globalThis.crypto?.randomUUID) throw new AggregateWorkerSaveError("Secure Profile saving is unavailable. Refresh the Admin and try again.");
      pending = { requestId: globalThis.crypto.randomUUID(), resumeId, profile, baselinePhotoUrl };
      try {
        const raw = JSON.stringify(pending);
        if (!globalThis.sessionStorage || new TextEncoder().encode(raw).byteLength > 220 * 1024) throw new Error("unavailable");
        globalThis.sessionStorage.setItem(storageKey, raw);
      } catch { throw new AggregateWorkerSaveError("The exact pending Profile request could not be stored safely. Keep the draft unchanged and retry."); }
    }
    try {
      const { data, error } = await supabase.auth.getSession();
      const token = data.session?.access_token; const expiresAt = data.session?.expires_at;
      if (error || typeof token !== "string" || !token || typeof expiresAt !== "number" || expiresAt <= Date.now() / 1000)
        throw new AggregateWorkerSaveError("Your session could not be verified. Sign in again, then retry the unchanged request.");
      let response: Response;
      try {
        response = await fetch("/api/admin/v1/profile/save", { method: "POST", credentials: "omit",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ request_id: pending.requestId, resume_id: resumeId, baseline_photo_url: pending.baselinePhotoUrl, profile: pending.profile }),
          signal: AbortSignal.timeout(30_000) });
      } catch { throw new AggregateWorkerSaveError("The Profile save result is uncertain. Retry the exact pending request."); }
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 409) {
          try { globalThis.sessionStorage?.removeItem(storageKey); } catch { /* A rejected request remains visible in the draft. */ }
        }
        throw new AggregateWorkerSaveError(response.status === 409
          ? "The Profile request ID conflicts with a different payload. Keep the draft and contact an administrator."
          : response.status >= 500 ? "The Profile save result is uncertain. Retry the exact pending request."
            : "Profile could not be saved. Your draft remains available for correction and retry.");
      }
      let raw: unknown;
      try { raw = await response.json(); } catch { throw new AggregateWorkerSaveError("The Profile save result is uncertain. Retry the exact pending request."); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || new TextEncoder().encode(JSON.stringify(raw)).byteLength > 212992)
        throw new AggregateWorkerSaveError("The Profile save result could not be confirmed. Retry the exact pending request.");
      const canonicalResult = canonicalizeProfile(raw);
      if (canonicalResult !== canonical) throw new AggregateWorkerSaveError("The Profile save result did not match the submitted aggregate. Retry the exact pending request.");
      try { globalThis.sessionStorage?.removeItem(storageKey); } catch { /* Exact replay remains safe after a confirmed response. */ }
      return profileSectionFromAggregate(raw);
    } catch (cause) {
      if (cause instanceof AggregateWorkerSaveError) throw cause;
      throw new AggregateWorkerSaveError("The Profile save result could not be confirmed. Retry the exact pending request.");
    }
  };
  const contactPendingKey = (resumeId: string) => `admin-contact-rpc-pending-v1:${resumeId}`;
  const saveSignedContact = async (resumeId: string, payload: Record<string, unknown>): Promise<ContactSection> => {
    const fingerprint = JSON.stringify(payload);
    if (new TextEncoder().encode(fingerprint).byteLength > 196608) throw new AggregateWorkerSaveError("Contact content exceeds the allowed request size.");
    const storageKey = contactPendingKey(resumeId);
    let pending: { requestId: string; resumeId: string; payload: Record<string, unknown> } | null = null;
    try {
      const raw = globalThis.sessionStorage?.getItem(storageKey);
      if (raw) {
        if (new TextEncoder().encode(raw).byteLength > 220 * 1024) throw new Error("oversize");
        const value = JSON.parse(raw) as Record<string, unknown>;
        if (Object.keys(value).sort().join(",") !== "payload,requestId,resumeId" || value.resumeId !== resumeId
          || typeof value.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
          || JSON.stringify(value.payload) !== fingerprint) throw new Error("invalid");
        pending = { requestId: value.requestId, resumeId, payload: value.payload as Record<string, unknown> };
      }
    } catch { throw new AggregateWorkerSaveError("A pending Contact request cannot be verified safely. Keep the draft unchanged and retry."); }
    if (!pending) {
      if (!globalThis.crypto?.randomUUID) throw new AggregateWorkerSaveError("Secure Contact saving is unavailable. Refresh the Admin and try again.");
      pending = { requestId: globalThis.crypto.randomUUID(), resumeId, payload };
      try {
        const raw = JSON.stringify(pending);
        if (!globalThis.sessionStorage || new TextEncoder().encode(raw).byteLength > 220 * 1024) throw new Error("unavailable");
        globalThis.sessionStorage.setItem(storageKey, raw);
      } catch { throw new AggregateWorkerSaveError("The exact pending Contact request could not be stored safely. Keep the draft unchanged and retry."); }
    }
    try {
      const { data, error } = await supabase.auth.getSession();
      const token = data.session?.access_token; const expiresAt = data.session?.expires_at;
      if (error || typeof token !== "string" || !token || typeof expiresAt !== "number" || expiresAt <= Date.now() / 1000)
        throw new AggregateWorkerSaveError("Your session could not be verified. Sign in again, then retry the unchanged request.");
      let response: Response;
      try { response = await fetch("/api/admin/v1/contact/save", { method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ request_id: pending.requestId, resume_id: resumeId, contact: pending.payload }), signal: AbortSignal.timeout(30_000) }); }
      catch { throw new AggregateWorkerSaveError("The Contact save result is uncertain. Retry the exact pending request."); }
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 409) {
          try { globalThis.sessionStorage?.removeItem(storageKey); } catch { /* preserve safe failure state */ }
        }
        throw new AggregateWorkerSaveError(response.status === 409
          ? "The Contact request ID conflicts with a different payload. Keep the pending draft and contact an administrator."
          : response.status >= 500 ? "The Contact save result is uncertain. Retry the exact pending request."
            : "Contact could not be saved. Your draft remains available for correction and retry.");
      }
      let raw: unknown;
      try { raw = await response.json(); } catch { throw new AggregateWorkerSaveError("The Contact save result is uncertain. Retry the exact pending request."); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || new TextEncoder().encode(JSON.stringify(raw)).byteLength > 212992)
        throw new AggregateWorkerSaveError("The Contact save result could not be confirmed. Retry the exact pending request.");
      const value = raw as Record<string, unknown>;
      if (Object.keys(value).sort().join(",") !== "focus,status,translations" || !value.translations || typeof value.translations !== "object") throw new Error("shape");
      const translations = value.translations as Record<string, unknown>;
      const decodeLocale = (locale: unknown) => {
        if (!locale || typeof locale !== "object" || Array.isArray(locale)) throw new Error("locale");
        const fields = locale as Record<string, unknown>;
        if (Object.keys(fields).sort().join(",") !== "availability,contact_label" || typeof fields.contact_label !== "string" || typeof fields.availability !== "string") throw new Error("fields");
        return { contactLabel: fields.contact_label, availability: fields.availability };
      };
      const decodeItems = (rawItems: unknown, kind: "focus" | "status") => {
        if (!Array.isArray(rawItems) || rawItems.length > 32) throw new Error("items");
        const requested = payload[kind] as Array<Record<string, unknown>>;
        if (requested.length !== rawItems.length) throw new Error("length");
        const ids = new Set<string>(); let priorPosition = -1;
        return rawItems.map((rawItem, position) => {
          if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) throw new Error("item");
          const item = rawItem as Record<string, unknown>; const expectKeys = kind === "focus" ? "en,id,position,zh" : "en,id,position,status_type,zh";
          if (Object.keys(item).sort().join(",") !== expectKeys || typeof item.id !== "string"
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.id)
            || ids.has(item.id) || !Number.isInteger(item.position) || (item.position as number) < 0
            || (position > 0 && (item.position as number) <= priorPosition) || (requested[position]?.id && requested[position]?.id !== item.id)) throw new Error("identity");
          ids.add(item.id); priorPosition = item.position as number;
          const decodeText = (locale: unknown) => {
            if (!locale || typeof locale !== "object" || Array.isArray(locale)) throw new Error("text");
            const text = locale as Record<string, unknown>;
            if (Object.keys(text).sort().join(",") !== "detail,title" || typeof text.title !== "string" || typeof text.detail !== "string") throw new Error("text fields");
            return { title: text.title, detail: text.detail };
          };
          const zh = decodeText(item.zh); const en = decodeText(item.en);
          const requestItem = requested[position]!;
          const matches = (key: "zh" | "en") => {
            const asked = requestItem[key] as Record<string, unknown> | undefined;
            const got = key === "zh" ? zh : en;
            return Boolean(asked && asked.title === got.title && asked.detail === got.detail);
          };
          if (!matches("zh") || !matches("en")) throw new Error("mismatch");
          if (kind === "focus") return { id: item.id, position: item.position as number, translations: { zh, en } };
          if (!(item.status_type === "study" || item.status_type === "graduation" || item.status_type === "open")
            || item.status_type !== requestItem.status_type) throw new Error("status type");
          return { id: item.id, position: item.position as number, statusType: item.status_type, translations: { zh, en } };
        });
      };
      const focus = decodeItems(value.focus, "focus") as ContactSection["focus"];
      const status = decodeItems(value.status, "status") as ContactSection["status"];
      const expectedTranslations = payload.translations as Record<string, Record<string, unknown>>;
      const zh = decodeLocale(translations.zh); const en = decodeLocale(translations.en);
      if (zh.contactLabel !== expectedTranslations.zh?.contact_label || zh.availability !== expectedTranslations.zh?.availability
        || en.contactLabel !== expectedTranslations.en?.contact_label || en.availability !== expectedTranslations.en?.availability) throw new Error("translation mismatch");
      const canonical = { translations: { zh, en }, focus, status } satisfies ContactSection;
      try { globalThis.sessionStorage?.removeItem(storageKey); } catch { /* same request ID remains safe to replay */ }
      return canonical;
    } catch (cause) {
      if (cause instanceof AggregateWorkerSaveError) throw cause;
      throw new AggregateWorkerSaveError("The Contact save result could not be confirmed. Retry the exact pending request.");
    }
  };
  const saveSignedD7 = async (domain: "website_links" | "files", resumeId: string, value: WebsiteLinksAggregate | FilesAggregate,
    uploadRequestIds: Partial<Record<Locale, string>> = {}, suppliedOperation?: FilesSaveOperation): Promise<{ result: WebsiteLinksAggregate | FilesAggregate; cleanupWarning: boolean }> => {
    const operation = suppliedOperation ?? (domain === "files" ? createFilesSaveOperation() : undefined);
    if (operation) assertFilesSaveOperation(operation);
    const canonical = domain === "website_links" ? canonicalizeWebsiteLinks(value) : canonicalizeFiles(value);
    if (new TextEncoder().encode(canonical).byteLength > (domain === "website_links" ? 65536 : 16384)) throw new AggregateWorkerSaveError("Website & Links / Files content exceeds the allowed request size.");
    const storageKey = `admin-${domain}-rpc-pending-v1:${resumeId}`;
    let pending: { requestId: string; resumeId: string; canonical: string; uploadRequestIds: Partial<Record<Locale, string>> } | null = null;
    try {
      const raw = globalThis.sessionStorage?.getItem(storageKey);
      if (raw) {
        if (new TextEncoder().encode(raw).byteLength > 72 * 1024) throw new Error("oversize");
        const stored = JSON.parse(raw) as Record<string, unknown>;
        const hasUploadIds = Object.keys(stored).sort().join(",") === "canonical,requestId,resumeId,uploadRequestIds";
        if ((!hasUploadIds && Object.keys(stored).sort().join(",") !== "canonical,requestId,resumeId") || stored.resumeId !== resumeId
          || stored.canonical !== canonical || typeof stored.requestId !== "string"
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored.requestId)) throw new Error("mismatch");
        const persistedUploadIds = hasUploadIds ? stored.uploadRequestIds as Partial<Record<Locale, string>> : {};
        if (!persistedUploadIds || typeof persistedUploadIds !== "object" || Object.entries(persistedUploadIds).some(([locale,id]) =>
          !(["zh","en"].includes(locale) && typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))
          || JSON.stringify(persistedUploadIds) !== JSON.stringify(uploadRequestIds)) throw new Error("upload identities mismatch");
        pending = { requestId: stored.requestId, resumeId, canonical, uploadRequestIds: persistedUploadIds };
      }
    } catch { throw new AggregateWorkerSaveError(`A pending ${domain} request cannot be verified safely; keep the draft unchanged.`); }
    if (!pending) {
      if (!globalThis.crypto?.randomUUID) throw new AggregateWorkerSaveError(`Secure ${domain} saving is unavailable.`);
      pending = { requestId: globalThis.crypto.randomUUID(), resumeId, canonical, uploadRequestIds };
      try { if (!globalThis.sessionStorage) throw new Error("unavailable"); globalThis.sessionStorage.setItem(storageKey, JSON.stringify({
        requestId: pending.requestId, resumeId, canonical, ...(domain === "files" && Object.keys(uploadRequestIds).length ? { uploadRequestIds } : {}),
      })); }
      catch { throw new AggregateWorkerSaveError(`The exact pending ${domain} request could not be stored safely.`); }
    }
    if (operation) assertFilesSaveOperation(operation);
    let sessionPromise: ReturnType<typeof supabase.auth.getSession>;
    try { sessionPromise = supabase.auth.getSession(); }
    catch { throw new AggregateWorkerSaveError("Your session check failed before the Files request was sent. Retry the unchanged request."); }
    const { data, error } = operation
      ? await awaitFilesPreflight(sessionPromise, operation, "session check", FILE_AUTH_TIMEOUT_MS)
      : await sessionPromise;
    const token = data.session?.access_token; const expiresAt = data.session?.expires_at;
    if (error || typeof token !== "string" || !token || typeof expiresAt !== "number" || expiresAt <= Date.now() / 1000)
      throw new AggregateWorkerSaveError("Your session could not be verified. Retry the unchanged request.");
    let response: Response;
    let responseValue: unknown;
    if (operation) {
      const result = await awaitFilesRequest(async signal => {
        const issued = await fetch(`/api/admin/v1/${domain === "website_links" ? "website-links" : "files"}/save`, { method: "POST", credentials: "omit",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ request_id: pending!.requestId, resume_id: resumeId, [domain]: value }), signal });
        let decoded: unknown;
        if (issued.ok) {
          try { decoded = await issued.json(); }
          catch { throw new AggregateWorkerSaveError(`The ${domain} result is uncertain. Retry the exact pending request.`, true); }
        }
        return { response: issued, responseValue: decoded };
      }, operation, `${domain} save`, FILE_SAVE_TIMEOUT_MS);
      response = result.response; responseValue = result.responseValue;
    } else {
      try { response = await fetch(`/api/admin/v1/${domain === "website_links" ? "website-links" : "files"}/save`, { method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ request_id: pending.requestId, resume_id: resumeId, [domain]: value }), signal: AbortSignal.timeout(FILE_SAVE_TIMEOUT_MS) }); }
      catch { throw new AggregateWorkerSaveError(`The ${domain} result is uncertain. Retry the exact pending request.`, true); }
    }
    if (!response.ok) {
      if (response.status >= 500) throw new AggregateWorkerSaveError(`The ${domain} result is uncertain. Retry the exact pending request.`, true);
      if (response.status !== 409) { try { globalThis.sessionStorage?.removeItem(storageKey); } catch { /* retain safe failure state */ } }
      throw new AggregateWorkerSaveError(response.status === 409 ? `The ${domain} request ID conflicts with a different payload. Keep the draft unchanged.`
        : `${domain} could not be saved. Your draft remains available.`);
    }
    if (!operation) try { responseValue = await response.json(); } catch { throw new AggregateWorkerSaveError(`The ${domain} result is uncertain. Retry the exact pending request.`, true); }
    try {
      let cleanupWarning = false; let rawAggregate = responseValue;
      if (domain === "files") {
        if (!responseValue || typeof responseValue !== "object" || Array.isArray(responseValue)) throw new Error("files response");
        const responseRecord = responseValue as Record<string, unknown>;
        if (typeof responseRecord.cleanup_warning !== "boolean") throw new Error("cleanup status");
        cleanupWarning = responseRecord.cleanup_warning; rawAggregate = responseRecord.files;
      }
      const validated = domain === "website_links" ? validateWebsiteLinksAggregate(rawAggregate) : validateFilesAggregate(rawAggregate);
      const returnedCanonical = domain === "website_links" ? canonicalizeWebsiteLinks(validated) : canonicalizeFiles(validated);
      if (returnedCanonical !== canonical) throw new Error("mismatch");
      try { globalThis.sessionStorage?.removeItem(storageKey); } catch { /* exact replay remains safe */ }
      return { result: validated, cleanupWarning };
    } catch { throw new AggregateWorkerSaveError(`The ${domain} result could not be confirmed. Retry the exact pending request.`, true); }
  };
  return {
    ...createEditableSectionWrites(supabase),
    ...createBatch6BRepositoryWrites(supabase, supabaseUrl ?? ""),
    async load() {
      const site = await readSiteRow(supabase);
      const resumeId = site.id as string;
      const children = await Promise.all(resumeTables.map(async table => {
        return [table, await readResumeRows(supabase, table, resumeId)] as const;
      }));
      return mapResumeRows({ resume_sites: [site], ...Object.fromEntries(children) } as ResumeRows);
    },
    async loadSiteMetadata() {
      return mapResumeSiteMetadata(await readSiteRow(supabase));
    },
    async loadAdminFeatureState(resumeId) {
      if (!resumeId) throw new Error("Missing resume ID");
      const { data, error } = await supabase.rpc("load_admin_feature_state_v11", { target_resume_id: resumeId });
      if (error) throw new Error("Unable to load Admin feature state");
      const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
      if (!row || typeof row !== "object") throw new Error("Invalid Admin feature state");
      const value = row as Record<string, unknown>;
      if (typeof value.activity_log_enabled !== "boolean"
        || (value.introduction_write_mode !== "direct" && value.introduction_write_mode !== "rpc")
        || typeof value.introduction_trusted_context_required !== "boolean") throw new Error("Invalid Admin feature state");
      if (value.introduction_write_mode === "direct" && value.introduction_trusted_context_required) throw new Error("Invalid Admin feature state");
      return { resumeId, activityLogEnabled: value.activity_log_enabled, introductionWriteMode: value.introduction_write_mode,
        introductionTrustedContextRequired: value.introduction_trusted_context_required };
    },
    async loadAdminAwardsWriteState(resumeId) {
      if (!resumeId) throw new Error("Missing resume ID");
      const { data, error } = await supabase.rpc("load_admin_awards_write_state", { target_resume_id: resumeId });
      if (error) throw new Error("Unable to load Awards write state");
      const row = Array.isArray(data) && data.length === 1 ? data[0] as Record<string, unknown> : null;
      if (!row || row.resume_id !== resumeId || typeof row.activity_log_enabled !== "boolean"
        || (row.awards_write_mode !== "direct" && row.awards_write_mode !== "rpc")
        || typeof row.awards_trusted_context_required !== "boolean"
        || (row.awards_write_mode === "direct" && row.awards_trusted_context_required)) throw new Error("Invalid Awards write state");
      return { resumeId, activityLogEnabled: row.activity_log_enabled, awardsWriteMode: row.awards_write_mode,
        awardsTrustedContextRequired: row.awards_trusted_context_required };
    },
    async saveAwardsWithWorker(resumeId, items) {
      const persistedItems = items.map((item, position) => {
        if (!item || !(item.id.startsWith("local-") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id))
          || typeof item.translations?.zh?.name !== "string" || typeof item.translations?.zh?.year !== "string"
          || typeof item.translations?.en?.name !== "string" || typeof item.translations?.en?.year !== "string") throw new AwardsWorkerSaveError("Awards content is invalid. Review and retry.");
        return { id: item.id.startsWith("local-") ? null : item.id.toLowerCase(), position,
          zh: { name: item.translations.zh.name, year: item.translations.zh.year },
          en: { name: item.translations.en.name, year: item.translations.en.year } };
      });
      if (persistedItems.length > 32) throw new AwardsWorkerSaveError("Awards may contain no more than 32 entries.");
      const fingerprint = JSON.stringify(persistedItems);
      if (new TextEncoder().encode(fingerprint).byteLength > 4096) throw new AwardsWorkerSaveError("Awards content exceeds the allowed request size.");
      let request = readAwardsPending(resumeId);
      if (!request) {
        if (!globalThis.crypto?.randomUUID) throw new AwardsWorkerSaveError("Secure Awards saving is unavailable. Refresh the Admin and try again.");
        request = { requestId: globalThis.crypto.randomUUID(), resumeId, fingerprint, awards: persistedItems };
        writeAwardsPending(request);
      }
      // Any stored request is retried verbatim even if a later reload shows a new server baseline.
      const pending = request;
      try {
        const { data, error } = await supabase.auth.getSession();
        const token = data.session?.access_token; const expiresAt = data.session?.expires_at;
        if (error || typeof token !== "string" || !token || typeof expiresAt !== "number" || expiresAt <= Date.now()/1000)
          throw new AwardsWorkerSaveError("Your session could not be verified. Sign in again, then retry the unchanged request.");
        let response: Response;
        try { response = await fetch("/api/admin/v1/awards/save", { method: "POST", credentials: "omit",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ request_id: pending.requestId, resume_id: resumeId, awards: pending.awards }), signal: AbortSignal.timeout(20_000) }); }
        catch { throw new AwardsWorkerSaveError("The save result is uncertain. Retry the exact pending Awards request without changing it."); }
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500 && response.status !== 409) clearAwardsPending(resumeId);
          throw new AwardsWorkerSaveError(response.status === 409
            ? "The Awards request ID conflicts with a different request. Keep the pending draft and contact an administrator."
            : response.status >= 500 ? "The save result is uncertain. Retry the exact pending Awards request."
              : "Awards could not be saved. Your draft remains available for correction and retry.");
        }
        let value: unknown;
        try { value = await response.json(); } catch { throw new AwardsWorkerSaveError("The save result is uncertain. Retry the exact pending Awards request."); }
        if (!Array.isArray(value) || value.length !== pending.awards.length || new TextEncoder().encode(JSON.stringify(value)).byteLength > 8192)
          throw new AwardsWorkerSaveError("The save result could not be confirmed. Retry the exact pending Awards request.");
        const seen = new Set<string>();
        const canonical = value.map((raw, position) => {
          if (!raw || typeof raw !== "object") throw new AwardsWorkerSaveError("The save result could not be confirmed. Retry the exact pending Awards request.");
          const row = raw as Record<string, unknown>; const zh = row.zh as Record<string, unknown> | undefined; const en = row.en as Record<string, unknown> | undefined;
          if (Object.keys(row).sort().join(",") !== "en,id,position,zh" || typeof row.id !== "string"
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id)
            || seen.has(row.id) || row.position !== position || !zh || !en
            || Object.keys(zh).sort().join(",") !== "name,year" || Object.keys(en).sort().join(",") !== "name,year"
            || typeof zh.name !== "string" || typeof zh.year !== "string" || typeof en.name !== "string" || typeof en.year !== "string")
            throw new AwardsWorkerSaveError("The save result could not be confirmed. Retry the exact pending Awards request.");
          const requested = pending.awards[position];
          if ((requested.id && requested.id !== row.id) || requested.zh.name !== zh.name || requested.zh.year !== zh.year
            || requested.en.name !== en.name || requested.en.year !== en.year) throw new AwardsWorkerSaveError("The canonical saved Awards do not match the request.");
          seen.add(row.id);
          const old = items.find(item => item.id.toLowerCase() === row.id);
          return { id: row.id, position, sourceKey: old?.sourceKey ?? null, translations: {
            zh: { name: zh.name as string, year: zh.year as string }, en: { name: en.name as string, year: en.year as string } } } satisfies AwardItem;
        });
        clearAwardsPending(resumeId);
        return canonical;
      } catch (error) {
        if (error instanceof AwardsWorkerSaveError) throw error;
        throw new AwardsWorkerSaveError("The save result is uncertain. Retry the exact pending Awards request.");
      }
    },
    hasPendingAwardsWorkerSave(resumeId) { try { return Boolean(readAwardsPending(resumeId)); } catch { return true; } },
    discardPendingAwardsSave() { /* An ambiguous request cannot be discarded safely. */ },
    async loadAdminExperienceWriteState(resumeId) {
      if (!resumeId) throw new Error("Missing resume ID");
      const { data, error } = await supabase.rpc("load_admin_experience_write_state", { target_resume_id: resumeId });
      if (error) throw new Error("Unable to load Experience write state");
      const row = Array.isArray(data) && data.length === 1 ? data[0] as Record<string, unknown> : null;
      if (!row || row.resume_id !== resumeId || typeof row.activity_log_enabled !== "boolean"
        || (row.experience_write_mode !== "direct" && row.experience_write_mode !== "rpc")
        || typeof row.experience_trusted_context_required !== "boolean"
        || (row.experience_write_mode === "direct" && row.experience_trusted_context_required)) throw new Error("Invalid Experience write state");
      return { resumeId, domain: "experience" as const, activityLogEnabled: row.activity_log_enabled,
        writeMode: row.experience_write_mode, trustedContextRequired: row.experience_trusted_context_required };
    },
    async saveExperienceWithWorker(resumeId, items) {
      if (!resumeId || !Array.isArray(items) || items.length > 16) throw new AggregateWorkerSaveError("Experience content is invalid.");
      const payload = items.map((item, position) => {
        if (!item || !(item.id.startsWith("local-") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id))) throw new AggregateWorkerSaveError("Experience IDs are invalid.");
        const locale = (value: ExperienceItem["translations"]["zh"]) => ({ organization: value.organization, title: value.title,
          period: value.period, description: value.description, location: value.location });
        return { id: item.id.startsWith("local-") ? null : item.id.toLowerCase(), position,
          zh: locale(item.translations.zh), en: locale(item.translations.en) };
      });
      const value = await saveSignedCollection("experience", resumeId, payload, raw => {
        if (raw.length !== payload.length) throw new Error("length");
        const seen = new Set<string>();
        return raw.map((entry, position) => {
          if (!entry || typeof entry !== "object") throw new Error("entry");
          const row = entry as Record<string, unknown>; const zh = row.zh as Record<string, unknown> | undefined; const en = row.en as Record<string, unknown> | undefined;
          const validLocale = (locale: Record<string, unknown> | undefined): locale is Record<string, unknown> => Boolean(locale
            && Object.keys(locale).sort().join(",") === "description,location,organization,period,title"
            && ["organization", "title", "period", "description"].every(key => typeof locale[key] === "string")
            && (locale.location === null || typeof locale.location === "string"));
          if (Object.keys(row).sort().join(",") !== "en,id,position,zh" || typeof row.id !== "string"
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id)
            || seen.has(row.id) || row.position !== position || !validLocale(zh) || !validLocale(en)) throw new Error("shape");
          const requested = payload[position];
          if ((requested.id && requested.id !== row.id) || ["organization", "title", "period", "description", "location"].some(field => requested.zh[field as keyof typeof requested.zh] !== zh[field])
            || ["organization", "title", "period", "description", "location"].some(field => requested.en[field as keyof typeof requested.en] !== en[field])) throw new Error("mismatch");
          seen.add(row.id); const source = items.find(item => item.id.toLowerCase() === row.id);
          return { id: row.id, position, sourceKey: source?.sourceKey ?? null,
            translations: { zh: zh as ExperienceItem["translations"]["zh"], en: en as ExperienceItem["translations"]["en"] } } satisfies ExperienceItem;
        });
      }) as ExperienceItem[];
      return value;
    },
    hasPendingExperienceWorkerSave(resumeId) { try { return Boolean(globalThis.sessionStorage?.getItem(collectionPendingKey("experience", resumeId))); } catch { return true; } },
    discardPendingExperienceSave() { /* Ambiguous idempotent requests are retained for exact replay. */ },
    async loadAdminSkillsWriteState(resumeId) {
      if (!resumeId) throw new Error("Missing resume ID");
      const { data, error } = await supabase.rpc("load_admin_skills_write_state", { target_resume_id: resumeId });
      if (error) throw new Error("Unable to load Skills write state");
      const row = Array.isArray(data) && data.length === 1 ? data[0] as Record<string, unknown> : null;
      if (!row || row.resume_id !== resumeId || typeof row.activity_log_enabled !== "boolean"
        || (row.skills_write_mode !== "direct" && row.skills_write_mode !== "rpc")
        || typeof row.skills_trusted_context_required !== "boolean"
        || (row.skills_write_mode === "direct" && row.skills_trusted_context_required)) throw new Error("Invalid Skills write state");
      return { resumeId, domain: "skills" as const, activityLogEnabled: row.activity_log_enabled,
        writeMode: row.skills_write_mode, trustedContextRequired: row.skills_trusted_context_required };
    },
    async saveSkillsWithWorker(resumeId, items) {
      if (!resumeId || !Array.isArray(items) || items.length > 16) throw new AggregateWorkerSaveError("Skills content is invalid.");
      const payload = items.map((item, position) => {
        if (!item || !(item.id.startsWith("local-") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id))) throw new AggregateWorkerSaveError("Skills IDs are invalid.");
        return { id: item.id.startsWith("local-") ? null : item.id.toLowerCase(), position,
          zh: { title: item.translations.zh.title, items: item.translations.zh.items },
          en: { title: item.translations.en.title, items: item.translations.en.items } };
      });
      return await saveSignedCollection("skills", resumeId, payload, raw => {
        if (raw.length !== payload.length) throw new Error("length");
        const seen = new Set<string>();
        return raw.map((entry, position) => {
          if (!entry || typeof entry !== "object") throw new Error("entry");
          const row = entry as Record<string, unknown>; const zh = row.zh as Record<string, unknown> | undefined; const en = row.en as Record<string, unknown> | undefined;
          const validLocale = (locale: Record<string, unknown> | undefined): locale is Record<string, unknown> => Boolean(locale && Object.keys(locale).sort().join(",") === "items,title"
            && typeof locale.title === "string" && typeof locale.items === "string");
          if (Object.keys(row).sort().join(",") !== "en,id,position,zh" || typeof row.id !== "string"
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id)
            || seen.has(row.id) || row.position !== position || !validLocale(zh) || !validLocale(en)) throw new Error("shape");
          const requested = payload[position];
          if ((requested.id && requested.id !== row.id) || requested.zh.title !== zh.title || requested.zh.items !== zh.items
            || requested.en.title !== en.title || requested.en.items !== en.items) throw new Error("mismatch");
          seen.add(row.id); const source = items.find(item => item.id.toLowerCase() === row.id);
          return { id: row.id, position, sourceKey: source?.sourceKey ?? null,
            translations: { zh: zh as SkillItem["translations"]["zh"], en: en as SkillItem["translations"]["en"] } } satisfies SkillItem;
        });
      }) as SkillItem[];
    },
    hasPendingSkillsWorkerSave(resumeId) { try { return Boolean(globalThis.sessionStorage?.getItem(collectionPendingKey("skills", resumeId))); } catch { return true; } },
    discardPendingSkillsSave() { /* Ambiguous idempotent requests are retained for exact replay. */ },
    async saveIntroductionAtomically(resumeId, items) {
      if (!resumeId || !Array.isArray(items) || items.some(item => !item || !item.id || typeof item.translations?.zh?.text !== "string" || typeof item.translations?.en?.text !== "string")) {
        throw new Error("Invalid Introduction save");
      }
      const input = items.map(item => ({ id: item.id, zh: item.translations.zh.text, en: item.translations.en.text }));
      const { data, error } = await supabase.rpc("save_resume_introduction", { target_resume_id: resumeId, target_items: input });
      if (error) throw new Error("Introduction changes could not be saved. Please retry.");
      if (!Array.isArray(data)) throw new Error("Invalid Introduction save response");
      return data.map(entry => {
        if (!entry || typeof entry !== "object") throw new Error("Invalid Introduction save response");
        const row = entry as Record<string, unknown>;
        const translations = row.translations as Record<string, unknown> | undefined;
        const zh = translations?.zh as Record<string, unknown> | undefined;
        const en = translations?.en as Record<string, unknown> | undefined;
        if (typeof row.id !== "string" || !Number.isInteger(row.position) || typeof zh?.text !== "string" || typeof en?.text !== "string") throw new Error("Invalid Introduction save response");
        return { id: row.id, position: row.position as number, translations: { zh: { text: zh.text }, en: { text: en.text } } };
      });
    },
    async saveIntroductionWithWorker(resumeId, items) {
      if (!resumeId || !Array.isArray(items) || items.some(item => !item
        || !(item.id === null || (typeof item.id === "string"
          && (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id) || /^local-[0-9]+-[0-9]+$/.test(item.id))))
        || typeof item.translations?.zh?.text !== "string" || typeof item.translations?.en?.text !== "string")) {
        throw new IntroductionWorkerSaveError("Introduction changes could not be saved. Please review the content and retry.");
      }
      const requestItems = items.map(item => ({ id: item.id, zh: item.translations.zh.text, en: item.translations.en.text }));
      const fingerprint = JSON.stringify(requestItems);
      if (pendingIntroductionRequest?.inFlight) {
        if (pendingIntroductionRequest.resumeId === resumeId && pendingIntroductionRequest.fingerprint === fingerprint) return pendingIntroductionRequest.inFlight;
        throw new IntroductionWorkerSaveError("A save is already in progress. Wait for it to finish before changing targets or content.");
      }
      if (!pendingIntroductionRequest || pendingIntroductionRequest.resumeId !== resumeId || pendingIntroductionRequest.fingerprint !== fingerprint) {
        if (!globalThis.crypto?.randomUUID) throw new IntroductionWorkerSaveError("The secure save service is unavailable. Refresh the Admin and try again.");
        let requestId: string;
        try { requestId = globalThis.crypto.randomUUID(); }
        catch { throw new IntroductionWorkerSaveError("The secure save service is unavailable. Refresh the Admin and try again."); }
        pendingIntroductionRequest = { resumeId, fingerprint, requestId };
      }
      const request = pendingIntroductionRequest;
      const execute = async (): Promise<IntroItem[]> => {
        let data: Awaited<ReturnType<SupabaseClient["auth"]["getSession"]>>["data"];
        let error: Awaited<ReturnType<SupabaseClient["auth"]["getSession"]>>["error"];
        try { ({ data, error } = await supabase.auth.getSession()); } catch {
          throw new IntroductionWorkerSaveError("Your session could not be verified. Sign in again before saving.");
        }
        const token = data.session?.access_token;
        const expiresAt = data.session?.expires_at;
        if (error || typeof token !== "string" || !token || typeof expiresAt !== "number" || expiresAt <= Date.now() / 1000) {
          throw new IntroductionWorkerSaveError("Your session could not be verified. Sign in again before saving.");
        }
        let response: Response;
        try {
          response = await fetch("/api/admin/v1/introduction/save", {
            method: "POST",
            credentials: "omit",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ request_id: request.requestId, resume_id: resumeId, items: requestItems }),
            signal: AbortSignal.timeout(20_000),
          });
        } catch {
          throw new IntroductionWorkerSaveError("The save result is uncertain because the service could not be reached. Retry without changing the content.");
        }
        if (!response.ok) {
          const message = response.status === 401 ? "Your session has expired. Sign in again, then retry the unchanged content."
            : response.status === 409 ? "The save could not be confirmed because the retry request conflicts. Refresh the Admin before trying again."
              : response.status === 413 || response.status === 422 ? "The Introduction content could not be accepted. Review it and try again."
                : response.status >= 500 ? "The save result is uncertain because the service is temporarily unavailable. Retry without changing the content."
                  : "The Introduction could not be saved. Refresh the Admin before trying again.";
          throw new IntroductionWorkerSaveError(message);
        }
        let payload: unknown;
        try { payload = await response.json(); } catch {
          throw new IntroductionWorkerSaveError("The save result is uncertain. Retry without changing the content.");
        }
        const rows = Array.isArray(payload) ? payload : null;
        const seenIds = new Set<string>();
        if (!rows || rows.length !== requestItems.length || rows.some((entry, index) => {
          if (!entry || typeof entry !== "object") return true;
          const row = entry as Record<string, unknown>;
          const keys = Object.keys(row).sort();
          const translations = row.translations as Record<string, unknown> | null;
          const zh = translations?.zh as Record<string, unknown> | null;
          const en = translations?.en as Record<string, unknown> | null;
          if (keys.join(",") !== "id,position,translations" || typeof row.id !== "string"
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)
            || seenIds.has(row.id.toLowerCase()) || row.position !== index
            || !translations || Object.keys(translations).sort().join(",") !== "en,zh"
            || !zh || Object.keys(zh).join(",") !== "text" || !en || Object.keys(en).join(",") !== "text"
            || typeof zh?.text !== "string" || typeof en?.text !== "string") return true;
          const submitted = requestItems[index];
          const submittedPersistedId = typeof submitted.id === "string"
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submitted.id);
          if ((submittedPersistedId && row.id.toLowerCase() !== submitted.id.toLowerCase())
            || zh.text !== submitted.zh || en.text !== submitted.en) return true;
          seenIds.add(row.id.toLowerCase());
          return false;
        })) throw new IntroductionWorkerSaveError("The save result could not be confirmed. Retry without changing the content.");
        return rows.map(entry => {
          const row = entry as Record<string, unknown>;
          const translations = row.translations as { zh: { text: string }; en: { text: string } };
          return { id: row.id as string, position: row.position as number,
            translations: { zh: { text: translations.zh.text }, en: { text: translations.en.text } } };
        });
      };
      const inFlight = execute();
      request.inFlight = inFlight;
      try {
        const canonical = await inFlight;
        if (pendingIntroductionRequest === request) pendingIntroductionRequest = null;
        return canonical;
      } finally {
        if (request.inFlight === inFlight) request.inFlight = undefined;
        if (request.discardWhenSettled && pendingIntroductionRequest === request) pendingIntroductionRequest = null;
      }
    },
    hasPendingIntroductionWorkerSave(resumeId, items) {
      if (!resumeId || !Array.isArray(items)) return false;
      const fingerprint = JSON.stringify(items.map(item => ({ id: item.id, zh: item.translations.zh.text, en: item.translations.en.text })));
      return pendingIntroductionRequest?.resumeId === resumeId && pendingIntroductionRequest.fingerprint === fingerprint;
    },
    discardPendingIntroductionSave(resumeId) {
      if (!resumeId || pendingIntroductionRequest?.resumeId === resumeId) {
        if (pendingIntroductionRequest?.inFlight) pendingIntroductionRequest.discardWhenSettled = true;
        else pendingIntroductionRequest = null;
      }
    },
    async loadActivityLogPage(resumeId, pageSize, cursor) {
      const { data, error } = await supabase.rpc("read_activity_log_events", {
        target_resume_id: resumeId, page_limit: pageSize,
        before_occurred_at: cursor?.occurredAt ?? null, before_id: cursor?.id ?? null,
      });
      if (error) throw new Error("Unable to load Activity Log");
      return mapActivityLogRows(data);
    },
    async loadActivityLogPageV12(resumeId, pageSize, filters, cursor) {
      const { data, error } = await supabase.rpc("read_activity_log_events_v12", {
        target_resume_id: resumeId,
        page_limit: pageSize,
        before_occurred_at: cursor?.occurredAt ?? null,
        before_id: cursor?.id ?? null,
        section_filter: filters.section || null,
        operation_filter: filters.operation || null,
        actor_email_filter: filters.actorEmail.trim() || null,
        date_from: filters.dateFrom,
        date_to_exclusive: filters.dateToExclusive,
        search_query: filters.search.trim() || null,
      });
      if (error) throw new Error("Unable to load Activity Log");
      return mapActivityLogRows(data);
    },
    async loadActivityLogPageV13C(resumeId, pageSize, filters, cursor) {
      const { data, error } = await supabase.rpc("read_activity_log_events_v13c", {
        target_resume_id: resumeId,
        page_limit: pageSize,
        before_occurred_at: cursor?.occurredAt ?? null,
        before_id: cursor?.id ?? null,
        before_source_rank: cursor?.sourceRank ?? null,
        event_filter: filters.eventFilter,
        section_filter: filters.section || null,
        operation_filter: filters.operation || null,
        actor_email_filter: filters.actorEmail.trim() || null,
        date_from: filters.dateFrom,
        date_to_exclusive: filters.dateToExclusive,
        search_query: filters.search.trim() || null,
      });
      if (error) throw new Error("Unable to load Activity Log");
      return mapActivityLogV13CRows(data);
    },
    async loadVersionHistoryPage(resumeId, pageSize, cursor) {
      if (!resumeId || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw new Error("Invalid Version History page request");
      }
      if (cursor && (!Number.isFinite(Date.parse(cursor.occurredAt))
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.eventId))) {
        throw new Error("Invalid Version History cursor");
      }
      const { data, error } = await supabase.rpc("read_version_history_v1", {
        target_resume_id: resumeId,
        page_limit: pageSize,
        before_occurred_at: cursor?.occurredAt ?? null,
        before_event_id: cursor?.eventId ?? null,
      });
      if (error) throw new Error("Unable to load Version History");
      const page = mapVersionHistoryRows(data);
      const last = page.entries.at(-1);
      return {
        entries: page.entries,
        hasMore: page.hasMore,
        nextCursor: page.hasMore && last ? { occurredAt: last.occurredAt, eventId: last.eventId } : null,
      };
    },
    async previewRestore(input) {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!input || !uuid.test(input.resumeId) || !uuid.test(input.sourceEventId)) throw new RestorePreviewError("invalid_response");
      let sessionResult: Awaited<ReturnType<SupabaseClient["auth"]["getSession"]>>;
      try { sessionResult = await supabase.auth.getSession(); }
      catch { throw new RestorePreviewError("unauthenticated"); }
      const token = sessionResult.data.session?.access_token;
      if (sessionResult.error || typeof token !== "string" || !token) throw new RestorePreviewError("unauthenticated");
      let response: Response;
      try {
        response = await fetch("/api/admin/v1/restore/preview", { method: "POST", credentials: "omit",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ resume_id: input.resumeId, source_event_id: input.sourceEventId }),
          signal: AbortSignal.timeout(15_000) });
      } catch { throw new RestorePreviewError("preview_unavailable"); }
      let payload: unknown;
      try { payload = await response.json() as unknown; }
      catch { throw new RestorePreviewError("invalid_response"); }
      if (!response.ok) throw new RestorePreviewError(restorePreviewErrorCode(payload) ?? "preview_unavailable");
      return mapRestorePreviewResponse(payload, input.sourceEventId);
    },
    getPendingRestoreAttempt(resumeId, sourceEventId) {
      if (!RESTORE_UUID.test(resumeId) || !RESTORE_UUID.test(sourceEventId)) throw new RestoreMutationError("invalid_response");
      return readRestorePending(restorePendingKey(resumeId, sourceEventId));
    },
    async restoreDomain(input, mode) {
      if (!input || !RESTORE_UUID.test(input.resumeId) || !RESTORE_UUID.test(input.sourceEventId)
        || !RESTORE_UUID.test(input.requestId) || !/^[0-9a-f]{64}$/.test(input.expectedCurrentDigest)) {
        throw new RestoreMutationError("invalid_response");
      }
      let sessionResult: Awaited<ReturnType<SupabaseClient["auth"]["getSession"]>>;
      try { sessionResult = await supabase.auth.getSession(); } catch { throw new RestoreMutationError("unauthenticated"); }
      const token = sessionResult.data.session?.access_token;
      if (sessionResult.error || typeof token !== "string" || !token) throw new RestoreMutationError("unauthenticated");

      const key = restorePendingKey(input.resumeId, input.sourceEventId);
      const exact = restoreRequestBody(input);
      const serialized = JSON.stringify({ resumeId: exact.resume_id, sourceEventId: exact.source_event_id,
        expectedCurrentDigest: exact.expected_current_digest, requestId: exact.request_id });
      const prior = readRestorePending(key);
      if (mode === "retry") {
        if (!prior || JSON.stringify(restoreRequestBody(prior)) !== JSON.stringify(exact)) throw new RestoreMutationError("pending_conflict");
      } else if (prior) {
        throw new RestoreMutationError("pending_conflict");
      }
      if (mode === "new") {
        try {
          const storage = globalThis.sessionStorage;
          if (!storage) throw new Error("Storage unavailable");
          storage.setItem(key, serialized);
          if (storage.getItem(key) !== serialized) throw new Error("Storage verification failed");
        } catch { throw new RestoreMutationError("storage_unavailable"); }
      }
      const clearExact = () => {
        try {
          const storage = globalThis.sessionStorage;
          if (storage?.getItem(key) === serialized) storage.removeItem(key);
        } catch { /* retain rather than risk deleting a newer attempt */ }
      };
      let response: Response;
      try {
        response = await fetch("/api/admin/v1/restore/apply", { method: "POST", credentials: "omit",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(exact), signal: AbortSignal.timeout(20_000) });
      } catch { throw new RestoreMutationError("outcome_unknown", true); }
      let payload: unknown;
      try { payload = await response.json() as unknown; }
      catch { throw new RestoreMutationError("outcome_unknown", true); }
      if (!response.ok) {
        const code = restoreMutationErrorCode(payload);
        if (!code || (response.status >= 500 && code !== "restore_signing_unavailable") || code === "outcome_unknown" || code === "idempotency_conflict" || code === "restore_request_pending") {
          throw new RestoreMutationError(code === "idempotency_conflict" ? code : code === "restore_request_pending" ? code : "outcome_unknown", true);
        }
        clearExact();
        throw new RestoreMutationError(code);
      }
      const result = validateRestoreMutationResult(payload, input.sourceEventId);
      if (!result) throw new RestoreMutationError("outcome_unknown", true);
      clearExact();
      return result;
    },
    async loadActivityLogAuthorizedTargets() {
      const { data, error } = await supabase.rpc("activity_log_authorized_targets");
      if (error) throw new Error("Unable to load Activity Log targets");
      return rows(data, "Activity Log target").map(row => {
        if (typeof row.resume_id !== "string" || (row.site_key !== "example-cv" && row.site_key !== "example-cv-qa")
          || (row.role !== "owner" && row.role !== "qa")) throw new Error("Invalid Activity Log target response");
        return { resumeId: row.resume_id, siteKey: row.site_key, role: row.role };
      });
    },
    async loadOverview(resumeId) {
      return mapOverviewRows(await readResumeRows(supabase, "resume_profile_translations", resumeId), resumeId);
    },
    async loadProfile(resumeId) {
      const [profile, translations] = await Promise.all([
        readResumeRows(supabase, "resume_profile", resumeId),
        readResumeRows(supabase, "resume_profile_translations", resumeId),
      ]);
      return mapProfileRows(profile, translations, resumeId);
    },
    async loadIntroduction(resumeId) {
      const [parents, translations] = await Promise.all([
        readResumeRows(supabase, "resume_intro_paragraphs", resumeId),
        readResumeRows(supabase, "resume_intro_paragraph_translations", resumeId),
      ]);
      return mapIntroductionRows(parents, translations, resumeId);
    },
    async loadEducation(resumeId) {
      const [parents, translations] = await Promise.all([
        readResumeRows(supabase, "resume_education_entries", resumeId),
        readResumeRows(supabase, "resume_education_translations", resumeId),
      ]);
      return mapEducationRows(parents, translations, resumeId);
    },
    async loadAdminEducationWriteState(resumeId) {
      if (!resumeId) throw new Error("Missing resume ID");
      const { data, error } = await supabase.rpc("load_admin_education_write_state", { target_resume_id: resumeId });
      if (error) throw new Error("Unable to load Education write state");
      const row = Array.isArray(data) && data.length === 1 ? data[0] as Record<string, unknown> : null;
      if (!row || row.resume_id !== resumeId || typeof row.activity_log_enabled !== "boolean"
        || (row.education_write_mode !== "direct" && row.education_write_mode !== "rpc")
        || typeof row.education_trusted_context_required !== "boolean"
        || (row.education_write_mode === "direct" && row.education_trusted_context_required)) throw new Error("Invalid Education write state");
      return { resumeId, activityLogEnabled: row.activity_log_enabled,
        educationWriteMode: row.education_write_mode, educationTrustedContextRequired: row.education_trusted_context_required };
    },
    async saveEducationWithWorker(resumeId, items) {
      if (!resumeId || !Array.isArray(items) || items.length > 16) throw new AggregateWorkerSaveError("Education content is invalid.");
      const payload = items.map((item, position) => {
        if (!item || !(item.id.startsWith("local-education-") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)))
          throw new AggregateWorkerSaveError("Education IDs are invalid.");
        const category = item.persistedCategory;
        if (category !== null && !isEducationCategory(category)) throw new AggregateWorkerSaveError("Education category is invalid.");
        const locale = (value: EducationItem["translations"]["zh"]) => ({
          title: value.title, program: value.program, period: value.period, grade: value.grade,
          course_title: value.courseTitle, course_description: value.courseDescription,
          custom_category_label: value.customCategoryLabel ?? null,
        });
        return { id: item.id.startsWith("local-") ? null : item.id.toLowerCase(), position,
          entry_type: item.entryType, education_category: category,
          zh: locale(item.translations.zh), en: locale(item.translations.en) };
      });
      return await saveSignedCollection("education", resumeId, payload, raw => {
        if (raw.length !== payload.length) throw new Error("length");
        const seen = new Set<string>();
        return raw.map((entry, position) => {
          if (!entry || typeof entry !== "object") throw new Error("entry");
          const row = entry as Record<string, unknown>;
          const zh = row.zh as Record<string, unknown> | undefined; const en = row.en as Record<string, unknown> | undefined;
          const validLocale = (locale: Record<string, unknown> | undefined) => Boolean(locale
            && Object.keys(locale).sort().join(",") === "course_description,course_title,custom_category_label,grade,period,program,title"
            && ["title", "program", "period", "grade"].every(key => typeof locale[key] === "string")
            && ["course_title", "course_description", "custom_category_label"].every(key => locale[key] === null || typeof locale[key] === "string"));
          const category = row.education_category;
          if (Object.keys(row).sort().join(",") !== "education_category,en,entry_type,id,position,zh"
            || typeof row.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id)
            || seen.has(row.id) || row.position !== position || (row.entry_type !== "standard" && row.entry_type !== "summerSchool")
            || !(category === null || isEducationCategory(category)) || !validLocale(zh) || !validLocale(en)) throw new Error("shape");
          const requested = payload[position] as Record<string, unknown>;
          const sameLocale = (expected: unknown, actual: Record<string, unknown> | undefined) => {
            if (!expected || typeof expected !== "object" || !actual) return false;
            const left = expected as Record<string, unknown>;
            return ["title", "program", "period", "grade", "course_title", "course_description", "custom_category_label"]
              .every(key => left[key] === actual[key]);
          };
          if ((requested.id && requested.id !== row.id) || requested.entry_type !== row.entry_type || requested.education_category !== category
            || !sameLocale(requested.zh, zh) || !sameLocale(requested.en, en)) throw new Error("mismatch");
          seen.add(row.id);
          const source = items.find(item => item.id.toLowerCase() === row.id);
          const parsedCategory = category as EducationCategory | null;
          return { id: row.id, position, sourceKey: source?.sourceKey ?? null,
            entryType: row.entry_type as EducationItem["entryType"], persistedCategory: parsedCategory,
            category: parsedCategory ?? (row.entry_type === "summerSchool" ? "summerSchool" : null),
            translations: { zh: { title: zh!.title as string, program: zh!.program as string, period: zh!.period as string, grade: zh!.grade as string,
              courseTitle: zh!.course_title as string | null, courseDescription: zh!.course_description as string | null, customCategoryLabel: zh!.custom_category_label as string | null },
            en: { title: en!.title as string, program: en!.program as string, period: en!.period as string, grade: en!.grade as string,
              courseTitle: en!.course_title as string | null, courseDescription: en!.course_description as string | null, customCategoryLabel: en!.custom_category_label as string | null } } } satisfies EducationItem;
        });
      }) as EducationItem[];
    },
    hasPendingEducationWorkerSave(resumeId) { try { return Boolean(globalThis.sessionStorage?.getItem(collectionPendingKey("education", resumeId))); } catch { return true; } },
    discardPendingEducationSave() { /* Ambiguous requests are retained for exact replay. */ },
    async loadAdminProjectsWriteState(resumeId) {
      if (!resumeId) throw new Error("Missing resume ID");
      const { data, error } = await supabase.rpc("load_admin_projects_write_state", { target_resume_id: resumeId });
      if (error) throw new Error("Unable to load Projects write state");
      const row = Array.isArray(data) && data.length === 1 ? data[0] as Record<string, unknown> : null;
      if (!row || row.resume_id !== resumeId || typeof row.activity_log_enabled !== "boolean"
        || (row.projects_write_mode !== "direct" && row.projects_write_mode !== "rpc")
        || typeof row.projects_trusted_context_required !== "boolean"
        || (row.projects_write_mode === "direct" && row.projects_trusted_context_required)) throw new Error("Invalid Projects write state");
      return { resumeId, domain: "projects" as const, activityLogEnabled: row.activity_log_enabled,
        writeMode: row.projects_write_mode, trustedContextRequired: row.projects_trusted_context_required };
    },
    async loadAdminContactWriteState(resumeId) {
      if (!resumeId) throw new Error("Missing resume ID");
      const { data, error } = await supabase.rpc("load_admin_contact_write_state", { target_resume_id: resumeId });
      if (error) throw new Error("Unable to load Contact write state");
      const row = Array.isArray(data) && data.length === 1 ? data[0] as Record<string, unknown> : null;
      if (!row || row.resume_id !== resumeId || typeof row.activity_log_enabled !== "boolean"
        || (row.contact_write_mode !== "direct" && row.contact_write_mode !== "rpc")
        || typeof row.contact_trusted_context_required !== "boolean"
        || (row.contact_write_mode === "direct" && row.contact_trusted_context_required)) throw new Error("Invalid Contact write state");
      return { resumeId, activityLogEnabled: row.activity_log_enabled, contactWriteMode: row.contact_write_mode, contactTrustedContextRequired: row.contact_trusted_context_required };
    },
    async saveContactWithWorker(resumeId, contact) {
      if (!resumeId || !contact || !contact.translations || !Array.isArray(contact.focus) || !Array.isArray(contact.status))
        throw new AggregateWorkerSaveError("Contact content is invalid.");
      const locale = (value: ContactSection["translations"]["zh"]) => ({ contact_label: value.contactLabel, availability: value.availability });
      const entryLocale = (value: { title: string; detail: string }) => ({ title: value.title, detail: value.detail });
      const payload = {
        translations: { zh: locale(contact.translations.zh), en: locale(contact.translations.en) },
        focus: contact.focus.map((item, position) => {
          if (!item || typeof item.id !== "string" || !(item.id.startsWith("local-") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)))
            throw new AggregateWorkerSaveError("Contact Focus IDs are invalid.");
          return { id: item.id.startsWith("local-") ? null : item.id.toLowerCase(), position,
            zh: entryLocale(item.translations.zh), en: entryLocale(item.translations.en) };
        }),
        status: contact.status.map((item, position) => {
          if (!item || typeof item.id !== "string" || !(item.id.startsWith("local-") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id))
            || !(item.statusType === "study" || item.statusType === "graduation" || item.statusType === "open"))
            throw new AggregateWorkerSaveError("Contact Status values are invalid.");
          return { id: item.id.startsWith("local-") ? null : item.id.toLowerCase(), position, status_type: item.statusType,
            zh: entryLocale(item.translations.zh), en: entryLocale(item.translations.en) };
        }),
      };
      return await saveSignedContact(resumeId, payload);
    },
    hasPendingContactWorkerSave(resumeId) { try { return Boolean(globalThis.sessionStorage?.getItem(contactPendingKey(resumeId))); } catch { return true; } },
    discardPendingContactSave() { /* Ambiguous requests are retained for exact replay. */ },
    async saveProjectsWithWorker(resumeId, items) {
      if (!resumeId || !Array.isArray(items) || items.length > 16) throw new AggregateWorkerSaveError("Projects content is invalid.");
      const payload = items.map((item, position) => {
        if (!item || !(item.id.startsWith("local-") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)))
          throw new AggregateWorkerSaveError("Project IDs are invalid.");
        const locale = (value: ProjectItem["translations"]["zh"]) => ({ title: value.title, subtitle: value.subtitle, period: value.period, description: value.description, href: value.href });
        const methods = (value: ProjectItem["methods"]["zh"]) => value.map((method, methodPosition) => {
          if (!method || !(method.id.startsWith("local-method-") || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(method.id)))
            throw new AggregateWorkerSaveError("Project method IDs are invalid.");
          return { id: method.id.startsWith("local-method-") ? null : method.id.toLowerCase(), position: methodPosition, value: method.value };
        });
        return { id: item.id.startsWith("local-") ? null : item.id.toLowerCase(), position,
          zh: locale(item.translations.zh), en: locale(item.translations.en), methods: { zh: methods(item.methods.zh), en: methods(item.methods.en) } };
      });
      return await saveSignedCollection("projects", resumeId, payload, raw => {
        if (raw.length !== payload.length) throw new Error("length");
        const seenProjects = new Set<string>(); const seenMethods = new Set<string>();
        let priorProjectPosition = -1;
        return raw.map((entry, position) => {
          if (!entry || typeof entry !== "object") throw new Error("entry");
          const row = entry as Record<string, unknown>; const zh = row.zh as Record<string, unknown> | undefined;
          const en = row.en as Record<string, unknown> | undefined; const methodLists = row.methods as Record<string, unknown> | undefined;
          const validLocale = (value: Record<string, unknown> | undefined): value is Record<string, unknown> => Boolean(value
            && Object.keys(value).sort().join(",") === "description,href,period,subtitle,title"
            && ["title", "subtitle", "period", "description", "href"].every(key => typeof value[key] === "string"));
          if (Object.keys(row).sort().join(",") !== "en,id,methods,position,zh" || typeof row.id !== "string"
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id)
            || seenProjects.has(row.id) || !Number.isInteger(row.position) || (row.position as number) < 0
            || (position > 0 && (row.position as number) <= priorProjectPosition) || !validLocale(zh) || !validLocale(en)
            || !methodLists || Object.keys(methodLists).sort().join(",") !== "en,zh") throw new Error("shape");
          priorProjectPosition = row.position as number;
          const requested = payload[position];
          if ((requested.id && requested.id !== row.id) || Object.keys(zh).some(key => zh[key] !== requested.zh[key as keyof typeof requested.zh])
            || Object.keys(en).some(key => en[key] !== requested.en[key as keyof typeof requested.en])) throw new Error("mismatch");
          const decodeMethods = (rawMethods: unknown, requestedMethods: typeof requested.methods["zh"]) => {
            if (!Array.isArray(rawMethods) || rawMethods.length !== requestedMethods.length) throw new Error("methods");
            let priorPosition = -1;
            return rawMethods.map((rawMethod, methodPosition) => {
              if (!rawMethod || typeof rawMethod !== "object") throw new Error("method");
              const method = rawMethod as Record<string, unknown>; const requestMethod = requestedMethods[methodPosition];
              if (Object.keys(method).sort().join(",") !== "id,position,value" || typeof method.id !== "string"
                || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(method.id)
                || seenMethods.has(method.id) || !Number.isInteger(method.position) || (method.position as number) < 0
                || (methodPosition > 0 && (method.position as number) <= priorPosition) || typeof method.value !== "string"
                || (requestMethod.id && requestMethod.id !== method.id) || requestMethod.value !== method.value) throw new Error("method shape");
              priorPosition = method.position as number;
              seenMethods.add(method.id); return { id: method.id, position: methodPosition, value: method.value };
            });
          };
          if (!Array.isArray(methodLists.zh) || !Array.isArray(methodLists.en)) throw new Error("method lists");
          const zhMethods = decodeMethods(methodLists.zh, requested.methods.zh); const enMethods = decodeMethods(methodLists.en, requested.methods.en);
          seenProjects.add(row.id); const source = items.find(item => item.id.toLowerCase() === row.id);
          return { id: row.id, position, sourceKey: source?.sourceKey ?? null,
            translations: { zh: zh as ProjectItem["translations"]["zh"], en: en as ProjectItem["translations"]["en"] },
            methods: { zh: zhMethods, en: enMethods } } satisfies ProjectItem;
        });
      }) as ProjectItem[];
    },
    hasPendingProjectsWorkerSave(resumeId) { try { return Boolean(globalThis.sessionStorage?.getItem(collectionPendingKey("projects", resumeId))); } catch { return true; } },
    discardPendingProjectsSave() { /* Ambiguous idempotent requests are retained for exact replay. */ },
    async loadExperience(resumeId) {
      const [parents, translations] = await Promise.all([
        readResumeRows(supabase, "resume_experience_entries", resumeId),
        readResumeRows(supabase, "resume_experience_translations", resumeId),
      ]);
      return mapExperienceRows(parents, translations, resumeId);
    },
    async loadProjects(resumeId) {
      const [parents, translations, methods] = await Promise.all([
        readResumeRows(supabase, "resume_project_entries", resumeId),
        readResumeRows(supabase, "resume_project_translations", resumeId),
        readResumeRows(supabase, "resume_project_methods", resumeId),
      ]);
      return mapProjectRows(parents, translations, methods, resumeId);
    },
    async loadSkills(resumeId) {
      const [parents, translations] = await Promise.all([
        readResumeRows(supabase, "resume_skill_groups", resumeId),
        readResumeRows(supabase, "resume_skill_group_translations", resumeId),
      ]);
      return mapSkillRows(parents, translations, resumeId);
    },
    async loadAwards(resumeId) {
      const [parents, translations] = await Promise.all([
        readResumeRows(supabase, "resume_award_entries", resumeId),
        readResumeRows(supabase, "resume_award_translations", resumeId),
      ]);
      return mapAwardRows(parents, translations, resumeId);
    },
    async loadContact(resumeId) {
      const [localeContent, focus, focusTranslations, status, statusTranslations] = await Promise.all([
        readResumeRows(supabase, "resume_locale_content", resumeId),
        readResumeRows(supabase, "resume_contact_focus_items", resumeId),
        readResumeRows(supabase, "resume_contact_focus_translations", resumeId),
        readResumeRows(supabase, "resume_contact_status_items", resumeId),
        readResumeRows(supabase, "resume_contact_status_translations", resumeId),
      ]);
      return mapContactRows(localeContent, focus, focusTranslations, status, statusTranslations, resumeId);
    },
    async loadLinks(resumeId) {
      const target = await readAdminTarget(supabase);
      if (target.resumeId !== resumeId) throw new Error("Links target does not match the authorized Admin resume");
      const [links, localeContent, navigation, navigationTranslations] = await Promise.all([
        readResumeRows(supabase, "resume_public_links", resumeId),
        readResumeRows(supabase, "resume_locale_content", resumeId),
        readResumeRows(supabase, "resume_navigation_items", resumeId),
        readResumeRows(supabase, "resume_navigation_item_translations", resumeId),
      ]);
      const mapped = mapLinksRows(links, localeContent, navigation, navigationTranslations, resumeId);
      const [zh, en] = await Promise.all(((["zh", "en"] as const).map(locale =>
        readResumePdfFilename(supabase, resumeId, target.siteKey, locale, mapped.translations[locale].portfolioHref))));
      return { ...mapped, resumePdfFilenames: { zh, en } };
    },
    async loadSiteText(resumeId) {
      const localeContent = await readResumeRows(supabase, "resume_locale_content", resumeId);
      return mapSiteTextRows(localeContent, resumeId);
    },
    async loadAdminProfileWriteState(resumeId) {
      if (!resumeId) throw new Error("Missing resume ID");
      const { data, error } = await supabase.rpc("load_admin_profile_write_state", { target_resume_id: resumeId });
      if (error) throw new Error("Unable to load Profile write state");
      const row = Array.isArray(data) && data.length === 1 ? data[0] as Record<string, unknown> : null;
      if (!row || row.resume_id !== resumeId || typeof row.activity_log_enabled !== "boolean"
        || (row.profile_write_mode !== "direct" && row.profile_write_mode !== "rpc")
        || typeof row.profile_trusted_context_required !== "boolean"
        || (row.profile_write_mode === "direct" && row.profile_trusted_context_required)) throw new Error("Invalid Profile write state");
      return { resumeId, activityLogEnabled: row.activity_log_enabled,
        profileWriteMode: row.profile_write_mode, profileTrustedContextRequired: row.profile_trusted_context_required };
    },
    async saveProfileWithWorker(resumeId, profile, baselinePhotoUrl) {
      if (!resumeId || (baselinePhotoUrl !== null && typeof baselinePhotoUrl !== "string"))
        throw new AggregateWorkerSaveError("Profile content is invalid.");
      return await saveSignedProfile(resumeId, profileAggregateFromSection(profile), baselinePhotoUrl);
    },
    hasPendingProfileWorkerSave(resumeId) {
      try { return Boolean(globalThis.sessionStorage?.getItem(profilePendingKey(resumeId))); } catch { return true; }
    },
    discardPendingProfileSave() { /* Ambiguous requests are retained for exact replay. */ },
    async loadAdminWebsiteLinksWriteState(resumeId, operation) {
      if (!resumeId) throw new Error("Missing resume ID");
      const statePromise = supabase.rpc("load_admin_website_links_write_state", { target_resume_id: resumeId });
      const { data, error } = operation
        ? await awaitFilesPreflight(statePromise, operation, "Website & Links state check", FILE_PREFLIGHT_TIMEOUT_MS)
        : await statePromise;
      if (error) throw new Error("Unable to load Website & Links write state");
      const row = Array.isArray(data) && data.length === 1 ? data[0] as Record<string, unknown> : null;
      if (!row || row.resume_id !== resumeId || typeof row.activity_log_enabled !== "boolean"
        || (row.website_links_write_mode !== "direct" && row.website_links_write_mode !== "rpc")
        || typeof row.website_links_trusted_context_required !== "boolean"
        || (row.website_links_write_mode === "direct" && row.website_links_trusted_context_required)) throw new Error("Invalid Website & Links write state");
      return { resumeId, domain: "website_links" as const, activityLogEnabled: row.activity_log_enabled,
        writeMode: row.website_links_write_mode, trustedContextRequired: row.website_links_trusted_context_required };
    },
    async saveWebsiteLinksWithWorker(resumeId, links, operation) {
      if (!resumeId || !links || !Array.isArray(links.navigation)) throw new AggregateWorkerSaveError("Website & Links content is invalid.");
      const payload: WebsiteLinksAggregate = validateWebsiteLinksAggregate({
        shared: { email: links.shared.email, github: links.shared.github, github_label: links.shared.githubLabel,
          linkedin_display_name: links.shared.linkedInDisplayName, email_label: links.shared.emailLabel, linkedin_label: links.shared.linkedInLabel },
        translations: Object.fromEntries(( ["zh", "en"] as const).map(locale => [locale, {
          linkedin_label: links.translations[locale].linkedInLabel, linkedin_href: links.translations[locale].linkedInHref,
          portfolio_label: links.translations[locale].portfolioLabel, updated_at_label: links.translations[locale].updatedAtLabel,
        }])) as WebsiteLinksAggregate["translations"],
        navigation: links.navigation.map(item => ({ navigation_item_id: item.id, position: item.position,
          zh: { label: item.translations.zh.label }, en: { label: item.translations.en.label } })),
      });
      await saveSignedD7("website_links", resumeId, payload, {}, operation);
      return links;
    },
    hasPendingWebsiteLinksWorkerSave(resumeId) { try { return Boolean(globalThis.sessionStorage?.getItem(`admin-website_links-rpc-pending-v1:${resumeId}`)); } catch { return true; } },
    async loadAdminFilesWriteState(resumeId, operation) {
      if (!resumeId) throw new Error("Missing resume ID");
      const statePromise = supabase.rpc("load_admin_files_storage_state_v1", { target_resume_id: resumeId });
      const { data, error } = operation
        ? await awaitFilesPreflight(statePromise, operation, "write-state check", FILE_PREFLIGHT_TIMEOUT_MS)
        : await statePromise;
      if (error) throw new Error("Unable to load Files write state");
      const row = Array.isArray(data) && data.length === 1 ? data[0] as Record<string, unknown> : null;
      if (!row || row.resume_id !== resumeId || typeof row.activity_log_enabled !== "boolean"
        || (row.files_write_mode !== "direct" && row.files_write_mode !== "rpc")
        || typeof row.files_trusted_context_required !== "boolean"
        || (row.files_write_mode === "direct" && row.files_trusted_context_required)
        || (row.storage_protocol !== "legacy" && row.storage_protocol !== "intent_v1")) throw new Error("Invalid Files write state");
      if (row.storage_protocol === "intent_v1"
        && (row.files_write_mode !== "rpc" || !row.activity_log_enabled || !row.files_trusted_context_required))
        throw new Error("Invalid Files storage protocol state");
      return { resumeId, domain: "files" as const, activityLogEnabled: row.activity_log_enabled,
        writeMode: row.files_write_mode, trustedContextRequired: row.files_trusted_context_required,
        storageProtocol: row.storage_protocol };
    },
    async uploadResumePdfWithWorker(resumeId, locale, file, suppliedOperation) {
      if (!resumeId || (locale !== "zh" && locale !== "en") || !(file instanceof File)) throw new AggregateWorkerSaveError("Invalid resume PDF upload.");
      if (file.type !== "application/pdf" || file.size < 1 || file.size > 10 * 1024 * 1024) throw new AggregateWorkerSaveError("Resume PDF must be a non-empty PDF no larger than 10 MiB.");
      const operation = suppliedOperation ?? createFilesSaveOperation();
      assertFilesSaveOperation(operation);
      let fileBuffer: ArrayBuffer;
      try { fileBuffer = await awaitFilesPreflight(file.arrayBuffer(), operation, "file read", FILE_PREFLIGHT_TIMEOUT_MS); }
      catch (error) { if (error instanceof AggregateWorkerSaveError) throw error; throw new AggregateWorkerSaveError("The Files file read failed before a request was sent. Keep the selected file and retry."); }
      assertFilesSaveOperation(operation);
      const bytes = new Uint8Array(fileBuffer);
      let digestBytes: ArrayBuffer;
      try { digestBytes = await awaitFilesPreflight(crypto.subtle.digest("SHA-256", bytes), operation, "file verification", FILE_PREFLIGHT_TIMEOUT_MS); }
      catch (error) { if (error instanceof AggregateWorkerSaveError) throw error; throw new AggregateWorkerSaveError("The Files file verification failed before a request was sent. Keep the selected file and retry."); }
      assertFilesSaveOperation(operation);
      const digest = [...new Uint8Array(digestBytes)].map(byte => byte.toString(16).padStart(2,"0")).join("");
      const key = `admin-files-upload-pending-v1:${resumeId}:${locale}`;
      let requestId: string;
      try {
        const raw = globalThis.sessionStorage?.getItem(key);
        if (raw) {
          const pending = JSON.parse(raw) as Record<string, unknown>;
          if (Object.keys(pending).sort().join(",") !== "digest,fileLastModified,fileName,fileSize,locale,requestId,resumeId"
            || pending.resumeId !== resumeId || pending.locale !== locale || pending.digest !== digest || pending.fileName !== file.name
            || pending.fileSize !== file.size || pending.fileLastModified !== file.lastModified || typeof pending.requestId !== "string"
            || !/^[0-9a-f-]{36}$/i.test(pending.requestId)) throw new Error("pending file differs");
          requestId = pending.requestId;
        } else {
          if (!globalThis.crypto?.randomUUID || !globalThis.sessionStorage) throw new Error("secure storage unavailable");
          requestId = globalThis.crypto.randomUUID().toLowerCase();
          globalThis.sessionStorage.setItem(key, JSON.stringify({ resumeId, locale, requestId, digest, fileName:file.name, fileSize:file.size, fileLastModified:file.lastModified }));
        }
      } catch { throw new AggregateWorkerSaveError("A pending PDF upload must be retried with the exact same file; keep the selection unchanged.", true); }
      assertFilesSaveOperation(operation);
      let session: Awaited<ReturnType<typeof supabase.auth.getSession>>;
      try {
        const sessionPromise = supabase.auth.getSession();
        session = await awaitFilesPreflight(sessionPromise, operation, "session check", FILE_AUTH_TIMEOUT_MS);
      }
      catch (error) { if (error instanceof AggregateWorkerSaveError) throw error; throw new AggregateWorkerSaveError("The Files session check failed before a request was sent. Keep the selected file and retry."); }
      const { data, error } = session; const token = data.session?.access_token;
      if (error || typeof token !== "string" || !token) throw new AggregateWorkerSaveError("Your session could not be verified; keep the selected PDF unchanged.");
      let uploadHeaders: Headers;
      try {
        const encodedFilename = encodeURIComponent(file.name);
        if (encodedFilename.length > FILE_UPLOAD_FILENAME_HEADER_MAX_LENGTH) throw new Error("filename too long");
        uploadHeaders = new Headers({ Authorization:`Bearer ${token}`, "Content-Type":"application/pdf", "X-Upload-Request-ID":requestId,
          [FILE_UPLOAD_FILENAME_HEADER]:encodedFilename });
      } catch {
        throw new AggregateWorkerSaveError("PDF upload request could not be constructed; no request was sent. Keep the selected file and retry.");
      }
      const { response, responseValue, errorCode } = await awaitFilesRequest(async signal => {
        const issued = await fetch(`/api/admin/v1/files/upload?locale=${locale}`, { method:"POST", credentials:"omit",
          headers:uploadHeaders, body:bytes, signal });
        let decoded: unknown; let code: unknown;
        if (issued.ok) {
          try { decoded = await issued.json(); }
          catch { throw new AggregateWorkerSaveError("PDF upload result is uncertain. Retry with the same selected file.", true); }
        } else {
          try { const body=await issued.clone().json() as Record<string,unknown>; code=(body.error as Record<string,unknown>|undefined)?.code; }
          catch { /* the response status still determines the safe failure class */ }
        }
        return { response: issued, responseValue: decoded, errorCode: code };
      }, operation, "PDF upload", FILE_UPLOAD_TIMEOUT_MS);
      if (!response.ok) {
        if (errorCode === "upload_candidate_cleaned") {
          try { const raw=globalThis.sessionStorage?.getItem(key); if(raw && (JSON.parse(raw) as Record<string,unknown>).requestId===requestId) globalThis.sessionStorage?.removeItem(key); } catch { /* keep unverifiable request identity */ }
        }
        throw new AggregateWorkerSaveError(response.status>=500 ? "PDF upload result is uncertain. Retry with the same selected file."
          : "The selected PDF could not be uploaded; keep the selection and request unchanged.", response.status>=500);
      }
      if (!responseValue || typeof responseValue!=="object" || Array.isArray(responseValue)) throw new AggregateWorkerSaveError("PDF upload response could not be confirmed.",true);
      const value=responseValue as Record<string,unknown>;
      if (typeof value.reference!=="string" || value.upload_request_id!==requestId
        || !managedResumePdfObjectPath(supabaseUrl,resumeId,locale,value.reference)) throw new AggregateWorkerSaveError("PDF upload response could not be confirmed.",true);
      return { reference:value.reference, uploadRequestId:requestId };
    },
    clearPendingResumePdfUpload(resumeId,locale,requestId) {
      const key=`admin-files-upload-pending-v1:${resumeId}:${locale}`;
      try { const raw=globalThis.sessionStorage?.getItem(key); if(raw && (JSON.parse(raw) as Record<string,unknown>).requestId===requestId) globalThis.sessionStorage.removeItem(key); }
      catch { /* keep unverifiable pending identity */ }
    },
    async cleanupResumePdfCandidatesWithWorker(resumeId,uploadRequestIds,suppliedOperation) {
      if (!resumeId || uploadRequestIds.length>2 || uploadRequestIds.some(id=>!/^[0-9a-f-]{36}$/i.test(id))) return true;
      const operation = suppliedOperation ?? createFilesSaveOperation();
      if (!operation.isActive() || operation.signal.aborted) return true;
      let session: Awaited<ReturnType<typeof supabase.auth.getSession>>;
      try {
        const sessionPromise = supabase.auth.getSession();
        session = await awaitFilesPreflight(sessionPromise, operation, "cleanup session check", FILE_AUTH_TIMEOUT_MS);
      } catch { return true; }
      if (!operation.isActive() || operation.signal.aborted) return true;
      const {data,error}=session; const token=data.session?.access_token;
      if(error || typeof token!=="string" || !token) return true;
      try {
        assertFilesSaveOperation(operation);
        const result = await awaitFilesRequest(async signal => {
          const response=await fetch("/api/admin/v1/files/cleanup",{method:"POST",credentials:"omit",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
            body:JSON.stringify({upload_request_ids:uploadRequestIds}),signal});
          if(!response.ok) return { ok: false as const };
          try { return { ok: true as const, body: await response.json() as Record<string,unknown> }; }
          catch { throw new AggregateWorkerSaveError("Candidate cleanup result is uncertain; preserve the exact upload request identity for reconciliation.", true); }
        }, operation, "candidate cleanup", FILE_CLEANUP_TIMEOUT_MS);
        return !result.ok || result.body.cleanup_warning!==false;
      } catch { return true; }
    },
    async saveFilesWithWorker(resumeId, files, uploadRequestIds = {}, operation) {
      if (!resumeId) throw new AggregateWorkerSaveError("Missing resume ID");
      const result=await saveSignedD7("files", resumeId, validateFilesAggregate(files),uploadRequestIds,operation);
      return { files:result.result as FilesAggregate, cleanupWarning:result.cleanupWarning };
    },
    async restoreFilesFromEvent(resumeId, sourceEventId, locale) {
      if (!resumeId || !/^[0-9a-f-]{36}$/i.test(sourceEventId) || (locale !== "zh" && locale !== "en"))
        throw new AggregateWorkerSaveError("Invalid Files restore request.");
      const key = `admin-files-restore-pending-v1:${resumeId}:${sourceEventId}:${locale}`;
      let pending: { requestId: string; resumeId: string; sourceEventId: string; locale: Locale } | null = null;
      try {
        const raw = globalThis.sessionStorage?.getItem(key);
        if (raw) {
          const value = JSON.parse(raw) as Record<string, unknown>;
          if (Object.keys(value).sort().join(",") !== "locale,requestId,resumeId,sourceEventId" || value.resumeId !== resumeId
            || value.sourceEventId !== sourceEventId || value.locale !== locale || typeof value.requestId !== "string"
            || !/^[0-9a-f-]{36}$/i.test(value.requestId)) throw new Error("pending mismatch");
          pending = { requestId: value.requestId, resumeId, sourceEventId, locale };
        }
      } catch { throw new AggregateWorkerSaveError("A pending Files restore cannot be verified safely; keep the current state unchanged."); }
      if (!pending) {
        if (!globalThis.crypto?.randomUUID || !globalThis.sessionStorage) throw new AggregateWorkerSaveError("Secure Files restoration is unavailable.");
        pending = { requestId: globalThis.crypto.randomUUID(), resumeId, sourceEventId, locale };
        try { globalThis.sessionStorage.setItem(key, JSON.stringify(pending)); }
        catch { throw new AggregateWorkerSaveError("The exact pending Files restore could not be stored safely."); }
      }
      const { data, error } = await supabase.auth.getSession(); const token = data.session?.access_token;
      if (error || typeof token !== "string" || !token) throw new AggregateWorkerSaveError("Your session could not be verified.");
      let response: Response;
      try { response = await fetch("/api/admin/v1/files/restore", { method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ request_id: pending.requestId, resume_id: resumeId, source_event_id: sourceEventId, locale }), signal: AbortSignal.timeout(30_000) }); }
      catch { throw new AggregateWorkerSaveError("The Files restore result is uncertain. Retry the exact request.", true); }
      if (!response.ok) {
        if (response.status >= 500) throw new AggregateWorkerSaveError("The Files restore result is uncertain. Retry the exact request.", true);
        try { globalThis.sessionStorage.removeItem(key); } catch { /* safe to retain */ }
        throw new AggregateWorkerSaveError("The previous Files reference could not be restored.");
      }
      let result: unknown;
      try { result = await response.json(); } catch { throw new AggregateWorkerSaveError("The Files restore result is uncertain. Retry the exact request.", true); }
      let files: FilesAggregate; let cleanupWarning: boolean;
      try {
        if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("result shape");
        const body = result as Record<string, unknown>;
        files = validateFilesAggregate(body.files);
        if (typeof body.cleanup_warning !== "boolean") throw new Error("cleanup status");
        cleanupWarning = body.cleanup_warning;
        try { globalThis.sessionStorage.removeItem(key); } catch { /* replay is safe */ }
      } catch { throw new AggregateWorkerSaveError("The Files restore result could not be confirmed. Retry the exact request.", true); }
      return { files, cleanupWarning };
    },
    hasPendingFilesWorkerSave(resumeId) { try { return Boolean(globalThis.sessionStorage?.getItem(`admin-files-rpc-pending-v1:${resumeId}`)); } catch { return true; } },
    async retryPendingFilesWithWorker(resumeId, operation) {
      let value: unknown;
      let pending: Record<string, unknown>;
      try {
        const raw = globalThis.sessionStorage?.getItem(`admin-files-rpc-pending-v1:${resumeId}`);
        if (!raw || new TextEncoder().encode(raw).byteLength > 72 * 1024) throw new Error("missing");
        const stored = JSON.parse(raw) as Record<string, unknown>;
        const keys=Object.keys(stored).sort().join(",");
        if ((keys!=="canonical,requestId,resumeId" && keys!=="canonical,requestId,resumeId,uploadRequestIds") || stored.resumeId !== resumeId
          || typeof stored.canonical !== "string" || typeof stored.requestId!=="string" || !/^[0-9a-f-]{36}$/i.test(stored.requestId)) throw new Error("shape");
        value = JSON.parse(stored.canonical);
        if (canonicalizeFiles(value) !== stored.canonical) throw new Error("canonical");
        if (stored.uploadRequestIds !== undefined && (!stored.uploadRequestIds || typeof stored.uploadRequestIds !== "object" || Array.isArray(stored.uploadRequestIds)
          || Object.entries(stored.uploadRequestIds as Record<string,unknown>).some(([locale,id])=>!(["zh","en"].includes(locale)&&typeof id==="string"&&/^[0-9a-f-]{36}$/i.test(id as string))))) throw new Error("upload identity");
        pending=stored;
      } catch { throw new AggregateWorkerSaveError("A pending Files request cannot be restored safely. Keep the current draft unchanged."); }
      const uploadIds = (pending.uploadRequestIds && typeof pending.uploadRequestIds === "object" ? pending.uploadRequestIds : {}) as Partial<Record<Locale,string>>;
      const result=await saveSignedD7("files", resumeId, validateFilesAggregate(value), uploadIds, operation);
      return { files:result.result as FilesAggregate, cleanupWarning:result.cleanupWarning };
    },
    async updateProfileSharedDetails(resumeId, shared) {
      if (typeof resumeId !== "string" || !resumeId) throw new Error("Missing resume ID");
      if (!shared || typeof shared.graduationValue !== "string" || typeof shared.avatarInitials !== "string"
        || (shared.photoUrl !== null && (typeof shared.photoUrl !== "string" || !/^https?:\/\//i.test(shared.photoUrl)))
        || typeof shared.footerName !== "string" || typeof shared.copyright !== "string") {
        throw new Error("Invalid shared profile details");
      }
      const payload = {
        graduation_value: shared.graduationValue,
        avatar_initials: shared.avatarInitials,
        photo_url: shared.photoUrl,
        footer_name: shared.footerName,
        copyright: shared.copyright,
      };
      const { data, error } = await supabase.from("resume_profile")
        .update(payload).eq("resume_id", resumeId)
        .select("resume_id,graduation_value,avatar_initials,photo_url,footer_name,copyright,updated_at").single();
      if (error || !data || data.resume_id !== resumeId) throw new Error("Profile save was not confirmed");
      if (typeof data.graduation_value !== "string" || typeof data.avatar_initials !== "string"
        || (data.photo_url !== null && (typeof data.photo_url !== "string" || !/^https?:\/\//i.test(data.photo_url)))
        || typeof data.footer_name !== "string" || typeof data.copyright !== "string") {
        throw new Error("Invalid profile save response");
      }
      return {
        resumeId,
        shared: {
          graduationValue: data.graduation_value,
          avatarInitials: data.avatar_initials,
          photoUrl: data.photo_url,
          footerName: data.footer_name,
          copyright: data.copyright,
        },
        updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
      };
    },
    async updateProfileTranslation(resumeId, locale, translation) {
      if (typeof resumeId !== "string" || !resumeId) throw new Error("Missing resume ID");
      if (locale !== "zh" && locale !== "en") throw new Error("Invalid profile locale");
      if (!translation || typeof translation.name !== "string" || typeof translation.navAboutLabel !== "string"
        || typeof translation.emailActionLabel !== "string" || typeof translation.graduationLabel !== "string"
        || typeof translation.avatarLabel !== "string" || typeof translation.contactFocusHeading !== "string"
        || typeof translation.contactStatusHeading !== "string") {
        throw new Error("Invalid profile translation");
      }
      const payload = {
        name: translation.name,
        nav_about_label: translation.navAboutLabel,
        email_action_label: translation.emailActionLabel,
        graduation_label: translation.graduationLabel,
        avatar_label: translation.avatarLabel,
        contact_focus_heading: translation.contactFocusHeading,
        contact_status_heading: translation.contactStatusHeading,
      };
      const { data, error } = await supabase.from("resume_profile_translations")
        .update(payload).eq("resume_id", resumeId).eq("locale", locale)
        .select("resume_id,locale,name,nav_about_label,email_action_label,graduation_label,avatar_label,contact_focus_heading,contact_status_heading,updated_at").single();
      if (error || !data || data.resume_id !== resumeId || data.locale !== locale) {
        throw new Error("Profile translation save was not confirmed");
      }
      if (typeof data.name !== "string" || typeof data.nav_about_label !== "string"
        || typeof data.email_action_label !== "string" || typeof data.graduation_label !== "string"
        || typeof data.avatar_label !== "string" || typeof data.contact_focus_heading !== "string"
        || typeof data.contact_status_heading !== "string") {
        throw new Error("Invalid profile translation response");
      }
      return {
        resumeId,
        locale,
        translation: {
          name: data.name,
          navAboutLabel: data.nav_about_label,
          emailActionLabel: data.email_action_label,
          graduationLabel: data.graduation_label,
          avatarLabel: data.avatar_label,
          contactFocusHeading: data.contact_focus_heading,
          contactStatusHeading: data.contact_status_heading,
        },
        updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
      };
    },
    async updateEducationEntry(resumeId, entryId, changes) {
      if (!resumeId || !entryId || !changes || Object.keys(changes).length === 0
        || (changes.position !== undefined && (!Number.isInteger(changes.position) || changes.position < 0))
        || (changes.entryType !== undefined && changes.entryType !== "standard" && changes.entryType !== "summerSchool")
        || (changes.category !== undefined && changes.category !== null && !isEducationCategory(changes.category))
        || (changes.category === "summerSchool" && changes.entryType !== "summerSchool")
        || (changes.category !== null && changes.category !== undefined && changes.category !== "summerSchool" && changes.entryType !== "standard")) {
        throw new Error("Invalid Education entry update");
      }
      const payload: Record<string, unknown> = {};
      if (changes.position !== undefined) payload.position = changes.position;
      if (changes.entryType !== undefined) payload.entry_type = changes.entryType;
      if (changes.category !== undefined) payload.education_category = changes.category;
      const { data, error } = await supabase.from("resume_education_entries").update(payload)
        .eq("resume_id", resumeId).eq("id", entryId)
        .select("*").single();
      if (error || !data || data.id !== entryId || data.resume_id !== resumeId) throw new Error("Education entry save was not confirmed");
      if (!Number.isInteger(data.position) || (data.entry_type !== "standard" && data.entry_type !== "summerSchool")
        || (data.source_key !== null && typeof data.source_key !== "string")) throw new Error("Invalid Education entry save response");
      return { resumeId, entryId, position: data.position as number, entryType: data.entry_type, category: parsedEducationCategory(data), sourceKey: data.source_key };
    },
    async updateEducationTranslation(resumeId, entryId, locale, translation) {
      if (!resumeId || !entryId || (locale !== "zh" && locale !== "en")) throw new Error("Invalid Education translation identity");
      validateEducationTranslation(translation);
      const payload: Record<string, unknown> = {
        title: translation.title, program: translation.program, period: translation.period, grade: translation.grade,
        course_title: translation.courseTitle, course_description: translation.courseDescription,
      };
      if (typeof translation.customCategoryLabel === "string") payload.custom_category_label = translation.customCategoryLabel;
      return persistEducationTranslation(supabase, "update", resumeId, entryId, locale, payload);
    },
    async insertEducationEntry(resumeId, position, entryType, category) {
      if (!resumeId || !Number.isInteger(position) || position < 0 || (entryType !== "standard" && entryType !== "summerSchool")
        || (category !== undefined && category !== null && !isEducationCategory(category))
        || (category === "summerSchool" && entryType !== "summerSchool")
        || (category !== null && category !== undefined && category !== "summerSchool" && entryType !== "standard")) {
        throw new Error("Invalid new Education entry");
      }
      const payload: Record<string, unknown> = { resume_id: resumeId, position, entry_type: entryType, source_key: null };
      if (category !== null && category !== undefined) payload.education_category = category;
      const { data, error } = await supabase.from("resume_education_entries")
        .insert(payload)
        .select("*").single();
      if (error || !data || typeof data.id !== "string" || !data.id || data.resume_id !== resumeId) throw new Error("Education parent creation was not confirmed; verify production before retrying");
      if (!Number.isInteger(data.position) || (data.entry_type !== "standard" && data.entry_type !== "summerSchool")
        || (data.source_key !== null && typeof data.source_key !== "string")) throw new Error("Invalid Education parent creation response");
      return { resumeId, entryId: data.id, position: data.position as number, entryType: data.entry_type, category: parsedEducationCategory(data), sourceKey: data.source_key };
    },
    async insertEducationTranslation(resumeId, entryId, locale, translation) {
      if (!resumeId || !entryId || (locale !== "zh" && locale !== "en")) throw new Error("Invalid Education translation identity");
      validateEducationTranslation(translation);
      const payload: Record<string, unknown> = {
        resume_id: resumeId, education_entry_id: entryId, locale, title: translation.title,
        program: translation.program, period: translation.period, grade: translation.grade,
        course_title: translation.courseTitle, course_description: translation.courseDescription,
      };
      if (typeof translation.customCategoryLabel === "string" && translation.customCategoryLabel !== "") {
        payload.custom_category_label = translation.customCategoryLabel;
      }
      return persistEducationTranslation(supabase, "insert", resumeId, entryId, locale, payload);
    },
    async readEducationTranslation(resumeId, entryId, locale) {
      const { data, error } = await supabase.from("resume_education_translations").select("*")
        .eq("resume_id", resumeId).eq("education_entry_id", entryId).eq("locale", locale).maybeSingle();
      if (error) throw new Error("Unable to verify Education translation state");
      if (!data) return null;
      return parseEducationTranslation(data, resumeId, entryId, locale);
    },
    async deleteEducationEntry(resumeId, entryId) {
      if (!resumeId || !entryId) throw new Error("Invalid Education delete identity");
      const { data, error } = await supabase.from("resume_education_entries").delete()
        .eq("resume_id", resumeId).eq("id", entryId).select("id,resume_id").single();
      if (error || !data || data.id !== entryId || data.resume_id !== resumeId) throw new Error("Education delete was not confirmed");
    },
  };
}

type EditableTableSpec = { parent: string; translations: string; foreignKey: string; sourceKey: boolean };
const editableTables: Record<EditableRepeatableSection, EditableTableSpec> = {
  introduction: { parent: "resume_intro_paragraphs", translations: "resume_intro_paragraph_translations", foreignKey: "paragraph_id", sourceKey: false },
  experience: { parent: "resume_experience_entries", translations: "resume_experience_translations", foreignKey: "experience_entry_id", sourceKey: true },
  skills: { parent: "resume_skill_groups", translations: "resume_skill_group_translations", foreignKey: "skill_group_id", sourceKey: true },
  awards: { parent: "resume_award_entries", translations: "resume_award_translations", foreignKey: "award_entry_id", sourceKey: true },
  projects: { parent: "resume_project_entries", translations: "resume_project_translations", foreignKey: "project_entry_id", sourceKey: true },
};

function editablePayload<K extends EditableRepeatableSection>(section: K, value: EditableTranslation<K>): Record<string, unknown> {
  switch (section) {
    case "introduction": return { text: (value as IntroItem["translations"][Locale]).text };
    case "experience": {
      const translation = value as ExperienceItem["translations"][Locale];
      return { organization: translation.organization, title: translation.title, period: translation.period,
        description: translation.description, location: translation.location };
    }
    case "skills": {
      const translation = value as SkillItem["translations"][Locale]; return { title: translation.title, items: translation.items };
    }
    case "awards": {
      const translation = value as AwardItem["translations"][Locale]; return { name: translation.name, year: translation.year };
    }
    case "projects": { const translation = value as ProjectItem["translations"][Locale]; return { title: translation.title, subtitle: translation.subtitle, period: translation.period, description: translation.description, href: translation.href }; }
  }
}

function parseEditableTranslation<K extends EditableRepeatableSection>(section: K, row: Record<string, unknown>, resumeId: string,
  entryId: string, locale: Locale): EditableTranslationRow<K> {
  const spec = editableTables[section];
  if (row.resume_id !== resumeId || row[spec.foreignKey] !== entryId || row.locale !== locale) throw new Error("Invalid editable translation identity");
  let translation: Record<string, unknown>;
  switch (section) {
    case "introduction":
      translation = { text: row.text };
      break;
    case "experience":
      translation = { organization: row.organization, title: row.title, period: row.period, description: row.description, location: row.location };
      if (translation.location !== null && typeof translation.location !== "string") throw new Error("Invalid Experience location response");
      break;
    case "skills": translation = { title: row.title, items: row.items }; break;
    case "awards": translation = { name: row.name, year: row.year }; break;
    case "projects": translation = { title: row.title, subtitle: row.subtitle, period: row.period, description: row.description, href: row.href }; break;
  }
  if (Object.entries(translation).some(([key, value]) => key !== "location" && typeof value !== "string")) throw new Error("Invalid editable translation response");
  return { resumeId, entryId, locale, translation: translation as EditableTranslation<K> };
}

async function persistEditableTranslation<K extends EditableRepeatableSection>(supabase: SupabaseClient, section: K,
  resumeId: string, entryId: string, locale: Locale, translation: EditableTranslation<K>, operation: "insert" | "update"): Promise<EditableTranslationRow<K>> {
  const spec = editableTables[section];
  const content = editablePayload(section, translation);
  let resolvedOperation = operation;
  if (operation === "update") {
    const { data: existing, error: readError } = await supabase.from(spec.translations).select("*").eq("resume_id", resumeId)
      .eq(spec.foreignKey, entryId).eq("locale", locale).maybeSingle();
    if (readError) throw new Error(`Unable to verify ${section} ${locale} translation state`);
    // Missing locale rows map to empty strings in the editor. Create only that absent locale; never copy the other locale.
    if (!existing) resolvedOperation = "insert";
  }
  const mutation = supabase.from(spec.translations);
  const payload = { resume_id: resumeId, [spec.foreignKey]: entryId, locale, ...content };
  const query = resolvedOperation === "insert"
    ? mutation.insert(payload).select("*").single()
    : mutation.update(content).eq("resume_id", resumeId).eq(spec.foreignKey, entryId).eq("locale", locale).select("*").single();
  const { data, error } = await query;
  if (error || !data) throw new Error(`${section} ${locale} translation ${resolvedOperation === "insert" ? "creation" : "save"} was not confirmed`);
  return parseEditableTranslation(section, data, resumeId, entryId, locale);
}

function createEditableSectionWrites(supabase: SupabaseClient): Pick<ResumeRepository,
  "updateEditableEntryPosition" | "insertEditableEntry" | "updateEditableTranslation" | "insertEditableTranslation"
  | "readEditableTranslation" | "deleteEditableTranslation" | "deleteEditableEntry"> {
  return {
    async updateEditableEntryPosition(section, resumeId, entryId, position) {
      if (!resumeId || !entryId || !Number.isInteger(position) || position < 0) throw new Error("Invalid editable entry position");
      const spec = editableTables[section];
      const { data, error } = await supabase.from(spec.parent).update({ position }).eq("resume_id", resumeId).eq("id", entryId).select("*").single();
      if (error || !data || data.id !== entryId || data.resume_id !== resumeId || data.position !== position) throw new Error("Entry reorder was not confirmed");
      if (spec.sourceKey && data.source_key !== null && typeof data.source_key !== "string") throw new Error("Invalid entry source key response");
      return { resumeId, entryId, position, sourceKey: typeof data.source_key === "string" ? data.source_key : null };
    },
    async insertEditableEntry(section, resumeId, position) {
      if (!resumeId || !Number.isInteger(position) || position < 0) throw new Error("Invalid new editable entry");
      const spec = editableTables[section];
      const payload: Record<string, unknown> = { resume_id: resumeId, position };
      if (spec.sourceKey) payload.source_key = null;
      const { data, error } = await supabase.from(spec.parent).insert(payload).select("*").single();
      if (error || !data || typeof data.id !== "string" || !data.id || data.resume_id !== resumeId || (!Number.isInteger(data.position) || (data.position as number) < 0)) {
        throw new Error("Parent creation was not confirmed; verify production before retrying");
      }
      if (spec.sourceKey && data.source_key !== null && typeof data.source_key !== "string") throw new Error("Invalid new entry source key response");
      return { resumeId, entryId: data.id, position: data.position as number, sourceKey: typeof data.source_key === "string" ? data.source_key : null };
    },
    async updateEditableTranslation(section, resumeId, entryId, locale, translation) {
      if (!resumeId || !entryId || (locale !== "zh" && locale !== "en")) throw new Error("Invalid editable translation identity");
      return persistEditableTranslation(supabase, section, resumeId, entryId, locale, translation, "update");
    },
    async insertEditableTranslation(section, resumeId, entryId, locale, translation) {
      if (!resumeId || !entryId || (locale !== "zh" && locale !== "en")) throw new Error("Invalid editable translation identity");
      return persistEditableTranslation(supabase, section, resumeId, entryId, locale, translation, "insert");
    },
    async readEditableTranslation(section, resumeId, entryId, locale) {
      const spec = editableTables[section];
      const { data, error } = await supabase.from(spec.translations).select("*").eq("resume_id", resumeId)
        .eq(spec.foreignKey, entryId).eq("locale", locale).maybeSingle();
      if (error) throw new Error(`Unable to verify ${section} ${locale} translation state`);
      return data ? parseEditableTranslation(section, data, resumeId, entryId, locale) : null;
    },
    async deleteEditableTranslation(section, resumeId, entryId, locale) {
      const spec = editableTables[section];
      const { error } = await supabase.from(spec.translations).delete().eq("resume_id", resumeId).eq(spec.foreignKey, entryId).eq("locale", locale);
      if (error) throw new Error(`${section} ${locale} translation delete failed`);
    },
    async deleteEditableEntry(section, resumeId, entryId) {
      const spec = editableTables[section];
      if (section === "projects") { const { error: methodsError } = await supabase.from("resume_project_methods").delete().eq("resume_id", resumeId).eq("project_entry_id", entryId); if (methodsError) throw new Error("Project methods could not be deleted"); }
      const { data, error } = await supabase.from(spec.parent).delete().eq("resume_id", resumeId).eq("id", entryId).select("id,resume_id").single();
      if (error || !data || data.id !== entryId || data.resume_id !== resumeId) throw new Error(`${section} entry delete was not confirmed`);
    },
  };
}

function validateEducationTranslation(value: EducationItem["translations"][Locale]): void {
  if (!value || [value.title, value.program, value.period, value.grade].some(field => typeof field !== "string")
    || (value.courseTitle !== null && typeof value.courseTitle !== "string")
    || (value.courseDescription !== null && typeof value.courseDescription !== "string")
    || (value.customCategoryLabel !== undefined && value.customCategoryLabel !== null && typeof value.customCategoryLabel !== "string")) throw new Error("Invalid Education translation");
}

function isEducationCategory(value: unknown): value is EducationCategory {
  return value === "undergraduate" || value === "graduate" || value === "doctoral" || value === "summerSchool" || value === "custom";
}

function parsedEducationCategory(data: Record<string, unknown>): EducationCategory | null {
  const value = data.education_category;
  const entryType = data.entry_type;
  if (entryType !== "standard" && entryType !== "summerSchool") throw new Error("Invalid Education entry type response");
  if (value === undefined || value === null) return entryType === "summerSchool" ? "summerSchool" : null;
  if (!isEducationCategory(value) || ((value === "summerSchool") !== (entryType === "summerSchool"))) {
    throw new Error("Invalid Education category response");
  }
  return value;
}

async function persistEducationTranslation(supabase: SupabaseClient, operation: "insert" | "update", resumeId: string,
  entryId: string, locale: Locale, values: Record<string, unknown>): Promise<UpdatedEducationTranslationRow> {
  const selected = "*";
  const mutation = supabase.from("resume_education_translations");
  const query = operation === "insert"
    ? mutation.insert(values).select(selected).single()
    : mutation.update(values).eq("resume_id", resumeId).eq("education_entry_id", entryId).eq("locale", locale).select(selected).single();
  const { data, error } = await query;
  if (error || !data) throw new Error(`Education ${locale} translation save was not confirmed`);
  return parseEducationTranslation(data, resumeId, entryId, locale);
}

function parseEducationTranslation(data: Record<string, unknown>, resumeId: string, entryId: string, locale: Locale): UpdatedEducationTranslationRow {
  if (data.resume_id !== resumeId || data.education_entry_id !== entryId || data.locale !== locale
    || [data.title, data.program, data.period, data.grade].some(value => typeof value !== "string")
    || (data.course_title !== null && typeof data.course_title !== "string")
    || (data.course_description !== null && typeof data.course_description !== "string")) {
    throw new Error("Invalid Education translation response");
  }
  const customCategoryLabel = data.custom_category_label;
  if (customCategoryLabel !== undefined && customCategoryLabel !== null && typeof customCategoryLabel !== "string") {
    throw new Error("Invalid Education custom category label response");
  }
  return { resumeId, entryId, locale, translation: {
    title: data.title as string, program: data.program as string, period: data.period as string, grade: data.grade as string,
    courseTitle: data.course_title as string | null, courseDescription: data.course_description as string | null,
    customCategoryLabel: customCategoryLabel as string | null | undefined ?? null,
  } };
}
