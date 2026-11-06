import { P, onPrefs, pref, type Pref } from '../editor/prefs';
import './settings.css';

// ---------- display settings: CSS variables and root classes (settings.css); none of them change the file ----------

export const FONTS: [string, string, string][] = [
  ['calibri', 'Calibri', ''], ['arial', 'Arial', 'Arial, Helvetica, sans-serif'], ['verdana', 'Verdana', 'Verdana, Geneva, sans-serif'],
  ['georgia', 'Georgia', 'Georgia, serif'], ['times', 'Times', "'Times New Roman', Times, serif"],
  ['comic', 'Comic Sans', "'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', sans-serif"],
];
/** Interface fonts: the chrome only (menus, tooltips, Settings, the bar). '' keeps the system font from styles.css. */
export const UI_FONTS: [string, string, string][] = [
  ['system', 'System', ''], ['geist', 'Geist', "'Geist Variable'"], ['inter', 'Inter', "'Inter Variable'"],
  ['switzer', 'Switzer', "'Switzer'"], ['figtree', 'Figtree', "'Figtree Variable'"], ['halden', 'Halden', "'Halden'"],
];
export const SIZE_PREFS: [string, string, Pref<number>][] = [
  ['normal', 'Body text', P.szNormal], ['pocket', 'Pocket', P.szPocket], ['hat', 'Hat', P.szHat], ['block', 'Block', P.szBlock],
  ['tag', 'Tag', P.szTag], ['cite', 'Cite', P.szCite], ['analytic', 'Analytic', P.szAnalytic], ['undertag', 'Undertag', P.szUndertag],
];
/** The doc font's ascent and descent (in em) and the screen's pixel ratio, which box-fit line spacing rounds to. */
function applyMetrics() {
  const root = document.documentElement;
  root.style.setProperty('--dpr', String(window.devicePixelRatio || 1));
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return;
  ctx.font = `bold 1000px ${getComputedStyle(root).getPropertyValue('--doc-font')}`;
  const m = ctx.measureText('x');
  root.style.setProperty('--asc', String(m.fontBoundingBoxAscent / 1000));
  root.style.setProperty('--dsc', String(m.fontBoundingBoxDescent / 1000));
}
function watchPixelRatio() {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => { applyMetrics(); watchPixelRatio(); }, { once: true });
}
function applyDisplay() {
  const root = document.documentElement;
  const v = (k: string, val: string) => (val ? root.style.setProperty(k, val) : root.style.removeProperty(k));
  v('--doc-font', FONTS.find(([id]) => id === pref(P.font))?.[2] ?? '');
  const ui = UI_FONTS.find(([id]) => id === pref(P.uiFont))?.[2];
  v('--ui-font', ui ? `${ui}, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` : '');
  v('--doc-lh', pref(P.lineHeight));
  for (const [id, , p] of SIZE_PREFS) v(`--sz-${id}`, `${pref(p)}pt`);
  v('--c-analytic', pref(P.colorAnalytic));
  v('--c-undertag', pref(P.colorUndertag));
  v('--text-w', { full: '', wide: '900px', narrow: '680px' }[pref(P.textWidth)]);
  v('--margin-x', { narrow: '12px', normal: '', wide: '72px' }[pref(P.margins)]);
  root.dataset.caret = pref(P.caret);
  root.dataset.sel = pref(P.selection);
  const cls: [string, boolean][] = [
    ['lh-box', pref(P.lineHeight) === '1.3'], ['cite-plain', !pref(P.citeBold)], ['emph-nobox', !pref(P.emphasisBox)], ['pocket-nobox', !pref(P.pocketBox)],
    ['hat-single', pref(P.hatLine) === 'single'], ['shade-dots', pref(P.shadingDots)], ['no-card-bar', !pref(P.cardBar)], ['reduce-motion', pref(P.reduceMotion)],
  ];
  for (const [c, on] of cls) root.classList.toggle(c, on);
  applyMetrics();
}
applyDisplay();
onPrefs(applyDisplay);
watchPixelRatio();
void document.fonts?.ready.then(applyMetrics);
