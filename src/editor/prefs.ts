/**
 * Falcon's own settings (the Settings panel's rows beyond the feature-declared SettingSpecs).
 * Each lives in localStorage under its key (toggles as 'on'/'off', like readSetting), is cached
 * after the first read so keystroke paths pay a Map lookup, and announces changes with an event
 * so the app and editor re-render live.
 */
export type Pref<T extends string | number | boolean> = { key: string; default: T };
function def(key: string, d: boolean): Pref<boolean>;
function def(key: string, d: number): Pref<number>;
function def<T extends string = string>(key: string, d: NoInfer<T>): Pref<T>;
function def(key: string, d: string | number | boolean) { return { key: `falcon.${key}`, default: d }; }

export type CondenseMode = 'integrity' | 'merge' | 'pilcrows';
type Style = 'normal' | 'pocket' | 'hat' | 'block' | 'tag' | 'analytic' | 'undertag';

export const P = {
  // General
  openHome: def('openHome', true),
  reopen: def('reopen', false),
  confirmClose: def('confirmClose', true),
  crashRecovery: def('crashRecovery', true),
  recentCount: def('recentCount', 12),
  newName: def<'untitled' | 'speech' | 'date'>('newName', 'untitled'),
  openDepth: def('openDepth', 0), // 0: opening a file keeps the current depth
  // Appearance
  wheelZoom: def('wheelZoom', false),
  theme: def('theme', 'dark'), // a preset id, 'system', or a custom theme's id (src/ui/theme.ts)
  paper: def<'theme' | 'white' | 'dark'>('paper', 'theme'),
  textWidth: def<'full' | 'wide' | 'narrow'>('textWidth', 'full'),
  margins: def<'narrow' | 'normal' | 'wide'>('margins', 'normal'),
  font: def('font', 'calibri'),
  lineHeight: def('lineHeight', '1.2'),
  szNormal: def('sz.normal', 11),
  szPocket: def('sz.pocket', 26),
  szHat: def('sz.hat', 22),
  szBlock: def('sz.block', 16),
  szTag: def('sz.tag', 13),
  szCite: def('sz.cite', 13),
  szAnalytic: def('sz.analytic', 13),
  szUndertag: def('sz.undertag', 11),
  colorAnalytic: def('color.analytic', ''), // '' = the built-in color
  colorUndertag: def('color.undertag', ''),
  citeBold: def('citeBold', true),
  emphasisBox: def('emphasisBox', true),
  pocketBox: def('pocketBox', true),
  hatLine: def<'double' | 'single'>('hatLine', 'double'),
  shadingDots: def('shadingDots', false),
  caret: def<'auto' | 'blue' | 'red' | 'ink'>('caret', 'auto'),
  selection: def<'blue' | 'gray' | 'ink'>('selection', 'blue'),
  cardBar: def('cardBar', true),
  reduceMotion: def('reduceMotion', false),
  // Editor
  condense: def<CondenseMode>('condense', 'integrity'),
  smallPilcrows: def('smallPilcrows', false),
  pasteCondense: def('pasteCondense', false),
  shrinkMin: def('shrinkMin', 4),
  shrinkProtect: def('shrinkProtect', true),
  smartPaste: def('smartPaste', true),
  citeNearest: def('citeNearest', true),
  hlUnderlined: def('hlUnderlined', false),
  enterPocket: def<Style>('enter.pocket', 'normal'),
  enterHat: def<Style>('enter.hat', 'normal'),
  enterBlock: def<Style>('enter.block', 'normal'),
  enterTag: def<Style>('enter.tag', 'normal'),
  enterAnalytic: def<Style>('enter.analytic', 'normal'),
  enterUndertag: def<Style>('enter.undertag', 'normal'),
  // Read mode
  readParas: def('read.paras', false),
  readWholeCite: def('read.wholeCite', false),
  readUndertags: def('read.undertags', false),
  readShading: def('read.shading', false),
  readTop: def('read.top', false),
  markerColor: def('markerColor', '#FF0000'),
  markerTime: def('markerTime', true),
  // Speech and timers
  showPrep: def('showPrep', false),
  prepMin: def('prepMin', 8),
  lowTime: def('lowTime', 0), // seconds left when the timer starts flashing; 0 = never
  beep: def('beep', false),
  wpm1: def('wpm1', 200),
  wpm2: def('wpm2', 300),
};

/** What Enter at the end of each style makes. */
export const ENTER_AFTER: Partial<Record<string, Pref<Style>>> = {
  pocket: P.enterPocket, hat: P.enterHat, block: P.enterBlock, tag: P.enterTag, analytic: P.enterAnalytic, undertag: P.enterUndertag,
};

const cache = new Map<string, string | number | boolean>();
const EVENT = 'falcon-prefs';
/** Transaction meta set when settings change, so plugins that draw from them redraw. */
export const PREFS_META = 'falconPrefs';

export function pref<T extends string | number | boolean>(p: Pref<T>): T {
  const hit = cache.get(p.key);
  if (hit !== undefined) return hit as T;
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(p.key);
  let v: string | number | boolean = p.default;
  if (raw !== null) {
    if (typeof p.default === 'boolean') v = raw === 'on';
    else if (typeof p.default === 'number') v = Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : p.default;
    else v = raw;
  }
  cache.set(p.key, v);
  return v as T;
}

const changed = () => dispatchEvent(new Event(EVENT));
export function setPref<T extends string | number | boolean>(p: Pref<T>, v: T) {
  localStorage.setItem(p.key, typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));
  cache.set(p.key, v);
  changed();
}
/** Restore defaults: forget every setting here. */
export function resetPrefs() {
  for (const p of Object.values(P)) localStorage.removeItem(p.key);
  cache.clear();
  changed();
}
/** Run `f` whenever a setting changes. Returns an unsubscribe. */
export function onPrefs(f: () => void): () => void {
  addEventListener(EVENT, f);
  return () => removeEventListener(EVENT, f);
}
// another window changed them
const KEYS = new Set(Object.values(P).map((p) => p.key));
if (typeof window !== 'undefined') addEventListener('storage', (e) => { if (!e.key || KEYS.has(e.key) || e.key === 'falcon.themes') { cache.clear(); changed(); } });
