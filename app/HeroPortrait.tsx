import type { Ref } from "react";

export function HeroPortrait({ photoUrl, avatarLabel, avatarInitials, portraitRef }: {
  photoUrl: string | null;
  avatarLabel: string;
  avatarInitials: string;
  portraitRef: Ref<HTMLElement>;
}) {
  return <aside className="portrait-wrap" ref={portraitRef} aria-label={avatarLabel}>
    {photoUrl
      ? <img src={photoUrl} alt="" aria-hidden="true" />
      : <div className="portrait-placeholder" aria-hidden="true">{avatarInitials}</div>}
  </aside>;
}
