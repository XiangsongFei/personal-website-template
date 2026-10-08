import { describe, expect, it } from "vitest";
import { validateRestoreMutationResult } from "../src/data/restoreMutationContract";

const source = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const resultEvent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const restored = { status: "restored", domain: "awards", source_event_id: source, result_event_id: resultEvent, occurred_at: "2026-10-08T02:10:04.123456+00:00" };

describe("frozen Restore mutation response contract", () => {
  it("accepts the exact restored and no-change shapes", () => {
    expect(validateRestoreMutationResult(restored, source)).toEqual(restored);
    expect(validateRestoreMutationResult({ status: "no_change", domain: "awards", source_event_id: source, result_event_id: null }, source))
      .toEqual({ status: "no_change", domain: "awards", source_event_id: source, result_event_id: null });
  });

  it.each([
    ["unknown status", { ...restored, status: "pending" }],
    ["unsupported domain", { ...restored, domain: "files" }],
    ["wrong source", { ...restored, source_event_id: resultEvent }],
    ["bad result UUID", { ...restored, result_event_id: "not-a-uuid" }],
    ["bad timestamp", { ...restored, occurred_at: "yesterday" }],
    ["extra private field", { ...restored, actor_user_id: "private" }],
    ["missing field", { status: "restored", domain: "awards", source_event_id: source, result_event_id: resultEvent }],
    ["no-change result event", { status: "no_change", domain: "awards", source_event_id: source, result_event_id: resultEvent }],
    ["nested data", { ...restored, result: { payload: "private" } }],
  ])("rejects %s", (_label, value) => {
    expect(validateRestoreMutationResult(value, source)).toBeNull();
  });
});
