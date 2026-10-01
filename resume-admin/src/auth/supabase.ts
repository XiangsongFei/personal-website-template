import { createClient, type AuthChangeEvent, type SupabaseClient } from "@supabase/supabase-js";

export type AdminIdentity = { id: string; email: string | null; sessionKey: string };
export type AdminTarget = { resumeId: string; siteKey: string; role: "owner" | "qa" };
export type AdminIdentityAndAccess = { identity: AdminIdentity | null; allowed: boolean; target?: AdminTarget | null };

export interface AdminAuthClient {
  getIdentity(): Promise<AdminIdentity | null>;
  /** Concurrently validates the current session with Auth and the admin RPC. */
  getIdentityAndAccess?(): Promise<AdminIdentityAndAccess>;
  getAdminTarget?(): Promise<AdminTarget>;
  signIn(email: string, password: string): Promise<void>;
  isResumeAdmin(): Promise<boolean>;
  signOut(): Promise<void>;
  subscribe(listener: (event: AuthChangeEvent, sessionKey: string | null) => void): () => void;
}

type SessionLike = { access_token: string; user: { id: string } };

/** A stable, non-authoritative key used only to coalesce work within one Auth session. */
function authSessionKey(session: SessionLike): string {
  try {
    const payload = session.access_token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64 + "=".repeat((4 - base64.length % 4) % 4))) as { session_id?: unknown };
    if (typeof claims.session_id === "string" && claims.session_id) return `${session.user.id}:${claims.session_id}`;
  } catch {
    // An opaque token fallback still prevents sharing work across different tokens.
  }
  return `${session.user.id}:${session.access_token}`;
}

export function createAdminSupabaseClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export function createAdminAuthClient(supabase: SupabaseClient): AdminAuthClient {
  const identityChecks = new Map<string, Promise<AdminIdentity>>();
  const accessChecks = new Map<string, Promise<AdminIdentityAndAccess>>();
  return {
    async getIdentity() {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) return null;
      const key = authSessionKey(sessionData.session);
      let check = identityChecks.get(key);
      if (!check) {
        check = (async () => {
          // Confirm the stored session with Auth before authorizing any editor route.
          const { data, error } = await supabase.auth.getUser();
          if (error) throw error;
          if (!data.user || data.user.id !== sessionData.session.user.id) throw new Error("Invalid session");
          const { data: current, error: currentError } = await supabase.auth.getSession();
          if (currentError) throw currentError;
          if (!current.session || authSessionKey(current.session) !== key || current.session.user.id !== data.user.id) {
            throw new Error("Session changed during validation");
          }
          return { id: data.user.id, email: data.user.email ?? null, sessionKey: key };
        })();
        identityChecks.set(key, check);
      }
      try {
        return await check;
      } finally {
        if (identityChecks.get(key) === check) identityChecks.delete(key);
      }
    },
    async getIdentityAndAccess() {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) return { identity: null, allowed: false, target: null };
      const session = sessionData.session;
      const key = authSessionKey(session);
      let check = accessChecks.get(key);
      if (!check) {
        check = (async () => {
          // Both remote checks are required. Use the captured token for getUser
          // so its network request can run alongside the RPC rather than being
          // serialized behind another auth storage-lock acquisition.
          const [userResult, adminResult] = await Promise.all([
            supabase.auth.getUser(session.access_token),
            supabase.rpc("is_resume_admin"),
          ]);
          if (userResult.error) throw userResult.error;
          if (adminResult.error) throw adminResult.error;
          if (!userResult.data.user || userResult.data.user.id !== session.user.id) throw new Error("Invalid session");
          const allowed = adminResult.data === true;
          const target = allowed ? await readAdminTarget(supabase) : null;
          const { data: current, error: currentError } = await supabase.auth.getSession();
          if (currentError) throw currentError;
          if (!current.session || authSessionKey(current.session) !== key || current.session.user.id !== userResult.data.user.id) {
            throw new Error("Session changed during validation");
          }
          return {
            identity: { id: userResult.data.user.id, email: userResult.data.user.email ?? null, sessionKey: key },
            allowed,
            target,
          };
        })();
        accessChecks.set(key, check);
      }
      try {
        return await check;
      } finally {
        if (accessChecks.get(key) === check) accessChecks.delete(key);
      }
    },
    async signIn(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session || !data.user) throw new Error("No session returned");
    },
    async isResumeAdmin() {
      const { data, error } = await supabase.rpc("is_resume_admin");
      if (error) throw error;
      return data === true;
    },
    async getAdminTarget() {
      return readAdminTarget(supabase);
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    subscribe(listener) {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") identityChecks.clear();
        listener(event, session ? authSessionKey(session) : null);
      });
      return () => data.subscription.unsubscribe();
    },
  };
}

export async function readAdminTarget(supabase: SupabaseClient): Promise<AdminTarget> {
  const { data, error } = await supabase.rpc("get_admin_resume_target");
  if (error) throw error;
  const row = Array.isArray(data) ? data.length === 1 ? data[0] : null : data;
  if (!row || typeof row !== "object") throw new Error("No authorized Admin resume target");
  const value = row as Record<string, unknown>;
  if (typeof value.resume_id !== "string" || !value.resume_id
    || typeof value.site_key !== "string" || !value.site_key
    || (value.role !== "owner" && value.role !== "qa")
    || (value.role === "owner" && value.site_key !== "example-cv")
    || (value.role === "qa" && value.site_key !== "example-cv-qa")) {
    throw new Error("Invalid Admin resume target");
  }
  return { resumeId: value.resume_id, siteKey: value.site_key, role: value.role };
}
