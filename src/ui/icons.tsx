const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 3v5h7V3M7 21v-7h10v7',
  outline: 'M4 6h16M8 12h12M12 18h8M4 12h.01M8 18h.01',
  x: 'M6 6l12 12M18 6 6 18',
  chevron: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronUp: 'm6 15 6-6 6 6',
  highlighter: 'm9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  bucket: 'M19 11 11 3 3 11l8 8 8-8zM3 11h16M21 15s-2 2.5-2 4a2 2 0 0 0 4 0c0-1.5-2-4-2-4z',
  falcon: 'M12 3 4 20l8-5 8 5z',
};

export function Icon({ name, className = 'icon' }: { name: string; className?: string }) {
  return (
    <svg className={className === 'icon' ? 'icon' : `icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} fill={name === 'falcon' ? 'currentColor' : undefined} />
    </svg>
  );
}
