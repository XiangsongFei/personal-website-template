import { describe, expect, it } from "vitest";
import { getAvatarAltText } from "../../shared/avatarAlt";

describe("localized avatar alternative text", () => {
  it("derives and trims Chinese and English names", () => {
    expect(getAvatarAltText("zh", "示例用户")).toBe("示例用户的个人头像");
    expect(getAvatarAltText("en", "Demo User")).toBe("Portrait of Demo User");
    expect(getAvatarAltText("zh", "  示例用户  ")).toBe("示例用户的个人头像");
    expect(getAvatarAltText("en", "  Demo User  ")).toBe("Portrait of Demo User");
  });

  it("uses localized fallback labels for empty names", () => {
    expect(getAvatarAltText("zh", "  ")).toBe("个人头像");
    expect(getAvatarAltText("en", "")).toBe("Profile portrait");
    expect(getAvatarAltText("zh", null)).toBe("个人头像");
    expect(getAvatarAltText("en", undefined)).toBe("Profile portrait");
  });
});
