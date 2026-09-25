import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { fixtureMeta, fixtureSections } from "./fixtures";
import type { LoadedResume, OverviewResumeData, ResumeSiteMetadata } from "./data/resumeMapper";
import type { EditableRepeatableSection, EditableTranslation, ResumeRepository, UpdatedEducationEntryRow, UpdatedEducationTranslationRow, UpdatedProfileRow, UpdatedProfileTranslationRow } from "./data/resumeRepository";
import type {
  AwardItem, Bilingual, ContactSection, EducationItem, ExperienceItem, FocusItem,
  EditorSections, IntroItem, Locale, LinksSection, OrderedItem, ProfileSection, ProjectItem, ProjectMethod, SectionKey,
  SkillItem, StatusItem,
} from "./model";
import { UiLocaleSwitch, useUiLocale } from "./uiLocale";

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
  { label: "Links & Site Text", path: "/links" },
] as const;

const clone = <T,>(value: T): T => structuredClone(value);
const renumber = <T extends OrderedItem,>(items: T[]): T[] => items.map((item, position) => ({ ...item, position }));
type EditableSectionItem = IntroItem | ExperienceItem | ProjectItem | SkillItem | AwardItem;
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
  profileRequests: ProfileRequests;
}>({ sections: fixtureSections, resume: null, overviewData: null, overviewSiteMetadata: null, overviewLoadState: "loading", onRetryOverview: null, drafts: new Map(), productionMode: false, profileResumeId: null, profileLoadState: "loading", onRetryProfile: null, educationSection: null, educationResumeId: null, educationLoadState: "loading", onRetryEducation: null, onEducationChanged: null, onReloadEducation: null, onEducationDeleted: null, additionalSections: {}, additionalResumeId: null, onAdditionalChanged: null, onReloadAdditional: null, repository: null, onProfileSaved: null, onProfileTranslationSaved: null,
  pdfFiles: {}, setPdfFiles: () => {}, pdfErrors: {}, setPdfErrors: () => {},
  profileEditor: null, setProfileEditor: () => {}, educationEditor: null, setEducationEditor: () => {}, profileRequests: { shared: false, translations: { zh: false, en: false } } });

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

function InputField({ id, label, value, onChange, multiline = false, type = "text", readOnly = false, hint }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  multiline?: boolean; type?: "text" | "email" | "url"; readOnly?: boolean; hint?: string;
}) {
  const { t } = useUiLocale();
  return <div className="field">
    <label htmlFor={id}>{t(label)}</label>
    {multiline
      ? <textarea id={id} value={value} onChange={event => onChange(event.target.value)} readOnly={readOnly} rows={4} aria-describedby={hint ? `${id}-hint` : undefined} />
      : <input id={id} type={type} value={value} onChange={event => onChange(event.target.value)} readOnly={readOnly} aria-describedby={hint ? `${id}-hint` : undefined} />}
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

function BilingualFields<T extends object>({ value, fields, onChange, idPrefix, readOnlyAll = false, readOnlyLocales, footer }: {
  value: Bilingual<T>; fields: FieldSpec<T>[]; onChange: (value: Bilingual<T>, locale: Locale) => void; idPrefix: string;
  readOnlyAll?: boolean; readOnlyLocales?: Partial<Record<Locale, boolean>>; footer?: (locale: Locale) => ReactNode;
}) {
  const { t } = useUiLocale();
  return <div className="bilingual-grid">{(["zh", "en"] as const).map(locale =>
    <div className="language-panel" key={locale}>
      <h3><span lang={locale}>{locale === "zh" ? t("Chinese") : t("English")}</span><small>{locale === "zh" ? t("Chinese") : t("English")}</small></h3>
      {fields.map(field => {
        const readOnly = readOnlyAll || readOnlyLocales?.[locale] || (locale === "zh" && field.readOnlyZh);
        return <InputField key={field.key} id={`${idPrefix}-${locale}-${field.key}`}
          label={`${locale === "zh" ? t("Chinese") : t("English")} ${t(field.label)}`}
          value={String(value[locale][field.key] ?? "")} type={field.type} multiline={field.multiline}
          readOnly={readOnly}
          hint={locale === "zh" && field.readOnlyZh && !readOnlyAll ? t("Not editable in the first CMS release. The public renderer uses fixed phrase styling here.") : undefined}
          onChange={next => onChange({ ...value, [locale]: { ...value[locale], [field.key]: next } }, locale)} />;
      })}
      {footer?.(locale)}
    </div>
  )}</div>;
}

function SectionForm<T>({ section, title, description, initial, children, productionSave, productionDirty = false, onProductionCancel, onProductionSaved }: {
  section: SectionKey; title: string; description: string; initial: T;
  children: (value: T, onChange: (next: T | ((current: T) => T)) => void) => ReactNode;
  productionSave?: (draft: T, baseline: T) => Promise<T | void>;
  productionDirty?: boolean; onProductionCancel?: () => void; onProductionSaved?: () => void;
}) {
  const { t } = useUiLocale();
  const context = useContext(EditorContext);
  const editor = useLocalDraft(section, initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const saveLock = useRef(false);
  const submit = async () => {
    if (editor.production && productionSave) {
      if (saveLock.current) return; saveLock.current = true; setSaving(true); setSaveError(false);
      try { const result = await productionSave(editor.draft, editor.saved); const confirmed = result ?? editor.draft; editor.confirm(confirmed); onProductionSaved?.(); editor.setMessage("Changes saved to production."); context.onAdditionalChanged?.(section, context.additionalResumeId ?? "", confirmed); }
      catch (error) { setSaveError(true); editor.setMessage(error instanceof Error ? error.message : "Production save failed. Your changes remain unsaved; please retry."); }
      finally { saveLock.current = false; setSaving(false); }
      return;
    }
    editor.save();
  };
  return <section className="page-section">
    <div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t(title)}</h1><p>{t(description)}</p></div>
    <form className="editor-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      {children(editor.draft, editor.update)}
      <div className="save-bar">
        <span className={editor.dirty || productionDirty ? "state-pill is-dirty" : "state-pill"}>{editor.dirty || productionDirty ? t("Unsaved changes") : t("No unsaved changes")}</span>
        <div className="save-actions">
          <button type="button" className="button secondary" onClick={() => { editor.cancel(); onProductionCancel?.(); }} disabled={!(editor.dirty || productionDirty) || saving}>{t("Cancel changes")}</button>
          <button type="submit" className="button primary" disabled={!(editor.dirty || productionDirty) || saving}>{saving ? t("Saving…") : editor.production && !productionSave ? t("Save local draft") : editor.production ? t("Save production changes") : t("Save section")}</button>
        </div>
      </div>
      <p className="save-notice" role={saveError ? "alert" : "status"} aria-live="polite">{t(editor.notice) || (editor.production ? t("Local draft only. Production writes are disabled for this section.") : t("Fixture saves stay in this browser session."))}</p>
    </form>
  </section>;
}

function RepeatableList<T extends OrderedItem>({ items, onChange, create, label, render, groupLabel, onConfirmedDelete, deleteDisabled }: {
  items: T[]; onChange: (items: T[]) => void; create: (id: string, position: number) => T;
  label: (item: T) => string; render: (item: T, onChange: (item: T) => void) => ReactNode; groupLabel: string;
  onConfirmedDelete?: (id: string) => void; deleteDisabled?: (id: string) => boolean;
}) {
  const { t } = useUiLocale();
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const nextId = useRef(0);
  const replace = (id: string, changed: T) => onChange(items.map(item => item.id === id ? changed : item));
  const remove = (id: string) => { onChange(renumber(items.filter(item => item.id !== id))); if (openId === id) setOpenId(null); };
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
    setOpenId(newItem.id);
  };
  return <div className="repeatable-group" aria-label={groupLabel}>
    <div className="group-heading"><h2>{t(groupLabel)}</h2><button type="button" className="button secondary" onClick={add}>{t("Add item")}</button></div>
    {items.length === 0 && <p className="empty-note">{t("No items yet. Add one to start this section.")}</p>}
    <div className="item-stack">{items.map((item, index) => {
      const itemLabel = label(item) || t("New item");
      const isOpen = openId === item.id;
      return <article className="item-card" key={item.id}>
        <div className="item-card-heading"><div><span className="item-number">{String(index + 1).padStart(2, "0")}</span><h3>{itemLabel}</h3></div>
          <div className="item-actions">
            <button type="button" onClick={() => setOpenId(isOpen ? null : item.id)} aria-label={`${isOpen ? t("Close editor for") : t("Edit")} ${itemLabel}`}>{isOpen ? t("Close") : t("Edit")}</button>
            <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`${t("Move")} ${itemLabel} ${t("up")}`}>↑</button>
            <button type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`${t("Move")} ${itemLabel} ${t("down")}`}>↓</button>
            {pendingDeleteId === item.id ? <><button type="button" className="danger-text" onClick={() => { if (onConfirmedDelete) onConfirmedDelete(item.id); else remove(item.id); setPendingDeleteId(null); }}>{t("Confirm delete")}</button>
              <button type="button" onClick={() => setPendingDeleteId(null)}>{t("Keep entry")}</button></>
              : <button type="button" className="danger-text" disabled={deleteDisabled?.(item.id)} onClick={() => onConfirmedDelete ? setPendingDeleteId(item.id) : remove(item.id)} aria-label={`${t("Delete")} ${itemLabel}`}>{t("Delete")}</button>}
          </div>
        </div>
        {isOpen && <div className="item-card-body">{render(item, changed => replace(item.id, changed))}</div>}
      </article>;
    })}</div>
  </div>;
}

function RepeatableSection<T extends OrderedItem>({ section, title, description, create, label, render }: {
  section: "introduction" | "education" | "experience" | "projects" | "skills" | "awards";
  title: string; description: string; create: (id: string, position: number) => T;
  label: (item: T) => string; render: (item: T, onChange: (item: T) => void) => ReactNode;
}) {
  const context = useContext(EditorContext);
  const { sections, productionMode } = context;
  if (productionMode && editableSections.has(section)) {
    const key = section as EditableRepeatableSection;
    const items = (context.additionalSections[key] ?? sections[key]) as unknown as T[];
    if (context.additionalResumeId && context.repository) return <ProductionRepeatableSection section={key} resumeId={context.additionalResumeId}
      items={items as unknown as EditableSectionItem[]} repository={context.repository} drafts={context.drafts} onChanged={context.onAdditionalChanged}
      onReload={context.onReloadAdditional} title={title} description={description} create={create as unknown as (id: string, position: number) => EditableSectionItem}
      label={label as unknown as (item: EditableSectionItem) => string} render={render as unknown as (item: EditableSectionItem, onChange: (item: EditableSectionItem) => void) => ReactNode} />;
  }
  return <SectionForm section={section} title={title} description={description} initial={sections[section] as unknown as T[]}>
    {(items, onChange) => <RepeatableList items={items} onChange={onChange} create={create} label={label} render={render} groupLabel={`${title} items`} />}
  </SectionForm>;
}

type ProductionRepeatableProps = {
  section: EditableRepeatableSection; resumeId: string; items: EditableSectionItem[]; repository: ResumeRepository;
  drafts: Map<SectionKey, unknown>;
  onChanged: ((section: EditableRepeatableSection, resumeId: string, value: EditableSectionItem[]) => void) | null;
  onReload: ((section: EditableRepeatableSection) => Promise<EditableSectionItem[]>) | null;
  title: string; description: string; create: (id: string, position: number) => EditableSectionItem;
  label: (item: EditableSectionItem) => string; render: (item: EditableSectionItem, onChange: (item: EditableSectionItem) => void) => ReactNode;
};

function ProductionRepeatableSection({ section, resumeId, items, repository, drafts, onChanged, onReload,
  title, description, create, label, render }: ProductionRepeatableProps) {
  const { t } = useUiLocale();
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

  const patchDraft = (next: EditableSectionItem[]) => stateUpdate(current => ({ ...current, draft: clone(next), notice: "", error: false }));
  const saveChanges = async () => {
    if (saving.current || !dirty || hasBlocked) return;
    const methods = repository.updateEditableEntryPosition && repository.insertEditableEntry && repository.updateEditableTranslation
      && repository.insertEditableTranslation && repository.readEditableTranslation && repository.deleteEditableTranslation && repository.deleteEditableEntry;
    if (!methods) { stateUpdate(current => ({ ...current, notice: "Production writes are unavailable for this section.", error: true })); return; }
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
      working = { ...working, baseline: clone(working.draft), draft: clone(working.draft), saving: false, notice: "Changes saved to production.", error: false };
      commit(working); patchCache();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Production save failed. Your changes remain unsaved; please retry.";
      if (!working.error) working = { ...working, notice: detail, error: true };
      working = { ...working, saving: false };
      commit(working);
    } finally { saving.current = false; }
  };
  const cancel = () => {
    if (hasRecovery || editor.saving) return;
    stateUpdate(current => ({ ...current, draft: clone(current.baseline), notice: "Changes reverted to the last confirmed production values.", error: false }));
  };
  const groupLabel = `${title} items`;
  return <section className="page-section" aria-busy={editor.saving}>
    <div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t(title)}</h1><p>{t(description)}</p></div>
    <RepeatableList items={draft} onChange={patchDraft} create={create} label={label} render={render} groupLabel={groupLabel}
      onConfirmedDelete={id => patchDraft(draft.filter(item => item.id !== id))} deleteDisabled={id => Boolean(editor.partialCreates[id]?.blocked)} />
    <p className="save-notice production-save-helper" role={editor.error ? "alert" : "status"} aria-live="polite">{t(editor.notice || "Changes are written to production only when saved.")}</p>
    <div className="save-bar"><span className={dirty ? "state-pill is-dirty" : "state-pill"}>{dirty ? t("Unsaved changes") : t("No unsaved changes")}</span>
      <div className="save-actions"><button type="button" className="button secondary" onClick={cancel} disabled={!dirty || editor.saving || hasRecovery}>{t("Cancel changes")}</button>
        <button type="button" className="button primary" onClick={() => void saveChanges()} disabled={!dirty || editor.saving || hasBlocked}>{editor.saving ? t("Saving…") : t("Save production changes")}</button></div>
    </div>
  </section>;
}

function Overview() {
  const { sections, resume, productionMode, overviewData, overviewSiteMetadata } = useContext(EditorContext);
  const { t } = useUiLocale();
  const isProductionOverview = productionMode && overviewData !== null && overviewSiteMetadata !== null;
  const isProductionSnapshot = productionMode && resume !== null;
  const cards = [
    ["Resume", isProductionOverview ? overviewData.profileName : isProductionSnapshot ? sections.profile.translations.en.name : fixtureMeta.name],
    ["Publication", isProductionOverview ? (overviewSiteMetadata.isPublished ? t("Published") : t("Unpublished")) : isProductionSnapshot ? (resume.isPublished ? t("Published") : t("Unpublished")) : fixtureMeta.publication],
    ["Languages", t(fixtureMeta.languages)], ["Content completeness", isProductionOverview || isProductionSnapshot ? t("9 editor sections") : t("9 of 9 editor sections (demo)")],
    ["Sections", `${navigation.length - 1} ${t("editable")}`], ["Last updated", isProductionOverview ? (overviewSiteMetadata.updatedAt ?? t("Unavailable")) : isProductionSnapshot ? (resume.updatedAt ?? t("Unavailable")) : fixtureMeta.lastUpdated],
  ];
  const hasProductionData = isProductionOverview || isProductionSnapshot;
  return <section className="page-section">
    <div className="page-heading"><p className="eyebrow">{t("Workspace overview")}</p><h1>{t("Overview")}</h1><p>{hasProductionData ? t("The current example-cv resume is loaded. All resume content sections save to production.") : t("A local model of the editing workspace for the Example CV resume.")}</p></div>
    <div className="mode-banner" role="status"><strong>{hasProductionData ? t("Production data") : t("Local fixture mode")}</strong><span>{hasProductionData ? t("Profile, Education, Introduction, Experience, Projects, Skills, Awards, Contact, and Links & Site Text save to production.") : t("No production data is being read or changed. Local saves stay in this browser session.")}</span></div>
    <div className="overview-grid">{cards.map(([title, value]) => <div className="overview-card" key={title}><span>{t(title)}</span><strong>{value}</strong></div>)}</div>
    <div className="overview-next"><h2>{t("Continue editing")}</h2><p>{t("Open a section to see shared fields, Chinese and English text, and ordered entries.")}</p><div className="quick-links"><Link to="/profile">{t("Profile")} <span aria-hidden="true">↗</span></Link><Link to="/education">{t("Education")} <span aria-hidden="true">↗</span></Link><Link to="/contact">{t("Contact")} <span aria-hidden="true">↗</span></Link></div></div>
  </section>;
}

function Profile() {
  const { sections, resume, productionMode, profileResumeId, profileLoadState, onRetryProfile, repository, onProfileSaved, onProfileTranslationSaved, profileEditor, setProfileEditor, profileRequests } = useContext(EditorContext);
  const { t } = useUiLocale();
  if (productionMode && profileEditor) return <ProductionProfile state={profileEditor} setState={setProfileEditor}
    requests={profileRequests} resumeId={profileResumeId ?? resume?.resumeId ?? ""} repository={repository}
    onSaved={onProfileSaved} onTranslationSaved={onProfileTranslationSaved} />;
  if (productionMode) return <section className="page-section" aria-busy={profileLoadState === "loading"}>
    <div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t("Profile")}</h1>
      {profileLoadState === "loading" ? <p role="status">{t("Loading Profile…")}</p> : <div role="alert"><p>{t("Unable to load Profile.")}</p>
        <button type="button" className="button secondary" onClick={onRetryProfile ?? undefined}>{t("Retry")}</button></div>}
    </div>
  </section>;
  return <SectionForm<ProfileSection> section="profile" title="Profile" description="Edit the identity, shared details, and labels shown around the hero and footer." initial={sections.profile}>
    {(profile, onChange) => <>
      <div className="panel"><h2>{t("Shared details")}</h2><p>{t("These values are the same in Chinese and English.")}</p>
        <SharedFields idPrefix="profile-shared" value={profile.shared} onChange={shared => onChange({ ...profile, shared })}
          fields={[{ key: "graduationValue", label: "Graduation value" }, { key: "avatarInitials", label: "Avatar initials" }, { key: "footerName", label: "Footer name" }, { key: "copyright", label: "Copyright" }]} />
      </div>
      <div className="panel"><h2>{t("Chinese and English profile")}</h2><BilingualFields idPrefix="profile" value={profile.translations}
        onChange={translations => onChange({ ...profile, translations })}
        fields={[{ key: "name", label: "Name" }, { key: "navAboutLabel", label: "About navigation label" }, { key: "emailActionLabel", label: "Email action label" }, { key: "graduationLabel", label: "Graduation label" }, { key: "avatarLabel", label: "Avatar accessibility label" }, { key: "contactFocusHeading", label: "Current Focus heading" }, { key: "contactStatusHeading", label: "Current Status heading" }]} />
      </div>
    </>}
  </SectionForm>;
}

function ProductionProfile({ state, setState, requests, resumeId, repository, onSaved, onTranslationSaved }: {
  state: ProfileEditorState;
  setState: Dispatch<SetStateAction<ProfileEditorState | null>>;
  requests: ProfileRequests;
  resumeId: string;
  repository: ResumeRepository | null;
  onSaved: ((row: UpdatedProfileRow) => void) | null;
  onTranslationSaved: ((row: UpdatedProfileTranslationRow) => void) | null;
}) {
  const { t } = useUiLocale();
  const dirty = JSON.stringify(state.draft) !== JSON.stringify(state.baseline);
  const translationDirty: Record<Locale, boolean> = {
    zh: JSON.stringify(state.translationDraft.zh) !== JSON.stringify(state.translationBaseline.zh),
    en: JSON.stringify(state.translationDraft.en) !== JSON.stringify(state.translationBaseline.en),
  };

  useEffect(() => {
    if (!dirty && !translationDirty.zh && !translationDirty.en) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, translationDirty.zh, translationDirty.en]);

  async function save() {
    if (!repository || !onSaved || !dirty || requests.shared) return;
    requests.shared = true;
    setState(current => current ? { ...current, saving: true, notice: "", saveError: false } : current);
    try {
      const confirmed = await repository.updateProfileSharedDetails(resumeId, state.draft);
      setState(current => current ? { ...current, baseline: clone(confirmed.shared), draft: clone(confirmed.shared), notice: "Shared profile details saved to production.", saveError: false } : current);
      onSaved(confirmed);
    } catch {
      setState(current => current ? { ...current, saveError: true, notice: "Could not save shared profile details. Your edits are still here; please retry." } : current);
    } finally {
      requests.shared = false;
      setState(current => current ? { ...current, saving: false } : current);
    }
  }

  async function saveTranslation(locale: Locale) {
    if (!repository || !onTranslationSaved || !translationDirty[locale] || requests.translations[locale]) return;
    requests.translations[locale] = true;
    setState(current => current ? {
      ...current,
      translationSaving: { ...current.translationSaving, [locale]: true },
      translationNotices: { ...current.translationNotices, [locale]: null },
    } : current);
    const language = locale === "zh" ? "Chinese" : "English";
    try {
      const confirmed = await repository.updateProfileTranslation(resumeId, locale, state.translationDraft[locale]);
      setState(current => current ? {
        ...current,
        translationBaseline: { ...current.translationBaseline, [locale]: clone(confirmed.translation) },
        translationDraft: { ...current.translationDraft, [locale]: clone(confirmed.translation) },
        translationNotices: { ...current.translationNotices, [locale]: { message: `${language} profile translation saved to production.`, error: false } },
      } : current);
      onTranslationSaved(confirmed);
    } catch {
      setState(current => current ? {
        ...current,
        translationNotices: { ...current.translationNotices, [locale]: { message: `${language} profile translation was not saved. Your edits remain; please retry.`, error: true } },
      } : current);
    } finally {
      requests.translations[locale] = false;
      setState(current => current ? { ...current, translationSaving: { ...current.translationSaving, [locale]: false } } : current);
    }
  }

  return <section className="page-section">
    <div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t("Profile")}</h1><p>{t("Edit the identity, shared details, and labels shown around the hero and footer.")}</p></div>
    <form className="editor-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="panel"><h2>{t("Shared details")}</h2><p>{t("These values are the same in Chinese and English.")} {t("Shared details have a separate production save.")}</p>
        <SharedFields idPrefix="profile-shared" value={state.draft} readOnly={state.saving}
          onChange={shared => setState(current => current ? { ...current, draft: shared, notice: "", saveError: false } : current)}
          fields={[{ key: "graduationValue", label: "Graduation value" }, { key: "avatarInitials", label: "Avatar initials" }, { key: "footerName", label: "Footer name" }, { key: "copyright", label: "Copyright" }]} />
      </div>
      <div className="panel"><h2>{t("Chinese and English profile")}</h2>
        <p>{t("Chinese and English translations save to production separately. One language can succeed while the other fails.")}</p>
        <BilingualFields idPrefix="profile" value={state.translationDraft} readOnlyLocales={state.translationSaving}
          onChange={(next, locale) => {
            if (requests.translations[locale]) return;
            setState(current => current ? {
              ...current,
              translationDraft: { ...current.translationDraft, [locale]: next[locale] },
              translationNotices: { ...current.translationNotices, [locale]: null },
            } : current);
          }}
          fields={[{ key: "name", label: "Name" }, { key: "navAboutLabel", label: "About navigation label" }, { key: "emailActionLabel", label: "Email action label" }, { key: "graduationLabel", label: "Graduation label" }, { key: "avatarLabel", label: "Avatar accessibility label" }, { key: "contactFocusHeading", label: "Current Focus heading" }, { key: "contactStatusHeading", label: "Current Status heading" }]}
          footer={locale => {
            const notice = state.translationNotices[locale];
            return <div className="profile-translation-footer">
              <span className={translationDirty[locale] ? "state-pill is-dirty" : "state-pill"}>{translationDirty[locale] ? t(locale === "zh" ? "Unsaved Chinese changes" : "Unsaved English changes") : t(locale === "zh" ? "No unsaved Chinese changes" : "No unsaved English changes")}</span>
              <div className="save-actions">
                <button type="button" className="button secondary" disabled={!translationDirty[locale] || state.translationSaving[locale]}
                  onClick={() => {
                    setState(current => current ? {
                      ...current,
                      translationDraft: { ...current.translationDraft, [locale]: clone(current.translationBaseline[locale]) },
                      translationNotices: { ...current.translationNotices, [locale]: { message: locale === "zh" ? "Chinese changes reverted to the last confirmed production values." : "English changes reverted to the last confirmed production values.", error: false } },
                    } : current);
                }}>{t(locale === "zh" ? "Cancel Chinese" : "Cancel English")}</button>
                <button type="button" className="button primary" disabled={!translationDirty[locale] || state.translationSaving[locale] || !repository || !onTranslationSaved}
                  onClick={() => void saveTranslation(locale)}>{state.translationSaving[locale] ? t("Saving…") : t(locale === "zh" ? "Save Chinese" : "Save English")}</button>
              </div>
              <p className="save-notice" role={notice?.error ? "alert" : "status"} aria-live="polite">
                {t(notice?.message || (locale === "zh" ? "Chinese profile translation saves to production separately." : "English profile translation saves to production separately."))}
              </p>
            </div>;
          }} />
      </div>
      <div className="save-bar">
        <span className={dirty ? "state-pill is-dirty" : "state-pill"}>{t(dirty ? "Shared details: Unsaved changes" : "Shared details: No unsaved changes")}</span>
        <div className="save-actions">
          <button type="button" className="button secondary" disabled={!dirty || state.saving}
            onClick={() => setState(current => current ? { ...current, draft: clone(current.baseline), notice: "Changes reverted to the last confirmed production values.", saveError: false } : current)}>{t("Cancel changes")}</button>
          <button type="submit" className="button primary" disabled={!dirty || state.saving || !repository || !onSaved}>
            {state.saving ? t("Saving shared…") : t("Save shared details")}
          </button>
        </div>
      </div>
      <p className="save-notice" role={state.saveError ? "alert" : "status"} aria-live="polite">
        {t(state.notice || "This control saves shared details to production. Chinese and English saves are separate above.")}
      </p>
    </form>
  </section>;
}

function Introduction() {
  const { t } = useUiLocale();
  return <RepeatableSection<IntroItem> section="introduction" title="Introduction" description="Keep paragraphs paired in Chinese and English. Their displayed order follows this list."
    create={(id, position) => ({ id, position, translations: { zh: { text: "" }, en: { text: "" } } })}
    label={item => item.translations.en.text || item.translations.zh.text || t("New paragraph")}
    render={(item, onChange) => <BilingualFields idPrefix={item.id} value={item.translations}
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
    render={(item, onChange) => <>
      <div className="shared-select"><label htmlFor={`${item.id}-entry-type`}>{t("Entry type (shared)")}</label><select id={`${item.id}-entry-type`} value={item.entryType}
        onChange={event => onChange({ ...item, entryType: event.target.value as EducationItem["entryType"] })}>
        <option value="standard">{t("Standard")}</option><option value="summerSchool">{t("Summer school")}</option>
      </select></div>
      <BilingualFields idPrefix={item.id} value={item.translations} onChange={translations => onChange({ ...item, translations })}
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
  const cancel = () => setEditor(current => {
    if (!current) return current;
    const partialIds = new Set(Object.keys(current.partialCreates));
    const partialDrafts = current.draft.filter(item => partialIds.has(item.id));
    return { ...current, draft: [...clone(current.baseline), ...partialDrafts], notice: partialDrafts.length
      ? "Unsaved edits were reverted. Incomplete production-created entries remain visible so they can be completed or deleted."
      : "Changes reverted to the last confirmed production values.", error: partialDrafts.length > 0 };
  });

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
            <BilingualFields idPrefix={item.id} value={item.translations} readOnlyAll={editor.saving}
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
    render={(item, onChange) => <BilingualFields idPrefix={item.id} value={item.translations}
      onChange={translations => onChange({ ...item, translations })}
      fields={[{ key: "organization", label: "Organization" }, { key: "title", label: "Role" }, { key: "period", label: "Period" }, { key: "location", label: "Location" }, { key: "description", label: "Description", multiline: true }]} />} />;
}

function MethodFields({ locale, methods, onChange, idPrefix }: { locale: "zh" | "en"; methods: ProjectMethod[]; onChange: (items: ProjectMethod[]) => void; idPrefix: string }) {
  const { t } = useUiLocale();
  const title = t(locale === "zh" ? "Chinese methods" : "English methods");
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= methods.length) return;
    const next = [...methods];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(renumber(next));
  };
  return <div className="method-group"><div className="group-heading"><h4>{title}</h4><button className="text-button" type="button" onClick={() => onChange([...methods, { id: `local-method-${Date.now()}-${methods.length}`, position: methods.length, value: "" }])}>{t("Add method")}</button></div>
    {methods.map((method, index) => <div className="method-row" key={method.id}>
      <InputField id={`${idPrefix}-${locale}-method-${method.id}`} label={`${title} ${index + 1}`} value={method.value}
        onChange={value => onChange(methods.map(entry => entry.id === method.id ? { ...entry, value } : entry))} />
      <div className="method-actions"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${title} ${index + 1} up`}>↑</button>
        <button type="button" disabled={index === methods.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${title} ${index + 1} down`}>↓</button>
        <button type="button" onClick={() => onChange(renumber(methods.filter(entry => entry.id !== method.id)))} aria-label={`${t("Delete")} ${title} ${index + 1}`}>{t("Delete")}</button></div>
    </div>)}
  </div>;
}

function Projects() {
  return <RepeatableSection<ProjectItem> section="projects" title="Projects" description="Edit bilingual project details and the ordered methods shown with each project."
    create={(id, position) => ({ id, sourceKey: null, position, translations: {
      zh: { title: "", subtitle: "", period: "", description: "", href: "" },
      en: { title: "", subtitle: "", period: "", description: "", href: "" },
    }, methods: { zh: [], en: [] } })}
    label={item => item.translations.en.title || item.translations.zh.title}
    render={(item, onChange) => <>
      <BilingualFields idPrefix={item.id} value={item.translations} onChange={translations => onChange({ ...item, translations })}
        fields={[{ key: "title", label: "Title" }, { key: "subtitle", label: "Subtitle" }, { key: "period", label: "Period" }, { key: "description", label: "Description", multiline: true }, { key: "href", label: "Project URL", type: "url" }]} />
      <div className="bilingual-grid methods-grid">{(["zh", "en"] as const).map(locale => <MethodFields key={locale} idPrefix={item.id} locale={locale}
        methods={item.methods[locale]} onChange={methods => onChange({ ...item, methods: { ...item.methods, [locale]: methods } })} />)}</div>
    </>} />;
}

function Skills() {
  return <RepeatableSection<SkillItem> section="skills" title="Skills" description="Organize bilingual skill groups in the order they should appear."
    create={(id, position) => ({ id, sourceKey: null, position, translations: { zh: { title: "", items: "" }, en: { title: "", items: "" } } })}
    label={item => item.translations.en.title || item.translations.zh.title}
    render={(item, onChange) => <BilingualFields idPrefix={item.id} value={item.translations}
      onChange={translations => onChange({ ...item, translations })}
      fields={[{ key: "title", label: "Group title" }, { key: "items", label: "Skills" }]} />} />;
}

function Awards() {
  return <RepeatableSection<AwardItem> section="awards" title="Awards" description="Add, remove, and reorder recognitions while keeping both languages paired."
    create={(id, position) => ({ id, sourceKey: null, position, translations: { zh: { name: "", year: "" }, en: { name: "", year: "" } } })}
    label={item => item.translations.en.name || item.translations.zh.name}
    render={(item, onChange) => <BilingualFields idPrefix={item.id} value={item.translations}
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
    {(contact, onChange) => <>
      <div className="panel"><h2>{t("Contact text")}</h2><BilingualFields idPrefix="contact" value={contact.translations}
        onChange={translations => onChange({ ...contact, translations })}
        fields={[{ key: "contactLabel", label: "Section label" }, { key: "availability", label: "Availability", multiline: true, readOnlyZh: true }]} />
        <p className="limitation-note">{t("Chinese availability is not editable in the first CMS release because the public page uses fixed phrase-specific markup.")}</p>
      </div>
      <div className="panel"><RepeatableList groupLabel="Current Focus" items={contact.focus}
        onChange={focus => onChange({ ...contact, focus })}
        onConfirmedDelete={id => onChange({ ...contact, focus: renumber(contact.focus.filter(item => item.id !== id)) })}
        create={(id, position): FocusItem => ({ id, position, translations: { zh: { title: "", detail: "" }, en: { title: "", detail: "" } } })}
        label={item => item.translations.en.title || item.translations.zh.title}
        render={(item, change) => <BilingualFields idPrefix={item.id} value={item.translations}
          onChange={translations => change({ ...item, translations })}
          fields={[{ key: "title", label: "Focus title" }, { key: "detail", label: "Detail" }]} />} /></div>
      <div className="panel"><RepeatableList groupLabel="Current Status" items={contact.status}
        onChange={status => onChange({ ...contact, status })}
        onConfirmedDelete={id => onChange({ ...contact, status: renumber(contact.status.filter(item => item.id !== id)) })}
        create={(id, position): StatusItem => ({ id, position, statusType: "open", translations: { zh: { title: "", detail: "" }, en: { title: "", detail: "" } } })}
        label={item => item.translations.en.title || item.translations.zh.title}
        render={(item, change) => <>
          <div className="shared-select"><label htmlFor={`${item.id}-status-type`}>{t("Status type (shared)")}</label><select id={`${item.id}-status-type`} value={item.statusType}
            onChange={event => change({ ...item, statusType: event.target.value as StatusItem["statusType"] })}>
            <option value="study">{t("Study")}</option><option value="graduation">{t("Graduation")}</option><option value="open">{t("Open")}</option>
          </select></div>
          <BilingualFields idPrefix={item.id} value={item.translations} onChange={translations => change({ ...item, translations })}
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
    {(links, onChange) => <>
      <div className="panel"><h2>{t("Shared public links")}</h2><SharedFields idPrefix="links-shared" value={links.shared}
        onChange={shared => onChange({ ...links, shared })}
        fields={[{ key: "email", label: "Email address", type: "email" }, { key: "github", label: "GitHub URL", type: "url" }, { key: "githubLabel", label: "GitHub label" }, { key: "linkedInDisplayName", label: "LinkedIn display name" }, { key: "emailLabel", label: "Email label" }, { key: "linkedInLabel", label: "LinkedIn action label" }]} /></div>
      <div className="panel"><h2>{t("Localized links and headings")}</h2><BilingualFields idPrefix="links-localized" value={links.translations}
        onChange={translations => onChange({ ...links, translations })}
        footer={locale => <ResumePdfUpload locale={locale} href={links.translations[locale].portfolioHref} file={pdfFiles[locale]} error={pdfErrors[locale]} onSelect={file => selectPdf(locale, file)} />}
        fields={[{ key: "portfolioLabel", label: "Resume PDF label" }, { key: "linkedInHref", label: "LinkedIn URL", type: "url" }, { key: "linkedInLabel", label: "LinkedIn text" }, { key: "kaggleLabel", label: "Project link label" }, { key: "updatedAtLabel", label: "Updated date label" }, { key: "educationLabel", label: "Education heading" }, { key: "experienceLabel", label: "Experience heading" }, { key: "projectHeading", label: "Projects heading" }, { key: "skillsLabel", label: "Skills heading" }, { key: "honorsLabel", label: "Awards heading" }]} /></div>
      <div className="panel"><h2>{t("Navigation labels")}</h2><p>{t("The five destinations are fixed in the public page. Only their bilingual labels are editable here.")}</p>
        <div className="navigation-labels">{links.navigation.map(item => <div className="navigation-label-row" key={item.id}><strong>{item.sectionId}</strong>
          <BilingualFields idPrefix={item.id} value={item.translations} fields={[{ key: "label", label: "Navigation label" }]}
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
  const drafts = useRef(new Map<SectionKey, unknown>());
  const sections: EditorSections = { ...(resume?.sections ?? fixtureSections), ...additionalSections };
  const initialProfile = profileSection ?? resume?.sections.profile ?? null;
  const [profileEditor, setProfileEditor] = useState<ProfileEditorState | null>(() => initialProfile ? initialProfileEditorState(initialProfile) : null);
  const profileInitialized = useRef(initialProfile !== null);
  const [educationEditor, setEducationEditor] = useState<EducationEditorState | null>(() => resume ? initialEducationEditorState(resume.sections.education) : null);
  const educationInitialized = useRef(resume !== null);
  const profileRequests = useRef<ProfileRequests>({ shared: false, translations: { zh: false, en: false } }).current;
  const [pdfFiles, setPdfFiles] = useState<Partial<Record<Locale, File>>>({});
  const [pdfErrors, setPdfErrors] = useState<Partial<Record<Locale, string>>>({});
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
  return <EditorContext.Provider value={{ sections, resume, overviewData, overviewSiteMetadata, overviewLoadState, onRetryOverview, drafts: drafts.current,
    productionMode, profileResumeId: profileResumeId ?? resume?.resumeId ?? null, profileLoadState, onRetryProfile,
    educationSection, educationResumeId: educationResumeId ?? resume?.resumeId ?? null, educationLoadState, onRetryEducation, onEducationChanged, onReloadEducation, onEducationDeleted,
    additionalSections, additionalResumeId, onAdditionalChanged, onReloadAdditional,
    repository, onProfileSaved, onProfileTranslationSaved, pdfFiles, setPdfFiles, pdfErrors, setPdfErrors, profileEditor, setProfileEditor,
    educationEditor, setEducationEditor, profileRequests }}><div className="app-shell">
    <a className="skip-link" href="#main-content">{t("Skip to content")}</a>
    <aside className={`sidebar${menuOpen ? " is-open" : ""}`} id="cms-sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">E</span><div><strong>{t("Example CV CMS")}</strong><small>{productionMode ? t("Admin workspace · production write") : t("Admin workspace · demo")}</small></div></div>
      <nav aria-label={t("CMS sections")}>{navigation.map((item, index) => <NavLink key={item.path} ref={index === 0 ? firstLink : undefined} to={item.path}
        className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
        onClick={() => setMenuOpen(false)}>{t(item.label)}</NavLink>)}</nav>
      <div className="sidebar-foot"><span className="mode-dot" aria-hidden="true" />{productionMode ? t("Production data") : t("Fixture mode")}<br /><small>{productionMode ? t("All resume content sections save to production") : t("Nothing is connected to production")}</small></div>
    </aside>
    {menuOpen && <button className="drawer-backdrop" type="button" aria-label={t("Close navigation menu")} onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }} />}
    <div className="app-main">
      <header className="topbar"><div className="topbar-left"><button ref={menuButton} className="menu-button" type="button" aria-controls="cms-sidebar" aria-expanded={menuOpen} aria-label={menuOpen ? t("Close menu") : t("Open menu")} onClick={() => setMenuOpen(value => !value)}>☰</button><span className="topbar-title">{t("Example CV CMS")}</span><span className="topbar-badge">{productionMode ? t("PRODUCTION WRITE") : t("LOCAL DEMO")}</span></div>
        <div className="account-placeholder"><UiLocaleSwitch /><span className="account-avatar" aria-hidden="true">A</span><span>{identityEmail || t("Authenticated admin")}</span><button type="button" onClick={onSignOut} disabled={signOutPending}>{t("Sign Out")}</button></div></header>
      {signOutError && <p className="sign-out-error" role="alert">{signOutError}</p>}
      <main id="main-content" tabIndex={-1}>{showOverviewRouteState
        ? <section className="page-section" aria-busy={overviewLoadState === "loading"}><div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t("Overview")}</h1>
          {overviewLoadState === "loading" ? <p role="status">{t("Loading Overview...")}</p> : <div role="alert"><p>{t("Unable to load Overview.")}</p>
            <button type="button" className="button secondary" onClick={onRetryOverview ?? undefined}>{t("Retry")}</button></div>}
        </div></section>
        : showAdditionalRouteState
        ? <section className="page-section" aria-busy={additionalRouteLoadState === "loading"}><div className="page-heading"><p className="eyebrow">{t("Resume content")}</p><h1>{t(additionalRouteTitle)}</h1>
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
        <Route path="/profile" element={<Profile />} /><Route path="/introduction" element={<Introduction />} />
        <Route path="/education" element={<Education />} /><Route path="/experience" element={<Experience />} />
        <Route path="/projects" element={<Projects />} /><Route path="/skills" element={<Skills />} />
        <Route path="/awards" element={<Awards />} /><Route path="/contact" element={<Contact />} />
        <Route path="/links" element={<Links />} /><Route path="*" element={<NotFound />} />
      </Routes>}</main>
    </div>
  </div></EditorContext.Provider>;
}
