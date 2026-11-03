/**
 * Settings > General > Export and Import: every Falcon setting as one .json file, and back.
 * Settings live in localStorage as `falcon.*` strings; the file holds those strings with the prefix taken off.
 * Import also reads CardMirror's settings export, carrying over the settings Falcon has an equivalent for.
 */
import { P, allPrefs, reloadPrefs } from '../editor/prefs';
import { HIGHLIGHTS, SHADES } from '../editor/schema';
import type { SettingSpec } from '../editor/tools';
import { navSettings } from '../editor/nav-keys';
import { docToolSettings } from '../editor/doc-tools';
import { cardToolSettings } from '../editor/card-tools';
import '../editor/keymap'; // registers the shortcut settings, so their keys count as settings
import { safeSet } from './storage';

const NS = 'falcon.';
/** Stored values that aren't settings: open documents, recents, the last session. Never exported or imported. */
const NOT_SETTINGS = ['autosave.', 'recents.', 'cc.recent', 'session', 'meta', 'pageDark'];
const isSetting = (key: string) =>
  key.startsWith(NS) && key !== P.usageStats.key && !NOT_SETTINGS.some((s) => key.slice(NS.length).startsWith(s));

const HEX = /^#[0-9a-f]{6}$/i;
const inRange = (min: number, max: number) => (v: string) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;
/** Settings App and the toolbar keep outside the prefs, and what each may hold. */
const APP_KEYS: Record<string, (v: string) => boolean> = {
  zoom: inRange(0.5, 3), speech: (v) => inRange(1, 30)(v) && Number.isInteger(Number(v)), depth: (v) => ['1', '2', '3', '4'].includes(v),
  outline: (v) => v === 'on' || v === 'off', highlight: (v) => v in HIGHLIGHTS, shading: (v) => HEX.test(v), fontColor: (v) => HEX.test(v),
  themes: (v) => { try { return Array.isArray(JSON.parse(v)); } catch { return false; } },
};
/** Does `v` fit setting `key` (with its `falcon.` prefix)? Unknown keys don't. */
function fits(key: string, v: string): boolean {
  if (!isSetting(key)) return false;
  const app = APP_KEYS[key.slice(NS.length)];
  if (app) return app(v);
  const spec = ([...navSettings, ...docToolSettings, ...cardToolSettings] as SettingSpec[]).find((x) => x.key === key);
  if (spec) return spec.kind === 'toggle' ? v === 'on' || v === 'off' : spec.options.some(([o]) => o === v);
  const p = allPrefs().find((x) => x.key === key);
  if (!p) return false;
  if (typeof p.default === 'boolean') return v === 'on' || v === 'off';
  if (typeof p.default === 'number') return v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1000;
  return v.length <= (key.startsWith(`${NS}prefix.`) ? 40 : 200);
}

export type SettingsFile = { app: 'Falcon'; version: 1; settings: Record<string, string> };

const storedKeys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);

export function exportSettings(): SettingsFile {
  const keys = storedKeys().filter(isSetting).sort();
  return { app: 'Falcon', version: 1, settings: Object.fromEntries(keys.map((k) => [k.slice(NS.length), localStorage.getItem(k)!])) };
}

/** Download the settings file (in the desktop app, Electron asks where to save it). */
export function downloadSettings() {
  const blob = new Blob([JSON.stringify(exportSettings(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'falcon-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export type ImportResult = { ok: true; from: 'Falcon' | 'CardMirror'; applied: number; skipped: number } | { ok: false; error: string };

/** Apply a settings file's text. Only settings Falcon knows, holding values they can take, are written; a file with none changes nothing. */
export function importSettings(text: string): ImportResult {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'That file isn’t valid JSON.' }; }
  const obj = data as { app?: unknown; settings?: unknown } | null;
  const settings = obj && typeof obj === 'object' && obj.settings && typeof obj.settings === 'object' && !Array.isArray(obj.settings)
    ? (obj.settings as Record<string, unknown>) : null;
  if (!settings) return { ok: false, error: 'That file has no settings in it.' };

  if (obj!.app === 'Falcon') {
    const entries = Object.entries(settings).filter(([k, v]) => typeof v === 'string' && fits(NS + k, v)) as [string, string][];
    if (!entries.length) return { ok: false, error: 'That file has no Falcon settings in it.' };
    // the file is the whole picture: a setting it leaves out is at its default there
    const before = storedKeys().filter(isSetting).map((k) => [k, localStorage.getItem(k)!] as const);
    for (const [k] of before) localStorage.removeItem(k);
    try {
      for (const [k, v] of entries) localStorage.setItem(NS + k, v);
    } catch {
      // storage is full: put back what was there
      for (const [k] of entries) localStorage.removeItem(NS + k);
      for (const [k, v] of before) safeSet(k, v);
      reloadPrefs();
      return { ok: false, error: 'Falcon’s storage is full, so nothing changed.' };
    }
    reloadPrefs();
    return { ok: true, from: 'Falcon', applied: entries.length, skipped: Object.keys(settings).length - entries.length };
  }
  if (!CM_MARKERS.some((k) => k in settings)) return { ok: false, error: 'That isn’t a Falcon or CardMirror settings file.' };
  const { values, used } = fromCardMirror(settings);
  for (const [k, v] of Object.entries(values)) safeSet(NS + k, v);
  reloadPrefs();
  return { ok: true, from: 'CardMirror', applied: Object.keys(values).length, skipped: Object.keys(settings).filter((k) => !used.has(k)).length };
}

// ---------- CardMirror ----------

const CM_MARKERS = ['navMaxLevel', 'displaySizes', 'ribbonKeyOverrides', 'timerProfile', 'sendDocPrefix'];
type Get = (path: string) => unknown;
const bool = (v: unknown) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : undefined);
/** A number snapped into [min, max] on `step`, or undefined. */
const num = (v: unknown, min: number, max: number, step = 1) =>
  typeof v === 'number' && Number.isFinite(v) ? String(+Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step)).toFixed(2)) : undefined;
const oneOf = (v: unknown, opts: string[]) => (typeof v === 'string' && opts.includes(v) ? v : undefined);
const hex = (v: unknown) => (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v) ? `#${v.replace('#', '').toUpperCase()}` : undefined);
const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 40) : undefined);
const STYLES = ['normal', 'pocket', 'hat', 'block', 'tag', 'analytic', 'undertag'];

/** Falcon key (without `falcon.`), the CardMirror settings it reads (comma-separated), and how it reads them. */
const CM_MAP: [string, string, (get: Get) => string | undefined][] = [
  ['savePrefix', 'prefixPresetSaveFilenames', (g) => bool(g('prefixPresetSaveFilenames'))],
  ['prefix.send', 'sendDocPrefix', (g) => text(g('sendDocPrefix'))],
  ['prefix.read', 'readDocPrefix', (g) => text(g('readDocPrefix'))],
  ['prefix.marked', 'markedDocPrefix', (g) => text(g('markedDocPrefix'))],
  ['theme', 'theme', (g) => oneOf(g('theme'), ['system', 'light', 'dark'])],
  ['reduceMotion', 'reduceMotion', (g) => (g('reduceMotion') === 'on' || g('reduceMotion') === true ? 'on' : g('reduceMotion') === 'off' || g('reduceMotion') === false ? 'off' : undefined)],
  ['spellcheck', 'editorSpellcheck', (g) => bool(g('editorSpellcheck'))],
  ['depth', 'navMaxLevel', (g) => num(g('navMaxLevel'), 1, 4)],
  ['zoom', 'defaultZoomPct', (g) => (typeof g('defaultZoomPct') === 'number' ? num((g('defaultZoomPct') as number) / 100, 0.5, 3, 0.1) : undefined)],
  ['prepMin', 'timerPrepMinutes', (g) => num(g('timerPrepMinutes'), 1, 15)],
  ['wpm1', 'readers', (g) => num(g('readers.0.wpm'), 50, 1000)],
  ['wpm2', 'readers', (g) => num(g('readers.1.wpm'), 50, 1000)],
  ['wpm1.tags', 'readers', (g) => (g('readers.0.tagWpm') === 0 ? '0' : num(g('readers.0.tagWpm'), 50, 1000))],
  ['wpm2.tags', 'readers', (g) => (g('readers.1.tagWpm') === 0 ? '0' : num(g('readers.1.tagWpm'), 50, 1000))],
  ['sz.normal', 'displaySizes', (g) => num(g('displaySizes.normal'), 8, 14)],
  ['sz.pocket', 'displaySizes', (g) => num(g('displaySizes.pocket'), 18, 36, 2)],
  ['sz.hat', 'displaySizes', (g) => num(g('displaySizes.hat'), 14, 28, 2)],
  ['sz.block', 'displaySizes', (g) => num(g('displaySizes.block'), 12, 22)],
  ['sz.tag', 'displaySizes', (g) => num(g('displaySizes.tag'), 10, 16)],
  ['sz.cite', 'displaySizes', (g) => num(g('displaySizes.cite'), 10, 16)],
  ['sz.analytic', 'displaySizes', (g) => num(g('displaySizes.analytic'), 10, 16)],
  ['sz.undertag', 'displaySizes', (g) => num(g('displaySizes.undertag'), 8, 14)],
  ['emphasisBox', 'displayTypography', (g) => bool(g('displayTypography.emphasisBox'))],
  ['color.analytic', 'displayColors', (g) => hex(g('displayColors.analytic'))?.toLowerCase()],
  ['color.undertag', 'displayColors', (g) => hex(g('displayColors.undertag'))?.toLowerCase()],
  ['markerColor', 'displayColors', (g) => oneOf(hex(g('displayColors.readingMarker')), ['#FF0000', '#0070C0', '#00B050', '#7030A0'])],
  ['font', 'bodyFont', (g) => {
    const f = String(g('bodyFont') ?? '').toLowerCase();
    return ['calibri', 'arial', 'verdana', 'georgia', 'times', 'comic'].find((id) => f.startsWith(id));
  }],
  ['lineHeight', 'lineHeight', (g) => {
    const v = g('lineHeight');
    if (typeof v !== 'number') return undefined;
    return [1, 1.2, 1.5, 2].reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)).toString();
  }],
  ['condense', 'paragraphIntegrity,usePilcrows', (g) => (g('paragraphIntegrity') === true ? 'integrity' : g('paragraphIntegrity') === false ? (g('usePilcrows') === true ? 'pilcrows' : 'merge') : undefined)],
  ['pasteCondense', 'condenseOnPaste', (g) => bool(g('condenseOnPaste'))],
  ['read.top', 'jumpToDocTopOnReadModeToggle', (g) => bool(g('jumpToDocTopOnReadModeToggle'))],
  ['highlight', 'lastHighlightColor', (g) => oneOf(g('lastHighlightColor'), Object.keys(HIGHLIGHTS))],
  ['autoBridge', 'autoBridgeFormattingGaps', (g) => bool(g('autoBridgeFormattingGaps'))],
  ['bridgeGaps', 'formattingGapClass', (g) => oneOf(g('formattingGapClass'), ['both', 'space'])],
  ['extractUndertag.quotes', 'extractUndertagInQuotes', (g) => bool(g('extractUndertagInQuotes'))],
  ['standardizeHighlightException', 'standardizeHighlightException', (g) => oneOf(g('standardizeHighlightException'), Object.keys(HIGHLIGHTS))],
  ['standardizeShadingException', 'standardizeShadingException', (g) => oneOf(hex(g('standardizeShadingException')), ['#FFFF00', '#00FF00', '#00FFFF', ...SHADES.map(([c]) => c)])],
  ['reference.heading', 'createReferenceIncludeHeading', (g) => bool(g('createReferenceIncludeHeading'))],
  ['reference.shrink', 'createReferenceShrinkPt,createReferenceShrinks', (g) => (g('createReferenceShrinks') === false ? '0' : num(g('createReferenceShrinkPt'), 0, 4))],
  ['reference.highlights', 'createReferenceHighlightMode', (g) => oneOf(g('createReferenceHighlightMode'), ['shading', 'convert', 'keep', 'remove'])],
  ...(['pocket', 'hat', 'block', 'tag', 'analytic', 'undertag'] as const).map((s): [string, string, (g: Get) => string | undefined] => {
    const cm = `enterAfter${s[0].toUpperCase()}${s.slice(1)}`;
    return [`enter.${s}`, cm, (g) => oneOf(g(cm), STYLES)];
  }),
];
function fromCardMirror(cm: Record<string, unknown>): { values: Record<string, string>; used: Set<string> } {
  const get: Get = (path) => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), cm);
  const values: Record<string, string> = {};
  const used = new Set<string>();
  for (const [key, from, read] of CM_MAP) {
    const v = read(get);
    if (v === undefined) continue;
    values[key] = v;
    for (const k of from.split(',')) used.add(k);
  }
  return { values, used };
}
