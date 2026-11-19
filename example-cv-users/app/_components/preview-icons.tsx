export function PreviewIcon({kind}: {kind: 'mail' | 'file' | 'linkedin' | 'github' | 'external' | 'study' | 'graduation' | 'open'}) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={kind === 'github' ? 'filled-icon' : undefined}>
    {kind === 'mail' ? <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>
      : kind === 'file' ? <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M8 13h8M8 17h6"/>
      : kind === 'linkedin' ? <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r=".8"/><path d="M8 11v6M12 17v-3.8c0-1.4.9-2.3 2.1-2.3s2.1.9 2.1 2.3V17"/></>
      : kind === 'github' ? <path d="M12 2.4a9.6 9.6 0 0 0-3.03 18.71c.48.09.66-.21.66-.47v-1.68c-2.68.58-3.24-1.13-3.24-1.13-.44-1.12-1.07-1.42-1.07-1.42-.87-.6.07-.59.07-.59.97.07 1.48 1 1.48 1 .86 1.48 2.25 1.06 2.8.8.09-.63.34-1.05.62-1.29-2.14-.24-4.39-1.07-4.39-4.76 0-1.05.38-1.91.99-2.58-.1-.24-.43-1.22.1-2.54 0 0 .81-.26 2.64.98A9.15 9.15 0 0 1 12 6.6c.82 0 1.64.11 2.41.33 1.83-1.24 2.64-.98 2.64-.98.53 1.32.2 2.3.1 2.54.62.67.99 1.53.99 2.58 0 3.7-2.25 4.51-4.4 4.75.35.3.65.86.65 1.74v2.58c0 .26.17.56.66.47A9.6 9.6 0 0 0 12 2.4Z"/>
      : kind === 'study' ? <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>
      : kind === 'graduation' ? <path d="m4 12 5 5L20 6"/>
      : <path d="M7 17 17 7M9 7h8v8"/>}
  </svg>;
}
