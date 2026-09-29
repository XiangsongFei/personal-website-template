import type { Ref } from "react";
import { getAvatarAltText } from "../shared/avatarAlt";

export function HeroPortrait({ photoUrl, name, locale, avatarInitials, portraitRef }: {
  photoUrl: string | null;
  name: string | null | undefined;
  locale: "zh" | "en";
  avatarInitials: string;
  portraitRef: Ref<HTMLElement>;
}) {
  const alt = getAvatarAltText(locale, name);
  return <aside className="portrait-wrap" ref={portraitRef}>
    {photoUrl
      ? <img src={photoUrl} alt={alt} />
      : <div className="portrait-placeholder" role="img" aria-label={alt}>{avatarInitials}</div>}
  </aside>;
}
