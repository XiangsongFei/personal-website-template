export type AvatarAltLocale = "zh" | "en";

export function getAvatarAltText(locale: AvatarAltLocale, localizedName: string | null | undefined): string {
  const name = typeof localizedName === "string" ? localizedName.trim() : "";
  if (!name) return locale === "zh" ? "个人头像" : "Profile portrait";
  return locale === "zh" ? `${name}的个人头像` : `Portrait of ${name}`;
}
