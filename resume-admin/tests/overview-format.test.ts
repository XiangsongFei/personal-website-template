import { describe, expect, it } from "vitest";
import { formatBeijingTimestamp } from "../src/overviewFormat";

describe("Overview timestamp formatting", () => {
  it("formats UTC input in Asia/Shanghai to minute precision", () => {
    expect(formatBeijingTimestamp("2026-09-24T06:51:31.640974+00:00")).toBe("2026-09-24 14:51");
  });

  it("uses a stable Beijing time regardless of the process timezone", () => {
    expect(formatBeijingTimestamp("2026-09-24T06:51:31Z")).toBe("2026-09-24 14:51");
  });

  it.each([null, undefined, "", "not-a-date"])("returns an em dash for unavailable/invalid input %s", value => {
    expect(formatBeijingTimestamp(value)).toBe("—");
  });
});
