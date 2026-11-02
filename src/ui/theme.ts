/**
 * Themes: the colors of Falcon's chrome and of the document paper. None of them change the saved file.
 *
 * A theme is four colors: the chrome's background and text, and the paper and its text. Every other
 * chrome color (panels, controls, lines, dim text) is that text mixed into that background, so a
 * custom theme only needs the four and still comes out in one family. A preset can pin any token to
 * an exact value (Dark pins today's graphite, shade for shade).
 */
import { bridge } from '../editor/host';
import { P, onPrefs, pref } from '../editor/prefs';

export type ThemeColors = { bg: string; text: string; paper: string; paperInk: string };
export type Theme = ThemeColors & { id: string; name: string; tokens?: Partial<Record<Token, string>> };

/** How much of the text color each chrome token mixes into the background, in percent. */
const MIX = {
  card: 5, raised: 9, pop: 6, panel: 2, well: 6, ctl: 11, ctl2: 13, 'ctl-on': 20, line: 9, tx2: 66, mut: 53, texture: 76,
} as const;
type Token = keyof typeof MIX | 'hover' | 'top' | 'sh' | 'an' | 'ut';

const DARK_TOKENS: Theme['tokens'] = {
  card: '#19191b', raised: '#232325', pop: '#1b1b1e', panel: '#141416', well: '#1c1c1f', ctl: '#26262a', ctl2: '#2c2c30',
  'ctl-on': '#3a3a3f', line: '#232326', tx2: '#a1a1a6', mut: '#85858b', texture: '#b8b8bd', hover: 'rgba(237, 237, 237, .05)',
};
const WHITE_PAPER = { paper: '#ffffff', paperInk: '#222222' };
const DARK_PAPER = { paper: '#1e1e20', paperInk: '#e6e6e6' };

export const PRESETS: Theme[] = [
  { id: 'dark', name: 'Dark', bg: '#0f0f10', text: '#ededed', ...WHITE_PAPER, tokens: DARK_TOKENS },
  { id: 'light', name: 'Light', bg: '#f4f4f5', text: '#1d1d1f', ...WHITE_PAPER, tokens: { pop: '#ffffff', panel: '#fafafa', well: '#ffffff', card: '#efeff0' } },
  { id: 'night', name: 'Night', bg: '#0f0f10', text: '#ededed', ...DARK_PAPER, tokens: DARK_TOKENS },
  { id: 'midnight', name: 'Midnight', bg: '#0b0f1a', text: '#e4e8f1', paper: '#141a28', paperInk: '#dde3ee' },
  { id: 'sepia', name: 'Sepia', bg: '#ebe3d4', text: '#3a3027', paper: '#f8f2e5', paperInk: '#2e261e', tokens: { pop: '#f8f2e5', well: '#f8f2e5', panel: '#f3ecdf' } },
  { id: 'contrast', name: 'High contrast', bg: '#000000', text: '#ffffff', paper: '#ffffff', paperInk: '#000000', tokens: { tx2: '#e6e6e6', mut: '#c4c4c4', line: '#5c5c5c', ctl2: '#3d3d3d', 'ctl-on': '#5c5c5c' } },
];
/** Follows the system's light or dark setting. Not a theme of its own: it picks Light or Dark. */
export const SYSTEM = 'system';

// ---------- custom themes: their own key, so Restore defaults (which forgets every pref) keeps them ----------

const CUSTOM_KEY = 'falcon.themes';
const HEX = /^#[0-9a-f]{6}$/i;
const valid = (t: unknown): t is Theme => {
  const x = t as Theme;
  return !!x && typeof x.id === 'string' && typeof x.name === 'string' && [x.bg, x.text, x.paper, x.paperInk].every((c) => HEX.test(c));
};
export function customThemes(): Theme[] {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(valid).map(({ id, name, bg, text, paper, paperInk }) => ({ id, name, bg, text, paper, paperInk })) : [];
  } catch { return []; }
}
function saveCustom(list: Theme[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  dispatchEvent(new Event('falcon-prefs')); // same event as a pref change: Settings and the theme redraw
}
/** A new custom theme copied from `from`'s four colors, named "<from> copy" (then 2, 3…). Returns it. */
export function addCustomTheme(from: Theme): Theme {
  const list = customThemes();
  const base = `${from.name} copy`;
  let name = base;
  for (let i = 2; list.some((t) => t.name === name); i++) name = `${base} ${i}`;
  const t: Theme = { id: `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, bg: from.bg, text: from.text, paper: from.paper, paperInk: from.paperInk };
  saveCustom([...list, t]);
  return t;
}
/** Change a custom theme. A new background or paper that its text would no longer read on also flips that
 *  text to light or dark (picking a text color yourself is never second-guessed). */
export function updateCustomTheme(id: string, change: Partial<Pick<Theme, 'name' | keyof ThemeColors>>) {
  saveCustom(customThemes().map((t) => {
    if (t.id !== id) return t;
    const n = { ...t, ...change };
    if (change.bg && !change.text && contrast(n.bg, n.text) < 4.5) n.text = isDark(n.bg) ? '#ededed' : '#1d1d1f';
    if (change.paper && !change.paperInk && contrast(n.paper, n.paperInk) < 4.5) n.paperInk = isDark(n.paper) ? '#e6e6e6' : '#222222';
    return n;
  }));
}
export function deleteCustomTheme(id: string) {
  saveCustom(customThemes().filter((t) => t.id !== id));
}

// ---------- resolving and applying ----------

const systemDark = () => typeof matchMedia === 'undefined' || matchMedia('(prefers-color-scheme: dark)').matches;
/** The theme `id` shows (System resolves to Light or Dark; an unknown or deleted id falls back to Dark). */
export function resolveTheme(id: string): Theme {
  if (id === SYSTEM) id = systemDark() ? 'dark' : 'light';
  return PRESETS.find((t) => t.id === id) ?? customThemes().find((t) => t.id === id) ?? PRESETS[0];
}

/** Relative luminance (WCAG) of a #rrggbb color, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const isDark = (hex: string) => luminance(hex) < 0.4;
/** WCAG contrast ratio of two #rrggbb colors, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Every CSS variable a theme sets on the root, as strings (color-mix() is resolved by the browser). */
export function themeVars(t: Theme, paperPref: 'theme' | 'white' | 'dark' = 'theme'): Record<string, string> {
  const dark = isDark(t.bg);
  const paper = paperPref === 'white' ? WHITE_PAPER : paperPref === 'dark' ? DARK_PAPER : t;
  const v: Record<string, string> = { '--u-deep': t.bg, '--u-tx': t.text, '--page': paper.paper, '--doc-ink': paper.paperInk };
  for (const [k, n] of Object.entries(MIX)) v[`--u-${k}`] = `color-mix(in srgb, ${t.text} ${n}%, ${t.bg})`;
  v['--u-hover'] = `color-mix(in srgb, ${t.text} 5%, transparent)`;
  v['--u-top'] = dark ? 'inset 0 1px 0 rgba(255, 255, 255, .08)' : '0 0 0 1px rgba(0, 0, 0, .06), 0 1px 2px rgba(0, 0, 0, .06)';
  v['--u-sh'] = dark ? '1' : '.4';
  // the toolbar's analytic and undertag previews: the dark page's colors on dark chrome, the white page's on light
  v['--u-an'] = dark ? '#8aa4d6' : '#1f3f8a';
  v['--u-ut'] = dark ? '#8fae7a' : '#2a6a3a';
  for (const [k, val] of Object.entries(t.tokens ?? {})) v[`--u-${k}`] = val;
  return v;
}

let applied: string[] = [];
/** Set the chosen theme's variables and root flags. Runs at load and whenever a setting changes. */
export function applyTheme() {
  const root = document.documentElement;
  const t = resolveTheme(pref(P.theme));
  const paperPref = pref(P.paper);
  const vars = themeVars(t, paperPref);
  for (const k of applied) if (!(k in vars)) root.style.removeProperty(k);
  for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
  applied = Object.keys(vars);
  const chromeDark = isDark(t.bg);
  root.dataset.chrome = chromeDark ? 'dark' : 'light';
  root.style.colorScheme = chromeDark ? 'dark' : 'light'; // native selects, color pickers and scrollbars match
  root.classList.toggle('page-dark', isDark(vars['--page']));
  bridge.setTheme?.(t.bg, chromeDark);
}

/** The old Document paper toggle (falcon.pageDark) becomes the paper setting, once. */
function migrate() {
  if (localStorage.getItem(P.paper.key) === null && localStorage.getItem('falcon.pageDark') === 'on') localStorage.setItem(P.paper.key, 'dark');
  localStorage.removeItem('falcon.pageDark');
}

if (typeof document !== 'undefined') {
  migrate();
  applyTheme();
  onPrefs(applyTheme);
  if (typeof matchMedia !== 'undefined') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (pref(P.theme) === SYSTEM) dispatchEvent(new Event('falcon-prefs')); });
}
