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
  recentCount: def('recentCount', 7), // how many files Home lists (1 to recents.ts MAX)
  usageStats: def('usageStats', true), // anonymous feature counts to PostHog (src/ui/analytics.ts)
  newName: def<'untitled' | 'speech' | 'date'>('newName', 'untitled'),
  aiOn: def('aiOn', false), // off until you turn it on and add a key (Settings > AI)
  aiProvider: def<'anthropic' | 'openrouter'>('aiProvider', 'anthropic'),
  aiModel: def('aiModel', ''), // blank: electron/ai.cjs picks
  aiRouterModel: def('aiRouterModel', ''), // OpenRouter's has to be pasted in, there's no sensible default
  aiMaxTokens: def('aiMaxTokens', 8192),
  aiCitePreset: def('aiCitePreset', ''), // which saved prompt is in use, '' for the built-in one
  aiCitePresets: def('aiCitePresets', '[]'), // the saved prompts, as JSON (ai-cite.ts)
  speechName: def('speechName', 'Speech {speech} {date:M-D h-mmA}'), // New speech doc's file name (files.ts speechFileName)
  savePrefix: def('savePrefix', true), // Save As puts the prefixes below on Send, Read and Marked Doc names
  prefixSend: def('prefix.send', 'SEND_'),
  prefixRead: def('prefix.read', 'READ_'),
  prefixMarked: def('prefix.marked', 'MARKED_'),
  openDepth: def('openDepth', 0), // 0: opening a file keeps the current depth
  // Appearance
  railResize: def('railResize', false), // the rail's right edge drags it wider to show file names
  joinMax: def('joinMax', 3), // how many files Join puts side by side
  wheelZoom: def('wheelZoom', false),
  theme: def('theme', 'dark'), // a preset id, 'system', or a custom theme's id (src/ui/theme.ts)
  paper: def<'theme' | 'white' | 'dark'>('paper', 'theme'),
  textWidth: def<'full' | 'wide' | 'narrow'>('textWidth', 'full'),
  margins: def<'narrow' | 'normal' | 'wide'>('margins', 'normal'),
  font: def('font', 'calibri'),
  uiFont: def('uiFont', 'geist'), // the chrome's font (Settings.tsx UI_FONTS); `font` is the document's
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
  launchFalcon: def('launchFalcon', true), // the falcon sweeps in over Home when Falcon starts
  // Editor
  spellcheck: def('spellcheck', true),
  condense: def<CondenseMode>('condense', 'integrity'),
  smallPilcrows: def('smallPilcrows', false),
  pasteCondense: def('pasteCondense', false),
  shrinkMin: def('shrinkMin', 4),
  shrinkProtect: def('shrinkProtect', true),
  smartShrink: def('smartShrink', false),
  smartPaste: def('smartPaste', true),
  smartQuotes: def('smartQuotes', true), // typed ' and " curl (quotes.ts)
  citeNearest: def('citeNearest', true),
  hlUnderlined: def('hlUnderlined', false),
  styleOffClears: def('styleOffClears', true), // taking underline off also clears size, bold, highlight... (CardMirror's default)
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
  showSend: def('showSend', false), // the Send button beside the timer; the send key works either way
  prepMin: def('prepMin', 8),
  round: def<'policy' | 'ld' | 'pf'>('round', 'policy'), // which speeches the timer window steps through (src/ui/round-clock.ts)
  lowTime: def('lowTime', 0), // seconds left when the timer starts flashing; 0 = never
  beep: def('beep', false),
  wpm1: def('wpm1', 200),
  wpm2: def('wpm2', 300),
  // tags, analytics and cites; 0 reads them at the card speed
  wpm1Tags: def('wpm1.tags', 0),
  wpm2Tags: def('wpm2.tags', 0),
};

/** What Enter at the end of each style makes. */
export const ENTER_AFTER: Partial<Record<string, Pref<Style>>> = {
  pocket: P.enterPocket, hat: P.enterHat, block: P.enterBlock, tag: P.enterTag, analytic: P.enterAnalytic, undertag: P.enterUndertag,
};

const cache = new Map<string, string | number | boolean>();
const KEYS = new Set<string>(Object.values(P).map((p) => p.key));
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
/** Settings declared outside `P` (each shortcut in keybinds.ts), so Restore defaults and other windows cover them too. */
const EXTRA: Pref<string | number | boolean>[] = [];
export function registerPrefs(ps: Pref<string | number | boolean>[]) {
  for (const p of ps) { EXTRA.push(p); KEYS.add(p.key); }
}
/** Every setting declared here or registered (the shortcuts). */
export const allPrefs = (): Pref<string | number | boolean>[] => [...Object.values(P), ...EXTRA];
/** Put one setting back to its default. */
export function clearPref(p: Pref<string | number | boolean>) {
  localStorage.removeItem(p.key);
  cache.delete(p.key);
  changed();
}
/** Restore defaults: forget every setting here. */
export function resetPrefs() {
  // an opt-out of usage statistics survives Restore defaults
  for (const p of [...Object.values(P), ...EXTRA]) if (p !== P.usageStats) localStorage.removeItem(p.key);
  cache.clear();
  changed();
}
/** Many settings were written straight to storage (Import settings): forget the cached values and redraw. */
export function reloadPrefs() {
  cache.clear();
  changed();
}
/** Run `f` whenever a setting changes. Returns an unsubscribe. */
export function onPrefs(f: () => void): () => void {
  addEventListener(EVENT, f);
  return () => removeEventListener(EVENT, f);
}
// another window changed them
if (typeof window !== 'undefined') addEventListener('storage', (e) => { if (!e.key || KEYS.has(e.key) || e.key === 'falcon.themes') { cache.clear(); changed(); } });
