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
  spark: '<path d="M8 2.5 9.4 6.6l4.1 1.4-4.1 1.4L8 13.5 6.6 9.4 2.5 8l4.1-1.4z"/>',
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
  save: '<path d="M3 3.5a1 1 0 0 1 1-1h6.5L13 5v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M5.5 2.5v3h4v-3M5.5 13.5V10h5v3.5"/>',
  saveAs: '<path d="M8.5 13.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h6.5L13 5v2.5"/><path d="M5.5 2.5v3h4v-3"/><path d="m12.2 9.3 1.5 1.5-3.4 3.4H8.8v-1.5z"/>',
  list: '<path d="M2.5 4h11M5 8h8.5M7.5 12h6"/>',
  contrast: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor" stroke="none"/>',
  keyboard: '<rect x="1.8" y="4" width="12.4" height="8" rx="1.5"/><path d="M4.5 6.8h.01M6.8 6.8h.01M9.2 6.8h.01M11.5 6.8h.01M5.5 9.4h5"/>',
  timer: '<circle cx="8" cy="9" r="5"/><path d="M8 9V6.5M6.5 2h3"/>',
  undo: '<path d="M3.5 3.5v3h3"/><path d="M3.8 6.5A5 5 0 1 1 3 9"/>',
  sliders: '<path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6"/><circle cx="10" cy="5" r="1.5"/><circle cx="6" cy="11" r="1.5"/>',
  format: '<path d="M3.5 12.5 7 3.5h2l3.5 9M5 9h6"/>',
  mic: '<rect x="6" y="1.8" width="4" height="7" rx="2"/><path d="M3.8 7.5a4.2 4.2 0 0 0 8.4 0M8 11.7v2M5.8 13.7h4.4"/>',
  refresh: '<path d="M13 6.5a5 5 0 0 0-9.3-1.6"/><path d="M3.5 2.3v2.8h2.8"/><path d="M3 9.5a5 5 0 0 0 9.3 1.6"/><path d="M12.5 13.7v-2.8H9.7"/>',
  download: '<path d="M8 2.5v7.5M5 7l3 3 3-3"/><path d="M2.5 10.5v1.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>',
  upload: '<path d="M8 10.5V3M5 6l3-3 3 3"/><path d="M2.5 10.5v1.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>',
  // SpeechDrop's tab: a tray that files drop into
  inbox: '<path d="M2.5 9.5h3l1 1.5h3l1-1.5h3"/><path d="M4.2 3.5h7.6l1.7 6v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-3z"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1"/>',
  gear: '<path d="M8 1.3L8.44 1.31L8.87 1.36L9.2 1.95L9.36 2.92L9.51 3.54L9.8 3.66L10.08 3.78L10.35 3.93L10.61 4.09L10.86 4.27L11.1 4.46L11.72 4.28L12.64 3.93L13.31 3.92L13.57 4.28L13.8 4.65L14.01 5.04L14.19 5.44L13.84 6.02L13.08 6.64L12.62 7.08L12.66 7.39L12.69 7.69L12.7 8L12.69 8.31L12.66 8.61L12.62 8.92L13.08 9.36L13.84 9.98L14.19 10.56L14.01 10.96L13.8 11.35L13.57 11.72L13.31 12.08L12.64 12.07L11.72 11.72L11.1 11.54L10.86 11.73L10.61 11.91L10.35 12.07L10.08 12.22L9.8 12.34L9.51 12.46L9.36 13.08L9.2 14.05L8.87 14.64L8.44 14.69L8 14.7L7.56 14.69L7.13 14.64L6.8 14.05L6.64 13.08L6.49 12.46L6.2 12.34L5.92 12.22L5.65 12.07L5.39 11.91L5.14 11.73L4.9 11.54L4.28 11.72L3.36 12.07L2.69 12.08L2.43 11.72L2.2 11.35L1.99 10.96L1.81 10.56L2.16 9.98L2.92 9.36L3.38 8.92L3.34 8.61L3.31 8.31L3.3 8L3.31 7.69L3.34 7.39L3.38 7.08L2.92 6.64L2.16 6.02L1.81 5.44L1.99 5.04L2.2 4.65L2.43 4.28L2.69 3.92L3.36 3.93L4.28 4.28L4.9 4.46L5.14 4.27L5.39 4.09L5.65 3.93L5.92 3.78L6.2 3.66L6.49 3.54L6.64 2.92L6.8 1.95L7.13 1.36L7.56 1.31Z"/><circle cx="8" cy="8" r="2.2"/>',
};
// the Head mark (logo/build-brand.mjs makes every other brand asset from the same path)
const LOGO = 'M12 57V36A24 24 0 0 1 36 12H42C50.5 12 56 18 56 26C56 30.5 54 33.5 50.5 35.5C51 31.5 49 29 45.5 29H41C37 29 34.5 32 34.5 36V57ZM39 17.5A3.5 3.5 0 1 0 39 24.5A3.5 3.5 0 1 0 39 17.5Z';

export function SvgIcon({ name }: { name: string }) {
  if (name === 'logo') return <svg viewBox="12 12 44 45" aria-hidden="true"><path d={LOGO} fill="currentColor" fillRule="evenodd" /></svg>;
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P16[name] }} />;
}
