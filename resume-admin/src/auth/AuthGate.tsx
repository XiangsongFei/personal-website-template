import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ResumeLoader } from "../data/ResumeLoader";
import type { ResumeRepository } from "../data/resumeRepository";
import { resumeSectionStore, type ResumeSectionStore } from "../data/resumeSectionStore";
import type { AdminAuthClient, AdminIdentity } from "./supabase";
import { UiLocaleSwitch, useUiLocale } from "../uiLocale";

type AuthState =
  | { kind: "restoring" }
  | { kind: "signedOut" }
  | { kind: "checking"; identity: AdminIdentity }
  | { kind: "authorized"; identity: AdminIdentity }
  | { kind: "denied"; identity: AdminIdentity }
  | { kind: "error"; identity: AdminIdentity | null };

export function AuthGate({ client, resumeRepository, sectionStore = resumeSectionStore }: {
  client: AdminAuthClient | null;
  resumeRepository: ResumeRepository | null;
  sectionStore?: ResumeSectionStore;
}) {
  const { t } = useUiLocale();
  const [state, setState] = useState<AuthState>({ kind: "restoring" });
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const request = useRef(0);
  const mounted = useRef(false);
  const stateRef = useRef(state);
  const activeSessionKey = useRef<string | null>(null);
  const hasObservedSession = useRef(false);
  const verifiedSessionKey = useRef<string | null>(null);
  const adminChecks = useRef(new Map<string, Promise<void>>());
  stateRef.current = state;

  const restore = useCallback(async (expectedSessionKey?: string, forceCheck = false, keepCurrentAdmin = false) => {
    if (!client) return;
    const currentRequest = request.current;
    const previous = stateRef.current;
    if (!keepCurrentAdmin || previous.kind !== "authorized") setState({ kind: "restoring" });
    try {
      const identity = await client.getIdentity();
      if (!mounted.current || currentRequest !== request.current) return;
      if (!identity) {
        hasObservedSession.current = true;
        activeSessionKey.current = null;
        verifiedSessionKey.current = null;
        sectionStore.invalidate();
        setState({ kind: "signedOut" });
        return;
      }
      if (expectedSessionKey && expectedSessionKey !== identity.sessionKey) return;
      if (hasObservedSession.current && activeSessionKey.current && activeSessionKey.current !== identity.sessionKey) return;
      activeSessionKey.current = identity.sessionKey;
      hasObservedSession.current = true;

      const current = stateRef.current;
      if (!forceCheck && current.kind === "authorized" && current.identity.sessionKey === identity.sessionKey
        && verifiedSessionKey.current === identity.sessionKey) return;
      const pending = adminChecks.current.get(identity.sessionKey);
      if (pending) return await pending;

      const preserveAuthorized = keepCurrentAdmin && current.kind === "authorized"
        && current.identity.sessionKey === identity.sessionKey;
      if (!preserveAuthorized) setState({ kind: "checking", identity });
      const check = client.isResumeAdmin().then(allowed => {
        if (!mounted.current || currentRequest !== request.current || activeSessionKey.current !== identity.sessionKey) return;
        verifiedSessionKey.current = allowed ? identity.sessionKey : null;
        if (allowed) sectionStore.setSession(identity.sessionKey);
        else sectionStore.invalidate();
        setState(allowed ? { kind: "authorized", identity } : { kind: "denied", identity });
      });
      adminChecks.current.set(identity.sessionKey, check);
      try { await check; }
      finally { if (adminChecks.current.get(identity.sessionKey) === check) adminChecks.current.delete(identity.sessionKey); }
    } catch {
      if (mounted.current && currentRequest === request.current) {
        verifiedSessionKey.current = null;
        sectionStore.invalidate();
        setState({ kind: "error", identity: null });
      }
    }
  }, [client, sectionStore]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const requestCounter = request;
    if (!client) return () => { active = false; mounted.current = false; ++requestCounter.current; };
    const unsubscribe = client.subscribe((event, sessionKey) => {
      if (!active) return;
      if (event === "SIGNED_OUT") {
        ++request.current;
        hasObservedSession.current = true;
        activeSessionKey.current = null;
        verifiedSessionKey.current = null;
        adminChecks.current.clear();
        sectionStore.invalidate();
        setState({ kind: "signedOut" });
        setSignOutError("");
      } else if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        if (!sessionKey) return; // The explicit initial restoration handles an empty session.
        const sameSession = hasObservedSession.current && activeSessionKey.current === sessionKey;
        if (!sameSession) {
          ++request.current;
          hasObservedSession.current = true;
          activeSessionKey.current = sessionKey;
          verifiedSessionKey.current = null;
          sectionStore.invalidate();
          setState({ kind: "restoring" });
        }
        if (sameSession && adminChecks.current.has(sessionKey)) return;
        if ((event === "INITIAL_SESSION" || event === "SIGNED_IN") && sameSession
          && verifiedSessionKey.current === sessionKey) return;
        const current = stateRef.current;
        const keepCurrent = sameSession && current.kind === "authorized" && current.identity.sessionKey === sessionKey;
        // Supabase warns against awaiting Auth methods within this callback.
        queueMicrotask(() => {
          if (active && mounted.current) void restore(sessionKey, event === "TOKEN_REFRESHED" || event === "USER_UPDATED", keepCurrent);
        });
      }
    });
    void restore();
    return () => {
      active = false;
      mounted.current = false;
      ++requestCounter.current;
      sectionStore.invalidate();
      unsubscribe();
    };
  }, [client, restore, sectionStore]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || loginPending) return;
    const form = event.currentTarget;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    setLoginPending(true);
    setLoginError("");
    try {
      await client.signIn(email, password);
      if (mounted.current) await restore();
    } catch {
      if (mounted.current) setLoginError(t("Unable to sign in. Check your email and password."));
    } finally {
      if (mounted.current) setLoginPending(false);
    }
  }

  async function signOut() {
    if (!client || signOutPending) return;
    setSignOutPending(true);
    setSignOutError("");
    try {
      await client.signOut();
      if (mounted.current) {
        ++request.current;
        hasObservedSession.current = true;
        activeSessionKey.current = null;
        verifiedSessionKey.current = null;
        adminChecks.current.clear();
        sectionStore.invalidate();
        setState({ kind: "signedOut" });
      }
    } catch {
      if (mounted.current) setSignOutError(t("Unable to sign out. Please try again."));
    } finally {
      if (mounted.current) setSignOutPending(false);
    }
  }

  if (!client) return <AuthScreen title={t("Configuration required")} message={t("Set the local Supabase URL and publishable key to use the admin app.")} />;
  if (state.kind === "restoring" || state.kind === "checking") return null;
  if (state.kind === "signedOut") return <div className="auth-screen"><div className="auth-card">
    <UiLocaleSwitch /><p className="auth-eyebrow">{t("Example CV CMS")}</p><h1>{t("Sign in")}</h1><p>{t("Use your administrator account to continue.")}</p>
    <form onSubmit={submit}>
      <label htmlFor="auth-email">{t("Email")}</label><input id="auth-email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="auth-password">{t("Password")}</label><input id="auth-password" name="password" type="password" autoComplete="current-password" required />
      {loginError && <p className="auth-error" role="alert">{loginError}</p>}
      <button type="submit" disabled={loginPending}>{loginPending ? t("Signing in…") : t("Sign in")}</button>
    </form>
  </div></div>;
  if (state.kind === "authorized") return <ResumeLoader key={state.identity.sessionKey} repository={resumeRepository} sessionKey={state.identity.sessionKey} identityEmail={state.identity.email}
    onSignOut={() => void signOut()} signOutPending={signOutPending} signOutError={signOutError} sectionStore={sectionStore} />;
  if (state.kind === "denied") return <AuthScreen title={t("Access denied")} message={`${t("This account is not authorized to edit this resume.")}${state.identity.email ? ` (${state.identity.email})` : ""}`} action={<><button type="button" onClick={() => void signOut()} disabled={signOutPending}>{t("Sign Out")}</button>{signOutError && <p className="auth-error" role="alert">{signOutError}</p>}</>} />;
  return <AuthScreen title={t("Unable to check access")} message={t("The session or administrator check failed. Please retry.")} action={<><button type="button" onClick={() => void restore()}>{t("Retry")}</button>{state.identity && <button type="button" onClick={() => void signOut()} disabled={signOutPending}>{t("Sign Out")}</button>}{signOutError && <p className="auth-error" role="alert">{signOutError}</p>}</>} />;
}

function AuthScreen({ title, message, busy = false, action }: { title: string; message: string; busy?: boolean; action?: React.ReactNode }) {
  const { t } = useUiLocale();
  return <div className="auth-screen"><div className="auth-card" aria-busy={busy}>
    <UiLocaleSwitch /><p className="auth-eyebrow">{t("Example CV CMS")}</p><h1>{title}</h1><p role={busy ? "status" : undefined}>{message}</p>{action && <div className="auth-actions">{action}</div>}
  </div></div>;
}
