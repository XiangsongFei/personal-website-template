import type { Locale, SectionKey } from "./model";

export type BilingualFieldIdentity = { section: SectionKey; itemId: string; field: string };
export type BilingualReviewReminder = BilingualFieldIdentity & { sourceLocale: Locale; targetLocale: Locale; sourceSaved: boolean };

export function bilingualFieldKey(identity: BilingualFieldIdentity, locale: Locale): string {
  return JSON.stringify([identity.section, identity.itemId, identity.field, locale]);
}

function stableItemId(item: { id: string; sourceKey?: string | null }): string {
  return item.sourceKey || item.id;
}

export function collectChangedBilingualFieldKeys(section: SectionKey, draft: unknown, confirmed: unknown, locales: readonly Locale[] = ["zh", "en"]): Set<string> {
  const changed = new Set<string>();
  const addTranslations = (itemId: string, next: unknown, base: unknown) => {
    if (!next || !base || typeof next !== "object" || typeof base !== "object") return;
    for (const locale of locales) {
      const nextFields = (next as Record<string, Record<string, unknown>>)[locale];
      const baseFields = (base as Record<string, Record<string, unknown>>)[locale];
      if (!nextFields || !baseFields) continue;
      for (const field of new Set([...Object.keys(nextFields), ...Object.keys(baseFields)])) {
        if (JSON.stringify(nextFields[field]) !== JSON.stringify(baseFields[field])) changed.add(bilingualFieldKey({ section, itemId, field }, locale));
      }
    }
  };
  const arrays = (next: unknown, base: unknown) => {
    const left = Array.isArray(next) ? next : [];
    const right = Array.isArray(base) ? base : [];
    const byId = new Map(right.filter(value => value && typeof value.id === "string").map(value => [value.id as string, value]));
    for (const item of left) if (item && typeof item.id === "string") addTranslations(stableItemId(item), item.translations, byId.get(item.id)?.translations);
  };

  if (section === "profile") {
    const next = draft as { translations?: unknown } | null;
    const base = confirmed as { translations?: unknown } | null;
    addTranslations("profile", next?.translations ?? draft, base?.translations ?? confirmed);
  } else if (section === "introduction" || section === "education" || section === "experience" || section === "projects" || section === "skills" || section === "awards") {
    arrays(draft, confirmed);
    if (section === "projects") {
      const next = Array.isArray(draft) ? draft as Array<{ id: string; methods?: Record<Locale, Array<{ id: string; value: string }>> }> : [];
      const confirmedProjects = Array.isArray(confirmed) ? confirmed as Array<{ id: string; methods?: Record<Locale, Array<{ id: string; value: string }>> }> : [];
      const base = new Map<string, { methods?: Record<Locale, Array<{ id: string; value: string }>> }>(confirmedProjects.map(item => [item.id, item]));
      for (const project of next) for (const locale of locales) {
        const oldMethods = base.get(project.id)?.methods?.[locale] ?? [];
        const oldById = new Map(oldMethods.map(method => [method.id, method]));
        for (const method of project.methods?.[locale] ?? []) if (oldById.get(method.id)?.value !== method.value)
          changed.add(bilingualFieldKey({ section, itemId: stableItemId(project), field: `method:${method.id}` }, locale));
      }
    }
  } else if (section === "contact") {
    const next = draft as { translations?: unknown; focus?: unknown; status?: unknown } | null;
    const base = confirmed as { translations?: unknown; focus?: unknown; status?: unknown } | null;
    addTranslations("contact", next?.translations, base?.translations);
    arrays(next?.focus, base?.focus);
    arrays(next?.status, base?.status);
  } else if (section === "links") {
    const next = draft as { translations?: unknown; navigation?: unknown } | null;
    const base = confirmed as { translations?: unknown; navigation?: unknown } | null;
    addTranslations("links", next?.translations, base?.translations);
    arrays(next?.navigation, base?.navigation);
  }
  return changed;
}
