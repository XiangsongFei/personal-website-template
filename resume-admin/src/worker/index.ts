import {
  decodeActivityLogV13Key,
  deriveActivityLogV13FailureEventId,
  signActivityLogV13,
  type ActivityLogV13Fields,
} from "./activityLogV13";

const API_ROOT = "/api/admin/v1";
const SAVE_PATH = `${API_ROOT}/introduction/save`;
const SAVE_AWARDS_PATH = `${API_ROOT}/awards/save`;
const SAVE_EXPERIENCE_PATH = `${API_ROOT}/experience/save`;
const SAVE_SKILLS_PATH = `${API_ROOT}/skills/save`;
const SAVE_EDUCATION_PATH = `${API_ROOT}/education/save`;
const SAVE_PROJECTS_PATH = `${API_ROOT}/projects/save`;
const REQUEST_BODY_LIMIT = 512 * 1024;
const CANONICAL_BODY_LIMIT = 256 * 1024;
const UPSTREAM_BODY_LIMIT = 512 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;
const SIGNATURE_LIFETIME_SECONDS = 180;
const V13B_RECORDER_TIMEOUT_MS = 1_500;
const V13B_QA_RESUME_ID = "ea111111-1111-4111-8111-111111111111";
const V13B_OFFICIAL_RESUME_ID = "10000000-0000-4000-8000-000000000001";
const V13_PURPOSE = "activity_log_system_event_v13";
const V13_KEY_ID = "activity_log_v13_failure_v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_ID_PATTERN = /^local-[0-9]+-[0-9]+$/;
const UTF8 = new TextEncoder();

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  ACTIVITY_LOG_HMAC_KEY?: string;
  ACTIVITY_LOG_HMAC_KEY_ID?: string;
  ACTIVITY_LOG_V13_HMAC_KEY?: string;
  ACTIVITY_LOG_V13B_FAILURE_REPORTING?: string;
}

interface IntroductionItem {
  id: string | null;
  zh: string;
  en: string;
}

interface AwardsItem { id: string | null; position: number; zh: { name: string; year: string }; en: { name: string; year: string } }
interface ExperienceLocale { organization: string; title: string; period: string; description: string; location: string | null }
interface ExperienceItem { id: string | null; position: number; zh: ExperienceLocale; en: ExperienceLocale }
interface SkillsLocale { title: string; items: string }
interface SkillsItem { id: string | null; position: number; zh: SkillsLocale; en: SkillsLocale }
interface EducationLocale {
  title: string; program: string; period: string; grade: string;
  course_title: string | null; course_description: string | null; custom_category_label: string | null;
}
interface EducationItem {
  id: string | null; position: number; entry_type: "standard" | "summerSchool";
  education_category: "undergraduate" | "graduate" | "doctoral" | "summerSchool" | "custom" | null;
  zh: EducationLocale; en: EducationLocale;
}
interface ProjectsMethod { id: string | null; position: number; value: string }
interface ProjectsItem { id: string | null; position: number; zh: { title: string; subtitle: string; period: string; description: string; href: string };
  en: { title: string; subtitle: string; period: string; description: string; href: string }; methods: { zh: ProjectsMethod[]; en: ProjectsMethod[] } }

interface SignedContext {
  context_version: number;
  key_id: string;
  actor_user_id: string;
  resume_id: string;
  domain: "introduction" | "awards" | "experience" | "skills" | "education" | "projects";
  operation: "update";
  request_id: string;
  mutation_digest: string;
  issued_at: number;
  expires_at: number;
  ip_network: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
}

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function errorResponse(error: ApiError): Response {
  return Response.json({ error: { code: error.code, message: error.message } }, {
    status: error.status,
    headers: { "Cache-Control": "no-store" },
  });
}

function apiError(status: number, code: string, message: string): ApiError {
  return new ApiError(status, code, message);
}

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw apiError(400, "invalid_content_length", "Invalid Content-Length header.");
    }
    if (Number(contentLength) > limit) {
      throw apiError(413, "payload_too_large", "Request body exceeds the allowed size.");
    }
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw apiError(413, "payload_too_large", "Request body exceeds the allowed size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function validateItems(value: unknown): IntroductionItem[] {
  if (!Array.isArray(value)) {
    throw apiError(422, "invalid_items", "Introduction items must be an array.");
  }
  if (value.length > 200) {
    throw apiError(422, "invalid_items", "Introduction contains too many items.");
  }

  const items: IntroductionItem[] = [];
  const persistedIds = new Set<string>();
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      throw apiError(422, "invalid_item", "Each Introduction item must be an object.");
    }
    const keys = Object.keys(entry);
    if (keys.length !== 3 || !keys.includes("id") || !keys.includes("zh") || !keys.includes("en")) {
      throw apiError(422, "invalid_item", "Each Introduction item must contain only id, zh, and en.");
    }
    const id = entry.id;
    if (id !== null && (typeof id !== "string" || UTF8.encode(id).byteLength > 64 || (!UUID_PATTERN.test(id) && !LOCAL_ID_PATTERN.test(id)))) {
      throw apiError(422, "invalid_item_id", "Introduction item ID is invalid.");
    }
    if (typeof entry.zh !== "string" || typeof entry.en !== "string"
      || entry.zh.includes("\0") || entry.en.includes("\0")
      || hasUnpairedSurrogate(entry.zh) || hasUnpairedSurrogate(entry.en)
      || Array.from(entry.zh).length > 12_000 || Array.from(entry.en).length > 12_000) {
      throw apiError(422, "invalid_item_text", "Introduction text is invalid or too long.");
    }
    if (typeof id === "string" && !id.startsWith("local-")) {
      const normalizedId = id.toLowerCase();
      if (persistedIds.has(normalizedId)) {
        throw apiError(422, "duplicate_item_id", "Introduction contains a duplicate item ID.");
      }
      persistedIds.add(normalizedId);
    }
    items.push({ id, zh: entry.zh, en: entry.en });
  }
  return items;
}

export function canonicalizeIntroduction(items: IntroductionItem[]): string {
  return JSON.stringify(items.map((item) => ({ id: item.id, zh: item.zh, en: item.en })));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", UTF8.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function compareUtf8Keys(left: string, right: string): number {
  const leftBytes = UTF8.encode(left);
  const rightBytes = UTF8.encode(right);
  if (leftBytes.length !== rightBytes.length) return leftBytes.length - rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return 0;
}

/** PostgreSQL jsonb text output: keys sorted by byte length then byte order. */
export function serializePostgresJsonbObject(value: object): string {
  const fields = value as Record<string, string | number | null>;
  return `{${Object.keys(value).sort(compareUtf8Keys).map((key) =>
    `${JSON.stringify(key)}: ${JSON.stringify(fields[key])}`
  ).join(", ")}}`;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function decodeHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw apiError(503, "signing_unavailable", "Signing configuration is unavailable.");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function getSigningConfig(env: WorkerEnv): { keyId: string; key: Uint8Array } {
  const keyId = env.ACTIVITY_LOG_HMAC_KEY_ID;
  const keyHex = env.ACTIVITY_LOG_HMAC_KEY;
  if (!keyId || !/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || !keyHex || !/^(?:[a-f0-9]{2}){32,512}$/i.test(keyHex)) {
    throw apiError(503, "signing_unavailable", "Signing configuration is unavailable.");
  }
  return { keyId, key: decodeHex(keyHex) };
}

export async function signContext(context: SignedContext, key: Uint8Array): Promise<{ serialized: string; signatureHex: string }> {
  const serialized = serializePostgresJsonbObject(context);
  const cryptoKey = await crypto.subtle.importKey("raw", copyToArrayBuffer(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, copyToArrayBuffer(UTF8.encode(serialized)));
  const signatureHex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { serialized, signatureHex };
}

function validateAwards(value: unknown): AwardsItem[] {
  if (!Array.isArray(value) || value.length > 32) throw apiError(422, "invalid_awards", "Awards must contain no more than 32 entries.");
  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isPlainObject(entry) || Object.keys(entry).sort().join(",") !== "en,id,position,zh")
      throw apiError(422, "invalid_award", "Each Award must contain only id, position, zh, and en.");
    if (!(entry.id === null || (typeof entry.id === "string" && UUID_PATTERN.test(entry.id))))
      throw apiError(422, "invalid_award_id", "Award ID must be null or a UUID.");
    if (entry.id !== null) {
      const id = String(entry.id).toLowerCase();
      if (ids.has(id)) throw apiError(422, "duplicate_award_id", "Awards contain a duplicate ID.");
      ids.add(id);
    }
    if (entry.position !== index) throw apiError(422, "invalid_award_position", "Award positions must be contiguous and ordered.");
    const translation = (raw: unknown): { name: string; year: string } => {
      if (!isPlainObject(raw) || Object.keys(raw).sort().join(",") !== "name,year"
        || typeof raw.name !== "string" || typeof raw.year !== "string"
        || raw.name.includes("\0") || raw.year.includes("\0") || hasUnpairedSurrogate(raw.name) || hasUnpairedSurrogate(raw.year)
        || Array.from(raw.name).length > 200 || Array.from(raw.year).length > 64)
        throw apiError(422, "invalid_award_translation", "Award translation is invalid or too long.");
      return { name: raw.name, year: raw.year };
    };
    return { id: entry.id === null ? null : String(entry.id).toLowerCase(), position: index,
      zh: translation(entry.zh), en: translation(entry.en) };
  });
}

export function canonicalizeAwards(items: AwardsItem[]): string {
  return JSON.stringify(items.map(item => ({ id: item.id, position: item.position,
    zh: { name: item.zh.name, year: item.zh.year }, en: { name: item.en.name, year: item.en.year } })));
}

function boundedText(value: unknown, maxBytes: number, label: string): string {
  if (typeof value !== "string" || value.includes("\0") || hasUnpairedSurrogate(value)
    || UTF8.encode(value).byteLength > maxBytes) throw apiError(422, "invalid_collection", `${label} is invalid or too long.`);
  return value;
}

function validateCollectionId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || (!UUID_PATTERN.test(value) && !LOCAL_ID_PATTERN.test(value)))
    throw apiError(422, "invalid_collection_id", "Collection item ID is invalid.");
  return value.startsWith("local-") ? null : value.toLowerCase();
}

function validateExperience(value: unknown): ExperienceItem[] {
  if (!Array.isArray(value) || value.length > 16) throw apiError(422, "invalid_experience", "Experience must contain no more than 16 entries.");
  const ids = new Set<string>();
  return value.map((raw, position) => {
    if (!isPlainObject(raw) || Object.keys(raw).sort().join(",") !== "en,id,position,zh" || raw.position !== position)
      throw apiError(422, "invalid_experience_entry", "Each Experience entry must contain only id, position, zh, and en in order.");
    const id = validateCollectionId(raw.id);
    if (id && (ids.has(id) || String(raw.id) !== id)) throw apiError(422, "invalid_experience_id", "Experience IDs must be unique canonical UUIDs.");
    if (id) ids.add(id);
    const locale = (input: unknown): ExperienceLocale => {
      if (!isPlainObject(input) || Object.keys(input).sort().join(",") !== "description,location,organization,period,title")
        throw apiError(422, "invalid_experience_locale", "Experience translations are invalid.");
      const location = input.location === null ? null : boundedText(input.location, 64, "Experience location");
      return { organization: boundedText(input.organization, 64, "Experience organization"),
        title: boundedText(input.title, 64, "Experience title"), period: boundedText(input.period, 32, "Experience period"),
        description: boundedText(input.description, 768, "Experience description"), location };
    };
    return { id, position, zh: locale(raw.zh), en: locale(raw.en) };
  });
}

export function canonicalizeExperience(items: ExperienceItem[]): string {
  return JSON.stringify(items.map(item => ({ id: item.id, position: item.position,
    zh: { organization: item.zh.organization, title: item.zh.title, period: item.zh.period, description: item.zh.description, location: item.zh.location },
    en: { organization: item.en.organization, title: item.en.title, period: item.en.period, description: item.en.description, location: item.en.location } })));
}

function validateSkills(value: unknown): SkillsItem[] {
  if (!Array.isArray(value) || value.length > 16) throw apiError(422, "invalid_skills", "Skills must contain no more than 16 groups.");
  const ids = new Set<string>();
  return value.map((raw, position) => {
    if (!isPlainObject(raw) || Object.keys(raw).sort().join(",") !== "en,id,position,zh" || raw.position !== position)
      throw apiError(422, "invalid_skill_group", "Each Skills group must contain only id, position, zh, and en in order.");
    const id = validateCollectionId(raw.id);
    if (id && (ids.has(id) || String(raw.id) !== id)) throw apiError(422, "invalid_skill_id", "Skills IDs must be unique canonical UUIDs.");
    if (id) ids.add(id);
    const locale = (input: unknown): SkillsLocale => {
      if (!isPlainObject(input) || Object.keys(input).sort().join(",") !== "items,title")
        throw apiError(422, "invalid_skills_locale", "Skills translations are invalid.");
      return { title: boundedText(input.title, 64, "Skill title"), items: boundedText(input.items, 896, "Skill items") };
    };
    return { id, position, zh: locale(raw.zh), en: locale(raw.en) };
  });
}

export function canonicalizeSkills(items: SkillsItem[]): string {
  return JSON.stringify(items.map(item => ({ id: item.id, position: item.position,
    zh: { title: item.zh.title, items: item.zh.items }, en: { title: item.en.title, items: item.en.items } })));
}

const EDUCATION_CATEGORIES = ["undergraduate", "graduate", "doctoral", "summerSchool", "custom"] as const;
const EDUCATION_TEXT_LIMITS = { title: 256, program: 256, period: 128, grade: 256,
  course_title: 256, course_description: 2048, custom_category_label: 256 } as const;
function validateEducation(value: unknown): EducationItem[] {
  if (!Array.isArray(value) || value.length > 16) throw apiError(422, "invalid_education", "Education must contain no more than 16 entries.");
  const ids = new Set<string>();
  return value.map((raw, position) => {
    if (!isPlainObject(raw) || Object.keys(raw).sort().join(",") !== "education_category,en,entry_type,id,position,zh"
      || raw.position !== position || (raw.entry_type !== "standard" && raw.entry_type !== "summerSchool"))
      throw apiError(422, "invalid_education_entry", "Each Education entry must contain the supported fields in order.");
    const id = raw.id === null ? null : typeof raw.id === "string" && UUID_PATTERN.test(raw.id) ? raw.id.toLowerCase() : null;
    if (raw.id !== null && (!id || String(raw.id) !== id)) throw apiError(422, "invalid_education_id", "Education IDs must be null or canonical UUIDs.");
    if (id && ids.has(id)) throw apiError(422, "duplicate_education_id", "Education IDs must be unique.");
    if (id) ids.add(id);
    const category = raw.education_category;
    if (category !== null && !(EDUCATION_CATEGORIES as readonly unknown[]).includes(category))
      throw apiError(422, "invalid_education_category", "Education category is invalid.");
    if (category !== null && ((category === "summerSchool") !== (raw.entry_type === "summerSchool")))
      throw apiError(422, "invalid_education_category", "Education category conflicts with entry type.");
    const locale = (input: unknown): EducationLocale => {
      if (!isPlainObject(input) || Object.keys(input).sort().join(",") !== "course_description,course_title,custom_category_label,grade,period,program,title")
        throw apiError(422, "invalid_education_locale", "Education translations are invalid.");
      const result = {} as EducationLocale;
      for (const field of Object.keys(EDUCATION_TEXT_LIMITS) as Array<keyof typeof EDUCATION_TEXT_LIMITS>) {
        const fieldValue = input[field];
        if (fieldValue === null && field !== "title" && field !== "program" && field !== "period" && field !== "grade") {
          result[field] = null;
        } else result[field] = boundedText(fieldValue, EDUCATION_TEXT_LIMITS[field], `Education ${field}`);
      }
      return result;
    };
    return { id, position, entry_type: raw.entry_type, education_category: category as EducationItem["education_category"],
      zh: locale(raw.zh), en: locale(raw.en) };
  });
}

export function canonicalizeEducation(items: EducationItem[]): string {
  return JSON.stringify(items.map(item => ({ id: item.id, position: item.position, entry_type: item.entry_type,
    education_category: item.education_category,
    zh: { title: item.zh.title, program: item.zh.program, period: item.zh.period, grade: item.zh.grade,
      course_title: item.zh.course_title, course_description: item.zh.course_description, custom_category_label: item.zh.custom_category_label },
    en: { title: item.en.title, program: item.en.program, period: item.en.period, grade: item.en.grade,
      course_title: item.en.course_title, course_description: item.en.course_description, custom_category_label: item.en.custom_category_label } })));
}

function validateProjects(value: unknown): ProjectsItem[] {
  if (!Array.isArray(value) || value.length > 16) throw apiError(422, "invalid_projects", "Projects must contain no more than 16 entries.");
  const projectIds = new Set<string>(); const methodIds = new Set<string>();
  return value.map((raw, position) => {
    if (!isPlainObject(raw) || Object.keys(raw).sort().join(",") !== "en,id,methods,position,zh" || raw.position !== position)
      throw apiError(422, "invalid_project", "Each Project must contain only id, position, zh, en, and methods in order.");
    const id = validateCollectionId(raw.id);
    if (id && projectIds.has(id)) throw apiError(422, "duplicate_project_id", "Project IDs must be unique.");
    if (id) projectIds.add(id);
    const locale = (input: unknown) => {
      if (!isPlainObject(input) || Object.keys(input).sort().join(",") !== "description,href,period,subtitle,title")
        throw apiError(422, "invalid_project_locale", "Project translations are invalid.");
      return { title: boundedText(input.title, 2048, "Project title"), subtitle: boundedText(input.subtitle, 2048, "Project subtitle"),
        period: boundedText(input.period, 1024, "Project period"), description: boundedText(input.description, 16384, "Project description"),
        href: boundedText(input.href, 2048, "Project URL") };
    };
    if (!isPlainObject(raw.methods) || Object.keys(raw.methods).sort().join(",") !== "en,zh") throw apiError(422, "invalid_project_methods", "Project methods must contain zh and en lists.");
    const methods = (input: unknown) => {
      if (!Array.isArray(input) || input.length > 64) throw apiError(422, "invalid_project_methods", "Each Project locale may contain no more than 64 methods.");
      return input.map((entry, methodPosition) => {
        if (!isPlainObject(entry) || Object.keys(entry).sort().join(",") !== "id,position,value" || entry.position !== methodPosition)
          throw apiError(422, "invalid_project_method", "Project method positions must be contiguous and ordered.");
        const methodId = entry.id === null || (typeof entry.id === "string" && entry.id.startsWith("local-method-")) ? null : validateCollectionId(entry.id);
        if (methodId && methodIds.has(methodId)) throw apiError(422, "duplicate_project_method_id", "Project method IDs must be unique.");
        if (methodId) methodIds.add(methodId);
        return { id: methodId, position: methodPosition, value: boundedText(entry.value, 2048, "Project method") };
      });
    };
    return { id, position, zh: locale(raw.zh), en: locale(raw.en), methods: { zh: methods(raw.methods.zh), en: methods(raw.methods.en) } };
  });
}

export function canonicalizeProjects(items: ProjectsItem[]): string {
  return JSON.stringify(items.map(item => ({ id: item.id, position: item.position,
    zh: { title: item.zh.title, subtitle: item.zh.subtitle, period: item.zh.period, description: item.zh.description, href: item.zh.href },
    en: { title: item.en.title, subtitle: item.en.subtitle, period: item.en.period, description: item.en.description, href: item.en.href },
    methods: { zh: item.methods.zh.map(method => ({ id: method.id, position: method.position, value: method.value })),
      en: item.methods.en.map(method => ({ id: method.id, position: method.position, value: method.value })) } })));
}

function parseIPv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets;
}

function parseIPv6(value: string): number[] | null {
  if (!value.includes(":") || value.includes("%")) return null;
  let input = value.toLowerCase();
  const dotted = input.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = parseIPv4(dotted[1]);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    input = input.slice(0, input.length - dotted[1].length) + `${high}:${low}`;
  }
  if ((input.match(/::/g) ?? []).length > 1) return null;
  const hasCompression = input.includes("::");
  const [leftPart, rightPart = ""] = hasCompression ? input.split("::") : [input, ""];
  const left = leftPart ? leftPart.split(":") : [];
  const right = rightPart ? rightPart.split(":") : [];
  const groups = [...left, ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  if (hasCompression ? groups.length >= 8 : groups.length !== 8) return null;
  const zeros = hasCompression ? 8 - groups.length : 0;
  return [...left.map((group) => Number.parseInt(group, 16)), ...Array(zeros).fill(0), ...right.map((group) => Number.parseInt(group, 16))];
}

function formatIPv6(groups: number[]): string {
  let bestStart = -1;
  let bestLength = 1;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) { index += 1; continue; }
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - index > bestLength) { bestStart = index; bestLength = end - index; }
    index = end;
  }
  if (bestStart < 0) return groups.map((group) => group.toString(16)).join(":");
  const before = groups.slice(0, bestStart).map((group) => group.toString(16)).join(":");
  const after = groups.slice(bestStart + bestLength).map((group) => group.toString(16)).join(":");
  return `${before}::${after}`;
}

export function normalizeClientNetwork(value: string | null): string | null {
  if (!value || value.trim() !== value || value.includes("/")) return null;
  const ipv4 = parseIPv4(value);
  if (ipv4) return `${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.0/24`;
  const ipv6 = parseIPv6(value);
  if (!ipv6) return null;
  ipv6[3] = 0;
  ipv6[4] = 0;
  ipv6[5] = 0;
  ipv6[6] = 0;
  ipv6[7] = 0;
  return `${formatIPv6(ipv6)}/48`;
}

function optionalGeoString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || UTF8.encode(value).byteLength > 128 || hasUnpairedSurrogate(value)) return null;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f)) return null;
  }
  return value;
}

export function getTrustedNetworkContext(request: Request): Pick<SignedContext, "ip_network" | "country_code" | "region" | "city"> {
  const cloudflareRequest = request as Request & { cf?: { country?: unknown; region?: unknown; city?: unknown } };
  const rawCountry = cloudflareRequest.cf?.country;
  const country = typeof rawCountry === "string" ? rawCountry.toUpperCase() : "";
  return {
    ip_network: normalizeClientNetwork(request.headers.get("CF-Connecting-IP")),
    country_code: /^[A-Z]{2}$/.test(country) ? country : null,
    region: optionalGeoString(cloudflareRequest.cf?.region),
    city: optionalGeoString(cloudflareRequest.cf?.city),
  };
}

function decodeBase64Url(segment: string): string {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) {
    throw apiError(401, "invalid_authorization", "A valid user access token is required.");
  }
  const base64 = segment.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  try {
    return atob(base64);
  } catch {
    throw apiError(401, "invalid_authorization", "A valid user access token is required.");
  }
}

function tokenActor(authorization: string | null): { header: string; token: string; actorId: string } {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) throw apiError(401, "invalid_authorization", "A Bearer user access token is required.");
  const token = match[1];
  const segments = token.split(".");
  if (segments.length !== 3) throw apiError(401, "invalid_authorization", "A valid user access token is required.");
  try {
    const header = JSON.parse(decodeBase64Url(segments[0])) as unknown;
    const payloadText = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(decodeBase64Url(segments[1]), (character) => character.charCodeAt(0)),
    );
    const payload = JSON.parse(payloadText) as unknown;
    if (!isPlainObject(header) || typeof header.alg !== "string" || !isPlainObject(payload)
      || typeof payload.sub !== "string" || !UUID_PATTERN.test(payload.sub)) {
      throw new Error("invalid token shape");
    }
    return { header: `Bearer ${token}`, token, actorId: payload.sub.toLowerCase() };
  } catch {
    throw apiError(401, "invalid_authorization", "A valid user access token is required.");
  }
}

async function readJsonResponse(response: Response, limit: number): Promise<unknown> {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response as unknown as Request, limit);
  } catch {
    throw apiError(502, "invalid_upstream_response", "The data service returned an invalid response.");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw apiError(502, "invalid_upstream_response", "The data service returned an invalid response.");
  }
}

function upstreamError(response: Response, body: unknown): ApiError {
  if (isPlainObject(body)) {
    const code = typeof body.code === "string" ? body.code : "";
    const message = typeof body.message === "string" ? body.message : "";
    if (response.status === 400 && code === "P13B1") {
      return apiError(409, "idempotency_conflict", "This save request conflicts with an earlier request.");
    }
    if (code === "23505" && message === "Idempotency key conflicts with a different request") {
      return apiError(409, "idempotency_conflict", "This save request conflicts with an earlier request.");
    }
    if (code === "22023" && message === "Idempotency request has expired; use a new request ID") {
      return apiError(409, "idempotency_expired", "This save request has expired. Submit it with a new request ID.");
    }
  }
  return apiError(502, "upstream_failure", `The data service could not save the Introduction (HTTP ${response.status}).`);
}

function reporterLog(category: string): void {
  console.warn("activity_log_v13_reporter", category);
}

function isV13BIdempotencyConflict(response: Response, body: unknown): boolean {
  return response.status === 400 && isPlainObject(body) && body.code === "P13B1";
}

async function reportV13BFailure(input: {
  env: WorkerEnv;
  supabase: { baseUrl: string; publishableKey: string };
  authorization: string;
  actorId: string;
  resumeId: string;
  requestId: string;
  network: Pick<SignedContext, "ip_network" | "country_code" | "region" | "city">;
}): Promise<void> {
  if (input.env.ACTIVITY_LOG_V13B_FAILURE_REPORTING !== "true") {
    reporterLog("reporter_disabled");
    return;
  }
  if (input.resumeId.toLowerCase() === V13B_OFFICIAL_RESUME_ID || input.resumeId.toLowerCase() !== V13B_QA_RESUME_ID) {
    reporterLog("reporter_target_blocked");
    return;
  }

  let key: Uint8Array;
  try {
    const keyHex = input.env.ACTIVITY_LOG_V13_HMAC_KEY;
    if (!keyHex) throw new TypeError("missing");
    key = decodeActivityLogV13Key(keyHex);
  } catch {
    reporterLog("signing_configuration_missing");
    return;
  }

  try {
    const issuedAtEpoch = Math.floor(Date.now() / 1000);
    const fields: ActivityLogV13Fields = {
      protocolVersion: 1,
      purpose: V13_PURPOSE,
      keyId: V13_KEY_ID,
      eventId: await deriveActivityLogV13FailureEventId({
        resumeId: input.resumeId,
        actorUserId: input.actorId,
        requestId: input.requestId,
        failureStage: "idempotency",
        failureCode: "idempotency_conflict",
      }),
      requestId: input.requestId.toLowerCase(),
      actorUserId: input.actorId.toLowerCase(),
      resumeId: input.resumeId.toLowerCase(),
      eventKind: "operation_failure",
      outcome: "rejected",
      sectionKey: "introduction",
      operation: "update",
      failureStage: "idempotency",
      failureCode: "idempotency_conflict",
      issuedAtEpoch,
      ipNetwork: input.network.ip_network,
      countryCode: input.network.country_code,
      region: input.network.region,
      city: input.network.city,
    };
    const signatureHex = await signActivityLogV13(fields, key);
    const body = JSON.stringify({
      target_resume_id: fields.resumeId,
      target_event_id: fields.eventId,
      target_request_id: fields.requestId,
      target_actor_user_id: fields.actorUserId,
      target_protocol_version: fields.protocolVersion,
      target_purpose: fields.purpose,
      target_key_id: fields.keyId,
      target_event_kind: fields.eventKind,
      target_outcome: fields.outcome,
      target_section_key: fields.sectionKey,
      target_operation: fields.operation,
      target_failure_stage: fields.failureStage,
      target_failure_code: fields.failureCode,
      target_issued_at_epoch: fields.issuedAtEpoch,
      target_ip_network: fields.ipNetwork,
      target_country_code: fields.countryCode,
      target_region: fields.region,
      target_city: fields.city,
      target_signature_hex: signatureHex,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${input.supabase.baseUrl}/rest/v1/rpc/record_activity_log_system_failure`, {
          method: "POST",
          headers: {
            "Authorization": input.authorization,
            "apikey": input.supabase.publishableKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body,
          signal: AbortSignal.timeout(V13B_RECORDER_TIMEOUT_MS),
        });
        if (response.ok) {
          reporterLog("reporter_success");
          return;
        }
        if (response.status === 401) {
          reporterLog("recorder_unauthorized");
          return;
        }
        if (response.status === 403 || response.status < 500) {
          reporterLog("recorder_rejected");
          return;
        }
        if (attempt === 1) {
          reporterLog("recorder_upstream_failure");
          return;
        }
      } catch (error) {
        if (attempt === 1) {
          reporterLog(error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")
            ? "recorder_timeout" : "recorder_upstream_failure");
          return;
        }
      }
    }
  } catch {
    reporterLog("signing_failure");
  }
}

function validateSupabaseConfig(env: WorkerEnv): { baseUrl: string; publishableKey: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw apiError(503, "upstream_unavailable", "The data service is not configured.");
  }
  try {
    const parsed = new URL(env.SUPABASE_URL);
    if (parsed.protocol !== "https:" || !/^https:\/\//i.test(env.SUPABASE_URL)
      || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    return { baseUrl: parsed.toString().replace(/\/$/, ""), publishableKey: env.SUPABASE_PUBLISHABLE_KEY };
  } catch {
    throw apiError(503, "upstream_unavailable", "The data service is not configured.");
  }
}

async function saveIntroduction(request: Request, env: WorkerEnv): Promise<Response> {
  const rawBody = await readBoundedBody(request, REQUEST_BODY_LIMIT);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw apiError(400, "invalid_content_type", "A JSON request body is required.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)) as unknown;
  } catch {
    throw apiError(400, "invalid_json", "Request body must contain valid UTF-8 JSON.");
  }
  if (!isPlainObject(parsed)) throw apiError(400, "invalid_request", "Request body must be a JSON object.");
  const bodyKeys = Object.keys(parsed);
  if (bodyKeys.length !== 3 || !bodyKeys.includes("request_id") || !bodyKeys.includes("resume_id") || !bodyKeys.includes("items")) {
    throw apiError(400, "invalid_request", "Request must contain only request_id, resume_id, and items.");
  }
  if (typeof parsed.request_id !== "string" || !UUID_PATTERN.test(parsed.request_id)
    || typeof parsed.resume_id !== "string" || !UUID_PATTERN.test(parsed.resume_id)) {
    throw apiError(422, "invalid_request_id", "Request and resume IDs must be UUIDs.");
  }
  const items = validateItems(parsed.items);
  const canonical = canonicalizeIntroduction(items);
  const canonicalBytes = UTF8.encode(canonical);
  if (canonicalBytes.byteLength > CANONICAL_BODY_LIMIT) {
    throw apiError(413, "canonical_payload_too_large", "Canonical Introduction exceeds the allowed size.");
  }

  const { header: authorization, actorId } = tokenActor(request.headers.get("authorization"));
  const supabase = validateSupabaseConfig(env);
  const { keyId, key } = getSigningConfig(env);
  const issuedAt = Math.floor(Date.now() / 1000);
  const network = getTrustedNetworkContext(request);
  const context: SignedContext = {
    context_version: 1,
    key_id: keyId,
    actor_user_id: actorId,
    resume_id: parsed.resume_id.toLowerCase(),
    domain: "introduction",
    operation: "update",
    request_id: parsed.request_id.toLowerCase(),
    mutation_digest: await sha256Hex(canonical),
    issued_at: issuedAt,
    expires_at: issuedAt + SIGNATURE_LIFETIME_SECONDS,
    ...network,
  };
  const signed = await signContext(context, key);
  if (UTF8.encode(signed.serialized).byteLength > 8192) {
    throw apiError(503, "signing_unavailable", "Signed request exceeds the supported size.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${supabase.baseUrl}/rest/v1/rpc/save_resume_introduction_v11`, {
      method: "POST",
      headers: {
        "Authorization": authorization,
        "apikey": supabase.publishableKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        target_resume_id: parsed.resume_id,
        canonical_items: canonical,
        signed_context: signed.serialized,
        signature_hex: signed.signatureHex,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw apiError(504, "upstream_timeout", "The data service timed out. Retry with the same request ID.");
    }
    throw apiError(502, "upstream_unavailable", "The data service is unavailable.");
  }

  const upstreamBody = await readJsonResponse(upstream, UPSTREAM_BODY_LIMIT);
  if (!upstream.ok) {
    const saveFailure = upstreamError(upstream, upstreamBody);
    if (isV13BIdempotencyConflict(upstream, upstreamBody)) {
      await reportV13BFailure({
        env,
        supabase,
        authorization,
        actorId,
        resumeId: parsed.resume_id,
        requestId: parsed.request_id,
        network,
      }).catch(() => reporterLog("recorder_upstream_failure"));
    }
    throw saveFailure;
  }
  return Response.json(upstreamBody, { headers: { "Cache-Control": "no-store" } });
}

async function saveAwards(request: Request, env: WorkerEnv): Promise<Response> {
  const rawBody = await readBoundedBody(request, 16 * 1024);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw apiError(400, "invalid_content_type", "A JSON request body is required.");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)) as unknown; }
  catch { throw apiError(400, "invalid_json", "Request body must contain valid UTF-8 JSON."); }
  if (!isPlainObject(parsed) || Object.keys(parsed).sort().join(",") !== "awards,request_id,resume_id")
    throw apiError(400, "invalid_request", "Request must contain only request_id, resume_id, and awards.");
  if (typeof parsed.request_id !== "string" || !UUID_PATTERN.test(parsed.request_id)
    || typeof parsed.resume_id !== "string" || !UUID_PATTERN.test(parsed.resume_id))
    throw apiError(422, "invalid_request_id", "Request and resume IDs must be UUIDs.");
  const awards = validateAwards(parsed.awards);
  const canonical = canonicalizeAwards(awards);
  if (UTF8.encode(canonical).byteLength > 4096) throw apiError(413, "canonical_payload_too_large", "Awards exceed the allowed size.");
  const { header: authorization, actorId } = tokenActor(request.headers.get("authorization"));
  const supabase = validateSupabaseConfig(env); const { keyId, key } = getSigningConfig(env);
  const issuedAt = Math.floor(Date.now() / 1000); const network = getTrustedNetworkContext(request);
  const context: SignedContext = { context_version: 1, key_id: keyId, actor_user_id: actorId,
    resume_id: parsed.resume_id.toLowerCase(), domain: "awards", operation: "update",
    request_id: parsed.request_id.toLowerCase(), mutation_digest: await sha256Hex(canonical),
    issued_at: issuedAt, expires_at: issuedAt + SIGNATURE_LIFETIME_SECONDS, ...network };
  const signed = await signContext(context, key);
  if (UTF8.encode(signed.serialized).byteLength > 8192) throw apiError(503, "signing_unavailable", "Signed request exceeds the supported size.");
  let upstream: Response;
  try {
    upstream = await fetch(`${supabase.baseUrl}/rest/v1/rpc/save_resume_awards_v1`, {
      method: "POST", headers: { Authorization: authorization, apikey: supabase.publishableKey,
        "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ target_resume_id: parsed.resume_id, canonical_awards: canonical,
        signed_context: signed.serialized, signature_hex: signed.signatureHex }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError"))
      throw apiError(504, "upstream_timeout", "The data service timed out. Retry with the same request ID.");
    throw apiError(502, "upstream_unavailable", "The data service is unavailable.");
  }
  const responseBody = await readJsonResponse(upstream, 8192);
  if (!upstream.ok) {
    if (isV13BIdempotencyConflict(upstream, responseBody))
      throw apiError(409, "idempotency_conflict", "The Awards retry conflicts with a different request. Refresh before trying again.");
    throw apiError(upstream.status >= 500 ? 502 : 422, "upstream_failure", `The data service could not save Awards (HTTP ${upstream.status}).`);
  }
  if (!Array.isArray(responseBody) || UTF8.encode(JSON.stringify(responseBody)).byteLength > 8192)
    throw apiError(502, "invalid_upstream_response", "The data service returned an invalid Awards result.");
  return Response.json(responseBody, { headers: { "Cache-Control": "no-store" } });
}

async function saveExperienceOrSkills(request: Request, env: WorkerEnv, domain: "experience" | "skills"): Promise<Response> {
  const rawBody = await readBoundedBody(request, REQUEST_BODY_LIMIT);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw apiError(400, "invalid_content_type", "A JSON request body is required.");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)) as unknown; }
  catch { throw apiError(400, "invalid_json", "Request body must contain valid UTF-8 JSON."); }
  const collectionKey = domain;
  if (!isPlainObject(parsed) || Object.keys(parsed).sort().join(",") !== [collectionKey, "request_id", "resume_id"].sort().join(","))
    throw apiError(400, "invalid_request", `Request must contain only request_id, resume_id, and ${collectionKey}.`);
  if (typeof parsed.request_id !== "string" || !UUID_PATTERN.test(parsed.request_id)
    || typeof parsed.resume_id !== "string" || !UUID_PATTERN.test(parsed.resume_id))
    throw apiError(422, "invalid_request_id", "Request and resume IDs must be UUIDs.");
  const items = domain === "experience" ? validateExperience(parsed[collectionKey]) : validateSkills(parsed[collectionKey]);
  const canonical = domain === "experience" ? canonicalizeExperience(items as ExperienceItem[]) : canonicalizeSkills(items as SkillsItem[]);
  if (UTF8.encode(canonical).byteLength > 196608)
    throw apiError(413, "canonical_payload_too_large", `${domain === "experience" ? "Experience" : "Skills"} exceeds the allowed size.`);
  const { header: authorization, actorId } = tokenActor(request.headers.get("authorization"));
  const supabase = validateSupabaseConfig(env); const { keyId, key } = getSigningConfig(env);
  const issuedAt = Math.floor(Date.now() / 1000); const network = getTrustedNetworkContext(request);
  const context: SignedContext = { context_version: 1, key_id: keyId, actor_user_id: actorId,
    resume_id: parsed.resume_id.toLowerCase(), domain, operation: "update", request_id: parsed.request_id.toLowerCase(),
    mutation_digest: await sha256Hex(canonical), issued_at: issuedAt, expires_at: issuedAt + SIGNATURE_LIFETIME_SECONDS, ...network };
  const signed = await signContext(context, key);
  if (UTF8.encode(signed.serialized).byteLength > 8192) throw apiError(503, "signing_unavailable", "Signed request exceeds the supported size.");
  let upstream: Response;
  try {
    upstream = await fetch(`${supabase.baseUrl}/rest/v1/rpc/save_resume_${domain}_v1`, {
      method: "POST", headers: { Authorization: authorization, apikey: supabase.publishableKey,
        "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ target_resume_id: parsed.resume_id, [`canonical_${collectionKey}`]: canonical,
        signed_context: signed.serialized, signature_hex: signed.signatureHex }), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError"))
      throw apiError(504, "upstream_timeout", `The data service timed out. Retry with the same ${domain} request ID.`);
    throw apiError(502, "upstream_unavailable", "The data service is unavailable.");
  }
  const responseBody = await readJsonResponse(upstream, 220 * 1024);
  if (!upstream.ok) {
    if (isV13BIdempotencyConflict(upstream, responseBody))
      throw apiError(409, "idempotency_conflict", `The ${domain} retry conflicts with a different request. Refresh before trying again.`);
    throw apiError(upstream.status >= 500 ? 502 : 422, "upstream_failure", `The data service could not save ${domain} (HTTP ${upstream.status}).`);
  }
  if (!Array.isArray(responseBody) || UTF8.encode(JSON.stringify(responseBody)).byteLength > 212992)
    throw apiError(502, "invalid_upstream_response", `The data service returned an invalid ${domain} result.`);
  return Response.json(responseBody, { headers: { "Cache-Control": "no-store" } });
}

async function saveEducation(request: Request, env: WorkerEnv): Promise<Response> {
  const rawBody = await readBoundedBody(request, REQUEST_BODY_LIMIT);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw apiError(400, "invalid_content_type", "A JSON request body is required.");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)) as unknown; }
  catch { throw apiError(400, "invalid_json", "Request body must contain valid UTF-8 JSON."); }
  if (!isPlainObject(parsed) || Object.keys(parsed).sort().join(",") !== "education,request_id,resume_id")
    throw apiError(400, "invalid_request", "Request must contain only request_id, resume_id, and education.");
  if (typeof parsed.request_id !== "string" || !UUID_PATTERN.test(parsed.request_id)
    || typeof parsed.resume_id !== "string" || !UUID_PATTERN.test(parsed.resume_id))
    throw apiError(422, "invalid_request_id", "Request and resume IDs must be UUIDs.");
  const items = validateEducation(parsed.education);
  const canonical = canonicalizeEducation(items);
  if (UTF8.encode(canonical).byteLength > 196608) throw apiError(413, "canonical_payload_too_large", "Education exceeds the allowed size.");
  const { header: authorization, actorId } = tokenActor(request.headers.get("authorization"));
  const supabase = validateSupabaseConfig(env); const { keyId, key } = getSigningConfig(env);
  const issuedAt = Math.floor(Date.now() / 1000); const network = getTrustedNetworkContext(request);
  const context: SignedContext = { context_version: 1, key_id: keyId, actor_user_id: actorId,
    resume_id: parsed.resume_id.toLowerCase(), domain: "education", operation: "update", request_id: parsed.request_id.toLowerCase(),
    mutation_digest: await sha256Hex(canonical), issued_at: issuedAt, expires_at: issuedAt + SIGNATURE_LIFETIME_SECONDS, ...network };
  const signed = await signContext(context, key);
  if (UTF8.encode(signed.serialized).byteLength > 8192) throw apiError(503, "signing_unavailable", "Signed request exceeds the supported size.");
  let upstream: Response;
  try {
    upstream = await fetch(`${supabase.baseUrl}/rest/v1/rpc/save_resume_education_v1`, {
      method: "POST", headers: { Authorization: authorization, apikey: supabase.publishableKey,
        "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ target_resume_id: parsed.resume_id, canonical_education: canonical,
        signed_context: signed.serialized, signature_hex: signed.signatureHex }), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError"))
      throw apiError(504, "upstream_timeout", "The data service timed out. Retry with the same Education request ID.");
    throw apiError(502, "upstream_unavailable", "The data service is unavailable.");
  }
  const responseBody = await readJsonResponse(upstream, 220 * 1024);
  if (!upstream.ok) {
    if (isV13BIdempotencyConflict(upstream, responseBody))
      throw apiError(409, "idempotency_conflict", "The Education retry conflicts with a different request. Refresh before trying again.");
    throw apiError(upstream.status >= 500 ? 502 : 422, "upstream_failure", `The data service could not save Education (HTTP ${upstream.status}).`);
  }
  if (!Array.isArray(responseBody) || UTF8.encode(JSON.stringify(responseBody)).byteLength > 212992)
    throw apiError(502, "invalid_upstream_response", "The data service returned an invalid Education result.");
  return Response.json(responseBody, { headers: { "Cache-Control": "no-store" } });
}

async function saveProjects(request: Request, env: WorkerEnv): Promise<Response> {
  const rawBody = await readBoundedBody(request, REQUEST_BODY_LIMIT);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw apiError(400, "invalid_content_type", "A JSON request body is required.");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)) as unknown; }
  catch { throw apiError(400, "invalid_json", "Request body must contain valid UTF-8 JSON."); }
  if (!isPlainObject(parsed) || Object.keys(parsed).sort().join(",") !== "projects,request_id,resume_id") throw apiError(400, "invalid_request", "Request must contain only request_id, resume_id, and projects.");
  if (typeof parsed.request_id !== "string" || !UUID_PATTERN.test(parsed.request_id) || typeof parsed.resume_id !== "string" || !UUID_PATTERN.test(parsed.resume_id))
    throw apiError(422, "invalid_request_id", "Request and resume IDs must be UUIDs.");
  const items = validateProjects(parsed.projects); const canonical = canonicalizeProjects(items);
  if (UTF8.encode(canonical).byteLength > 196608) throw apiError(413, "canonical_payload_too_large", "Projects exceeds the allowed size.");
  const { header: authorization, actorId } = tokenActor(request.headers.get("authorization"));
  const supabase = validateSupabaseConfig(env); const { keyId, key } = getSigningConfig(env);
  const issuedAt = Math.floor(Date.now() / 1000); const network = getTrustedNetworkContext(request);
  const context: SignedContext = { context_version: 1, key_id: keyId, actor_user_id: actorId, resume_id: parsed.resume_id.toLowerCase(),
    domain: "projects", operation: "update", request_id: parsed.request_id.toLowerCase(), mutation_digest: await sha256Hex(canonical),
    issued_at: issuedAt, expires_at: issuedAt + SIGNATURE_LIFETIME_SECONDS, ...network };
  const signed = await signContext(context, key);
  if (UTF8.encode(signed.serialized).byteLength > 8192) throw apiError(503, "signing_unavailable", "Signed request exceeds the supported size.");
  let upstream: Response;
  try {
    upstream = await fetch(`${supabase.baseUrl}/rest/v1/rpc/save_resume_projects_v1`, { method: "POST",
      headers: { Authorization: authorization, apikey: supabase.publishableKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ target_resume_id: parsed.resume_id, canonical_projects: canonical, signed_context: signed.serialized, signature_hex: signed.signatureHex }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) throw apiError(504, "upstream_timeout", "The data service timed out. Retry with the same Projects request ID.");
    throw apiError(502, "upstream_unavailable", "The data service is unavailable.");
  }
  const responseBody = await readJsonResponse(upstream, 220 * 1024);
  if (!upstream.ok) {
    if (isV13BIdempotencyConflict(upstream, responseBody)) throw apiError(409, "idempotency_conflict", "The Projects retry conflicts with a different request. Refresh before trying again.");
    throw apiError(upstream.status >= 500 ? 502 : 422, "upstream_failure", `The data service could not save Projects (HTTP ${upstream.status}).`);
  }
  if (!Array.isArray(responseBody) || UTF8.encode(JSON.stringify(responseBody)).byteLength > 212992)
    throw apiError(502, "invalid_upstream_response", "The data service returned an invalid Projects result.");
  return Response.json(responseBody, { headers: { "Cache-Control": "no-store" } });
}

function isApiPath(pathname: string): boolean {
  return pathname === API_ROOT || pathname.startsWith(`${API_ROOT}/`);
}

export async function handleWorkerRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!isApiPath(url.pathname)) return env.ASSETS.fetch(request);
  if (url.pathname !== SAVE_PATH && url.pathname !== SAVE_AWARDS_PATH && url.pathname !== SAVE_EXPERIENCE_PATH && url.pathname !== SAVE_SKILLS_PATH && url.pathname !== SAVE_EDUCATION_PATH && url.pathname !== SAVE_PROJECTS_PATH) {
    return errorResponse(apiError(404, "not_found", "API endpoint not found."));
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: { code: "method_not_allowed", message: "Only POST is allowed." } }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Allow": "POST" },
    });
  }
  try {
    if (url.pathname === SAVE_PATH) return await saveIntroduction(request, env);
    if (url.pathname === SAVE_AWARDS_PATH) return await saveAwards(request, env);
    if (url.pathname === SAVE_EDUCATION_PATH) return await saveEducation(request, env);
    if (url.pathname === SAVE_PROJECTS_PATH) return await saveProjects(request, env);
    return await saveExperienceOrSkills(request, env, url.pathname === SAVE_EXPERIENCE_PATH ? "experience" : "skills");
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return errorResponse(apiError(502, "request_failed", "The Admin request could not be completed."));
  }
}

const worker = {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorkerRequest(request, env);
  },
};

export default worker;
