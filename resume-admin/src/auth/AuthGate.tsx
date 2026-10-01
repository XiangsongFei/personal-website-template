import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ResumeLoader } from "../data/ResumeLoader";
import type { ResumeRepository } from "../data/resumeRepository";
import { clearAllRouteSnapshots, readRouteSnapshot, type RouteSnapshot } from "../data/routeSnapshot";
import { resumeSectionStore, type ResumeSectionStore } from "../data/resumeSectionStore";
import { isDocumentReloadNavigation } from "../refreshState";
import type { AdminAuthClient, AdminIdentity, AdminTarget } from "./supabase";
import { useUiLocale } from "../uiLocale";
import { AdminSystemShell, AdminSystemState } from "../SystemState";

type AuthState =
  | { kind: "restoring" }
  | { kind: "signedOut" }
  | { kind: "checking"; identity: AdminIdentity }
  | { kind: "authorized"; identity: AdminIdentity; target: AdminTarget | null }
  | { kind: "denied"; identity: AdminIdentity }
  | { kind: "error"; identity: AdminIdentity | null };

export function AuthGate({ client, resumeRepository, sectionStore = resumeSectionStore }: {
  client: AdminAuthClient | null;
  resumeRepository: ResumeRepository | null;
  sectionStore?: ResumeSectionStore;
}) {
  const { t, locale } = useUiLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const isDocumentReload = useRef(isDocumentReloadNavigation()).current;
  const routeSnapshotRef = useRef<RouteSnapshot | null>(null);
  const [state, setState] = useState<AuthState>({ kind: "restoring" });
  const [showCheckingAccess, setShowCheckingAccess] = useState(false);
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
      const current = stateRef.current;
      const alreadyVerified = !forceCheck && current.kind === "authorized"
        && verifiedSessionKey.current === current.identity.sessionKey;
      let identity: AdminIdentity | null;
      let combinedAccess: boolean | undefined;
      let combinedTarget: AdminTarget | null | undefined;
      if (alreadyVerified || !client.getIdentityAndAccess) {
        identity = await client.getIdentity();
        if (alreadyVerified && identity?.sessionKey === current.identity.sessionKey) {
          combinedAccess = true;
          combinedTarget = current.target;
        }
      } else {
        const verification = await client.getIdentityAndAccess();
        identity = verification.identity;
        combinedAccess = verification.allowed;
        combinedTarget = verification.target ?? null;
      }
      if (!mounted.current || currentRequest !== request.current) return;
      if (!identity) {
        clearAllRouteSnapshots();
        routeSnapshotRef.current = null;
        setShowCheckingAccess(false);
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

      const currentState = stateRef.current;
      if (!forceCheck && currentState.kind === "authorized" && currentState.identity.sessionKey === identity.sessionKey
        && verifiedSessionKey.current === identity.sessionKey) return;
      if (combinedAccess !== undefined) {
        if (!mounted.current || currentRequest !== request.current || activeSessionKey.current !== identity.sessionKey) return;
        setShowCheckingAccess(false);
        verifiedSessionKey.current = combinedAccess ? identity.sessionKey : null;
        const target = combinedAccess
          ? combinedTarget ?? await client.getAdminTarget?.() ?? null
          : null;
        if (!mounted.current || currentRequest !== request.current || activeSessionKey.current !== identity.sessionKey) return;
        const targetChanged = currentState.kind === "authorized"
          && currentState.identity.sessionKey === identity.sessionKey
          && (currentState.target?.resumeId !== target?.resumeId
            || currentState.target?.siteKey !== target?.siteKey || currentState.target?.role !== target?.role);
        if (!combinedAccess || targetChanged || (routeSnapshotRef.current && (routeSnapshotRef.current.userId !== identity.id
          || (target && (routeSnapshotRef.current.site.resumeId !== target.resumeId || routeSnapshotRef.current.site.siteKey !== target.siteKey))))) {
          clearAllRouteSnapshots();
          routeSnapshotRef.current = null;
        }
        if (targetChanged) sectionStore.invalidate();
        if (combinedAccess) sectionStore.setSession(identity.sessionKey);
        else sectionStore.invalidate();
        setState(combinedAccess ? { kind: "authorized", identity, target } : { kind: "denied", identity });
      } else {
        const pending = adminChecks.current.get(identity.sessionKey);
        if (pending) return await pending;

        const preserveAuthorized = keepCurrentAdmin && currentState.kind === "authorized"
          && currentState.identity.sessionKey === identity.sessionKey;
        if (!preserveAuthorized) setState({ kind: "checking", identity });
        const check = client.isResumeAdmin().then(async allowed => {
          if (!mounted.current || currentRequest !== request.current || activeSessionKey.current !== identity.sessionKey) return;
          setShowCheckingAccess(false);
          verifiedSessionKey.current = allowed ? identity.sessionKey : null;
          const target = allowed ? await client.getAdminTarget?.() ?? null : null;
          if (!mounted.current || currentRequest !== request.current || activeSessionKey.current !== identity.sessionKey) return;
          if (!allowed || (routeSnapshotRef.current && (routeSnapshotRef.current.userId !== identity.id
            || (target && (routeSnapshotRef.current.site.resumeId !== target.resumeId || routeSnapshotRef.current.site.siteKey !== target.siteKey))))) {
            clearAllRouteSnapshots();
            routeSnapshotRef.current = null;
          }
          if (allowed) sectionStore.setSession(identity.sessionKey);
          else sectionStore.invalidate();
          setState(allowed ? { kind: "authorized", identity, target: target ?? null } : { kind: "denied", identity });
        });
        adminChecks.current.set(identity.sessionKey, check);
        try { await check; }
        finally { if (adminChecks.current.get(identity.sessionKey) === check) adminChecks.current.delete(identity.sessionKey); }
      }
    } catch {
      if (mounted.current && currentRequest === request.current) {
        clearAllRouteSnapshots();
        routeSnapshotRef.current = null;
        setShowCheckingAccess(false);
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
        setShowCheckingAccess(false);
        clearAllRouteSnapshots();
        routeSnapshotRef.current = null;
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
          setShowCheckingAccess(event === "SIGNED_IN");
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
    setShowCheckingAccess(true);
    try {
      await client.signIn(email, password);
      if (mounted.current) {
        navigate("/overview", { replace: true });
        await restore();
      }
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
        clearAllRouteSnapshots();
        routeSnapshotRef.current = null;
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

  if (!client) return <AdminSystemState title={t("Configuration required")} description={locale === "zh" ? <><span className="configuration-required-chinese-sentence">{t("Admin setup is incomplete.")}</span><span className="configuration-required-chinese-sentence">{t("Please contact the administrator.")}</span></> : t("Admin setup is incomplete. Please contact the administrator.")} className="configuration-required-state" />;
  if (state.kind === "restoring" || state.kind === "checking") {
    return showCheckingAccess
      ? <AdminSystemState title={t("Checking access")} description={t("Please wait while your session and admin access are verified.")} busy />
      : null;
  }
  if (state.kind === "signedOut") return <AdminSystemShell>
    <h1>{t("Welcome back")}</h1><p className="auth-login-description">{t("Sign in to continue managing your resume.")}</p>
    <form onSubmit={submit}>
      <label htmlFor="auth-email">{t("Email")}</label><input id="auth-email" name="email" type="email" autoComplete="username" placeholder={t("Enter your email")} required />
      <label htmlFor="auth-password">{t("Password")}</label><input id="auth-password" name="password" type="password" autoComplete="current-password" placeholder={t("Enter your password")} required />
      {loginError && <p className="auth-error" role="alert">{loginError}</p>}
      <button type="submit" disabled={loginPending}>{loginPending ? t("Signing in…") : t("Sign in")}</button>
    </form>
  </AdminSystemShell>;
  if (state.kind === "authorized") {
    const snapshot = isDocumentReload
      ? readRouteSnapshot(location.pathname, state.identity.id, state.target?.resumeId)
      : null;
    const matchingSnapshot = snapshot && (!state.target || snapshot.site.siteKey === state.target.siteKey) ? snapshot : null;
    routeSnapshotRef.current = matchingSnapshot;
    return <ResumeLoader key={matchingSnapshot ? `snapshot:${matchingSnapshot.route}:${matchingSnapshot.userId}:${matchingSnapshot.site.resumeId}` : `authorized:${state.identity.sessionKey}:${state.target?.resumeId ?? "unresolved"}`}
      repository={resumeRepository} sessionKey={state.identity.sessionKey} identityEmail={state.identity.email} identityId={state.identity.id}
      authReady initialSnapshot={matchingSnapshot} authorizedTarget={state.target} onSignOut={() => void signOut()} signOutPending={signOutPending}
      signOutError={signOutError} sectionStore={sectionStore} />;
  }
  if (state.kind === "denied") return <AdminSystemState title={t("Access denied")} description={`${t("This account is not authorized to edit this resume.")}${state.identity.email ? ` (${state.identity.email})` : ""}`} action={<><button type="button" onClick={() => void signOut()} disabled={signOutPending}>{t("Sign Out")}</button>{signOutError && <p className="auth-error" role="alert">{signOutError}</p>}</>} />;
  return <AdminSystemState title={t("Unable to check access")} description={t("The session or administrator check failed. Please retry.")} action={<><button type="button" onClick={() => { setShowCheckingAccess(true); void restore(); }}>{t("Retry")}</button>{state.identity && <button type="button" onClick={() => void signOut()} disabled={signOutPending}>{t("Sign Out")}</button>}{signOutError && <p className="auth-error" role="alert">{signOutError}</p>}</>} />;
}
