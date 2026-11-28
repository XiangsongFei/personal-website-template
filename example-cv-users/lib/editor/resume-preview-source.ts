import {emptyDraft, type ContentLocale, type LocalDraft} from './draft.ts';
import {introductionText, parseIntroduction} from './introduction-dto.ts';
import {buildPreview, type GuideOverrides} from './preview-model.ts';
import {applyTextContent, isTextSection, parseTextSnapshot, textSections, type TextSection} from './resume-text.ts';

type Source =
  | {kind:'local'; draft:LocalDraft; guides:GuideOverrides; showExamples:boolean}
  | {kind:'saved'; siteId:string; introduction:unknown; sections:readonly unknown[]}
  | {kind:'published'; revision:number; draft:LocalDraft};

/** Source selection is pure. Authorization and published field projection happen upstream. */
export function resumePreviewSource(source: Source, locale: ContentLocale) {
  if(source.kind==='local')return {kind:source.kind,locale,preview:buildPreview(source.draft,source.guides,source.showExamples)};
  if(source.kind==='published'){
    if(!Number.isSafeInteger(source.revision)||source.revision<1)return;
    return {kind:source.kind,locale,revision:source.revision,preview:buildPreview(source.draft,{},false)};
  }
  const introduction=parseIntroduction(source.introduction);
  if(introduction?.siteId!==source.siteId)return;
  let draft={...emptyDraft,introduction:introductionText(introduction)};
  const loaded=new Set<TextSection>();
  const revisions: Partial<Record<TextSection|'introduction',number>>={introduction:introduction.revision};
  for(const value of source.sections){
    const section=(value as {section?:unknown}|null)?.section;
    if(!isTextSection(section)||loaded.has(section))return;
    const snapshot=parseTextSnapshot(value,section);
    if(snapshot?.siteId!==source.siteId)return;
    draft=applyTextContent(draft,section,snapshot.content);
    loaded.add(section);
    revisions[section]=snapshot.revision;
  }
  if(loaded.size!==textSections.length)return;
  return {kind:source.kind,locale,revisions,preview:buildPreview(draft,{},false)};
}
