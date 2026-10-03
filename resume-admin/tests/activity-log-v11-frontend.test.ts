import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository, createWriteReadinessRepository } from "../src/data/resumeRepository";
import type { IntroItem } from "../src/model";

const target = "ea111111-1111-4111-8111-111111111111";
const item: IntroItem = { id: "local-1-2", position: 0, translations: { zh: { text: "中文" }, en: { text: "English" } } };
const featureRow = { activity_log_enabled: true, introduction_write_mode: "rpc", introduction_trusted_context_required: true };
const persisted = [{ id: "11111111-1111-4111-8111-111111111111", position: 0, translations: { zh: { text: "中文" }, en: { text: "English" } } }];
const persistedItem: IntroItem = { id: persisted[0].id, position: 0, translations: { zh: { text: "中文" }, en: { text: "English" } } };
const persistedRows = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", position: 0, translations: { zh: { text: "第一段" }, en: { text: "First paragraph" } } },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: 1, translations: { zh: { text: "第二段" }, en: { text: "Second paragraph" } } },
];
const persistedItems: IntroItem[] = persistedRows.map(row => ({ id: row.id, position: row.position,
  translations: { zh: { text: row.translations.zh.text }, en: { text: row.translations.en.text } } }));

function makeRepository(options: { featureData?: unknown; featureError?: Error | null; token?: string | null } = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: options.featureData ?? [featureRow], error: options.featureError ?? null });
  const from = vi.fn();
  const getSession = vi.fn().mockResolvedValue({ data: { session: options.token === null ? null : { access_token: options.token ?? "current-access-token", expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null });
  const repo = createResumeRepository({ rpc, from, auth: { getSession } } as unknown as SupabaseClient);
  return { repo, rpc, from, getSession };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Activity Log V1.1 frontend feature state and Introduction routing", () => {
  it("keeps local retry-state inspection and discard available through the write-readiness guard", () => {
    const source = { hasPendingIntroductionWorkerSave: vi.fn().mockReturnValue(true), discardPendingIntroductionSave: vi.fn() };
    const guarded = createWriteReadinessRepository(source as never, () => false);
    expect(guarded.hasPendingIntroductionWorkerSave!(target, [item])).toBe(true);
    expect(guarded.discardPendingIntroductionSave!(target)).toBeUndefined();
    expect(source.discardPendingIntroductionSave).toHaveBeenCalledWith(target);
  });

  it("loads the exact V1.1 feature-state RPC shape and binds it to the requested target", async () => {
    const { repo, rpc } = makeRepository();
    await expect(repo.loadAdminFeatureState!(target)).resolves.toEqual({
      resumeId: target, activityLogEnabled: true, introductionWriteMode: "rpc", introductionTrustedContextRequired: true,
    });
    expect(rpc).toHaveBeenCalledWith("load_admin_feature_state_v11", { target_resume_id: target });
  });

  it.each([
    ["missing row", []],
    ["multiple rows", [featureRow, featureRow]],
    ["missing requirement", [{ activity_log_enabled: true, introduction_write_mode: "rpc" }]],
    ["unknown mode", [{ ...featureRow, introduction_write_mode: "other" }]],
    ["malformed capability", [{ ...featureRow, activity_log_enabled: "true" }]],
    ["impossible direct plus requirement", [{ ...featureRow, introduction_write_mode: "direct" }]],
  ])("fails closed for %s feature state", async (_name, data) => {
    const { repo } = makeRepository({ featureData: data });
    await expect(repo.loadAdminFeatureState!(target)).rejects.toThrow("Invalid Admin feature state");
  });

  it("fails closed when feature-state loading fails", async () => {
    const { repo } = makeRepository({ featureError: new Error("private server detail") });
    await expect(repo.loadAdminFeatureState!(target)).rejects.toThrow("Unable to load Admin feature state");
  });

  it("forwards only the current session token and exact Worker request contract, then adopts canonical IDs", async () => {
    const { repo, getSession } = makeRepository();
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("22222222-2222-4222-8222-222222222222").mockReturnValueOnce("33333333-3333-4333-8333-333333333333") });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(persisted), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ ...persisted[0], translations: { zh: { text: "updated" }, en: { text: "English" } } }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const canonical = await repo.saveIntroductionWithWorker!(target, item ? [item] : []);
    expect(canonical).toEqual([{ id: persisted[0].id, position: 0, translations: { zh: { text: "中文" }, en: { text: "English" } } }]);
    expect(getSession).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/v1/introduction/save");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer current-access-token");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ request_id: "22222222-2222-4222-8222-222222222222", resume_id: target, items: [{ id: "local-1-2", zh: "中文", en: "English" }] });
    expect(Object.keys(body).sort()).toEqual(["items", "request_id", "resume_id"]);
    expect(Object.keys(body.items[0]).sort()).toEqual(["en", "id", "zh"]);
    expect(JSON.stringify(body)).not.toMatch(/ip|country|region|city|role|email|user_id|signature|signed_context/i);
    await repo.saveIntroductionWithWorker!(target, [{ ...canonical[0], translations: { zh: { text: "updated" }, en: { text: "English" } } }]);
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(secondBody.items[0].id).toBe(persisted[0].id);
  });

  it("accepts an exact persisted-ID canonical response", async () => {
    const { repo } = makeRepository();
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("12121212-1212-4212-8212-121212121212") });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(persisted), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(repo.saveIntroductionWithWorker!(target, [persistedItem])).resolves.toEqual([persistedItem]);
  });

  it("accepts null and local IDs becoming persisted UUIDs with matching text", async () => {
    const { repo } = makeRepository();
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("13131313-1313-4313-8313-131313131313").mockReturnValueOnce("14141414-1414-4414-8414-141414141414") });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(persisted), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(persisted), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const nullIdItem = { ...item, id: null } as unknown as IntroItem;
    await expect(repo.saveIntroductionWithWorker!(target, [nullIdItem])).resolves.toEqual([persistedItem]);
    await expect(repo.saveIntroductionWithWorker!(target, [item])).resolves.toEqual([persistedItem]);
  });

  it.each([
    ["empty response", []],
    ["truncated response", [persistedRows[0]]],
    ["extra row", [...persistedRows, { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", position: 2, translations: { zh: { text: "多余" }, en: { text: "Extra" } } }]],
    ["Chinese text mismatch", [{ ...persistedRows[0], translations: { ...persistedRows[0].translations, zh: { text: "错误中文" } } }, persistedRows[1]]],
    ["English text mismatch", [persistedRows[0], { ...persistedRows[1], translations: { ...persistedRows[1].translations, en: { text: "Wrong English" } } }]],
    ["persisted ID replacement", [{ ...persistedRows[0], id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, persistedRows[1]]],
    ["swapped item order", [{ ...persistedRows[1], position: 0 }, { ...persistedRows[0], position: 1 }]],
    ["duplicate returned ID", [persistedRows[0], { ...persistedRows[1], id: persistedRows[0].id }]],
  ])("rejects %s and retries unchanged with the same request identity", async (_name, invalidRows) => {
    const { repo, rpc, from } = makeRepository();
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("15151515-1515-4515-8515-151515151515") });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(invalidRows), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(persistedRows), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(repo.saveIntroductionWithWorker!(target, persistedItems)).rejects.toThrow("save result could not be confirmed");
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    await expect(repo.saveIntroductionWithWorker!(target, persistedItems)).resolves.toEqual(persistedItems);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0]).toMatchObject({ resume_id: target, items: [
      { id: persistedItems[0].id, zh: "第一段", en: "First paragraph" },
      { id: persistedItems[1].id, zh: "第二段", en: "Second paragraph" },
    ] });
  });

  it("does not send a Worker request or fall back when the session is missing", async () => {
    const { repo, rpc, from } = makeRepository({ token: null });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(repo.saveIntroductionWithWorker!(target, [item])).rejects.toThrow("Your session could not be verified");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when current-session token retrieval itself fails", async () => {
    const { repo, getSession, rpc, from } = makeRepository();
    getSession.mockRejectedValue(new Error("private auth detail"));
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(repo.saveIntroductionWithWorker!(target, [item])).rejects.toThrow("Your session could not be verified");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it.each([401, 409, 413, 422, 500, 502, 503, 504, 400])("never falls back after Worker HTTP %i", async status => {
    const { repo, rpc, from } = makeRepository();
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("33333333-3333-4333-8333-333333333333") });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status })); vi.stubGlobal("fetch", fetchMock);
    await expect(repo.saveIntroductionWithWorker!(target, [item])).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("reuses the same request ID after an ambiguous network failure and changed content gets a new ID", async () => {
    const { repo } = makeRepository();
    const ids = ["44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"];
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => ids.shift()!) });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("connection dropped"))
      .mockResolvedValueOnce(new Response(JSON.stringify(persisted), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ ...persisted[0], translations: { zh: { text: "改过" }, en: { text: "English" } } }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(repo.saveIntroductionWithWorker!(target, [item])).rejects.toThrow("result is uncertain");
    await repo.saveIntroductionWithWorker!(target, [item]);
    const changed = { ...item, translations: { ...item.translations, zh: { text: "改过" } } };
    await repo.saveIntroductionWithWorker!(target, [changed]);
    const idsSent = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).request_id);
    expect(idsSent).toEqual(["44444444-4444-4444-8444-444444444444", "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"]);
  });

  it("clears the request ID after success and uses one mutation for concurrent duplicate submissions", async () => {
    const { repo } = makeRepository();
    const ids = ["66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777"];
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => ids.shift()!) });
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const first = repo.saveIntroductionWithWorker!(target, [item]);
    const duplicate = repo.saveIntroductionWithWorker!(target, [item]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    finish(new Response(JSON.stringify(persisted), { status: 200 }));
    await Promise.all([first, duplicate]);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(persisted), { status: 200 }));
    await repo.saveIntroductionWithWorker!(target, [item]);
    const idsSent = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).request_id);
    expect(idsSent).toEqual(["66666666-6666-4666-8666-666666666666", "77777777-7777-4777-8777-777777777777"]);
  });

  it("does not reuse pending request identity across targets", async () => {
    const { repo } = makeRepository();
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("88888888-8888-4888-8888-888888888888").mockReturnValueOnce("99999999-9999-4999-8999-999999999999") });
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValueOnce(new Response(JSON.stringify(persisted), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(repo.saveIntroductionWithWorker!(target, [item])).rejects.toThrow();
    await repo.saveIntroductionWithWorker!("other-resume", [item]);
    const sent = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(sent.map(body => body.resume_id)).toEqual([target, "other-resume"]);
    expect(sent.map(body => body.request_id)).toEqual(["88888888-8888-4888-8888-888888888888", "99999999-9999-4999-8999-999999999999"]);
  });

  it("clears an ambiguous pending request when the draft is explicitly discarded", async () => {
    const { repo } = makeRepository();
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("cccccccc-cccc-4ccc-8ccc-cccccccccccc").mockReturnValueOnce("dddddddd-dddd-4ddd-8ddd-dddddddddddd") });
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify(persisted), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(repo.saveIntroductionWithWorker!(target, [item])).rejects.toThrow();
    repo.discardPendingIntroductionSave!(target);
    await repo.saveIntroductionWithWorker!(target, [item]);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).request_id)).toEqual([
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ]);
  });

  it("keeps malformed success responses uncertain and never falls back", async () => {
    const { repo, rpc, from } = makeRepository();
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ id: "bad", position: "zero", translations: { zh: { text: "x" }, en: { text: "y" } } }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(persisted), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(repo.saveIntroductionWithWorker!(target, [item])).rejects.toThrow("could not be confirmed");
    await repo.saveIntroductionWithWorker!(target, [item]);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).request_id)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
