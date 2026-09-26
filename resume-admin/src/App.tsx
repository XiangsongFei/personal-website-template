import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { fixtureMeta, fixtureSections } from "./fixtures";
import type { LoadedResume, OverviewResumeData, ResumeSiteMetadata } from "./data/resumeMapper";
import type { EditableRepeatableSection, EditableTranslation, ResumeRepository, UpdatedEducationEntryRow, UpdatedEducationTranslationRow, UpdatedProfileRow, UpdatedProfileTranslationRow } from "./data/resumeRepository";
import type {
  AwardItem, Bilingual, ContactSection, EducationItem, ExperienceItem, FocusItem,
  EditorSections, IntroItem, Locale, LinksSection, OrderedItem, ProfileSection, ProjectItem, ProjectMethod, SectionKey,
  SkillItem, StatusItem,
} from "./model";
import { mapEditorSnapshotToResumeContent } from "./preview/resumeContentMapper";
import { ResumePreviewPanel, type PreviewSection } from "./preview/ResumePreviewPanel";
import { validateProfilePhoto } from "./data/profilePhoto";
import { bilingualFieldKey, collectChangedBilingualFieldKeys, type BilingualFieldIdentity, type BilingualReviewReminder } from "./bilingualReview";
import { UiLocaleSwitch, useUiLocale } from "./uiLocale";
import { diagnoseRefreshScroll, freezeExistingScrollSnapshot, freezeScrollSnapshot, isDocumentReloadNavigation, isScrollSnapshotFrozen, observeUserScroll, readStoredScrollPosition, resumeScrollSnapshotAfterBfcache, writeStoredScrollPosition } from "./refreshState";
import { formatBeijingTimestamp } from "./overviewFormat";

const navigation = [
  { label: "Overview", path: "/overview" },
  { label: "Profile", path: "/profile" },
  { label: "Introduction", path: "/introduction" },
  { label: "Education", path: "/education" },
  { label: "Experience", path: "/experience" },
  { label: "Projects", path: "/projects" },
  { label: "Skills", path: "/skills" },
  { label: "Awards", path: "/awards" },
  { label: "Contact", path: "/contact" },
  { label: "Site & Links", path: "/links" },
] as const;

const clone = <T,>(value: T): T => structuredClone(value);
const renumber = <T extends OrderedItem,>(items: T[]): T[] => items.map((item, position) => ({ ...item, position }));
const UI_RESTORE_STORAGE_PREFIX = "example-cv-cms:ui:";
const previewModeStorageKey = (section: PreviewSection) => `${UI_RESTORE_STORAGE_PREFIX}preview-mode:${section}`;

function readPreviewMode(section: PreviewSection): "editor" | "preview" {
  try {
    return window.sessionStorage.getItem(previewModeStorageKey(section)) === "preview" ? "preview" : "editor";
  } catch {
    return "editor";
  }
}

function persistPreviewMode(section: PreviewSection, view: "editor" | "preview") {
  try { window.sessionStorage.setItem(previewModeStorageKey(section), view); } catch { /* UI preference is optional. */ }
}

function getDocumentScrollOwner(): HTMLElement | null {
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement ?? document.body;
}

type EditableSectionItem = IntroItem | ExperienceItem | ProjectItem | SkillItem | AwardItem;
type PreviewDrafts = Partial<Pick<EditorSections, PreviewSection>>;
type PreviewDraftValue = EditorSections[PreviewSection];
type EditableFormItem = OrderedItem & { sourceKey?: string | null; translations: Record<Locale, object> };
type ProductionListState<T extends EditableFormItem = EditableSectionItem> = { marker: "production-list"; baseline: T[]; draft: T[];
  partialCreates: Record<string, { inserted: Locale[]; blocked?: boolean }>; saving: boolean; notice: string; error: boolean };
const editableSections = new Set<SectionKey>(["introduction", "experience", "projects", "skills", "awards"]);
type ProfileEditorState = {
  baseline: ProfileSection["shared"];
  draft: ProfileSection["shared"];
  saving: boolean;
  notice: string;
  saveError: boolean;
  translationBaseline: ProfileSection["translations"];
  translationDraft: ProfileSection["translations"];
  translationSaving: Record<Locale, boolean>;
  translationNotices: Record<Locale, { message: string; error: boolean } | null>;
};
type ProfileRequests = { shared: boolean; translations: Record<Locale, boolean> };
type ProfilePhotoDraft = { file: File; objectUrl: string; uploadedUrl?: string } | null;
type EducationEditorState = {
  baseline: EducationItem[]; draft: EducationItem[];
  partialCreates: Record<string, { inserted: Locale[]; blocked?: boolean }>;
  saving: boolean; notice: string; error: boolean; deleteTarget: string | null; deleting: boolean;
};

function initialProfileEditorState(profile: ProfileSection): ProfileEditorState {
  return {
    baseline: clone(profile.shared), draft: clone(profile.shared), saving: false, notice: "", saveError: false,
    translationBaseline: clone(profile.translations), translationDraft: clone(profile.translations),
    translationSaving: { zh: false, en: false }, translationNotices: { zh: null, en: null },
  };
}

function initialEducationEditorState(items: EducationItem[]): EducationEditorState {
  const baseline = clone(items);
  return { baseline, draft: clone(items), partialCreates: {}, saving: false, notice: "", error: false, deleteTarget: null, deleting: false };
}

const EditorContext = createContext<{
  sections: EditorSections; resume: LoadedResume | null; overviewData: OverviewResumeData | null; overviewSiteMetadata: ResumeSiteMetadata | null;
  overviewLoadState: "loading" | "error"; onRetryOverview: (() => void) | null; drafts: Map<SectionKey, unknown>;
  productionMode: boolean; profileResumeId: string | null; profileLoadState: "loading" | "error"; onRetryProfile: (() => void) | null;
  educationSection: EducationItem[] | null; educationResumeId: string | null; educationLoadState: "loading" | "error";
  onRetryEducation: (() => void) | null; onEducationChanged: ((resumeId: string, education: EducationItem[]) => void) | null;
  onReloadEducation: (() => Promise<EducationItem[]>) | null; onEducationDeleted: ((resumeId: string, entryId: string) => void) | null;
  additionalSections: Partial<Pick<EditorSections, "introduction" | "experience" | "projects" | "skills" | "awards" | "contact" | "links">>;
  additionalRouteLoadState: "loading" | "error";
  additionalResumeId: string | null;
  onAdditionalChanged: ((section: SectionKey, resumeId: string, value: unknown) => void) | null;
  onReloadAdditional: ((section: EditableRepeatableSection) => Promise<EditableSectionItem[]>) | null;
  repository: ResumeRepository | null; onProfileSaved: ((row: UpdatedProfileRow) => void) | null;
  onProfileTranslationSaved: ((row: UpdatedProfileTranslationRow) => void) | null;
  pdfFiles: Partial<Record<Locale, File>>; setPdfFiles: Dispatch<SetStateAction<Partial<Record<Locale, File>>>>;
  pdfErrors: Partial<Record<Locale, string>>; setPdfErrors: Dispatch<SetStateAction<Partial<Record<Locale, string>>>>;
  profileEditor: ProfileEditorState | null;
  setProfileEditor: Dispatch<SetStateAction<ProfileEditorState | null>>;
  educationEditor: EducationEditorState | null;
  setEducationEditor: Dispatch<SetStateAction<EducationEditorState | null>>;
  previewDrafts: PreviewDrafts;
  onPreviewDraftChanged: (section: PreviewSection, value: PreviewDraftValue) => void;
  previewLocale: Locale | null;
  setPreviewLocale: Dispatch<SetStateAction<Locale | null>>;
  profileRequests: ProfileRequests;
  preservePreviewScroll: boolean;
  profilePhotoDraft: ProfilePhotoDraft;
  setProfilePhotoDraft: Dispatch<SetStateAction<ProfilePhotoDraft>>;
  profilePhotoError: string;
  setProfilePhotoError: Dispatch<SetStateAction<string>>;
  onProfilePhotoUrlChanged: (url: string | null) => void;
  bilingualReviews: Record<string, BilingualReviewReminder>;
  onBilingualFieldEdit: (identity: BilingualFieldIdentity, locale: Locale, modified: boolean) => void;
  onBilingualReviewConfirm: (identity: BilingualFieldIdentity, locale: Locale) => void;
  onBilingualCancel: (changedKeys: Set<string>) => void;
  onBilingualSave: (changedKeys: Set<string>) => void;
}>({ sections: fixtureSections, resume: null, overviewData: null, overviewSiteMetadata: null, overviewLoadState: "loading", onRetryOverview: null, drafts: new Map(), productionMode: false, profileResumeId: null, profileLoadState: "loading", onRetryProfile: null, educationSection: null, educationResumeId: null, educationLoadState: "loading", onRetryEducation: null, onEducationChanged: null, onReloadEducation: null, onEducationDeleted: null, additionalSections: {}, additionalRouteLoadState: "loading", additionalResumeId: null, onAdditionalChanged: null, onReloadAdditional: null, repository: null, onProfileSaved: null, onProfileTranslationSaved: null,
  pdfFiles: {}, setPdfFiles: () => {}, pdfErrors: {}, setPdfErrors: () => {},
  profileEditor: null, setProfileEditor: () => {}, educationEditor: null, setEducationEditor: () => {}, previewDrafts: {}, onPreviewDraftChanged: () => {}, previewLocale: null, setPreviewLocale: () => {}, profileRequests: { shared: false, translations: { zh: false, en: false } }, preservePreviewScroll: false, profilePhotoDraft: null, setProfilePhotoDraft: () => {}, profilePhotoError: "", setProfilePhotoError: () => {}, onProfilePhotoUrlChanged: () => {}, bilingualReviews: {}, onBilingualFieldEdit: () => {}, onBilingualReviewConfirm: () => {}, onBilingualCancel: () => {}, onBilingualSave: () => {} });

function useLocalDraft<T>(section: SectionKey, initial: T) {
  const { productionMode, drafts } = useContext(EditorContext);
  const production = productionMode;
  const storageKey = `example-cv-cms-fixture-${section}`;
  const [saved, setSaved] = useState<T>(() => {
    if (production) {
      const record = drafts.get(section) as { saved: T; draft: T } | undefined;
      return clone(record?.saved ?? initial);
    }
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) as T : clone(initial);
    } catch {
      return clone(initial);
    }
  });
  const [draft, setDraft] = useState<T>(() => production
    ? clone((drafts.get(section) as { saved: T; draft: T } | undefined)?.draft ?? saved)
    : clone(saved));
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (next: T | ((current: T) => T)) => {
    setDraft(current => {
      const value = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      if (production) drafts.set(section, { saved, draft: clone(value) });
      return value;
    });
    setNotice("");
  };
  const save = () => {
    const next = clone(draft);
    if (production) {
      drafts.set(section, { saved: next, draft: next });
      setSaved(next);
      setNotice("Saved as a local draft only. Production data was not changed.");
      return;
    }
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(next));
      setSaved(next);
      setNotice("Saved in this browser session only. No production data was changed.");
    } catch {
      setNotice("Local session storage is unavailable. Changes remain on this screen only.");
    }
  };
  const confirm = (next: T) => { setSaved(clone(next)); setDraft(clone(next)); if (production) drafts.set(section, { saved: clone(next), draft: clone(next) }); };
  const setMessage = (message: string) => setNotice(message);
  const cancel = () => {
    setDraft(clone(saved));
    if (production) drafts.set(section, { saved: clone(saved), draft: clone(saved) });
    setNotice("Local changes reverted.");
  };
  return { draft, update, dirty, notice, save, cancel, production, confirm, setMessage, saved };
}

type FieldSpec<T> = { key: keyof T & string; label: string; multiline?: boolean; type?: "text" | "email" | "url"; readOnlyZh?: boolean };

function InputField({ id, label, value, onChange, multiline = false, type = "text", readOnly = false, hint, compactLabel, modified, reviewLabel, onReviewConfirm }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  multiline?: boolean; type?: "text" | "email" | "url"; readOnly?: boolean; hint?: string; compactLabel?: string;
  modified?: boolean; reviewLabel?: string; onReviewConfirm?: () => void;
}) {
  const { t } = useUiLocale();
  return <div className="field">
    <label htmlFor={id}>{compactLabel ? <><span aria-hidden="true">{compactLabel}</span><span className="visually-hidden">{t(label)}</span></> : t(label)}</label>
    {multiline
      ? <textarea id={id} value={value} onChange={event => onChange(event.target.value)} readOnly={readOnly} rows={4} aria-label={compactLabel ? t(label) : undefined} aria-describedby={hint ? `${id}-hint` : undefined} />
      : <input id={id} type={type} value={value} onChange={event => onChange(event.target.value)} readOnly={readOnly} aria-label={compactLabel ? t(label) : undefined} aria-describedby={hint ? `${id}-hint` : undefined} />}
    {(modified || reviewLabel) && <div className="field-edit-status">
      {modified && <span>{t("Modified")}</span>}
      {reviewLabel && onReviewConfirm && <><span className="field-review-warning">{t(reviewLabel)}</span><button className="field-review-dismiss" type="button" onClick={onReviewConfirm}>{t("No change needed")}</button></>}
    </div>}
    {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
  </div>;
}

function SharedFields<T extends object>({ value, fields, onChange, idPrefix, readOnly = false }: {
  value: T; fields: FieldSpec<T>[]; onChange: (value: T) => void; idPrefix: string; readOnly?: boolean;
}) {
  return <div className="field-grid">{fields.map(field =>
    <InputField key={field.key} id={`${idPrefix}-${field.key}`} label={field.label} value={String(value[field.key] ?? "")}
      type={field.type} multiline={field.multiline} readOnly={readOnly}
      onChange={next => onChange({ ...value, [field.key]: next })} />
  )}</div>;
}

function BilingualFields<T extends object>({ value, fields, onChange, idPrefix, readOnlyAll = false, readOnlyLocales, footer, section, itemId, confirmed, locales: shownLocales, showLocaleHeaders = false }: {
  value: Bilingual<T>; fields: FieldSpec<T>[]; onChange: (value: Bilingual<T>, locale: Locale) => void; idPrefix: string;
  readOnlyAll?: boolean; readOnlyLocales?: Partial<Record<Locale, boolean>>; footer?: (locale: Locale) => ReactNode;
  section?: SectionKey; itemId?: string; confirmed?: Bilingual<T>; locales?: readonly Locale[]; showLocaleHeaders?: boolean;
}) {
  const { t } = useUiLocale();
  const context = useContext(EditorContext);
  const locales = shownLocales ?? ["zh", "en"];
  return <div className="bilingual-fields">
    <div className={`bilingual-grid${showLocaleHeaders ? " has-locale-headings" : ""}`}>
      {showLocaleHeaders && <div className="bilingual-column-headings" aria-hidden="true"><span />
        <span lang="zh">{t("Chinese")}</span><span lang="en">English</span>
      </div>}
      {fields.map(field =>
      <section className="bilingual-field-pair" key={field.key}>
        <h3>{t(field.label)}</h3>
        <div className="bilingual-field-values">{locales.map(locale => {
          const readOnly = readOnlyAll || readOnlyLocales?.[locale] || (locale === "zh" && field.readOnlyZh);
          const localeName = locale === "zh" ? t("Chinese") : t("English");
          const identity = section && itemId ? { section, itemId, field: field.key } : null;
          const key = identity ? bilingualFieldKey(identity, locale) : "";
          const currentValue = String(value[locale][field.key] ?? "");
          const baseValue = confirmed ? String(confirmed[locale][field.key] ?? "") : "";
          const modified = currentValue !== baseValue;
          const review = identity ? context.bilingualReviews[key] : undefined;
          const reviewLabel = review ? (locale === "zh" ? "Review Chinese" : "Review English") : undefined;
          return <InputField key={locale} id={`${idPrefix}-${locale}-${field.key}`}
            label={`${localeName} ${t(field.label)}`} compactLabel={locale === "zh" ? "中文" : "EN"}
            value={String(value[locale][field.key] ?? "")} type={field.type} multiline={field.multiline}
            readOnly={readOnly}
            modified={modified} reviewLabel={reviewLabel}
            onReviewConfirm={identity ? () => context.onBilingualReviewConfirm(identity, locale) : undefined}
            hint={locale === "zh" && field.readOnlyZh && !readOnlyAll ? t("Not editable in the first CMS release. The public renderer uses fixed phrase styling here.") : undefined}
            onChange={next => {
              if (identity) context.onBilingualFieldEdit(identity, locale, next !== baseValue);
              onChange({ ...value, [locale]: { ...value[locale], [field.key]: next } }, locale);
            }} />;
        })}</div>
      </section>
    )}</div>
    {footer && <div className="bilingual-footer-grid">{locales.map(locale =>
      <section className="language-panel bilingual-footer-panel" key={locale}>
        <h3><span lang={locale}>{locale === "zh" ? t("Chinese") : t("English")}</span></h3>
        {footer(locale)}
      </section>
    )}</div>}
  </div>;
}

function SectionForm<T>({ section, title, description, initial, children, productionSave, productionDirty = false, onProductionCancel, onProductionSaved }: {
  section: SectionKey; title: string; description: string; initial: T;
  children: (value: T, onChange: (next: T | ((current: T) => T)) => void, confirmed: T) => ReactNode;
  productionSave?: (draft: T, baseline: T) => Promise<T | void>;
  productionDirty?: boolean; onProductionCancel?: () => void; onProductionSaved?: () => void;
}) {
  const { t } = useUiLocale();
  const context = useContext(EditorContext);
  const { onPreviewDraftChanged } = context;
  const editor = useLocalDraft(section, initial);
  const cancelDraft = () => {
    context.onBilingualCancel(collectChangedBilingualFieldKeys(section, editor.draft, editor.saved));
    editor.cancel();
    onProductionCancel?.();
  };
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const saveLock = useRef(false);
  useEffect(() => {
    onPreviewDraftChanged(section as PreviewSection, editor.draft as PreviewDraftValue);
  }, [onPreviewDraftChanged, editor.draft, section]);
  const submit = async () => {
    if (editor.production && productionSave) {
      if (saveLock.current) return; saveLock.current = true; setSaving(true); setSaveError(false);
      try { const changedKeys = collectChangedBilingualFieldKeys(section, editor.draft, editor.saved); const result = await productionSave(editor.draft, editor.saved); const confirmed = result ?? editor.draft; context.onBilingualSave(changedKeys); editor.confirm(confirmed); onProductionSaved?.(); editor.setMessage(section === "introduction" ? "Introduction changes saved." : "Changes saved to production."); context.onAdditionalChanged?.(section, context.additionalResumeId ?? "", confirmed); }
      catch (error) { setSaveError(true); editor.setMessage(error instanceof Error ? error.message : section === "introduction" ? "Introduction changes could not be saved. Please retry." : "Production save failed. Your changes remain unsaved; please retry."); }
      finally { saveLock.current = false; setSaving(false); }
      return;
    }
    const changedKeys = collectChangedBilingualFieldKeys(section, editor.draft, editor.saved);
    editor.save();
    context.onBilingualSave(changedKeys);
  };
  return <section className="page-section">
    <div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t(title)}</h1><p>{t(description)}</p></div>
    <form className="editor-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      {children(editor.draft, editor.update, editor.saved)}
      <div className="save-bar">
        <span className={editor.dirty || productionDirty ? "state-pill is-dirty" : "state-pill"}>{editor.dirty || productionDirty ? t("Unsaved changes") : t("No unsaved changes")}</span>
        <div className="save-actions">
          <button type="button" className="button secondary" onClick={cancelDraft} disabled={!(editor.dirty || productionDirty) || saving}>{t("Cancel changes")}</button>
          <button type="submit" className="button primary" disabled={!(editor.dirty || productionDirty) || saving}>{saving ? t("Saving…") : section === "introduction" ? t("Save Introduction changes") : editor.production && !productionSave ? t("Save local draft") : editor.production ? t("Save production changes") : t("Save section")}</button>
        </div>
      </div>
      <p className="save-notice" role={saveError ? "alert" : "status"} aria-live="polite">{t(editor.notice) || (editor.production ? t("Local draft only. Production writes are disabled for this section.") : t("Fixture saves stay in this browser session."))}</p>
    </form>
  </section>;
}

function RepeatableList<T extends OrderedItem>({ items, onChange, create, label, render, groupLabel, addLabel = "Add item", allowMultipleOpen = false, onConfirmedDelete, deleteDisabled, confirmedItems = [] }: {
  items: T[]; onChange: (items: T[]) => void; create: (id: string, position: number) => T;
  label: (item: T, index: number) => string; render: (item: T, onChange: (item: T) => void, confirmed?: T) => ReactNode; groupLabel: string; addLabel?: string; allowMultipleOpen?: boolean; confirmedItems?: T[];
  onConfirmedDelete?: (id: string) => void; deleteDisabled?: (id: string) => boolean;
}) {
  const { t } = useUiLocale();
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(items[0] ? [items[0].id] : []));
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const nextId = useRef(0);
  const replace = (id: string, changed: T) => onChange(items.map(item => item.id === id ? changed : item));
  const remove = (id: string) => {
    onChange(renumber(items.filter(item => item.id !== id)));
    if (allowMultipleOpen) setOpenIds(current => { const next = new Set(current); next.delete(id); return next; });
    else if (openId === id) setOpenId(null);
  };
  const toggleOpen = (id: string, isOpen: boolean) => {
    if (allowMultipleOpen) setOpenIds(current => { const next = new Set(current); if (isOpen) next.delete(id); else next.add(id); return next; });
    else setOpenId(isOpen ? null : id);
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onChange(renumber(reordered));
  };
  const add = () => {
    const newItem = create(`local-${++nextId.current}-${Date.now()}`, items.length);
    onChange([...items, newItem]);
    if (allowMultipleOpen) setOpenIds(current => new Set(current).add(newItem.id));
    else setOpenId(newItem.id);
  };
  return <div className="repeatable-group" aria-label={groupLabel}>
    <div className="group-heading"><h2>{t(groupLabel)}</h2><button type="button" className="button secondary" onClick={add}>{t(addLabel)}</button></div>
    {items.length === 0 && <p className="empty-note">{t("No items yet. Add one to start this section.")}</p>}
    <div className="item-stack">{items.map((item, index) => {
      const itemLabel = label(item, index) || t("New item");
      const isOpen = allowMultipleOpen ? openIds.has(item.id) : openId === item.id;
      return <article className="item-card" key={item.id}>
        <div className="item-card-heading"><div><span className="item-number">{String(index + 1).padStart(2, "0")}</span><h3>{itemLabel}</h3></div>
          <div className="item-actions">
            <button type="button" onClick={() => toggleOpen(item.id, isOpen)} aria-label={`${isOpen ? t("Close editor for") : t("Edit")} ${itemLabel}`}>{isOpen ? t("Close") : t("Edit")}</button>
            <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`${t("Move")} ${itemLabel} ${t("up")}`}>↑</button>
            <button type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`${t("Move")} ${itemLabel} ${t("down")}`}>↓</button>
            {pendingDeleteId === item.id ? <><button type="button" className="danger-text" onClick={() => { if (onConfirmedDelete) { onConfirmedDelete(item.id); if (allowMultipleOpen) setOpenIds(current => { const next = new Set(current); next.delete(item.id); return next; }); } else remove(item.id); setPendingDeleteId(null); }}>{t("Confirm delete")}</button>
              <button type="button" onClick={() => setPendingDeleteId(null)}>{t("Keep entry")}</button></>
              : <button type="button" className="danger-text" disabled={deleteDisabled?.(item.id)} onClick={() => onConfirmedDelete ? setPendingDeleteId(item.id) : remove(item.id)} aria-label={`${t("Delete")} ${itemLabel}`}>{t("Delete")}</button>}
          </div>
        </div>
        {isOpen && <div className="item-card-body">{render(item, changed => replace(item.id, changed), confirmedItems.find(value => value.id === item.id))}</div>}
      </article>;
    })}</div>
  </div>;
}

function RepeatableSection<T extends OrderedItem>({ section, title, description, create, label, render }: {
  section: "introduction" | "education" | "experience" | "projects" | "skills" | "awards";
  title: string; description: string; create: (id: string, position: number) => T;
  label: (item: T, index: number) => string; render: (item: T, onChange: (item: T) => void, confirmed?: T) => ReactNode;
}) {
  const context = useContext(EditorContext);
  const { locale } = useUiLocale();
  const { sections, productionMode } = context;
  const scopeClass = section === "introduction" ? "introduction-editor-scope" : undefined;
  if (productionMode && editableSections.has(section)) {
    const key = section as EditableRepeatableSection;
    const items = (context.additionalSections[key] ?? sections[key]) as unknown as T[];
    if (context.additionalResumeId && context.repository) return <div className={scopeClass}><ProductionRepeatableSection section={key} resumeId={context.additionalResumeId}
      items={items as unknown as EditableSectionItem[]} repository={context.repository} drafts={context.drafts} onChanged={context.onAdditionalChanged}
      onReload={context.onReloadAdditional} title={title} description={description} create={create as unknown as (id: string, position: number) => EditableSectionItem}
      label={label as unknown as (item: EditableSectionItem, index: number) => string} render={render as unknown as (item: EditableSectionItem, onChange: (item: EditableSectionItem) => void) => ReactNode} /></div>;
  }
  const groupLabel = section === "introduction" ? locale === "zh" ? "简介内容" : "Introduction" : `${title} items`;
  const addLabel = section === "introduction" ? "Add paragraph" : "Add item";
  return <div className={scopeClass}><SectionForm section={section} title={title} description={description} initial={sections[section] as unknown as T[]}>
    {(items, onChange, confirmed) => <RepeatableList items={items} confirmedItems={confirmed as T[]} onChange={onChange} create={create} label={label} render={render} groupLabel={groupLabel} addLabel={addLabel} allowMultipleOpen={section === "introduction"} />}
  </SectionForm></div>;
}

type ProductionRepeatableProps = {
  section: EditableRepeatableSection; resumeId: string; items: EditableSectionItem[]; repository: ResumeRepository;
  drafts: Map<SectionKey, unknown>;
  onChanged: ((section: EditableRepeatableSection, resumeId: string, value: EditableSectionItem[]) => void) | null;
  onReload: ((section: EditableRepeatableSection) => Promise<EditableSectionItem[]>) | null;
  title: string; description: string; create: (id: string, position: number) => EditableSectionItem;
  label: (item: EditableSectionItem, index: number) => string; render: (item: EditableSectionItem, onChange: (item: EditableSectionItem) => void, confirmed?: EditableSectionItem) => ReactNode;
};

function ProductionRepeatableSection({ section, resumeId, items, repository, drafts, onChanged, onReload,
  title, description, create, label, render }: ProductionRepeatableProps) {
  const { t, locale } = useUiLocale();
  const { onPreviewDraftChanged, onBilingualCancel: contextOnCancel, onBilingualSave: contextOnSave } = useContext(EditorContext);
  const stored = drafts.get(section) as ProductionListState | undefined;
  const [editor, setEditor] = useState<ProductionListState>(() => stored?.marker === "production-list" ? clone(stored) : {
    marker: "production-list", baseline: clone(items), draft: clone(items),
    partialCreates: {}, saving: false, notice: "", error: false,
  });
  const saving = useRef(false);
  const stateUpdate = (next: ProductionListState | ((current: ProductionListState) => ProductionListState)) => {
    setEditor(current => {
      const value = typeof next === "function" ? next(current as ProductionListState) : next;
      drafts.set(section, clone(value));
      return value;
    });
  };
  const baseline = editor.baseline as EditableSectionItem[];
  const draft = editor.draft as EditableSectionItem[];
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
    || baseline.some(item => !draft.some(value => value.id === item.id));
  const hasBlocked = Object.values(editor.partialCreates).some(value => value.blocked);
  const hasRecovery = Object.keys(editor.partialCreates).length > 0;

  useEffect(() => {
    if (["introduction", "experience", "projects", "skills", "awards"].includes(section))
      onPreviewDraftChanged(section as PreviewSection, draft as PreviewDraftValue);
  }, [onPreviewDraftChanged, draft, section]);

  const patchDraft = (next: EditableSectionItem[]) => stateUpdate(current => ({ ...current, draft: clone(next), notice: "", error: false }));
  const saveChanges = async () => {
    if (saving.current || !dirty || hasBlocked) return;
    const methods = repository.updateEditableEntryPosition && repository.insertEditableEntry && repository.updateEditableTranslation
      && repository.insertEditableTranslation && repository.readEditableTranslation && repository.deleteEditableTranslation && repository.deleteEditableEntry;
    if (!methods) { stateUpdate(current => ({ ...current, notice: section === "introduction" ? "Introduction changes could not be saved. Please retry." : "Production writes are unavailable for this section.", error: true })); return; }
    saving.current = true;
    let working: ProductionListState = { ...clone(editor), saving: true, notice: "", error: false };
    const commit = (next: ProductionListState) => { working = next; drafts.set(section, clone(next)); setEditor(next); };
    const patchCache = () => onChanged?.(section, resumeId, clone(working.baseline));
    commit(working);
    try {
      // Explicitly remove child translations first so parent deletion never depends on FK cascade behavior.
      for (const oldItem of [...working.baseline]) {
        if (working.draft.some(item => item.id === oldItem.id)) continue;
        await repository.deleteEditableTranslation!(section, resumeId, oldItem.id, "zh");
        await repository.deleteEditableTranslation!(section, resumeId, oldItem.id, "en");
        await repository.deleteEditableEntry!(section, resumeId, oldItem.id);
        working = { ...working, baseline: working.baseline.filter(item => item.id !== oldItem.id), partialCreates: Object.fromEntries(Object.entries(working.partialCreates).filter(([id]) => id !== oldItem.id)) };
        commit(working); patchCache();
      }
      // Remove a newly-created but incomplete parent only after the user confirmed its removal.
      for (const [id, partial] of Object.entries(working.partialCreates)) {
        if (partial.blocked || working.draft.some(item => item.id === id)) continue;
        for (const locale of ["zh", "en"] as const) await repository.deleteEditableTranslation!(section, resumeId, id, locale);
        await repository.deleteEditableEntry!(section, resumeId, id);
        working = { ...working, partialCreates: Object.fromEntries(Object.entries(working.partialCreates).filter(([key]) => key !== id)) };
        commit(working); patchCache();
      }
      // Create rows with server UUIDs and track translation completion for safe retries.
      for (const snapshot of [...working.draft]) {
        const foundItem = working.draft.find(value => value.id === snapshot.id);
        if (!foundItem) continue;
        let item: EditableSectionItem = foundItem;
        if (working.baseline.some(value => value.id === item.id)) continue;
        let progress = working.partialCreates[item.id];
        if (progress?.blocked) throw new Error("Parent creation was not confirmed. Verify production before retrying this item.");
        if (!progress) {
          let parent;
          try { const nextPosition = Math.max(-1, ...working.baseline.map(value => value.position), ...Object.keys(working.partialCreates).map(id => working.draft.find(value => value.id === id)?.position ?? -1)) + 1;
          parent = await repository.insertEditableEntry!(section, resumeId, nextPosition); }
          catch (cause) {
            working = { ...working, partialCreates: { ...working.partialCreates, [item.id]: { inserted: [], blocked: true } } };
            commit(working); throw cause;
          }
          const temporaryId = item.id;
          item = { ...item, id: parent.entryId, position: parent.position, sourceKey: parent.sourceKey } as EditableSectionItem;
          working = { ...working, draft: working.draft.map(value => value.id === temporaryId ? item : value), partialCreates: { ...working.partialCreates, [parent.entryId]: { inserted: [] } } };
          commit(working);
          progress = working.partialCreates[parent.entryId];
        }
        for (const locale of ["zh", "en"] as const) {
          if (progress!.inserted.includes(locale)) continue;
          let confirmed = await repository.readEditableTranslation!(section, resumeId, item.id, locale);
          if (!confirmed) {
            try {
              confirmed = await repository.insertEditableTranslation!(section, resumeId, item.id, locale,
                item.translations[locale] as EditableTranslation<typeof section>);
            } catch (cause) {
              try { confirmed = await repository.readEditableTranslation!(section, resumeId, item.id, locale); } catch { /* Keep the partial state and verify on explicit retry. */ }
              if (!confirmed) throw cause;
            }
          }
          const confirmedItem = { ...item, translations: { ...item.translations, [locale]: confirmed.translation } } as EditableSectionItem;
          progress = { inserted: [...new Set([...progress!.inserted, locale])] };
          working = { ...working, draft: working.draft.map(value => value.id === item!.id ? confirmedItem : value),
            partialCreates: { ...working.partialCreates, [item.id]: progress } };
          item = confirmedItem; commit(working);
        }
        const created = working.draft.find(value => value.id === item!.id)!;
        working = { ...working, baseline: [...working.baseline, clone(created)], partialCreates: Object.fromEntries(Object.entries(working.partialCreates).filter(([id]) => id !== created.id)) };
        commit(working); patchCache();
      }
      // Update changed translations independently; each confirmed row advances its baseline.
      for (const snapshot of [...working.draft]) {
        const item = working.draft.find(value => value.id === snapshot.id)!;
        let old = working.baseline.find(value => value.id === item.id);
        if (!old) continue;
        for (const locale of ["zh", "en"] as const) {
          if (JSON.stringify(item.translations[locale]) === JSON.stringify(old.translations[locale])) continue;
          const confirmed = await repository.updateEditableTranslation!(section, resumeId, item.id, locale,
            item.translations[locale] as EditableTranslation<typeof section>);
          const baseNext = { ...old, translations: { ...old.translations, [locale]: confirmed.translation } } as EditableSectionItem;
          const draftNext = { ...item, translations: { ...item.translations, [locale]: confirmed.translation } } as EditableSectionItem;
          working = { ...working, baseline: working.baseline.map(value => value.id === item.id ? baseNext : value),
            draft: working.draft.map(value => value.id === item.id ? draftNext : value) };
          old = baseNext; commit(working); patchCache();
        }
      }
      if (section === "projects") {
        const methodsReady = repository.updateProjectMethod && repository.insertProjectMethod && repository.readProjectMethodByPosition && repository.deleteProjectMethod;
        if (!methodsReady) throw new Error("Project method production writes are unavailable.");
        for (const snapshot of [...working.draft]) {
          let project = working.draft.find(item => item.id === snapshot.id) as ProjectItem | undefined;
          if (!project) continue;
          let oldProject = working.baseline.find(item => item.id === project!.id) as ProjectItem | undefined;
          for (const locale of ["zh", "en"] as const) {
            let oldMethods: ProjectMethod[] = (oldProject?.methods[locale] ?? []).filter((method: ProjectMethod) => !method.id.startsWith("local-method-"));
            let currentMethods: ProjectMethod[] = [...project.methods[locale]];
            for (const oldMethod of oldMethods) if (!currentMethods.some(method => method.id === oldMethod.id)) {
              await repository.deleteProjectMethod!(resumeId, project.id, oldMethod.id, locale);
              oldMethods = oldMethods.filter(method => method.id !== oldMethod.id);
              working = { ...working, baseline: working.baseline.map(value => value.id === project!.id ? { ...(value as ProjectItem), methods: { ...(value as ProjectItem).methods, [locale]: oldMethods } } : value) };
              oldProject = working.baseline.find(value => value.id === project!.id) as ProjectItem; commit(working); patchCache();
            }
            for (const method of [...currentMethods]) {
              const oldMethod = oldMethods.find(value => value.id === method.id);
              if (oldMethod && oldMethod.value !== method.value) {
                const saved = await repository.updateProjectMethod!(resumeId, project.id, method.id, locale, { value: method.value });
                currentMethods = currentMethods.map(value => value.id === method.id ? { ...value, value: saved.value } : value);
                oldMethods = oldMethods.map(value => value.id === method.id ? { ...value, value: saved.value } : value);
                working = { ...working, baseline: working.baseline.map(value => value.id === project!.id ? { ...(value as ProjectItem), methods: { ...(value as ProjectItem).methods, [locale]: oldMethods } } : value) };
                oldProject = working.baseline.find(value => value.id === project!.id) as ProjectItem; commit(working); patchCache();
              } else if (!oldMethod && method.id.startsWith("local-method-")) {
                let saved;
                try { saved = await repository.insertProjectMethod!(resumeId, project.id, locale, method.position, method.value); }
                catch (cause) { saved = await repository.readProjectMethodByPosition!(resumeId, project.id, locale, method.position, method.value); if (!saved) throw cause; }
                currentMethods = currentMethods.map(value => value.id === method.id ? { id: saved!.methodId, position: saved!.position, value: saved!.value } : value);
                oldMethods = [...oldMethods, { id: saved!.methodId, position: saved!.position, value: saved!.value }];
                project = { ...project, methods: { ...project.methods, [locale]: currentMethods } };
                working = { ...working, draft: working.draft.map(value => value.id === project!.id ? project! : value), baseline: working.baseline.map(value => value.id === project!.id ? { ...(value as ProjectItem), methods: { ...(value as ProjectItem).methods, [locale]: oldMethods } } : value) };
                oldProject = working.baseline.find(value => value.id === project!.id) as ProjectItem; commit(working); patchCache();
              }
            }
            const orderChanged = currentMethods.some((method,index) => method.id !== oldMethods.sort((a,b)=>a.position-b.position || a.id.localeCompare(b.id))[index]?.id || method.position !== index);
            if (orderChanged) {
              const high = Math.max(-1, ...oldMethods.map(method=>method.position), ...currentMethods.map(method=>method.position)) + currentMethods.length + 1;
              for (let index=0; index<currentMethods.length; index++) await repository.updateProjectMethod!(resumeId, project.id, currentMethods[index].id, locale, { position: high+index });
              for (let index=0; index<currentMethods.length; index++) {
                const saved = await repository.updateProjectMethod!(resumeId, project.id, currentMethods[index].id, locale, { position: index });
                currentMethods[index] = { ...currentMethods[index], position: saved.position };
              }
            }
            project = { ...project, methods: { ...project.methods, [locale]: currentMethods } };
            working = { ...working, draft: working.draft.map(value => value.id === project!.id ? project! : value),
              baseline: working.baseline.map(value => value.id === project!.id ? { ...(value as ProjectItem), methods: { ...(value as ProjectItem).methods, [locale]: currentMethods.filter(method => !method.id.startsWith("local-method-")) } } : value) };
            oldProject = working.baseline.find(value=>value.id===project!.id) as ProjectItem;
            commit(working); patchCache();
          }
        }
      }
      const target = working.draft.filter(item => working.baseline.some(value => value.id === item.id));
      const currentOrder = [...working.baseline].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(item => item.id);
      const baselineById = new Map(working.baseline.map(item => [item.id, item]));
      const orderChanged = target.length !== currentOrder.length || target.some((item, index) => item.id !== currentOrder[index]
        || baselineById.get(item.id)?.position !== index);
      if (orderChanged) {
        const maxPosition = Math.max(-1, ...working.baseline.map(item => item.position));
        try {
          for (let index = 0; index < target.length; index++) {
            const row = await repository.updateEditableEntryPosition!(section, resumeId, target[index].id, maxPosition + target.length + index + 1);
            working = { ...working, baseline: working.baseline.map(value => value.id === row.entryId ? { ...value, position: row.position } : value) };
            commit(working);
          }
          for (let position = 0; position < target.length; position++) {
            const row = await repository.updateEditableEntryPosition!(section, resumeId, target[position].id, position);
            working = { ...working, baseline: working.baseline.map(value => value.id === row.entryId ? { ...value, position: row.position } : value),
              draft: working.draft.map(value => value.id === row.entryId ? { ...value, position: row.position } : value) };
            commit(working); patchCache();
          }
        } catch (cause) {
          try {
            if (!onReload) throw new Error("Section reload is unavailable");
            const latest = await onReload(section) as unknown as EditableSectionItem[];
            const byId = new Map(latest.map(item => [item.id, item]));
            const desiredIds = working.draft.map(item => item.id).filter(id => byId.has(id));
            const draftById = new Map(working.draft.map(item => [item.id, item]));
            const reloadedDraft = latest.map(value => {
              const local = draftById.get(value.id);
              return local ? { ...value, translations: local.translations } as EditableSectionItem : value;
            }).sort((a, b) => desiredIds.indexOf(a.id) - desiredIds.indexOf(b.id));
            working = { ...working, baseline: latest as EditableSectionItem[], draft: reloadedDraft as EditableSectionItem[],
              notice: "Reorder failed. The section was reloaded from production; review and retry.", error: true };
            commit(working);
          } catch {
            working = { ...working, notice: "Reorder failed and the section could not be reloaded. Your draft remains available; retry after checking production.", error: true };
            commit(working);
          }
          throw cause;
        }
      }
      contextOnSave(collectChangedBilingualFieldKeys(section, working.draft, editor.baseline));
      working = { ...working, baseline: clone(working.draft), draft: clone(working.draft), saving: false, notice: section === "introduction" ? "Introduction changes saved." : "Changes saved to production.", error: false };
      commit(working); patchCache();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : section === "introduction" ? "Introduction changes could not be saved. Please retry." : "Production save failed. Your changes remain unsaved; please retry.";
      if (!working.error) working = { ...working, notice: detail, error: true };
      working = { ...working, saving: false };
      commit(working);
    } finally { saving.current = false; }
  };
  const cancel = () => {
    if (hasRecovery || editor.saving) return;
    contextOnCancel?.(collectChangedBilingualFieldKeys(section, draft, baseline));
    stateUpdate(current => ({ ...current, draft: clone(current.baseline), notice: section === "introduction" ? "Introduction changes reverted." : "Changes reverted to the last confirmed production values.", error: false }));
  };
  const groupLabel = section === "introduction" ? locale === "zh" ? "简介内容" : "Introduction" : `${title} items`;
  const addLabel = section === "introduction" ? "Add paragraph" : "Add item";
  return <section className="page-section" aria-busy={editor.saving}>
    <div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t(title)}</h1><p>{t(description)}</p></div>
    <RepeatableList items={draft} confirmedItems={baseline as EditableSectionItem[]} onChange={patchDraft} create={create} label={label} render={render} groupLabel={groupLabel} addLabel={addLabel} allowMultipleOpen={section === "introduction"}
      onConfirmedDelete={id => patchDraft(draft.filter(item => item.id !== id))} deleteDisabled={id => Boolean(editor.partialCreates[id]?.blocked)} />
    {(section !== "introduction" || editor.notice) && <p className="save-notice production-save-helper" role={editor.error ? "alert" : "status"} aria-live="polite">{t(editor.notice || "Changes are written to production only when saved.")}</p>}
    <div className="save-bar"><span className={dirty ? "state-pill is-dirty" : "state-pill"}>{dirty ? t("Unsaved changes") : t("No unsaved changes")}</span>
      <div className="save-actions"><button type="button" className="button secondary" onClick={cancel} disabled={!dirty || editor.saving || hasRecovery}>{t("Cancel changes")}</button>
        <button type="button" className="button primary" onClick={() => void saveChanges()} disabled={!dirty || editor.saving || hasBlocked}>{editor.saving ? t("Saving…") : t(section === "introduction" ? "Save Introduction changes" : "Save production changes")}</button></div>
    </div>
  </section>;
}

function Overview() {
  const { sections, resume, productionMode, overviewData, overviewSiteMetadata } = useContext(EditorContext);
  const { t, locale } = useUiLocale();
  const isProductionOverview = productionMode && overviewData !== null && overviewSiteMetadata !== null;
  const isProductionSnapshot = productionMode && resume !== null;
  const profileName = isProductionOverview
    ? overviewData.profileName
    : sections.profile.translations[locale].name || fixtureMeta.name;
  const updatedAt = isProductionOverview ? overviewSiteMetadata.updatedAt : isProductionSnapshot ? resume.updatedAt : null;
  const managementItems = [
    { path: "/profile", title: "Profile", description: "Identity, photo, and shared information" },
    { path: "/introduction", title: "Introduction", description: "Homepage introduction" },
    { path: "/education", title: "Education", description: "Schools and education background" },
    { path: "/experience", title: "Experience", description: "Internships and work experience" },
    { path: "/projects", title: "Projects", description: "Projects and outcomes" },
    { path: "/skills", title: "Skills", description: "Skill categories and content" },
    { path: "/awards", title: "Awards", description: "Awards and honors" },
    { path: "/contact", title: "Contact", description: "Contact information" },
    { path: "/links", title: "Site & Links", description: "Navigation, links, and site text" },
  ];
  return <section className="page-section overview-page">
    <div className="page-heading"><p className="eyebrow">{t("Workspace Overview")}</p><h1>{t("Overview")}</h1><p>{t("Manage and maintain your bilingual resume content.")}</p></div>
    <div className="overview-summary" aria-label={t("Resume summary")}>
      <div><span>{t("Current resume")}</span><strong>{profileName}</strong></div>
      <div><span>{t("Content languages")}</span><strong>{t("Chinese · English")}</strong></div>
      <div><span>{t("Last updated")}</span><strong>{formatBeijingTimestamp(updatedAt)}</strong><small>{t("Beijing Time")}</small></div>
    </div>
    <div className="overview-management">
      <h2>{t("Content management")}</h2>
      <p>{t("Choose a section to start editing.")}</p>
      <nav className="overview-management-grid" aria-label={t("Content management")}>
        {managementItems.map(item => <Link className="overview-management-item" to={item.path} key={item.path}>
          <span><strong>{t(item.title)}</strong><span aria-hidden="true">↗</span></span>
          <small>{t(item.description)}</small>
        </Link>)}
      </nav>
    </div>
  </section>;
}

function PreviewWorkspace({ section, children }: { section: PreviewSection; children: ReactNode }) {
  const context = useContext(EditorContext);
  const { locale: uiLocale, t } = useUiLocale();
  const [view, setView] = useState<"editor" | "preview">(() => readPreviewMode(section));
  const changeView = (next: "editor" | "preview") => {
    setView(next);
    persistPreviewMode(section, next);
  };
  const previewReady = !context.productionMode || context.resume !== null || (section === "profile"
    ? context.profileEditor !== null
      : section === "education"
        ? context.educationEditor !== null || context.educationSection !== null
        : context.additionalSections[section] !== undefined);
  const profile = context.profileEditor
    ? { shared: context.profileEditor.draft, translations: context.profileEditor.translationDraft }
    : context.previewDrafts.profile ?? context.sections.profile;
  const education = context.educationEditor?.draft
    ?? context.previewDrafts.education
    ?? context.educationSection
    ?? context.sections.education;
  const content = previewReady
    ? mapEditorSnapshotToResumeContent({ ...context.sections, ...context.previewDrafts, profile, education })
    : null;
  const confirmedProfile = context.profileEditor
    ? { shared: context.profileEditor.baseline, translations: context.profileEditor.translationBaseline }
    : context.sections.profile;
  const confirmedContent = previewReady ? mapEditorSnapshotToResumeContent({
    ...context.sections,
    profile: confirmedProfile,
    education: context.educationEditor?.baseline ?? context.sections.education,
  }) : null;
  const locale = context.previewLocale ?? uiLocale;
  const previewRouteTitle = ({ profile: "Profile", education: "Education", introduction: "Introduction", experience: "Experience", projects: "Projects", skills: "Skills", awards: "Awards", contact: "Contact", links: "Links & Site Text" } as const)[section];
  const statusMessage = section === "profile"
    ? context.profileLoadState === "error" ? t("Profile preview is unavailable because its data could not be loaded.") : t("Loading Profile preview…")
      : section === "education"
      ? context.educationLoadState === "error" ? t("Education preview is unavailable because its data could not be loaded.") : t("Loading Education preview…")
      : context.additionalRouteLoadState === "error" ? t(`${previewRouteTitle} preview is unavailable because its data could not be loaded.`) : t(`Loading ${previewRouteTitle} preview…`);

  return <div className="editor-preview-layout" data-preview-view={view}>
    <div className="editor-preview-toggle" role="group" aria-label={t("Editor or preview view")}>
      <button type="button" aria-pressed={view === "editor"} onClick={() => changeView("editor")}>{t("Editor")}</button>
      <button type="button" aria-pressed={view === "preview"} onClick={() => changeView("preview")}>{t("Preview")}</button>
    </div>
    <div className="editor-preview-pane">{children}</div>
    <ResumePreviewPanel content={content} confirmedContent={confirmedContent} bilingualReviews={Object.values(context.bilingualReviews)} section={section} locale={locale} statusMessage={statusMessage}
      preserveScroll={context.preservePreviewScroll && view === "preview"}
      onLocaleChange={context.setPreviewLocale} photoPreviewUrl={context.profilePhotoDraft?.objectUrl} />
  </div>;
}

function ReviewLocaleSwitch() {
  const context = useContext(EditorContext);
  const reviewLocales = [...new Set(Object.values(context.bilingualReviews).map(reminder => reminder.targetLocale))];
  return <UiLocaleSwitch reviewLocales={reviewLocales} />;
}

function Profile() {
  const { sections, resume, productionMode, profileResumeId, profileLoadState, onRetryProfile, repository, onProfileSaved, onProfileTranslationSaved, profileEditor, setProfileEditor, profileRequests, profilePhotoDraft, setProfilePhotoDraft, profilePhotoError, setProfilePhotoError, onProfilePhotoUrlChanged } = useContext(EditorContext);
  const { t } = useUiLocale();
  if (productionMode && profileEditor) return <ProductionProfile state={profileEditor} setState={setProfileEditor}
    requests={profileRequests} resumeId={profileResumeId ?? resume?.resumeId ?? ""} repository={repository}
    onSaved={onProfileSaved} onTranslationSaved={onProfileTranslationSaved} photoDraft={profilePhotoDraft}
    setPhotoDraft={setProfilePhotoDraft} photoError={profilePhotoError} setPhotoError={setProfilePhotoError}
    onPhotoUrlChanged={onProfilePhotoUrlChanged} />;
  if (productionMode) return <section className="page-section" aria-busy={profileLoadState === "loading"}>
    <div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t("Profile")}</h1>
      {profileLoadState === "loading" ? <p role="status">{t("Loading Profile…")}</p> : <div role="alert"><p>{t("Unable to load Profile.")}</p>
        <button type="button" className="button secondary" onClick={onRetryProfile ?? undefined}>{t("Retry")}</button></div>}
    </div>
  </section>;
  return <SectionForm<ProfileSection> section="profile" title="Profile" description="Edit the identity, shared details, and labels shown around the hero and footer." initial={sections.profile}>
    {(profile, onChange, confirmed) => <>
      <div className="panel"><h2>{t("Shared details")}</h2><p>{t("These values are the same in Chinese and English.")}</p>
        <SharedFields idPrefix="profile-shared" value={profile.shared} onChange={shared => onChange({ ...profile, shared })}
          fields={[{ key: "graduationValue", label: "Graduation value" }, { key: "avatarInitials", label: "Avatar initials" }, { key: "footerName", label: "Footer name" }, { key: "copyright", label: "Copyright" }]} />
      </div>
      <div className="panel"><h2>{t("Chinese and English profile")}</h2><BilingualFields idPrefix="profile" section="profile" itemId="profile" confirmed={confirmed.translations} value={profile.translations}
        onChange={translations => onChange({ ...profile, translations })}
        fields={[{ key: "name", label: "Name" }, { key: "navAboutLabel", label: "About navigation label" }, { key: "emailActionLabel", label: "Email action label" }, { key: "graduationLabel", label: "Graduation label" }, { key: "avatarLabel", label: "Avatar accessibility label" }, { key: "contactFocusHeading", label: "Current Focus heading" }, { key: "contactStatusHeading", label: "Current Status heading" }]} />
      </div>
    </>}
  </SectionForm>;
}

function ProductionProfile({ state, setState, requests, resumeId, repository, onSaved, onTranslationSaved, photoDraft, setPhotoDraft, photoError, setPhotoError, onPhotoUrlChanged }: {
  state: ProfileEditorState;
  setState: Dispatch<SetStateAction<ProfileEditorState | null>>;
  requests: ProfileRequests;
  resumeId: string;
  repository: ResumeRepository | null;
  onSaved: ((row: UpdatedProfileRow) => void) | null;
  onTranslationSaved: ((row: UpdatedProfileTranslationRow) => void) | null;
  photoDraft: ProfilePhotoDraft;
  setPhotoDraft: Dispatch<SetStateAction<ProfilePhotoDraft>>;
  photoError: string;
  setPhotoError: Dispatch<SetStateAction<string>>;
  onPhotoUrlChanged: (url: string | null) => void;
}) {
  const { t } = useUiLocale();
  const context = useContext(EditorContext);
  const sharedDirty = JSON.stringify(state.draft) !== JSON.stringify(state.baseline) || photoDraft !== null;
  const translationDirty: Record<Locale, boolean> = {
    zh: JSON.stringify(state.translationDraft.zh) !== JSON.stringify(state.translationBaseline.zh),
    en: JSON.stringify(state.translationDraft.en) !== JSON.stringify(state.translationBaseline.en),
  };
  const dirty = sharedDirty || translationDirty.zh || translationDirty.en;
  const saving = state.saving || state.translationSaving.zh || state.translationSaving.en;
  const [saveInFlight, setSaveInFlight] = useState(false);
  const saveLock = useRef(false);
  const [profileStatus, setProfileStatus] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!dirty && !translationDirty.zh && !translationDirty.en) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, translationDirty.zh, translationDirty.en]);

  async function saveShared(): Promise<boolean> {
    if (!repository || !onSaved || !sharedDirty || requests.shared) return false;
    requests.shared = true;
    setState(current => current ? { ...current, saving: true, notice: "", saveError: false } : current);
    try {
      let photoUrl = state.draft.photoUrl;
      if (photoDraft) {
        if (!repository.uploadProfilePhoto) throw new Error("Profile photo upload is unavailable.");
        photoUrl = photoDraft.uploadedUrl ?? await repository.uploadProfilePhoto(photoDraft.file);
        if (!photoDraft.uploadedUrl) {
          const uploadedUrl = photoUrl;
          setPhotoDraft(current => current?.file === photoDraft.file ? { ...current, uploadedUrl } : current);
        }
      }
      const confirmed = await repository.updateProfileSharedDetails(resumeId, { ...state.draft, photoUrl });
      setState(current => current ? { ...current, baseline: clone(confirmed.shared), draft: clone(confirmed.shared), notice: "Shared profile details saved to production.", saveError: false } : current);
      onSaved(confirmed);
      if (photoDraft) {
        URL.revokeObjectURL(photoDraft.objectUrl);
        onPhotoUrlChanged(null);
        setPhotoDraft(null);
        setPhotoError("");
      }
      return true;
    } catch {
      setState(current => current ? { ...current, saveError: true, notice: "Could not save shared profile details. Your edits are still here; please retry." } : current);
      return false;
    } finally {
      requests.shared = false;
      setState(current => current ? { ...current, saving: false } : current);
    }
  }

  async function saveTranslation(locale: Locale): Promise<boolean> {
    if (!repository || !onTranslationSaved || !translationDirty[locale] || requests.translations[locale]) return false;
    requests.translations[locale] = true;
    setState(current => current ? {
      ...current,
      translationSaving: { ...current.translationSaving, [locale]: true },
      translationNotices: { ...current.translationNotices, [locale]: null },
    } : current);
    const language = locale === "zh" ? "Chinese" : "English";
    try {
      const confirmed = await repository.updateProfileTranslation(resumeId, locale, state.translationDraft[locale]);
      context.onBilingualSave(collectChangedBilingualFieldKeys("profile", state.translationDraft, state.translationBaseline, [locale]));
      setState(current => current ? {
        ...current,
        translationBaseline: { ...current.translationBaseline, [locale]: clone(confirmed.translation) },
        translationDraft: { ...current.translationDraft, [locale]: clone(confirmed.translation) },
        translationNotices: { ...current.translationNotices, [locale]: { message: `${language} profile translation saved to production.`, error: false } },
      } : current);
      onTranslationSaved(confirmed);
      return true;
    } catch {
      setState(current => current ? {
        ...current,
        translationNotices: { ...current.translationNotices, [locale]: { message: `${language} profile translation was not saved. Your edits remain; please retry.`, error: true } },
      } : current);
      return false;
    } finally {
      requests.translations[locale] = false;
      setState(current => current ? { ...current, translationSaving: { ...current.translationSaving, [locale]: false } } : current);
    }
  }

  async function saveProfileChanges() {
    if (!dirty || saving || saveLock.current || !repository || !onSaved || !onTranslationSaved) return;
    saveLock.current = true;
    setSaveInFlight(true);
    setProfileStatus(null);
    const operations: Promise<boolean>[] = [];
    if (sharedDirty) operations.push(saveShared());
    if (translationDirty.zh) operations.push(saveTranslation("zh"));
    if (translationDirty.en) operations.push(saveTranslation("en"));
    try {
      const results = await Promise.all(operations);
      const savedCount = results.filter(Boolean).length;
      const failedCount = results.length - savedCount;
      if (failedCount === 0) setProfileStatus({ message: "Profile changes saved.", error: false });
      else if (savedCount > 0) setProfileStatus({ message: "Some Profile changes could not be saved. Saved changes are kept; remaining changes are still unsaved.", error: true });
      else setProfileStatus({ message: "Profile changes were not saved. Your edits remain; please retry.", error: true });
    } finally {
      saveLock.current = false;
      setSaveInFlight(false);
    }
  }

  function cancelProfileChanges() {
    if (saving || saveInFlight) return;
    context.onBilingualCancel(collectChangedBilingualFieldKeys("profile", state.translationDraft, state.translationBaseline, ["zh", "en"]));
    setState(current => current ? {
      ...current,
      draft: clone(current.baseline),
      translationDraft: clone(current.translationBaseline),
      notice: "", saveError: false,
      translationNotices: { zh: null, en: null },
    } : current);
    if (photoDraft) URL.revokeObjectURL(photoDraft.objectUrl);
    onPhotoUrlChanged(null);
    setPhotoDraft(null);
    setPhotoError("");
    setProfileStatus(null);
  }

  return <section className="page-section">
    <div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t("Profile")}</h1><p>{t("Edit the profile information shown across your resume.")}</p></div>
    <form className="editor-form profile-editor-form" onSubmit={event => { event.preventDefault(); void saveProfileChanges(); }}>
      <section className="panel profile-editor-section profile-shared-section">
        <h2>{t("Shared information")}</h2><p>{t("These details appear in both language versions of your resume.")}</p>
        <SharedFields idPrefix="profile-shared" value={state.draft} readOnly={saving || saveInFlight}
          onChange={shared => { setProfileStatus(null); setState(current => current ? { ...current, draft: shared, notice: "", saveError: false } : current); }}
          fields={[{ key: "graduationValue", label: "Graduation value" }, { key: "avatarInitials", label: "Avatar initials" }, { key: "footerName", label: "Footer name" }, { key: "copyright", label: "Copyright" }]} />
        <ProfilePhotoField currentUrl={state.draft.photoUrl} hasConfirmedPhoto={Boolean(state.baseline.photoUrl)} photoDraft={photoDraft} error={photoError} disabled={saving || saveInFlight}
          onSelect={file => {
            const error = validateProfilePhoto(file);
            if (error) { setPhotoError(error); return; }
            setProfileStatus(null);
            setPhotoError("");
            const objectUrl = URL.createObjectURL(file);
            if (photoDraft) URL.revokeObjectURL(photoDraft.objectUrl);
            onPhotoUrlChanged(objectUrl);
            setPhotoDraft({ file, objectUrl });
          }} onRemove={() => {
            if (photoDraft) URL.revokeObjectURL(photoDraft.objectUrl);
            setProfileStatus(null);
            onPhotoUrlChanged(null);
            setPhotoDraft(null);
            setPhotoError("");
            setState(current => current ? { ...current, draft: { ...current.draft, photoUrl: null }, notice: "", saveError: false } : current);
          }} />
      </section>
      <section className="panel profile-editor-section profile-editor-locale">
        <h2>{t("Profile content")}</h2><p>{t("Edit Chinese and English content side by side.")}</p>
        <BilingualFields showLocaleHeaders idPrefix="profile" section="profile" itemId="profile" confirmed={state.translationBaseline} value={state.translationDraft} readOnlyLocales={{ zh: saving || saveInFlight, en: saving || saveInFlight }}
          onChange={(next, locale) => {
            if (requests.translations[locale]) return;
            setProfileStatus(null);
            setState(current => current ? {
              ...current,
              translationDraft: { ...current.translationDraft, [locale]: next[locale] },
              translationNotices: { ...current.translationNotices, [locale]: null },
            } : current);
          }}
          fields={[{ key: "name", label: "Name" }, { key: "navAboutLabel", label: "About navigation label" }, { key: "emailActionLabel", label: "Email action label" }, { key: "graduationLabel", label: "Graduation label" }, { key: "avatarLabel", label: "Avatar accessibility label" }, { key: "contactFocusHeading", label: "Current Focus heading" }, { key: "contactStatusHeading", label: "Current Status heading" }]}
          />
      </section>
      <div className="save-bar">
        <span className={dirty ? "state-pill is-dirty" : "state-pill"}>{t(dirty ? "Unsaved changes" : "No unsaved changes")}</span>
        <div className="save-actions">
          <button type="button" className="button secondary" disabled={!dirty || saving || saveInFlight}
            onClick={cancelProfileChanges}>{t("Cancel changes")}</button>
          <button type="submit" className="button primary" disabled={!dirty || saving || saveInFlight || !repository || !onSaved || !onTranslationSaved}>
            {saving || saveInFlight ? t("Saving…") : t("Save profile changes")}
          </button>
        </div>
      </div>
      {profileStatus && <p className="save-notice profile-save-status" role={profileStatus.error ? "alert" : "status"} aria-live="polite">{t(profileStatus.message)}</p>}
    </form>
  </section>;
}

function ProfilePhotoField({ currentUrl, hasConfirmedPhoto, photoDraft, error, disabled, onSelect, onRemove }: {
  currentUrl: string | null; hasConfirmedPhoto: boolean; photoDraft: ProfilePhotoDraft; error: string; disabled: boolean; onSelect: (file: File) => void; onRemove: () => void;
}) {
  const { t } = useUiLocale();
  const previewUrl = photoDraft?.objectUrl ?? currentUrl;
  return <div className="profile-photo-field">
    <div className="profile-photo-field-preview">
      {previewUrl ? <img src={previewUrl} alt={t("Profile photo preview")} /> : <span>{t("No profile photo")}</span>}
    </div>
    <div className="profile-photo-field-controls">
      <h3>{t("Personal photo")}</h3>
      {photoDraft && <span>{t("Selected")}: {photoDraft.file.name}</span>}
      <label className="button secondary pdf-file-picker">{t(currentUrl || hasConfirmedPhoto || photoDraft ? "Replace profile photo" : "Choose profile photo")}
        <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label={t("Profile photo")}
          disabled={disabled} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) onSelect(file); event.currentTarget.value = ""; }} />
      </label>
      {hasConfirmedPhoto && <button type="button" className="button secondary" disabled={disabled} onClick={onRemove}>{t("Remove photo")}</button>}
      {error && <p role="alert" className="field-hint">{t(error)}</p>}
      <p className="field-hint">{t("JPG, PNG, or WebP; maximum 5 MB.")}</p>
    </div>
  </div>;
}

function Introduction() {
  const { locale } = useUiLocale();
  return <RepeatableSection<IntroItem> section="introduction" title="Introduction" description="Edit the Chinese and English introduction side by side."
    create={(id, position) => ({ id, position, translations: { zh: { text: "" }, en: { text: "" } } })}
    label={(_item, index) => `${locale === "zh" ? "简介段落" : "Introduction"} ${index + 1}`}
    render={(item, onChange, confirmed) => <BilingualFields showLocaleHeaders idPrefix={item.id} section="introduction" itemId={confirmed?.sourceKey ?? item.sourceKey ?? item.id} confirmed={confirmed?.translations} value={item.translations}
      onChange={translations => onChange({ ...item, translations })}
      fields={[{ key: "text", label: "Paragraph", multiline: true }]} />} />;
}

function Education() {
  const { resume, repository, productionMode, educationResumeId, educationLoadState, onRetryEducation, onEducationChanged, onReloadEducation, onEducationDeleted, educationEditor, setEducationEditor } = useContext(EditorContext);
  const { t } = useUiLocale();
  if (productionMode) {
    if (educationEditor && (educationResumeId || resume?.resumeId)) return <ProductionEducation resumeId={educationResumeId ?? resume!.resumeId} editor={educationEditor}
      setEditor={setEducationEditor} repository={repository} onEducationChanged={onEducationChanged} onReloadEducation={onReloadEducation} onEducationDeleted={onEducationDeleted} />;
    return <section className="page-section" aria-busy={educationLoadState === "loading"}><div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t("Education")}</h1>
      {educationLoadState === "loading" ? <p role="status">{t("Loading Education...")}</p> : <div role="alert"><p>{t("Unable to load Education.")}</p>
        <button type="button" className="button secondary" onClick={onRetryEducation ?? undefined}>{t("Retry")}</button></div>}
    </div></section>;
  }
  return <RepeatableSection<EducationItem> section="education" title="Education" description="Reorder entries, set a shared entry type, and edit both translations together."
    create={(id, position) => ({ id, sourceKey: null, position, entryType: "standard", translations: {
      zh: { title: "", program: "", period: "", grade: "", courseTitle: "", courseDescription: "" },
      en: { title: "", program: "", period: "", grade: "", courseTitle: "", courseDescription: "" },
    } })}
    label={item => item.translations.en.title || item.translations.zh.title}
    render={(item, onChange, confirmed) => <>
      <div className="shared-select"><label htmlFor={`${item.id}-entry-type`}>{t("Entry type (shared)")}</label><select id={`${item.id}-entry-type`} value={item.entryType}
        onChange={event => onChange({ ...item, entryType: event.target.value as EducationItem["entryType"] })}>
        <option value="standard">{t("Standard")}</option><option value="summerSchool">{t("Summer school")}</option>
      </select></div>
      <BilingualFields idPrefix={item.id} section="education" itemId={confirmed?.sourceKey ?? item.sourceKey ?? item.id} confirmed={confirmed?.translations} value={item.translations} onChange={translations => onChange({ ...item, translations })}
        fields={[{ key: "title", label: "Title" }, { key: "program", label: "Program" }, { key: "period", label: "Period" }, { key: "grade", label: "Grade" },
          ...(item.entryType === "summerSchool" ? [{ key: "courseTitle", label: "Course title" }, { key: "courseDescription", label: "Course description", multiline: true, readOnlyZh: true }] as const : [])]} />
    </>} />;
}

function ProductionEducation({ resumeId, editor, setEditor, repository, onEducationChanged, onReloadEducation, onEducationDeleted }: {
  resumeId: string; editor: EducationEditorState; setEditor: Dispatch<SetStateAction<EducationEditorState | null>>; repository: ResumeRepository | null;
  onEducationChanged: ((resumeId: string, education: EducationItem[]) => void) | null;
  onReloadEducation: (() => Promise<EducationItem[]>) | null; onEducationDeleted: ((resumeId: string, entryId: string) => void) | null;
}) {
  const { t } = useUiLocale();
  const context = useContext(EditorContext);
  const [openId, setOpenId] = useState<string | null>(editor.draft[0]?.id ?? null);
  const methodsReady = Boolean(repository?.updateEducationEntry && repository.updateEducationTranslation
    && repository.insertEducationEntry && repository.insertEducationTranslation && repository.readEducationTranslation && repository.deleteEducationEntry);
  const baselineById = new Map(editor.baseline.map(item => [item.id, item]));
  const dirty = editor.draft.some(item => !baselineById.has(item.id) || JSON.stringify(item) !== JSON.stringify(baselineById.get(item.id)))
    || editor.baseline.some(item => !editor.draft.some(draft => draft.id === item.id));
  const patchDraft = (id: string, change: (item: EducationItem) => EducationItem) => setEditor(current => current ? {
    ...current, draft: current.draft.map(item => item.id === id ? change(item) : item), notice: "", error: false,
  } : current);
  const reconcileBaselineEntry = (id: string, change: (item: EducationItem) => EducationItem) => setEditor(current => current ? {
    ...current, baseline: current.baseline.map(item => item.id === id ? change(item) : item),
  } : current);
  const saveChanges = async () => {
    if (!repository || !methodsReady || editor.saving) return;
    let confirmedParentCreated = false;
    setEditor(current => current ? { ...current, saving: true, notice: "", error: false } : current);
    try {
      let workingDraft = clone(editor.draft);
      let workingBaseline = clone(editor.baseline);
      const partialCreates = { ...editor.partialCreates };
      for (const original of workingDraft) {
        let item = workingDraft.find(value => value.id === original.id)!;
        let baseline = workingBaseline.find(value => value.id === item.id);
        let partial = partialCreates[item.id];
        if (!baseline && !partial) {
          const position = Math.max(-1, ...workingBaseline.map(value => value.position)) + 1;
          let parent: UpdatedEducationEntryRow;
          try { parent = await repository.insertEducationEntry!(resumeId, position, item.entryType); }
          catch (cause) {
            partialCreates[item.id] = { inserted: [], blocked: true };
            setEditor(current => current ? { ...current, partialCreates: { ...current.partialCreates, [item.id]: { inserted: [], blocked: true } } } : current);
            throw cause;
          }
          confirmedParentCreated = true;
          const oldId = item.id;
          item = { ...item, id: parent.entryId, position: parent.position, sourceKey: parent.sourceKey, entryType: parent.entryType };
          setOpenId(parent.entryId);
          workingDraft = workingDraft.map(value => value.id === oldId ? item : value);
          partialCreates[parent.entryId] = { inserted: [] };
          partial = partialCreates[parent.entryId];
          setEditor(current => current ? { ...current, draft: current.draft.map(value => value.id === oldId ? item : value), partialCreates: { ...current.partialCreates, [parent.entryId]: { inserted: [] } } } : current);
        }
        if (!baseline) {
          if (partial?.blocked) throw new Error("Parent creation was not confirmed. Verify production before discarding or retrying this local draft.");
          for (const locale of ["zh", "en"] as const) {
            let confirmed: UpdatedEducationTranslationRow | null = null;
            if (partial!.inserted.includes(locale)) continue;
            confirmed = await repository.readEducationTranslation!(resumeId, item.id, locale);
            if (!confirmed) {
              try {
                confirmed = await repository.insertEducationTranslation!(resumeId, item.id, locale, item.translations[locale]);
              } catch (cause) {
                // A response may be lost after the database committed. Read back before any retry.
                try { confirmed = await repository.readEducationTranslation!(resumeId, item.id, locale); }
                catch { /* The next explicit retry will read back before attempting another insert. */ }
                if (!confirmed) throw cause;
              }
            }
            if (confirmed) {
              item = { ...item, translations: { ...item.translations, [locale]: confirmed.translation } };
              partialCreates[item.id] = { inserted: [...new Set([...(partialCreates[item.id]?.inserted ?? []), locale])] };
              workingDraft = workingDraft.map(value => value.id === item.id ? item : value);
              setEditor(current => current ? { ...current, draft: current.draft.map(value => value.id === item.id ? item : value), partialCreates: { ...current.partialCreates, [item.id]: partialCreates[item.id] } } : current);
            }
          }
          const created = workingDraft.find(value => value.id === item.id) ?? item;
          workingBaseline = [...workingBaseline, clone(created)];
          delete partialCreates[item.id];
          setEditor(current => current ? { ...current, baseline: [...current.baseline.filter(value => value.id !== item.id), clone(created)], draft: current.draft.map(value => value.id === item.id ? clone(created) : value), partialCreates: Object.fromEntries(Object.entries(current.partialCreates).filter(([key]) => key !== item.id)) } : current);
          continue;
        }

        if (item.entryType !== baseline.entryType) {
          const confirmed = await repository.updateEducationEntry!(resumeId, item.id, { entryType: item.entryType });
          baseline = mergeEducationParent(baseline, confirmed);
          workingBaseline = workingBaseline.map(value => value.id === item.id ? baseline! : value);
          item = { ...item, entryType: confirmed.entryType, sourceKey: confirmed.sourceKey };
          workingDraft = workingDraft.map(value => value.id === item.id ? item : value);
          reconcileBaselineEntry(item.id, value => mergeEducationParent(value, confirmed));
        }
        for (const locale of ["zh", "en"] as const) {
          if (JSON.stringify(item.translations[locale]) === JSON.stringify(baseline.translations[locale])) continue;
          const confirmed = await repository.updateEducationTranslation!(resumeId, item.id, locale, item.translations[locale]);
          baseline = { ...baseline, translations: { ...baseline.translations, [locale]: confirmed.translation } };
          item = { ...item, translations: { ...item.translations, [locale]: confirmed.translation } };
          workingBaseline = workingBaseline.map(value => value.id === item.id ? baseline! : value);
          workingDraft = workingDraft.map(value => value.id === item.id ? item : value);
          reconcileBaselineEntry(item.id, value => ({ ...value, translations: { ...value.translations, [locale]: confirmed.translation } }));
          patchDraft(item.id, value => ({ ...value, translations: { ...value.translations, [locale]: confirmed.translation } }));
        }
      }
      const reordered = workingDraft.filter(item => workingBaseline.some(value => value.id === item.id));
      const currentOrder = [...workingBaseline].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(item => item.id);
      const desiredOrder = reordered.map(item => item.id);
      const orderChanged = desiredOrder.length !== currentOrder.length || desiredOrder.some((id, index) => id !== currentOrder[index]);
      if (orderChanged) {
        const maxPosition = Math.max(-1, ...workingBaseline.map(item => item.position));
        try {
          for (let index = 0; index < reordered.length; index++) {
            await repository.updateEducationEntry!(resumeId, reordered[index].id, { position: maxPosition + reordered.length + index + 1 });
          }
          for (let position = 0; position < reordered.length; position++) {
            await repository.updateEducationEntry!(resumeId, reordered[position].id, { position });
          }
        } catch (error) {
          let byId: Map<string, number>;
          try {
            if (!onReloadEducation) throw new Error("Education reload is unavailable");
            const authoritative = await onReloadEducation();
            byId = new Map(authoritative.map(value => [value.id, value.position]));
            const byCurrentId = new Map(authoritative.map(value => [value.id, value]));
            setEditor(current => {
              if (!current) return current;
              const currentDraftById = new Map(current.draft.map(value => [value.id, value]));
              const reconciled = authoritative.map(value => {
                const draft = currentDraftById.get(value.id);
                return draft ? { ...value, entryType: draft.entryType, translations: draft.translations } : value;
              });
              const localDrafts = current.draft.filter(value => !byCurrentId.has(value.id));
              return { ...current, baseline: authoritative, draft: [...reconciled, ...localDrafts] };
            });
          } catch (readError) {
            setEditor(current => current ? { ...current,
              notice: `Reorder was only partially applied and production order could not be refreshed. Retry after checking the current order. ${error instanceof Error ? error.message : ""} ${readError instanceof Error ? readError.message : ""}`,
              error: true,
            } : current);
            return;
          }
          setEditor(current => current ? {
            ...current,
            baseline: current.baseline.map(value => byId.has(value.id) ? { ...value, position: byId.get(value.id)! } : value),
            draft: current.draft.map(value => byId.has(value.id) ? { ...value, position: byId.get(value.id)! } : value),
            notice: `Reorder was only partially applied; the displayed order was refreshed from production. ${error instanceof Error ? error.message : "Retry the save."}`,
            error: true,
          } : current);
          return;
        }
        workingBaseline = workingBaseline.map(value => ({ ...value, position: reordered.findIndex(item => item.id === value.id) }));
        workingDraft = workingDraft.map(value => ({ ...value, position: reordered.findIndex(item => item.id === value.id) }));
      } else {
        workingDraft = workingDraft.map(value => {
          const confirmed = workingBaseline.find(item => item.id === value.id);
          return confirmed ? { ...value, position: confirmed.position } : value;
        });
      }
      workingBaseline.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      context.onBilingualSave(collectChangedBilingualFieldKeys("education", editor.draft, editor.baseline));
      setEditor(current => current ? { ...current, baseline: workingBaseline, draft: workingDraft, partialCreates,
        notice: "Education changes saved to production.", error: false } : current);
      onEducationChanged?.(resumeId, workingBaseline);
    } catch (cause) {
      if (confirmedParentCreated || Object.values(editor.partialCreates).some(value => !value.blocked)) {
        try { if (onReloadEducation) await onReloadEducation(); } catch { /* Keep the confirmed partial-create draft available for an explicit retry. */ }
      }
      const message = cause instanceof Error ? cause.message : "Education save failed. Retry after checking the production state.";
      setEditor(current => current ? { ...current, notice: message, error: true } : current);
    } finally {
      setEditor(current => current ? { ...current, saving: false } : current);
    }
  };
  const deleteEntry = async (id: string) => {
    const item = editor.draft.find(value => value.id === id);
    if (!item) return;
    const isPersisted = !id.startsWith("local-education-")
      && (editor.baseline.some(value => value.id === id) || Boolean(editor.partialCreates[id]));
    if (!isPersisted) {
      setEditor(current => current ? { ...current, draft: current.draft.filter(value => value.id !== id), partialCreates: Object.fromEntries(Object.entries(current.partialCreates).filter(([key]) => key !== id)), deleteTarget: null, notice: "Unsaved Education draft discarded.", error: false } : current);
      return;
    }
    if (!repository?.deleteEducationEntry || editor.deleting) return;
    setEditor(current => current ? { ...current, deleting: true, notice: "", error: false } : current);
    try {
      await repository.deleteEducationEntry(resumeId, id);
      setEditor(current => current ? { ...current, baseline: current.baseline.filter(value => value.id !== id), draft: current.draft.filter(value => value.id !== id), partialCreates: Object.fromEntries(Object.entries(current.partialCreates).filter(([key]) => key !== id)), deleteTarget: null, notice: "Education entry deleted from production.", error: false } : current);
      onEducationDeleted?.(resumeId, id);
    } catch (cause) {
      setEditor(current => current ? { ...current, notice: cause instanceof Error ? cause.message : "Education delete failed. Retry.", error: true } : current);
    } finally {
      setEditor(current => current ? { ...current, deleting: false } : current);
    }
  };
  const addEntry = () => {
    const position = editor.draft.length ? Math.max(...editor.draft.map(item => item.position)) + 1 : 0;
    const id = `local-education-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const blank: EducationItem = { id, sourceKey: null, position, entryType: "standard", translations: {
      zh: { title: "", program: "", period: "", grade: "", courseTitle: null, courseDescription: null },
      en: { title: "", program: "", period: "", grade: "", courseTitle: null, courseDescription: null },
    } };
    setEditor(current => current ? { ...current, draft: [...current.draft, blank], notice: "", error: false } : current);
    setOpenId(id);
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= editor.draft.length || editor.saving) return;
    const next = [...editor.draft]; [next[index], next[target]] = [next[target], next[index]];
    setEditor(current => current ? { ...current, draft: renumber(next), notice: "", error: false } : current);
  };
  const cancel = () => {
    context.onBilingualCancel(collectChangedBilingualFieldKeys("education", editor.draft, editor.baseline));
    setEditor(current => {
    if (!current) return current;
    const partialIds = new Set(Object.keys(current.partialCreates));
    const partialDrafts = current.draft.filter(item => partialIds.has(item.id));
    return { ...current, draft: [...clone(current.baseline), ...partialDrafts], notice: partialDrafts.length
      ? "Unsaved edits were reverted. Incomplete production-created entries remain visible so they can be completed or deleted."
      : "Changes reverted to the last confirmed production values.", error: partialDrafts.length > 0 };
    });
  };

  return <section className="page-section">
    <div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t("Education")}</h1><p>{t("Edit Chinese and English independently. Changes are written only when saved; reordering and deletion are explicit.")}</p></div>
    <div className="repeatable-group" aria-label="Education items">
      <div className="group-heading"><h2>{t("Education items")}</h2><button type="button" className="button secondary" onClick={addEntry} disabled={editor.saving}>{t("Add Education")}</button></div>
      {editor.draft.length === 0 && <p className="empty-note">{t("No items yet. Add one to start this section.")}</p>}
      <div className="item-stack">{editor.draft.map((item, index) => {
        const label = item.translations.en.title || item.translations.zh.title || t("New Education item");
        const isOpen = openId === item.id;
        const localOnly = item.id.startsWith("local-education-");
        const partial = editor.partialCreates[item.id];
        return <article className="item-card" key={item.id}>
          <div className="item-card-heading"><div><span className="item-number">{String(index + 1).padStart(2, "0")}</span><h3>{label}</h3></div>
            <div className="item-actions"><button type="button" onClick={() => setOpenId(isOpen ? null : item.id)} aria-label={`${isOpen ? t("Close editor for") : t("Edit")} ${label}`}>{isOpen ? t("Close") : t("Edit")}</button>
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0 || editor.saving} aria-label={`${t("Move")} ${label} ${t("up")}`}>↑</button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === editor.draft.length - 1 || editor.saving} aria-label={`${t("Move")} ${label} ${t("down")}`}>↓</button>
              <button type="button" className="danger-text" onClick={() => localOnly ? void deleteEntry(item.id) : setEditor(current => current ? { ...current, deleteTarget: item.id, notice: "", error: false } : current)} disabled={editor.saving || editor.deleting || Boolean(partial?.blocked)}>{localOnly ? t("Discard draft") : t("Delete")}</button>
            </div>
          </div>
          {editor.deleteTarget === item.id && <div className="panel" role="alertdialog" aria-label={`${t("Confirm delete")} ${label}`}>
            <p>{t("Delete this Education entry from production? This cannot be undone.")}</p>
            <div className="save-actions"><button type="button" className="button secondary" onClick={() => setEditor(current => current ? { ...current, deleteTarget: null } : current)} disabled={editor.deleting}>{t("Keep entry")}</button>
              <button type="button" className="button danger" onClick={() => void deleteEntry(item.id)} disabled={editor.deleting}>{editor.deleting ? t("Deleting…") : t("Confirm delete")}</button></div>
          </div>}
          {isOpen && <div className="item-card-body">
            {partial?.blocked && <p className="save-notice" role="alert">{t("Parent creation returned no confirmed row. Verify production manually before retrying this item.")}</p>}
            {partial && !partial.blocked && <p className="save-notice" role="status">{t("Production created the parent. Translation rows confirmed:")} {partial.inserted.join(", ") || t("none")}. {t("Save again to finish.")}</p>}
            <div className="shared-select"><label htmlFor={`${item.id}-entry-type`}>{t("Entry type (shared)")}</label><select id={`${item.id}-entry-type`} value={item.entryType} disabled={editor.saving}
              onChange={event => patchDraft(item.id, value => ({ ...value, entryType: event.target.value as EducationItem["entryType"] }))}>
              <option value="standard">{t("Standard")}</option><option value="summerSchool">{t("Summer school")}</option>
            </select></div>
            <BilingualFields idPrefix={item.id} section="education" itemId={baselineById.get(item.id)?.sourceKey ?? item.sourceKey ?? item.id} confirmed={baselineById.get(item.id)?.translations} value={item.translations} readOnlyAll={editor.saving}
              onChange={(translations, locale) => patchDraft(item.id, value => ({ ...value, translations: { ...value.translations, [locale]: translations[locale] } }))}
              fields={[{ key: "title", label: "Title" }, { key: "program", label: "Program" }, { key: "period", label: "Period" }, { key: "grade", label: "Grade" },
                ...(item.entryType === "summerSchool" ? [{ key: "courseTitle", label: "Course title" }, { key: "courseDescription", label: "Course description", multiline: true, readOnlyZh: true }] as const : [])]} />
          </div>}
        </article>;
      })}</div>
    </div>
    <p className="save-notice production-save-helper" role={editor.error ? "alert" : "status"} aria-live="polite">{t(editor.notice || (methodsReady ? "Education saves to production explicitly. Chinese and English remain separate." : "Education production writes are unavailable in this editor instance."))}</p>
    <div className="save-bar"><span className={dirty ? "state-pill is-dirty" : "state-pill"}>{dirty ? t("Unsaved changes") : t("No unsaved changes")}</span>
      <div className="save-actions"><button type="button" className="button secondary" onClick={cancel} disabled={!dirty || editor.saving}>{t("Cancel changes")}</button>
        <button type="button" className="button primary" onClick={() => void saveChanges()} disabled={!dirty || editor.saving || !methodsReady || Object.values(editor.partialCreates).some(value => value.blocked)}>{editor.saving ? t("Saving…") : t("Save Education changes")}</button></div>
    </div>
  </section>;
}

function mergeEducationParent(item: EducationItem, row: UpdatedEducationEntryRow): EducationItem {
  return { ...item, id: row.entryId, position: row.position, entryType: row.entryType, sourceKey: row.sourceKey };
}

function Experience() {
  return <RepeatableSection<ExperienceItem> section="experience" title="Experience" description="Descriptions retain their line breaks; the public resume renders them as bullets."
    create={(id, position) => ({ id, sourceKey: null, position, translations: {
      zh: { organization: "", title: "", period: "", description: "", location: null },
      en: { organization: "", title: "", period: "", description: "", location: null },
    } })}
    label={item => item.translations.en.organization || item.translations.zh.organization}
    render={(item, onChange, confirmed) => <BilingualFields idPrefix={item.id} section="experience" itemId={confirmed?.sourceKey ?? item.sourceKey ?? item.id} confirmed={confirmed?.translations} value={item.translations}
      onChange={translations => onChange({ ...item, translations })}
      fields={[{ key: "organization", label: "Organization" }, { key: "title", label: "Role" }, { key: "period", label: "Period" }, { key: "location", label: "Location" }, { key: "description", label: "Description", multiline: true }]} />} />;
}

function MethodFields({ locale, methods, confirmedMethods = [], onChange, idPrefix, projectId }: { locale: Locale; methods: ProjectMethod[]; confirmedMethods?: ProjectMethod[]; onChange: (items: ProjectMethod[]) => void; idPrefix: string; projectId: string }) {
  const { t } = useUiLocale();
  const context = useContext(EditorContext);
  const title = t(locale === "zh" ? "Chinese methods" : "English methods");
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= methods.length) return;
    const next = [...methods];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(renumber(next));
  };
  return <div className="method-group"><div className="group-heading"><h4>{title}</h4><button className="text-button" type="button" onClick={() => onChange([...methods, { id: `local-method-${Date.now()}-${methods.length}`, position: methods.length, value: "" }])}>{t("Add method")}</button></div>
    {methods.map((method, index) => {
      const identity = { section: "projects" as const, itemId: projectId, field: `method:${method.id}` };
      const review = context.bilingualReviews[bilingualFieldKey(identity, locale)];
      return <div className="method-row" key={method.id}>
      <InputField id={`${idPrefix}-${locale}-method-${method.id}`} label={`${title} ${index + 1}`} value={method.value}
        modified={confirmedMethods.find(value => value.id === method.id)?.value !== method.value}
        reviewLabel={review ? (locale === "zh" ? "Review Chinese" : "Review English") : undefined}
        onReviewConfirm={() => context.onBilingualReviewConfirm(identity, locale)}
        onChange={value => {
          context.onBilingualFieldEdit(identity, locale, value !== (confirmedMethods.find(entry => entry.id === method.id)?.value ?? ""));
          onChange(methods.map(entry => entry.id === method.id ? { ...entry, value } : entry));
        }} />
      <div className="method-actions"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${title} ${index + 1} up`}>↑</button>
        <button type="button" disabled={index === methods.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${title} ${index + 1} down`}>↓</button>
        <button type="button" onClick={() => onChange(renumber(methods.filter(entry => entry.id !== method.id)))} aria-label={`${t("Delete")} ${title} ${index + 1}`}>{t("Delete")}</button></div>
    </div>;
    })}
  </div>;
}

function Projects() {
  return <RepeatableSection<ProjectItem> section="projects" title="Projects" description="Edit bilingual project details and the ordered methods shown with each project."
    create={(id, position) => ({ id, sourceKey: null, position, translations: {
      zh: { title: "", subtitle: "", period: "", description: "", href: "" },
      en: { title: "", subtitle: "", period: "", description: "", href: "" },
    }, methods: { zh: [], en: [] } })}
    label={item => item.translations.en.title || item.translations.zh.title}
    render={(item, onChange, confirmed) => <>
      <BilingualFields idPrefix={item.id} section="projects" itemId={confirmed?.sourceKey ?? item.sourceKey ?? item.id} confirmed={confirmed?.translations} value={item.translations} onChange={translations => onChange({ ...item, translations })}
        fields={[{ key: "title", label: "Title" }, { key: "subtitle", label: "Subtitle" }, { key: "period", label: "Period" }, { key: "description", label: "Description", multiline: true }, { key: "href", label: "Project URL", type: "url" }]} />
      <div className="bilingual-grid methods-grid">{(["zh", "en"] as const).map(locale => <MethodFields key={locale} idPrefix={item.id} projectId={confirmed?.sourceKey ?? item.sourceKey ?? item.id} locale={locale}
        methods={item.methods[locale]} confirmedMethods={confirmed?.methods[locale]} onChange={methods => onChange({ ...item, methods: { ...item.methods, [locale]: methods } })} />)}</div>
    </>} />;
}

function Skills() {
  return <RepeatableSection<SkillItem> section="skills" title="Skills" description="Organize bilingual skill groups in the order they should appear."
    create={(id, position) => ({ id, sourceKey: null, position, translations: { zh: { title: "", items: "" }, en: { title: "", items: "" } } })}
    label={item => item.translations.en.title || item.translations.zh.title}
    render={(item, onChange, confirmed) => <BilingualFields idPrefix={item.id} section="skills" itemId={confirmed?.sourceKey ?? item.sourceKey ?? item.id} confirmed={confirmed?.translations} value={item.translations}
      onChange={translations => onChange({ ...item, translations })}
      fields={[{ key: "title", label: "Group title" }, { key: "items", label: "Skills" }]} />} />;
}

function Awards() {
  return <RepeatableSection<AwardItem> section="awards" title="Awards" description="Add, remove, and reorder recognitions while keeping both languages paired."
    create={(id, position) => ({ id, sourceKey: null, position, translations: { zh: { name: "", year: "" }, en: { name: "", year: "" } } })}
    label={item => item.translations.en.name || item.translations.zh.name}
    render={(item, onChange, confirmed) => <BilingualFields idPrefix={item.id} section="awards" itemId={confirmed?.sourceKey ?? item.sourceKey ?? item.id} confirmed={confirmed?.translations} value={item.translations}
      onChange={translations => onChange({ ...item, translations })}
      fields={[{ key: "name", label: "Award name" }, { key: "year", label: "Year" }]} />} />;
}

const contactCreateRecovery = new Map<string, { entryId?: string; confirmed: Locale[]; blocked?: boolean }>();
function recoveryKey(kind: "focus" | "status", resumeId: string, draftId: string) { return `${kind}:${resumeId}:${draftId}`; }

async function saveContactProduction(repository: ResumeRepository, resumeId: string, next: ContactSection, baseline: ContactSection): Promise<ContactSection> {
  const required = [repository.updateContactLabel, repository.updateFocusPosition, repository.insertFocus, repository.updateFocusTranslation, repository.insertFocusTranslation,
    repository.readFocusTranslation, repository.deleteFocus, repository.updateStatusPosition, repository.insertStatus, repository.updateStatusTranslation,
    repository.insertStatusTranslation, repository.readStatusTranslation, repository.deleteStatus, repository.updateStatusType];
  if (required.some(value => !value)) throw new Error("Contact production writes are unavailable.");
  const confirmed = structuredClone(next);
  for (const locale of ["zh", "en"] as const) {
    if (next.translations[locale].contactLabel !== baseline.translations[locale].contactLabel) await repository.updateContactLabel!(resumeId, locale, next.translations[locale].contactLabel);
    // Chinese availability remains read-only under the existing public-renderer limitation.
    if (locale === "en" && next.translations.en.availability !== baseline.translations.en.availability) {
      const method = repository.updateContactAvailability;
      if (!method) throw new Error("Contact availability production write is unavailable.");
      await method(resumeId, locale, next.translations.en.availability);
    }
  }
  const sync = async (kind: "focus" | "status") => {
    const before = kind === "focus" ? baseline.focus : baseline.status;
    const draft = kind === "focus" ? confirmed.focus : confirmed.status;
    for (const [key, recovery] of contactCreateRecovery) {
      if (!key.startsWith(`${kind}:${resumeId}:`)) continue;
      const temporaryId = key.slice(`${kind}:${resumeId}:`.length);
      if (draft.some(item => item.id === temporaryId)) continue;
      if (recovery.blocked) throw new Error("Parent creation was ambiguous; verify production before retrying.");
      if (recovery.entryId) { if (kind === "focus") await repository.deleteFocus!(resumeId, recovery.entryId); else await repository.deleteStatus!(resumeId, recovery.entryId); }
      contactCreateRecovery.delete(key);
    }
    const getText = (entry: FocusItem | StatusItem, locale: Locale) => entry.translations[locale];
    for (const old of before) if (!draft.some(item => item.id === old.id)) await (kind === "focus" ? repository.deleteFocus! : repository.deleteStatus!)(resumeId, old.id);
    const withId: (FocusItem | StatusItem)[] = [];
    for (const original of draft) {
      let entry = original;
      const key = recoveryKey(kind, resumeId, original.id);
      let recovery = contactCreateRecovery.get(key);
      if (!before.some(item => item.id === original.id)) {
        if (!recovery) { recovery = { confirmed: [] }; contactCreateRecovery.set(key, recovery); }
        if (recovery.blocked) throw new Error("Parent creation was ambiguous; verify production before retrying.");
        if (!recovery.entryId) {
          try {
            const parent = kind === "focus" ? await repository.insertFocus!(resumeId, original.position) : await repository.insertStatus!(resumeId, original.position, (original as StatusItem).statusType);
            recovery.entryId = parent.entryId;
          } catch (error) { recovery.blocked = true; throw error; }
        }
        entry = { ...original, id: recovery.entryId! };
        for (const locale of ["zh", "en"] as const) {
          if (recovery.confirmed.includes(locale)) continue;
          const existing = kind === "focus" ? await repository.readFocusTranslation!(resumeId, entry.id, locale) : await repository.readStatusTranslation!(resumeId, entry.id, locale);
          if (!existing) {
            if (kind === "focus") await repository.insertFocusTranslation!(resumeId, entry.id, locale, getText(entry, locale));
            else await repository.insertStatusTranslation!(resumeId, entry.id, locale, getText(entry, locale));
          }
          recovery.confirmed.push(locale);
        }
      } else {
        const old = before.find(item => item.id === entry.id)!;
        if (kind === "status" && (entry as StatusItem).statusType !== (old as StatusItem).statusType) await repository.updateStatusType!(resumeId, entry.id, (entry as StatusItem).statusType);
        for (const locale of ["zh", "en"] as const) if (JSON.stringify(getText(entry, locale)) !== JSON.stringify(getText(old, locale))) {
          if (kind === "focus") await repository.updateFocusTranslation!(resumeId, entry.id, locale, getText(entry, locale));
          else await repository.updateStatusTranslation!(resumeId, entry.id, locale, getText(entry, locale));
        }
      }
      withId.push(entry);
    }
    const sortedBefore = [...before].sort((a,b)=>a.position-b.position || a.id.localeCompare(b.id));
    const orderChanged = withId.some((item,index)=>item.id !== sortedBefore[index]?.id || item.position !== index) || withId.length !== before.length;
    if (orderChanged) {
      const updatePos = kind === "focus" ? repository.updateFocusPosition! : repository.updateStatusPosition!;
      const tempBase = Math.max(-1, ...before.map(item=>item.position), ...withId.map(item=>item.position)) + withId.length + 1;
      for (let index=0; index<withId.length; index++) await updatePos(resumeId, withId[index].id, tempBase+index);
      for (let index=0; index<withId.length; index++) { await updatePos(resumeId, withId[index].id, index); withId[index] = { ...withId[index], position:index }; }
    }
    if (kind === "focus") confirmed.focus = withId as FocusItem[]; else confirmed.status = withId as StatusItem[];
  };
  await sync("focus"); await sync("status");
  for (const key of contactCreateRecovery.keys()) if (key.startsWith(`focus:${resumeId}:`) || key.startsWith(`status:${resumeId}:`)) contactCreateRecovery.delete(key);
  return confirmed;
}

async function saveLinksProduction(repository: ResumeRepository, resumeId: string, next: LinksSection, baseline: LinksSection, pdfFiles: Partial<Record<Locale, File>> = {}): Promise<LinksSection> {
  if (!repository.updatePublicLinks || !repository.updateSiteText || !repository.updateNavigationLabel) throw new Error("Links & Site Text production writes are unavailable.");
  const shared: Partial<LinksSection["shared"]> = {};
  for (const key of Object.keys(next.shared) as (keyof LinksSection["shared"])[]) if (next.shared[key] !== baseline.shared[key]) shared[key] = next.shared[key];
  if (Object.keys(shared).length) await repository.updatePublicLinks(resumeId, shared);
  const confirmed = structuredClone(next);
  for (const locale of ["zh", "en"] as const) {
    const fields: Partial<LinksSection["translations"][Locale]> = {};
    for (const key of Object.keys(next.translations[locale]) as (keyof LinksSection["translations"][Locale])[]) if (next.translations[locale][key] !== baseline.translations[locale][key]) fields[key] = next.translations[locale][key];
    const file = pdfFiles[locale];
    if (file) {
      if (!repository.uploadResumePdf) throw new Error("Resume PDF upload is unavailable.");
      fields.portfolioHref = await repository.uploadResumePdf(locale, file);
      confirmed.translations[locale].portfolioHref = fields.portfolioHref;
    }
    if (Object.keys(fields).length) await repository.updateSiteText(resumeId, locale, fields);
  }
  for (const item of next.navigation) {
    const old = baseline.navigation.find(value=>value.id===item.id);
    if (!old || old.position !== item.position || old.sectionId !== item.sectionId || old.sourceKey !== item.sourceKey) throw new Error("Navigation structure is fixed; only labels may be edited.");
    for (const locale of ["zh", "en"] as const) if (item.translations[locale].label !== old.translations[locale].label) await repository.updateNavigationLabel(resumeId, item.id, locale, item.translations[locale].label);
  }
  if (next.navigation.length !== baseline.navigation.length) throw new Error("Navigation structure is fixed; only labels may be edited.");
  return confirmed;
}

function ResumePdfUpload({ locale, href, file, error, onSelect }: {
  locale: Locale; href: string; file?: File; error?: string; onSelect: (file?: File) => void;
}) {
  const { t } = useUiLocale();
  const language = locale === "zh" ? t("Chinese") : t("English");
  const currentName = href ? href.split(/[?#]/, 1)[0].split("/").filter(Boolean).at(-1) || href : "";
  return <div className="field pdf-upload-field">
    <span className="pdf-upload-label">{language} {t("Resume PDF")}</span>
    <div className="pdf-upload-status">
      {href ? <a href={href} target="_blank" rel="noreferrer">{t("Current PDF")}: {currentName}</a> : <span>{t("No PDF uploaded")}</span>}
      {file && <span className="pdf-selected-name">{t("Selected")}: {file.name}</span>}
      <label className="button secondary pdf-file-picker">{t("Select PDF")}
        <input type="file" accept="application/pdf,.pdf" aria-label={`${language} ${t("Resume PDF")}`}
          onChange={event => { onSelect(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
      </label>
    </div>
    {error && <p className="field-hint pdf-upload-error" role="alert">{t(error)}</p>}
  </div>;
}

function Contact() {
  const context = useContext(EditorContext);
  const { sections } = context;
  const { t } = useUiLocale();
  return <SectionForm<ContactSection> section="contact" title="Contact" description="Manage public contact text, Current Focus, and Current Status."
    initial={sections.contact} productionSave={context.repository && context.additionalResumeId ? (draft, baseline) => saveContactProduction(context.repository!, context.additionalResumeId!, draft, baseline) : undefined}>
    {(contact, onChange, confirmed) => <>
      <div className="panel"><h2>{t("Contact text")}</h2><BilingualFields idPrefix="contact" section="contact" itemId="contact" confirmed={confirmed.translations} value={contact.translations}
        onChange={translations => onChange({ ...contact, translations })}
        fields={[{ key: "contactLabel", label: "Section label" }, { key: "availability", label: "Availability", multiline: true, readOnlyZh: true }]} />
        <p className="limitation-note">{t("Chinese availability is not editable in the first CMS release because the public page uses fixed phrase-specific markup.")}</p>
      </div>
      <div className="panel"><RepeatableList groupLabel="Current Focus" items={contact.focus} confirmedItems={confirmed.focus}
        onChange={focus => onChange({ ...contact, focus })}
        onConfirmedDelete={id => onChange({ ...contact, focus: renumber(contact.focus.filter(item => item.id !== id)) })}
        create={(id, position): FocusItem => ({ id, position, translations: { zh: { title: "", detail: "" }, en: { title: "", detail: "" } } })}
        label={item => item.translations.en.title || item.translations.zh.title}
        render={(item, change, base) => <BilingualFields idPrefix={item.id} section="contact" itemId={item.id} confirmed={base?.translations} value={item.translations}
          onChange={translations => change({ ...item, translations })}
          fields={[{ key: "title", label: "Focus title" }, { key: "detail", label: "Detail" }]} />} /></div>
      <div className="panel"><RepeatableList groupLabel="Current Status" items={contact.status} confirmedItems={confirmed.status}
        onChange={status => onChange({ ...contact, status })}
        onConfirmedDelete={id => onChange({ ...contact, status: renumber(contact.status.filter(item => item.id !== id)) })}
        create={(id, position): StatusItem => ({ id, position, statusType: "open", translations: { zh: { title: "", detail: "" }, en: { title: "", detail: "" } } })}
        label={item => item.translations.en.title || item.translations.zh.title}
        render={(item, change, base) => <>
          <div className="shared-select"><label htmlFor={`${item.id}-status-type`}>{t("Status type (shared)")}</label><select id={`${item.id}-status-type`} value={item.statusType}
            onChange={event => change({ ...item, statusType: event.target.value as StatusItem["statusType"] })}>
            <option value="study">{t("Study")}</option><option value="graduation">{t("Graduation")}</option><option value="open">{t("Open")}</option>
          </select></div>
          <BilingualFields idPrefix={item.id} section="contact" itemId={item.id} confirmed={base?.translations} value={item.translations} onChange={translations => change({ ...item, translations })}
            fields={[{ key: "title", label: "Status title" }, { key: "detail", label: "Detail" }]} />
        </>} /></div>
    </>}
  </SectionForm>;
}

function Links() {
  const context = useContext(EditorContext);
  const { sections } = context;
  const { t } = useUiLocale();
  const { pdfFiles, setPdfFiles, pdfErrors, setPdfErrors } = context;
  const selectPdf = (locale: Locale, file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setPdfFiles(current => ({ ...current, [locale]: undefined }));
      setPdfErrors(current => ({ ...current, [locale]: "Resume PDF must be a PDF file." }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPdfFiles(current => ({ ...current, [locale]: undefined }));
      setPdfErrors(current => ({ ...current, [locale]: "Resume PDF must be 10 MB or smaller." }));
      return;
    }
    setPdfFiles(current => ({ ...current, [locale]: file }));
    setPdfErrors(current => ({ ...current, [locale]: undefined }));
  };
  const clearPdfDrafts = () => { setPdfFiles({}); setPdfErrors({}); };
  return <SectionForm section="links" title="Links & Site Text" description="Edit shared contact links, locale-specific public labels and URLs, and the five fixed navigation labels." initial={sections.links}
    productionDirty={Boolean(pdfFiles.zh || pdfFiles.en)} onProductionCancel={clearPdfDrafts} onProductionSaved={clearPdfDrafts}
    productionSave={context.repository && context.additionalResumeId ? (draft, baseline) => saveLinksProduction(context.repository!, context.additionalResumeId!, draft, baseline, pdfFiles) : undefined}>
    {(links, onChange, confirmed) => <>
      <div className="panel"><h2>{t("Shared public links")}</h2><SharedFields idPrefix="links-shared" value={links.shared}
        onChange={shared => onChange({ ...links, shared })}
        fields={[{ key: "email", label: "Email address", type: "email" }, { key: "github", label: "GitHub URL", type: "url" }, { key: "githubLabel", label: "GitHub label" }, { key: "linkedInDisplayName", label: "LinkedIn display name" }, { key: "emailLabel", label: "Email label" }, { key: "linkedInLabel", label: "LinkedIn action label" }]} /></div>
      <div className="panel"><h2>{t("Localized links and headings")}</h2><BilingualFields idPrefix="links-localized" section="links" itemId="links" confirmed={confirmed.translations} value={links.translations}
        onChange={translations => onChange({ ...links, translations })}
        footer={locale => <ResumePdfUpload locale={locale} href={links.translations[locale].portfolioHref} file={pdfFiles[locale]} error={pdfErrors[locale]} onSelect={file => selectPdf(locale, file)} />}
        fields={[{ key: "portfolioLabel", label: "Resume PDF label" }, { key: "linkedInHref", label: "LinkedIn URL", type: "url" }, { key: "linkedInLabel", label: "LinkedIn text" }, { key: "kaggleLabel", label: "Project link label" }, { key: "updatedAtLabel", label: "Updated date label" }, { key: "educationLabel", label: "Education heading" }, { key: "experienceLabel", label: "Experience heading" }, { key: "projectHeading", label: "Projects heading" }, { key: "skillsLabel", label: "Skills heading" }, { key: "honorsLabel", label: "Awards heading" }]} /></div>
      <div className="panel"><h2>{t("Navigation labels")}</h2><p>{t("The five destinations are fixed in the public page. Only their bilingual labels are editable here.")}</p>
        <div className="navigation-labels">{links.navigation.map(item => <div className="navigation-label-row" key={item.id}><strong>{item.sectionId}</strong>
          <BilingualFields idPrefix={item.id} section="links" itemId={item.id} confirmed={confirmed.navigation.find(value => value.id === item.id)?.translations} value={item.translations} fields={[{ key: "label", label: "Navigation label" }]}
            onChange={translations => onChange({ ...links, navigation: links.navigation.map(current => current.id === item.id ? { ...current, translations } : current) })} />
        </div>)}</div>
      </div>
    </>}
  </SectionForm>;
}

function NotFound() { const { t } = useUiLocale(); return <section className="page-section"><div className="page-heading"><h1>{t("Section not found")}</h1><p>{t("Choose a CMS section from the navigation.")}</p><Link to="/overview">{t("Return to Overview")}</Link></div></section>; }

export function App({ identityEmail, onSignOut, signOutPending, signOutError, resume = null, repository = null,
  productionMode = resume !== null, profileSection = null, profileResumeId = null,
  overviewData = null, overviewSiteMetadata = null, overviewLoadState = "loading", overviewRouteFirst = false, onRetryOverview = null,
  educationSection = null, educationResumeId = null, educationLoadState = "loading", onRetryEducation = null,
  onEducationChanged = null, onReloadEducation = null, onEducationDeleted = null,
  additionalSections = {}, additionalRouteKey = null, additionalRouteFirst = false, additionalRouteLoadState = "loading", onRetryAdditionalRoute = null, additionalResumeId = null, onAdditionalChanged = null, onReloadAdditional = null,
  profileLoadState = "loading", onRetryProfile = null, fullSnapshotState = "idle", onRetryFullSnapshot = null,
  onProfileSaved = null, onProfileTranslationSaved = null }: {
  identityEmail: string | null;
  onSignOut: () => void;
  signOutPending: boolean;
  signOutError: string;
  resume?: LoadedResume | null;
  overviewData?: OverviewResumeData | null;
  overviewSiteMetadata?: ResumeSiteMetadata | null;
  overviewLoadState?: "loading" | "error";
  overviewRouteFirst?: boolean;
  onRetryOverview?: (() => void) | null;
  productionMode?: boolean;
  profileSection?: ProfileSection | null;
  profileResumeId?: string | null;
  profileLoadState?: "loading" | "error";
  onRetryProfile?: (() => void) | null;
  educationSection?: EducationItem[] | null;
  educationResumeId?: string | null;
  educationLoadState?: "loading" | "error";
  onRetryEducation?: (() => void) | null;
  onEducationChanged?: ((resumeId: string, education: EducationItem[]) => void) | null;
  onReloadEducation?: (() => Promise<EducationItem[]>) | null;
  onEducationDeleted?: ((resumeId: string, entryId: string) => void) | null;
  additionalSections?: Partial<Pick<EditorSections, "introduction" | "experience" | "projects" | "skills" | "awards" | "contact" | "links">>;
  additionalRouteKey?: "introduction" | "experience" | "projects" | "skills" | "awards" | "contact" | "links" | null;
  additionalRouteFirst?: boolean;
  additionalRouteLoadState?: "loading" | "error";
  onRetryAdditionalRoute?: (() => void) | null;
  additionalResumeId?: string | null;
  onAdditionalChanged?: ((section: SectionKey, resumeId: string, value: unknown) => void) | null;
  onReloadAdditional?: ((section: EditableRepeatableSection) => Promise<EditableSectionItem[]>) | null;
  fullSnapshotState?: "idle" | "loading" | "error";
  onRetryFullSnapshot?: (() => void) | null;
  repository?: ResumeRepository | null;
  onProfileSaved?: ((row: UpdatedProfileRow) => void) | null;
  onProfileTranslationSaved?: ((row: UpdatedProfileTranslationRow) => void) | null;
}) {
  const { t } = useUiLocale();
  const location = useLocation();
  const navigationType = useNavigationType();
  const initialPathname = useRef(location.pathname);
  const isDocumentReload = useRef(isDocumentReloadNavigation()).current;
  const restoredScrollIdentity = useRef<string | null>(null);
  const drafts = useRef(new Map<SectionKey, unknown>());
  const [previewDrafts, setPreviewDrafts] = useState<PreviewDrafts>({});
  const [previewLocale, setPreviewLocale] = useState<Locale | null>(null);
  const onPreviewDraftChanged = useCallback((section: PreviewSection, value: PreviewDraftValue) => {
    setPreviewDrafts(current => {
      if (JSON.stringify(current[section]) === JSON.stringify(value)) return current;
      return { ...current, [section]: clone(value) } as PreviewDrafts;
    });
  }, []);
  const sections: EditorSections = { ...(resume?.sections ?? fixtureSections), ...additionalSections };
  const initialProfile = profileSection ?? resume?.sections.profile ?? null;
  const [profileEditor, setProfileEditor] = useState<ProfileEditorState | null>(() => initialProfile ? initialProfileEditorState(initialProfile) : null);
  const profileInitialized = useRef(initialProfile !== null);
  const [educationEditor, setEducationEditor] = useState<EducationEditorState | null>(() => {
    const initialEducation = educationSection ?? resume?.sections.education ?? null;
    return initialEducation ? initialEducationEditorState(initialEducation) : null;
  });
  const educationInitialized = useRef(educationSection !== null || resume !== null);
  const profileRequests = useRef<ProfileRequests>({ shared: false, translations: { zh: false, en: false } }).current;
  const [pdfFiles, setPdfFiles] = useState<Partial<Record<Locale, File>>>({});
  const [pdfErrors, setPdfErrors] = useState<Partial<Record<Locale, string>>>({});
  const [profilePhotoDraft, setProfilePhotoDraft] = useState<ProfilePhotoDraft>(null);
  const [profilePhotoError, setProfilePhotoError] = useState("");
  const [bilingualReviews, setBilingualReviews] = useState<Record<string, BilingualReviewReminder>>({});
  const onBilingualFieldEdit = useCallback((identity: BilingualFieldIdentity, locale: Locale, modified: boolean) => {
    const ownKey = bilingualFieldKey(identity, locale);
    const targetLocale: Locale = locale === "zh" ? "en" : "zh";
    const targetKey = bilingualFieldKey(identity, targetLocale);
    setBilingualReviews(current => {
      const next = { ...current };
      const wasReviewTarget = Boolean(next[ownKey]);
      const existingSourceReminder = next[targetKey]?.sourceLocale === locale ? next[targetKey] : undefined;
      delete next[ownKey];
      if (modified && !wasReviewTarget) next[targetKey] = { ...identity, sourceLocale: locale, targetLocale, sourceSaved: existingSourceReminder?.sourceSaved ?? false };
      else if (!modified && existingSourceReminder && !existingSourceReminder.sourceSaved) delete next[targetKey];
      return next;
    });
  }, []);
  const onBilingualReviewConfirm = useCallback((identity: BilingualFieldIdentity, locale: Locale) => {
    const key = bilingualFieldKey(identity, locale);
    setBilingualReviews(current => { if (!current[key]) return current; const next = { ...current }; delete next[key]; return next; });
  }, []);
  const onBilingualCancel = useCallback((changedKeys: Set<string>) => {
    if (!changedKeys.size) return;
    setBilingualReviews(current => {
      let changed = false;
      const next = { ...current };
      for (const [key, reminder] of Object.entries(next)) {
        if (!reminder.sourceSaved && changedKeys.has(bilingualFieldKey(reminder, reminder.sourceLocale))) { delete next[key]; changed = true; }
      }
      return changed ? next : current;
    });
  }, []);
  const onBilingualSave = useCallback((changedKeys: Set<string>) => {
    if (!changedKeys.size) return;
    setBilingualReviews(current => {
      let changed = false;
      const next = { ...current };
      for (const [key, reminder] of Object.entries(next)) {
        if (!reminder.sourceSaved && changedKeys.has(bilingualFieldKey(reminder, reminder.sourceLocale))) {
          next[key] = { ...reminder, sourceSaved: true };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);
  const profilePhotoObjectUrl = useRef<string | null>(null);
  const onProfilePhotoUrlChanged = useCallback((url: string | null) => { profilePhotoObjectUrl.current = url; }, []);
  useEffect(() => () => {
    if (profilePhotoObjectUrl.current) URL.revokeObjectURL(profilePhotoObjectUrl.current);
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const profile = profileSection ?? resume?.sections.profile ?? null;
    if (!profileInitialized.current && profile) {
      profileInitialized.current = true;
      setProfileEditor(initialProfileEditorState(profile));
    }
  }, [profileSection, resume]);
  useEffect(() => {
    const education = educationSection ?? resume?.sections.education ?? null;
    if (!educationInitialized.current && education) {
      educationInitialized.current = true;
      setEducationEditor(initialEducationEditorState(education));
    }
  }, [educationSection, resume]);
  useEffect(() => {
    if (!menuOpen) return;
    firstLink.current?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); }
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [menuOpen]);
  const isOverviewRoute = location.pathname === "/" || location.pathname === "/overview";
  const showOverviewRouteState = productionMode && overviewRouteFirst && isOverviewRoute && !resume && !overviewData;
  const showFullSnapshotState = productionMode && !resume && location.pathname !== "/profile" && location.pathname !== "/education" && !additionalRouteFirst && !(isOverviewRoute && overviewRouteFirst);
  const showAdditionalRouteState = productionMode && additionalRouteFirst && additionalRouteKey !== null && !resume && !additionalSections[additionalRouteKey];
  const additionalRouteTitle = additionalRouteKey ? ({ introduction: "Introduction", experience: "Experience", projects: "Projects", skills: "Skills", awards: "Awards", contact: "Contact", links: "Links & Site Text" } as const)[additionalRouteKey] : "";
  const additionalLoadingText = additionalRouteKey ? ({ introduction: "Loading Introduction...", experience: "Loading Experience...", projects: "Loading Projects...", skills: "Loading Skills...", awards: "Loading Awards...", contact: "Loading Contact...", links: "Loading Links & Site Text..." } as const)[additionalRouteKey] : "";
  const additionalErrorText = additionalRouteKey ? ({ introduction: "Unable to load Introduction.", experience: "Unable to load Experience.", projects: "Unable to load Projects.", skills: "Unable to load Skills.", awards: "Unable to load Awards.", contact: "Unable to load Contact.", links: "Unable to load Links & Site Text." } as const)[additionalRouteKey] : "";
  const previewRouteByPath: Partial<Record<string, PreviewSection>> = {
    "/profile": "profile", "/education": "education", "/introduction": "introduction",
    "/experience": "experience", "/projects": "projects", "/skills": "skills", "/awards": "awards", "/contact": "contact", "/links": "links",
  };
  const previewSection = previewRouteByPath[location.pathname];
  const isPreviewRoute = previewSection !== undefined;
  const routeDataReady = !productionMode || resume !== null || fullSnapshotState === "error"
    || (isOverviewRoute && (overviewData !== null || overviewLoadState === "error"))
    || (location.pathname === "/profile" && (profileEditor !== null || profileLoadState === "error"))
    || (location.pathname === "/education" && (educationEditor !== null || educationLoadState === "error"))
    || (additionalRouteKey !== null && (additionalSections[additionalRouteKey] !== undefined || additionalRouteLoadState === "error"));

  const preservePreviewScroll = Boolean(isDocumentReload && location.pathname === initialPathname.current
    && navigationType === "POP" && previewSection && readPreviewMode(previewSection) === "preview"
    && readStoredScrollPosition(location.pathname, "preview") !== null);

  useLayoutEffect(() => {
    const pathname = location.pathname;
    const documentOwner = getDocumentScrollOwner();
    if (!documentOwner) return;

    const isInitialRefreshRoute = isDocumentReload && pathname === initialPathname.current && navigationType === "POP";
    let previewOwner = previewSection
      ? document.querySelector<HTMLElement>("[data-preview-scroll-owner]")
      : null;
    let cancelPendingRestoration: (() => void) | null = null;
    const currentMode = () => previewSection ? readPreviewMode(previewSection) : "editor";
    const currentOwnerPosition = (mode: "editor" | "preview") => mode === "preview"
      ? (document.querySelector<HTMLElement>("[data-preview-scroll-owner]")?.scrollTop ?? 0)
      : Math.max(window.scrollY, documentOwner.scrollTop);
    const currentGeometry = () => ({
      documentScrollTop: Math.max(window.scrollY, documentOwner.scrollTop),
      documentScrollHeight: documentOwner.scrollHeight,
      documentClientHeight: documentOwner.clientHeight,
      previewScrollTop: document.querySelector<HTMLElement>("[data-preview-scroll-owner]")?.scrollTop ?? null,
      previewScrollHeight: document.querySelector<HTMLElement>("[data-preview-scroll-owner]")?.scrollHeight ?? null,
      previewClientHeight: document.querySelector<HTMLElement>("[data-preview-scroll-owner]")?.clientHeight ?? null,
    });
    const onRefreshIntent = (event: KeyboardEvent) => {
      const refreshKey = ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r")
        || event.key === "F5" || event.key === "BrowserRefresh";
      if (!refreshKey) return;
      const mode = currentMode();
      const position = currentOwnerPosition(mode);
      const storedBeforeShortcut = readStoredScrollPosition(pathname, mode);
      const frozenPosition = freezeScrollSnapshot(pathname, mode, position, `keyboard:${event.key}`);
      diagnoseRefreshScroll("refresh-shortcut", {
        pathname, mode, key: event.key, positionBeforeRefresh: position,
        storedBeforeShortcut, frozenPosition, ...currentGeometry(),
      });
    };
    const onNonKeyboardReload = (event: Event) => {
      const mode = currentMode();
      const stored = freezeExistingScrollSnapshot(pathname, mode, event.type);
      diagnoseRefreshScroll("non-keyboard-reload", { pathname, mode, event: event.type, stored, ...currentGeometry() });
    };
    const onBfcachePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resumeScrollSnapshotAfterBfcache(pathname, currentMode());
    };
    window.addEventListener("keydown", onRefreshIntent, true);
    window.addEventListener("beforeunload", onNonKeyboardReload);
    window.addEventListener("pagehide", onNonKeyboardReload);
    window.addEventListener("pageshow", onBfcachePageShow);
    const persistUserPosition = (mode: "editor" | "preview", position: number) => {
      const frozen = isScrollSnapshotFrozen(pathname, mode);
      if (frozen) {
        diagnoseRefreshScroll("user-scroll-write-blocked", { pathname, mode, position, frozen: true });
        return;
      }
      // Once the user starts a genuine scroll gesture, that newer position owns
      // the route/mode. Do not let a still-unreachable bootstrap target apply
      // later over the user's movement.
      cancelPendingRestoration?.();
      diagnoseRefreshScroll("authorized-user-scroll-write", { pathname, mode, position, frozen });
      writeStoredScrollPosition(pathname, mode, position);
    };
    const stopDocumentSaving = observeUserScroll(window, position => persistUserPosition("editor", position), {
      ignoreIntent: event => Boolean(previewOwner && event.target instanceof Node && previewOwner.contains(event.target)),
      onScrollEvent: (position, authorizedByInput) => diagnoseRefreshScroll("document-scroll-event", {
        pathname, mode: currentMode(), position, authorizedByInput, frozen: isScrollSnapshotFrozen(pathname, currentMode()), ...currentGeometry(),
      }),
    });
    let stopPreviewSaving = previewOwner
      ? observeUserScroll(previewOwner, position => persistUserPosition("preview", position), {
        onScrollEvent: (position, authorizedByInput) => diagnoseRefreshScroll("preview-scroll-event", {
          pathname, mode: "preview", position, authorizedByInput, frozen: isScrollSnapshotFrozen(pathname, "preview"), ...currentGeometry(),
        }),
      })
      : () => {};

    const mode = previewSection ? readPreviewMode(previewSection) : "editor";
    const identity = `${pathname}:${mode}`;
    const target = isInitialRefreshRoute ? readStoredScrollPosition(pathname, mode) : null;
    if (isInitialRefreshRoute) diagnoseRefreshScroll("restoration-target-read", {
      pathname, mode, target, key: `${UI_RESTORE_STORAGE_PREFIX}scroll:${pathname}:${mode}`, ...currentGeometry(),
    });
    if (!isInitialRefreshRoute || target === null || !routeDataReady || restoredScrollIdentity.current === identity) {
      return () => {
        window.removeEventListener("keydown", onRefreshIntent, true);
        window.removeEventListener("beforeunload", onNonKeyboardReload);
        window.removeEventListener("pagehide", onNonKeyboardReload);
        window.removeEventListener("pageshow", onBfcachePageShow);
        stopDocumentSaving(); stopPreviewSaving();
      };
    }

    let restorationPending = true;
    let restoreFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let stopRestorationSignals = () => {};
    let documentLoaded = document.readyState === "complete";
    // The native viewport restore may run between load and pageshow. Keep the
    // custom pass behind both events so it cannot finish and then be replaced.
    let pageShown = documentLoaded;
    let fontsLoaded = !document.fonts || document.fonts.status === "loaded";
    let previousGeometry = "";
    let stableFrames = 0;
    const observedElements = new Set<Element>();
    const maximumAllowedDifference = 2;
    const getOwner = () => mode === "preview" ? previewOwner : documentOwner;
    const currentPosition = () => mode === "preview" ? (previewOwner?.scrollTop ?? 0) : Math.max(documentOwner.scrollTop, window.scrollY);
    const observeElement = (element: Element | null) => {
      if (!element || observedElements.has(element)) return;
      observedElements.add(element);
      resizeObserver?.observe(element);
    };
    const unobserveElement = (element: Element | null) => {
      if (!element || !observedElements.has(element)) return;
      observedElements.delete(element);
      resizeObserver?.unobserve(element);
    };
    const currentStage = () => previewOwner?.querySelector<HTMLElement>(".resume-preview-stage") ?? null;
    const hasLoadedImages = () => {
      const owner = getOwner();
      if (!owner) return false;
      return Array.from(owner.querySelectorAll("img")).every(image => (image as HTMLImageElement).complete);
    };
    let assetsLoaded = hasLoadedImages();
    const isLayoutReady = () => routeDataReady && documentLoaded && pageShown && fontsLoaded && assetsLoaded && hasLoadedImages();
    const finishRestore = () => {
      restorationPending = false;
      cancelPendingRestoration = null;
      restoredScrollIdentity.current = identity;
      resizeObserver?.disconnect();
      resizeObserver = null;
      mutationObserver?.disconnect();
      mutationObserver = null;
      observedElements.clear();
      if (restoreFrame) window.cancelAnimationFrame(restoreFrame);
      stopRestorationSignals();
    };
    cancelPendingRestoration = finishRestore;
    const attemptRestore = () => {
      if (!restorationPending) return;
      const owner = getOwner();
      if (!isLayoutReady() || !owner) return;
      const maximum = Math.max(0, owner.scrollHeight - owner.clientHeight);
      // Never clamp to a bootstrap layout. The saved offset must be physically
      // reachable by this route/mode's own scroll container before completion.
      if (maximum + maximumAllowedDifference < target) { stableFrames = 0; previousGeometry = ""; return; }
      owner.scrollTop = target;
      if (mode === "editor" && Math.abs(currentPosition() - target) > maximumAllowedDifference) window.scrollTo(0, target);
      const actual = currentPosition();
      diagnoseRefreshScroll("restoration-applied", { pathname, mode, target, actual, ...currentGeometry() });
      if (Math.abs(actual - target) > maximumAllowedDifference) { stableFrames = 0; previousGeometry = ""; return; }

      // Keep observing through a pair of stable rendered frames. Resize, font,
      // image, or React content changes reset this check rather than allowing
      // the first transiently reachable layout to win.
      const geometry = `${owner.scrollHeight}:${owner.clientHeight}:${actual}`;
      if (geometry === previousGeometry) stableFrames += 1;
      else { previousGeometry = geometry; stableFrames = 1; }
      if (stableFrames >= 2) { finishRestore(); return; }
      restoreFrame = window.requestAnimationFrame(attemptRestore);
    };

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => { stableFrames = 0; previousGeometry = ""; attemptRestore(); });
      observeElement(documentOwner);
      observeElement(document.documentElement);
      observeElement(document.body);
      const main = document.getElementById("main-content");
      observeElement(main);
      observeElement(previewOwner);
      observeElement(currentStage());
    }
    const syncPreviewOwner = () => {
      if (mode !== "preview") return;
      const nextOwner = document.querySelector<HTMLElement>("[data-preview-scroll-owner]");
      if (nextOwner === previewOwner) return;
      const oldOwner = previewOwner;
      const oldStage = currentStage();
      unobserveElement(oldOwner);
      unobserveElement(oldStage);
      stopPreviewSaving();
      previewOwner = nextOwner;
      stopPreviewSaving = previewOwner
        ? observeUserScroll(previewOwner, position => persistUserPosition("preview", position))
        : () => {};
      observeElement(previewOwner);
      observeElement(currentStage());
      stableFrames = 0;
      previousGeometry = "";
      attemptRestore();
    };
    const main = document.getElementById("main-content") ?? document.documentElement;
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => { syncPreviewOwner(); assetsLoaded = hasLoadedImages(); resetStability(); attemptRestore(); });
      mutationObserver.observe(main, { childList: true, subtree: true });
    }
    const resetStability = () => { stableFrames = 0; previousGeometry = ""; };
    const onDocumentLoad = () => { documentLoaded = true; assetsLoaded = hasLoadedImages(); resetStability(); attemptRestore(); };
    const onPageShow = () => { pageShown = true; resetStability(); attemptRestore(); };
    const onAssetsChange = () => { assetsLoaded = hasLoadedImages(); resetStability(); attemptRestore(); };
    const onFontsReady = () => { fontsLoaded = true; resetStability(); attemptRestore(); };
    const onResize = () => { resetStability(); attemptRestore(); };
    window.addEventListener("resize", onResize, { passive: true });
    if (!documentLoaded) window.addEventListener("load", onDocumentLoad, { once: true });
    if (!pageShown) window.addEventListener("pageshow", onPageShow, { once: true });
    document.addEventListener("load", onAssetsChange, true);
    document.addEventListener("error", onAssetsChange, true);
    if (document.fonts && !fontsLoaded) void document.fonts.ready.then(onFontsReady);
    stopRestorationSignals = () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("load", onDocumentLoad);
      window.removeEventListener("pageshow", onBfcachePageShow);
      document.removeEventListener("load", onAssetsChange, true);
      document.removeEventListener("error", onAssetsChange, true);
    };
    // Keep `history.scrollRestoration` at its browser default to preserve
    // normal Back/Forward behavior. Waiting through pageshow lets native
    // refresh restoration run first; this route+mode pass is applied after it.
    restoreFrame = window.requestAnimationFrame(attemptRestore);

    return () => {
      restorationPending = false;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (restoreFrame) window.cancelAnimationFrame(restoreFrame);
      stopRestorationSignals();
      window.removeEventListener("keydown", onRefreshIntent, true);
      window.removeEventListener("beforeunload", onNonKeyboardReload);
      window.removeEventListener("pagehide", onNonKeyboardReload);
      window.removeEventListener("pageshow", onPageShow);
      cancelPendingRestoration = null;
      stopDocumentSaving();
      stopPreviewSaving();
    };
  }, [location.pathname, navigationType, routeDataReady, isDocumentReload, previewSection]);

  return <EditorContext.Provider value={{ sections, resume, overviewData, overviewSiteMetadata, overviewLoadState, onRetryOverview, drafts: drafts.current,
    productionMode, profileResumeId: profileResumeId ?? resume?.resumeId ?? null, profileLoadState, onRetryProfile,
    educationSection, educationResumeId: educationResumeId ?? resume?.resumeId ?? null, educationLoadState, onRetryEducation, onEducationChanged, onReloadEducation, onEducationDeleted,
    additionalSections, additionalRouteLoadState, additionalResumeId, onAdditionalChanged, onReloadAdditional,
    repository, onProfileSaved, onProfileTranslationSaved, pdfFiles, setPdfFiles, pdfErrors, setPdfErrors, profileEditor, setProfileEditor,
    profilePhotoDraft, setProfilePhotoDraft, profilePhotoError, setProfilePhotoError, onProfilePhotoUrlChanged,
    bilingualReviews, onBilingualFieldEdit, onBilingualReviewConfirm, onBilingualCancel, onBilingualSave, preservePreviewScroll,
    educationEditor, setEducationEditor, previewDrafts, onPreviewDraftChanged, previewLocale, setPreviewLocale, profileRequests }}><div className="app-shell">
    <a className="skip-link" href="#main-content">{t("Skip to content")}</a>
    <aside className={`sidebar${menuOpen ? " is-open" : ""}`} id="cms-sidebar">
      <div className="brand"><strong>{t("Resume Editor")}</strong></div>
      <nav aria-label={t("CMS sections")}>
        {navigation.slice(0, 1).map(item => <NavLink key={item.path} ref={firstLink} to={item.path}
          className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
          onClick={() => setMenuOpen(false)}>{t(item.label)}</NavLink>)}
        <div className="sidebar-nav-group"><span className="sidebar-nav-label">{t("Home")}</span>
          {navigation.slice(1, 3).map(item => <NavLink key={item.path} to={item.path}
            className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
            onClick={() => setMenuOpen(false)}>{t(item.label)}</NavLink>)}
        </div>
        <div className="sidebar-nav-group"><span className="sidebar-nav-label">{t("Resume")}</span>
          {navigation.slice(3, 9).map(item => <NavLink key={item.path} to={item.path}
            className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
            onClick={() => setMenuOpen(false)}>{t(item.label)}</NavLink>)}
        </div>
        <div className="sidebar-nav-group"><span className="sidebar-nav-label">{t("Settings")}</span>
          {navigation.slice(9).map(item => <NavLink key={item.path} to={item.path}
            className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
            onClick={() => setMenuOpen(false)}>{t(item.label)}</NavLink>)}
        </div>
      </nav>
    </aside>
    {menuOpen && <button className="drawer-backdrop" type="button" aria-label={t("Close navigation menu")} onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }} />}
    <div className="app-main">
      <header className="topbar"><div className="topbar-left"><button ref={menuButton} className="menu-button" type="button" aria-controls="cms-sidebar" aria-expanded={menuOpen} aria-label={menuOpen ? t("Close menu") : t("Open menu")} onClick={() => setMenuOpen(value => !value)}>☰</button></div>
        <div className="account-placeholder"><ReviewLocaleSwitch /><span className="account-avatar" aria-hidden="true">A</span><span>{identityEmail || t("Authenticated admin")}</span><button type="button" onClick={onSignOut} disabled={signOutPending}>{t("Sign Out")}</button></div></header>
      {signOutError && <p className="sign-out-error" role="alert">{signOutError}</p>}
      <main id="main-content" className={isPreviewRoute ? "preview-route-main" : undefined} tabIndex={-1}>{showOverviewRouteState
        ? <section className="page-section" aria-busy={overviewLoadState === "loading"}><div className="page-heading"><p className="eyebrow">{t("Workspace Overview")}</p><h1>{t("Overview")}</h1>
          {overviewLoadState === "loading" ? <p role="status">{t("Loading Overview...")}</p> : <div role="alert"><p>{t("Unable to load Overview.")}</p>
            <button type="button" className="button secondary" onClick={onRetryOverview ?? undefined}>{t("Retry")}</button></div>}
        </div></section>
        : showAdditionalRouteState
        ? previewSection && previewSection !== "profile" && previewSection !== "education"
          ? <PreviewWorkspace section={previewSection}><section className="page-section" aria-busy={additionalRouteLoadState === "loading"}><div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t(additionalRouteTitle)}</h1>
            {additionalRouteLoadState === "loading" ? <p role="status">{t(additionalLoadingText)}</p> : <div role="alert"><p>{t(additionalErrorText)}</p>
              <button type="button" className="button secondary" onClick={onRetryAdditionalRoute ?? undefined}>{t("Retry")}</button></div>}
          </div></section></PreviewWorkspace>
          : <section className="page-section" aria-busy={additionalRouteLoadState === "loading"}><div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t(additionalRouteTitle)}</h1>
          {additionalRouteLoadState === "loading" ? <p role="status">{t(additionalLoadingText)}</p> : <div role="alert"><p>{t(additionalErrorText)}</p>
            <button type="button" className="button secondary" onClick={onRetryAdditionalRoute ?? undefined}>{t("Retry")}</button></div>}
        </div></section>
        : showFullSnapshotState
        ? <section className="page-section" aria-busy={fullSnapshotState !== "error"}>
          <div className="page-heading"><p className="eyebrow">{t("Resume content")}</p>
            {fullSnapshotState === "error" ? <><h1>{t("Unable to load resume content")}</h1><p>{t("The production resume could not be loaded. No fixture content has been substituted.")}</p>
              <button type="button" onClick={onRetryFullSnapshot ?? undefined}>{t("Retry")}</button></>
              : <><h1>{t("Loading resume content…")}</h1><p role="status">{t("Reading the current example-cv content.")}</p></>}
          </div>
        </section>
        : <Routes>
        <Route path="/" element={<Overview />} /><Route path="/overview" element={<Overview />} />
        <Route path="/profile" element={<PreviewWorkspace section="profile"><Profile /></PreviewWorkspace>} /><Route path="/introduction" element={<PreviewWorkspace section="introduction"><Introduction /></PreviewWorkspace>} />
        <Route path="/education" element={<PreviewWorkspace section="education"><Education /></PreviewWorkspace>} /><Route path="/experience" element={<PreviewWorkspace section="experience"><Experience /></PreviewWorkspace>} />
        <Route path="/projects" element={<PreviewWorkspace section="projects"><Projects /></PreviewWorkspace>} /><Route path="/skills" element={<PreviewWorkspace section="skills"><Skills /></PreviewWorkspace>} />
        <Route path="/awards" element={<PreviewWorkspace section="awards"><Awards /></PreviewWorkspace>} /><Route path="/contact" element={<PreviewWorkspace section="contact"><Contact /></PreviewWorkspace>} />
        <Route path="/links" element={<PreviewWorkspace section="links"><Links /></PreviewWorkspace>} /><Route path="*" element={<NotFound />} />
      </Routes>}</main>
    </div>
  </div></EditorContext.Provider>;
}
