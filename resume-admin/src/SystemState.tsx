import type { ReactNode } from "react";
import { UiLocaleSwitch, useUiLocale } from "./uiLocale";

export function AdminSystemShell({ children }: { children: ReactNode }) {
  const { t } = useUiLocale();
  return <main className="auth-screen auth-login-screen">
    <section className="auth-card auth-login-content">
      <header className="auth-login-header">
        <div className="auth-login-brand"><span>EXAMPLE_CV</span><span>{t("Resume CMS")}</span></div>
        <UiLocaleSwitch />
      </header>
      {children}
    </section>
  </main>;
}

export function AdminSystemState({ title, description, busy = false, action, className = "" }: {
  title: string;
  description: ReactNode;
  busy?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  return <AdminSystemShell>
    <SystemStateContent title={title} description={description} busy={busy} action={action} className={`auth-system-state-content${className ? ` ${className}` : ""}`} />
  </AdminSystemShell>;
}

export function SystemStateContent({ eyebrow, title, description, busy = false, action, className = "" }: {
  eyebrow?: string;
  title: string;
  description: ReactNode;
  busy?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  return <section className={`system-state-content${className ? ` ${className}` : ""}`} aria-busy={busy}>
    {eyebrow && <p className="eyebrow">{eyebrow}</p>}
    <h1>{title}</h1>
    <p className="system-state-description" role={busy ? "status" : "alert"} aria-live="polite">{description}</p>
    {action && <div className="system-state-actions">{action}</div>}
  </section>;
}
