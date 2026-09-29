import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroPortrait } from "../../app/HeroPortrait";
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

  it("exposes the generated public photo alternative through the image itself", () => {
    const { rerender } = render(<HeroPortrait photoUrl="/portrait.webp" name="Demo User" locale="en" avatarInitials="DU" portraitRef={null} />);
    expect(screen.getByRole("img", { name: "Portrait of Demo User" }).getAttribute("src")).toBe("/portrait.webp");
    rerender(<HeroPortrait photoUrl="/portrait.webp" name="示例用户" locale="zh" avatarInitials="DU" portraitRef={null} />);
    expect(screen.getByRole("img", { name: "示例用户的个人头像" })).toBeTruthy();
  });

  it("labels the initials fallback without a duplicate outer landmark name", () => {
    const { container } = render(<HeroPortrait photoUrl={null} name="" locale="en" avatarInitials="DU" portraitRef={null} />);
    expect(screen.getByRole("img", { name: "Profile portrait" })).toBeTruthy();
    expect(container.querySelector("aside")?.hasAttribute("aria-label")).toBe(false);
  });
});
