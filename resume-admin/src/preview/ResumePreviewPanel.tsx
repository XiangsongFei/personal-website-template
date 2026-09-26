import { useLayoutEffect, useRef, useState } from "react";
import type { ResumeContent } from "../../../app/data/resume";
import type { Locale } from "../model";
import { useUiLocale } from "../uiLocale";
import "./preview.css";

export type PreviewSection = "profile" | "education" | "introduction" | "experience" | "projects" | "skills" | "awards" | "contact" | "links";

const PUBLIC_PAGE_WIDTH = 980;

function PreviewLink({ href, label, icon }: { href: string; label: string; icon: "mail" | "file" | "linkedin" | "github" }) {
  const iconContent = icon === "mail"
    ? <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>
    : icon === "file"
      ? <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h6"/></>
      : icon === "linkedin"
        ? <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r=".8"/><path d="M8 11v6M12 17v-3.8c0-1.4.9-2.3 2.1-2.3s2.1.9 2.1 2.3V17M12 11v6"/></>
        : <path d="M12 2.4a9.6 9.6 0 0 0-3.03 18.71c.48.09.66-.21.66-.47v-1.68c-2.68.58-3.24-1.13-3.24-1.13-.44-1.12-1.07-1.42-1.07-1.42-.87-.6.07-.59.07-.59.97.07 1.48 1 1.48 1 .86 1.48 2.25 1.05 2.8.8.09-.63.34-1.05.62-1.29-2.14-.24-4.39-1.07-4.39-4.76 0-1.05.38-1.91.99-2.58-.1-.24-.43-1.22.1-2.54 0 0 .81-.26 2.64.98A9.15 9.15 0 0 1 12 6.6c.82 0 1.64.11 2.41.33 1.83-1.24 2.64-.98 2.64-.98.53 1.32.2 2.3.1 2.54.62.67.99 1.53.99 2.58 0 3.7-2.25 4.51-4.4 4.75.35.3.65.86.65 1.74v2.58c0 .26.17.56.66.47A9.6 9.6 0 0 0 12 2.4Z"/>;

  return <a className="resume-preview-action" href={href} target={icon === "mail" ? undefined : "_blank"} rel={icon === "mail" ? undefined : "noreferrer"}>
    <svg className={`resume-preview-action-icon is-${icon}`} viewBox="0 0 24 24" aria-hidden="true">{iconContent}</svg>
    <span>{label}</span><svg className="resume-preview-external-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>
  </a>;
}

export function ResumePreviewPanel({ content, section, locale, statusMessage, onLocaleChange }: {
  content: ResumeContent | null;
  section: PreviewSection;
  locale: Locale;
  statusMessage: string;
  onLocaleChange: (locale: Locale) => void;
}) {
  const { t } = useUiLocale();
  const text = content?.locales[locale];
  const panelRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const educationRef = useRef<HTMLElement>(null);
  const [scale, setScale] = useState(1);
  const [canvasHeight, setCanvasHeight] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateScale = () => {
      if (viewport.clientWidth > 0) setScale(Math.min(1, viewport.clientWidth / PUBLIC_PAGE_WIDTH));
    };
    updateScale();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateScale);
      observer.observe(viewport);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateHeight = () => setCanvasHeight(canvas.offsetHeight || canvas.scrollHeight);
    updateHeight();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateHeight);
      observer.observe(canvas);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, [content, locale, section]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const targetId = section === "education" || section === "experience" || section === "projects" || section === "skills" || section === "awards" || section === "contact"
      ? `preview-${section}` : "preview-about";
    const focusTarget = () => {
      const target = viewport.querySelector<HTMLElement>(`#${targetId}`);
      if (!target || panelRef.current?.getBoundingClientRect().width === 0) return false;
      const distance = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      viewport.scrollTop += distance;
      return true;
    };
    const frame = requestAnimationFrame(focusTarget);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        if (focusTarget()) observer?.disconnect();
      });
      observer.observe(viewport);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [section, scale]);

  return <aside ref={panelRef} className="resume-preview-panel" aria-label={t("Resume preview")}>
    <div className="resume-preview-toolbar">
      <h2>{t("Preview")}</h2>
      <div className="resume-preview-languages" role="group" aria-label={t("Preview language")}>
        <button type="button" aria-label={t("Preview Chinese")} aria-pressed={locale === "zh"} onClick={() => onLocaleChange("zh")}>中文</button>
        <span aria-hidden="true">|</span>
        <button type="button" aria-label={t("Preview English")} aria-pressed={locale === "en"} onClick={() => onLocaleChange("en")}>English</button>
      </div>
    </div>
    <div className="resume-preview-viewport" ref={viewportRef} data-testid="resume-preview" data-preview-focus={section === "profile" || section === "introduction" || section === "links" ? "about" : section} lang={locale}>
      {!content && <p className="resume-preview-empty" aria-live="polite">{statusMessage}</p>}
      {content && text && <div className="resume-preview-stage" style={{ height: `${canvasHeight * scale}px` }}>
        <div className="resume-preview-canvas" ref={canvasRef} style={{ transform: `scale(${scale})` }}>
          <div className="resume-preview-page">
            <div className="resume-preview-sticky-nav">
              <nav aria-label="Public resume navigation">
                <a className="resume-preview-nav-name" href="#preview-about">{content.profile.navAboutLabel[locale]}</a>
                <div className="resume-preview-nav-links">
                  {text.nav.map((item, index) => {
                    const id = ["experience", "projects", "skills", "awards", "contact"][index] ?? "education";
                    return <a aria-label={`${t("Resume preview")} ${item}`} href={`#preview-${id}`} key={`${item}-${index}`} onClick={event => {
                      event.preventDefault();
                      const target = viewportRef.current?.querySelector<HTMLElement>(`#preview-${id}`);
                      const viewport = viewportRef.current;
                      if (target && viewport) viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
                    }}>{item}</a>;
                  })}
                  <button type="button" aria-label={t("Preview language")} onClick={() => onLocaleChange(locale === "zh" ? "en" : "zh")}>{locale === "zh" ? "EN" : "中文"}</button>
                </div>
              </nav>
            </div>
            <section className="resume-preview-hero" id="preview-about">
              <div className="resume-preview-hero-grid">
                <div className="resume-preview-hero-copy">
                  <h1 className={locale === "en" ? "is-english" : ""}>{content.profile.name[locale]}</h1>
                  <div className="resume-preview-intro">{text.intro.map((paragraph, index) => <p key={`${index}-${paragraph}`}>{paragraph}</p>)}</div>
                  <div className="resume-preview-actions">
                    {content.publicLinks.email && <PreviewLink href={`mailto:${content.publicLinks.email}`} label={content.profile.emailActionLabel[locale]} icon="mail"/>}
                    {text.portfolioHref && <PreviewLink href={text.portfolioHref} label={text.portfolioLabel} icon="file"/>}
                    {text.linkedInHref && <PreviewLink href={text.linkedInHref} label={content.publicLinks.linkedInLabel} icon="linkedin"/>}
                    {content.publicLinks.github && <PreviewLink href={content.publicLinks.github} label={content.publicLinks.githubLabel} icon="github"/>}
                  </div>
                  <div className="resume-preview-graduation">
                    <span>{content.profile.graduationLabel[locale]}</span>
                    <strong>{content.profile.graduationValue}</strong>
                  </div>
                </div>
                <aside className="resume-preview-portrait" aria-label={content.profile.avatarLabel[locale]}>
                  <div>{content.profile.avatarInitials}</div>
                </aside>
              </div>
            </section>
            <section className="resume-preview-education-section" id="preview-education" ref={educationRef}>
              <div className="resume-preview-section-label">{text.education}</div>
              <div className="resume-preview-education-list">
                {(section === "profile" ? text.edu.slice(0, 1) : text.edu).map(entry => <article className={`resume-preview-education-entry${entry.entryType === "summerSchool" ? " is-summer-school" : ""}`} key={entry.id}>
                  <div className="resume-preview-education-copy">
                    <h3>{entry.title}</h3>
                    <p className="resume-preview-program">{entry.program}</p>
                    {entry.entryType === "summerSchool" && <>
                      {entry.courseTitle && <p className="resume-preview-course-title">{entry.courseTitle}</p>}
                      {entry.courseDescription && <p className="resume-preview-course-description">{entry.courseDescription}</p>}
                    </>}
                  </div>
                  <div className="resume-preview-education-meta">
                    <strong>{entry.period}</strong>
                    {entry.grade && <span>{entry.grade.split(" · ").map((value, index) => <span className="resume-preview-grade" key={`${index}-${value}`}>{value}</span>)}</span>}
                  </div>
                </article>)}
                {text.edu.length === 0 && <p className="resume-preview-empty">{locale === "zh" ? "暂无教育经历" : "No education entries"}</p>}
              </div>
            </section>
            <section className="resume-preview-content-section resume-preview-experience" id="preview-experience">
              <div className="resume-preview-section-label">{text.experience}</div>
              <div className="resume-preview-timeline">
                {text.jobs.map(job => <article key={job.id}>
                  <div>
                    <h3>{job.organization}</h3>
                    <p className="resume-preview-job-title">{job.title}</p>
                    {job.location && <p className="resume-preview-job-location">{job.location}</p>}
                    <span className="resume-preview-mobile-period">{job.period}</span>
                    <ul className="resume-preview-bullets">{toBullets(job.description, locale).map((bullet, index) => <li key={`${index}-${bullet}`}>{bullet}</li>)}</ul>
                  </div>
                  <div className="resume-preview-entry-meta"><strong>{job.period}</strong></div>
                </article>)}
                {text.jobs.length === 0 && <p className="resume-preview-empty">{locale === "zh" ? "暂无工作经历" : "No experience entries"}</p>}
              </div>
            </section>
            <section className="resume-preview-content-section resume-preview-projects" id="preview-projects">
              <div className="resume-preview-section-label">{text.projectHeading}</div>
              <div className="resume-preview-timeline">
                {text.projects.map(project => <article key={project.id}>
                  <div>
                    <h3>{project.title}</h3>
                    <p className="resume-preview-project-subtitle">{project.subtitle}</p>
                    <span className="resume-preview-mobile-period">{project.period}</span>
                    <p className="resume-preview-project-methods">{project.methods.join(" · ")}</p>
                    <ul className="resume-preview-bullets">{toBullets(project.description, locale).map((bullet, index) => <li key={`${index}-${bullet}`}>{bullet}</li>)}</ul>
                    {project.href && <a className="resume-preview-project-link" href={project.href} target="_blank" rel="noreferrer">{text.kaggleLabel} <span>↗</span></a>}
                  </div>
                  <div className="resume-preview-entry-meta"><strong>{project.period}</strong></div>
                </article>)}
                {text.projects.length === 0 && <p className="resume-preview-empty">{locale === "zh" ? "暂无项目经历" : "No projects"}</p>}
              </div>
            </section>
            <section className="resume-preview-content-section resume-preview-skills" id="preview-skills">
              <div className="resume-preview-section-label">{text.skills}</div>
              <div className="resume-preview-skill-list">
                {text.skillGroups.map(group => <div key={group.id}><strong>{group.title}</strong><span>{group.items}</span></div>)}
                {text.skillGroups.length === 0 && <p className="resume-preview-empty">{locale === "zh" ? "暂无技能" : "No skills"}</p>}
              </div>
            </section>
            <section className="resume-preview-content-section resume-preview-awards" id="preview-awards">
              <div className="resume-preview-section-label">{text.honors}</div>
              <div className="resume-preview-award-list">
                {text.honorsList.map(award => <article key={award.id}><h3>{award.name}</h3><strong>{award.year}</strong></article>)}
                {text.honorsList.length === 0 && <p className="resume-preview-empty">{locale === "zh" ? "暂无奖项" : "No awards"}</p>}
              </div>
            </section>
            <div className="resume-preview-contact-area" id="preview-contact">
              <footer>
                <p className="resume-preview-contact-label">{text.contact}</p>
                <h2>{text.availability}</h2>
                <div className="resume-preview-contact-links">
                  <div><span>{content.publicLinks.emailLabel}</span><a href={`mailto:${content.publicLinks.email}`}>{content.publicLinks.email} <b aria-hidden="true">↗</b></a></div>
                  <div><span>{text.linkedInLabel}</span><a aria-label={`${content.publicLinks.linkedInLabel}: ${content.publicLinks.linkedInDisplayName}`} href={text.linkedInHref} target="_blank" rel="noreferrer">{content.publicLinks.linkedInDisplayName} <b aria-hidden="true">↗</b></a></div>
                </div>
                <div className="resume-preview-footer-meta"><span>{content.profile.footerName}</span><span>{text.updatedAt}</span><span>{content.profile.copyright}</span></div>
              </footer>
              <section className="resume-preview-contact-extension" aria-label={text.contact}>
                <div>
                  <h3>{content.profile.contactFocusHeading[locale]}</h3>
                  <div className="resume-preview-focus-list">
                    {text.contactFocusItems.map(([title, detail], index) => <article key={`${index}-${title}`}><p>{title}</p>{detail && <span>{detail}</span>}</article>)}
                    {text.contactFocusItems.length === 0 && <p className="resume-preview-empty">{locale === "zh" ? "暂无当前重点" : "No current focus items"}</p>}
                  </div>
                </div>
                <div>
                  <h3>{content.profile.contactStatusHeading[locale]}</h3>
                  <div className="resume-preview-status-list">
                    {text.contactStatusItems.map((item, index) => <article key={`${index}-${item.type}-${item.title}`} data-status-type={item.type}><span aria-hidden="true">{item.type === "study" ? "◷" : item.type === "graduation" ? "✓" : "↗"}</span><div><p>{item.title}</p>{item.detail && <small>{item.detail}</small>}</div></article>)}
                    {text.contactStatusItems.length === 0 && <p className="resume-preview-empty">{locale === "zh" ? "暂无当前状态" : "No current status items"}</p>}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>}
    </div>
  </aside>;
}

function toBullets(value: string, locale: Locale): string[] {
  const parts = value.includes("\n") ? value.split("\n") : value.split(locale === "zh" ? /[；。]/ : /\.\s+(?=[A-Z])/);
  return parts.map(item => item.trim()).filter(Boolean);
}
