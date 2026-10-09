import { describe, expect, it } from "vitest";
import { presentRestorePreview } from "../src/data/restorePreviewPresenter";
import type { RestorePreview, RestorePreviewJson } from "../src/data/resumeRepository";

const eventId = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const targetId = "ea111111-1111-4111-8111-111111111111";
const digest = "a".repeat(64);
const row = (id: string, position: number, enName: string, zhName = "奖项") => ({
  id, position, en: { name: enName, year: "2099" }, zh: { name: zhName, year: "2099" },
});
function preview(domain: RestorePreview["domain"], currentState: RestorePreviewJson, historicalState: RestorePreviewJson): RestorePreview {
  return { status: JSON.stringify(currentState) === JSON.stringify(historicalState) ? "no_change" : "ready", sourceEventId: eventId,
    sourceOccurredAt: "2026-10-05T02:10:04Z", domain, currentState, historicalState,
    comparison: { before: currentState, after: historicalState }, expectedCurrentDigest: digest };
}

describe("Restore Preview presenter", () => {
  it("presents additions and removals only in the direction of after restore", () => {
    const current = [row(targetId, 0, "Kept")];
    const historical = [row(targetId, 0, "Kept"), row("ea222222-2222-4222-8222-222222222222", 1, "Earlier award")];
    const addition = presentRestorePreview(preview("awards", current, historical), eventId);
    expect(addition.state).toBe("changes");
    if (addition.state !== "changes") return;
    expect(addition.comparison.items.some(item => item.state === "added" && item.label === "Earlier award")).toBe(true);
    expect(addition.comparison.items.some(item => item.state === "removed")).toBe(false);

    const removal = presentRestorePreview(preview("awards", historical, current), eventId);
    expect(removal.state).toBe("changes");
    if (removal.state !== "changes") return;
    expect(removal.comparison.items.some(item => item.state === "removed" && item.label === "Earlier award")).toBe(true);
    expect(removal.comparison.items.some(item => item.state === "added")).toBe(false);
  });

  it("reports ordering without exposing numeric positions", () => {
    const current = [row(targetId, 0, "First"), row("ea222222-2222-4222-8222-222222222222", 1, "Second")];
    const historical = [row("ea222222-2222-4222-8222-222222222222", 0, "Second"), row(targetId, 1, "First")];
    const result = presentRestorePreview(preview("awards", current, historical), eventId);
    expect(result.state).toBe("changes");
    if (result.state !== "changes") return;
    expect(result.comparison.items.filter(item => item.state === "reordered")).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("position");
  });

  it("preserves null-to-value and long content without inventing values", () => {
    const common = { organization: "Example", title: "Engineer", period: "2020", description: "Role", location: null as string | null };
    const current = [{ id: targetId, position: 0, en: { ...common }, zh: { ...common } }];
    const longDescription = "A detailed historical description. ".repeat(20);
    const historical = [{ id: targetId, position: 0, en: { ...common, location: "Shanghai", description: longDescription }, zh: { ...common } }];
    const result = presentRestorePreview(preview("experience", current, historical), eventId);
    expect(result.state).toBe("changes");
    if (result.state !== "changes") return;
    const fields = result.comparison.items.flatMap(item => item.fields);
    expect(fields).toContainEqual(expect.objectContaining({ key: "location", locale: "en", before: { recorded: true, value: null }, after: { recorded: true, value: "Shanghai" } }));
    expect(fields).toContainEqual(expect.objectContaining({ key: "description", locale: "en", after: { recorded: true, value: longDescription } }));
    expect(fields.some(field => field.key === "location" && field.locale === "zh")).toBe(false);
  });

  it("fails closed when the response belongs to another history event", () => {
    const result = presentRestorePreview(preview("awards", [row(targetId, 0, "Current")], [row(targetId, 0, "Past")]),
      "ea333333-3333-4333-8333-333333333333");
    expect(result).toEqual({ state: "unavailable", domain: null });
  });
});
