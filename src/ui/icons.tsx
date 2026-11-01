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
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  falcon: 'M12 3 4 20l8-5 8 5z',
};

export function Icon({ name, className = 'icon' }: { name: string; className?: string }) {
  return (
    <svg className={className === 'icon' ? 'icon' : `icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} fill={name === 'falcon' ? 'currentColor' : undefined} />
    </svg>
  );
}

// The prototype's 16px icons (prototypes/src/side.js and top-api.js).
const P16: Record<string, string> = {
  logo: '',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  doc: '<path d="M4 2.5h5.5L12 5v8.5H4z"/><path d="M6 8h4M6 10.5h4"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  open: '<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/>',
  x: '<path d="m4.5 4.5 7 7m0-7-7 7"/>',
  chev: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
  pen: '<path d="M10.2 2.8l3 3L6.5 12.5H3.5v-3z"/><path d="M8.7 4.3l3 3"/>',
  bucket: '<path d="M7 2.5l5 5-4.5 4.5a1.4 1.4 0 01-2 0L2.5 9a1.4 1.4 0 010-2z"/><path d="M3 8h8.5"/><path d="M13.6 10.6s.9 1.2.9 1.9a.9.9 0 01-1.8 0c0-.7.9-1.9.9-1.9z"/>',
  caret: '<path d="M5.5 6.75L8 9.25l2.5-2.5"/>',
  up: '<path d="M5.5 9.25L8 6.75l2.5 2.5"/>',
  eye: '<path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="2"/>',
  up2: '<path d="m4.5 9.5 3.5-3.5 3.5 3.5"/>',
};
const LOGO = 'M2.5 14.5c3.2-.6 5.6-2.6 6.8-6.2L10.6 3l1.1 4.4c.9 3.6 3 5.9 5.8 6.9-3.2.9-5.6.4-7.2-1.1-1.5 1.4-4.2 2.1-7.8 1.3z';

export function SvgIcon({ name }: { name: string }) {
  if (name === 'logo') return <svg viewBox="0 0 20 20" aria-hidden="true"><path d={LOGO} fill="currentColor" /></svg>;
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P16[name] }} />;
}
