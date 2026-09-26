import { adaptResumeRows, type ResumeDatabaseRows } from "../app/data/resume-adapter";

export type ResumeApiEnv = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};

type TableName = Exclude<keyof ResumeDatabaseRows, "resume_sites">;

const tableColumns: Record<TableName, string> = {
  resume_profile: "resume_id,graduation_value,avatar_initials,photo_url,footer_name,copyright",
  resume_profile_translations: "resume_id,locale,name,nav_about_label,email_action_label,graduation_label,avatar_label,contact_focus_heading,contact_status_heading",
  resume_public_links: "resume_id,email,github,github_label,linkedin_display_name,email_label,linkedin_label",
  resume_locale_content: "resume_id,locale,education_label,experience_label,project_heading,skills_label,honors_label,contact_label,availability,portfolio_label,portfolio_href,kaggle_label,updated_at_label,linkedin_label,linkedin_href",
  resume_intro_paragraphs: "id,resume_id,position,source_key",
  resume_intro_paragraph_translations: "paragraph_id,resume_id,locale,text",
  resume_navigation_items: "id,resume_id,position,source_key",
  resume_navigation_item_translations: "navigation_item_id,resume_id,locale,label",
  resume_education_entries: "id,resume_id,source_key,position,entry_type",
  resume_education_translations: "education_entry_id,resume_id,locale,title,program,period,grade,course_title,course_description",
  resume_experience_entries: "id,resume_id,source_key,position",
  resume_experience_translations: "experience_entry_id,resume_id,locale,organization,title,period,description,location",
  resume_project_entries: "id,resume_id,source_key,position",
  resume_project_translations: "project_entry_id,resume_id,locale,title,subtitle,period,description,href",
  resume_project_methods: "id,resume_id,project_entry_id,locale,position,value",
  resume_skill_groups: "id,resume_id,source_key,position",
  resume_skill_group_translations: "skill_group_id,resume_id,locale,title,items",
  resume_award_entries: "id,resume_id,source_key,position",
  resume_award_translations: "award_entry_id,resume_id,locale,name,year",
  resume_contact_focus_items: "id,resume_id,position",
  resume_contact_focus_translations: "focus_item_id,resume_id,locale,title,detail",
  resume_contact_status_items: "id,resume_id,position,status_type",
  resume_contact_status_translations: "status_item_id,resume_id,locale,title,detail",
};

const noStore = { "Cache-Control": "no-store" };

export function isResumeApiPath(pathname: string): boolean {
  return pathname === "/api/resume";
}

function jsonError(status: number, message: string, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(noStore);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

function assertRowArray(value: unknown, table: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) {
    throw new Error(`Invalid upstream rows for ${table}`);
  }
  return value as Record<string, unknown>[];
}

async function getRows(
  fetcher: typeof fetch,
  supabaseUrl: URL,
  publishableKey: string,
  table: string,
  columns: string,
  resumeId?: string,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set("select", columns);
  if (resumeId) url.searchParams.set("resume_id", `eq.${resumeId}`);
  else {
    url.searchParams.set("site_key", "eq.example-cv");
    url.searchParams.set("is_published", "eq.true");
    url.searchParams.set("limit", "2");
  }

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { apikey: publishableKey, Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    console.error("[api/resume] Supabase request failed", table);
    throw new Error("Upstream request failed");
  }
  if (!response.ok) {
    console.error("[api/resume] Supabase returned an error", table, response.status);
    throw new Error("Upstream response failed");
  }
  try {
    return assertRowArray(await response.json(), table);
  } catch {
    console.error("[api/resume] Supabase returned invalid JSON rows", table);
    throw new Error("Invalid upstream rows");
  }
}

/** Handle the same-origin public resume API using only the anonymous publishable key. */
export async function handleResumeApi(
  request: Request,
  env: ResumeApiEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "GET") {
    return jsonError(405, "Method not allowed", { Allow: "GET" });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    console.error("[api/resume] Required Supabase bindings are missing");
    return jsonError(503, "Resume service unavailable");
  }

  let supabaseUrl: URL;
  try {
    supabaseUrl = new URL(env.SUPABASE_URL);
    if (supabaseUrl.protocol !== "https:") throw new Error("Invalid protocol");
  } catch {
    console.error("[api/resume] Supabase URL binding is invalid");
    return jsonError(503, "Resume service unavailable");
  }

  try {
    const sites = await getRows(
      fetcher,
      supabaseUrl,
      env.SUPABASE_PUBLISHABLE_KEY,
      "resume_sites",
      "id,site_key,is_published",
    );
    if (sites.length === 0) return jsonError(404, "Published resume not found");
    if (sites.length !== 1) {
      console.error("[api/resume] Multiple published roots matched the fixed site key");
      return jsonError(500, "Resume data unavailable");
    }
    const site = sites[0];
    if (site.site_key !== "example-cv" || site.is_published !== true || typeof site.id !== "string") {
      console.error("[api/resume] Published root row failed validation");
      return jsonError(500, "Resume data unavailable");
    }
    const publishedResumeId = site.id;
    const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;

    const childRows = await Promise.all(
      (Object.entries(tableColumns) as [TableName, string][]).map(async ([table, columns]) => [
        table,
        await getRows(fetcher, supabaseUrl, publishableKey, table, columns, publishedResumeId),
      ] as const),
    );
    const rows = Object.fromEntries(childRows) as Omit<ResumeDatabaseRows, "resume_sites">;
    const content = adaptResumeRows({ ...rows, resume_sites: sites });
    return new Response(JSON.stringify(content), {
      status: 200,
      headers: { ...noStore, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    console.error("[api/resume] Resume request failed", error instanceof Error ? error.name : "UnknownError");
    return jsonError(500, "Resume data unavailable");
  }
}
