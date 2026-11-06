import { MAX_PRESETS, aiService, citePresets, currentPreset, deletePreset, editPreset, newPreset } from '../editor/ai-cite';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { version } from '../../package.json';
import { HIGHLIGHTS, HIGHLIGHT_NAMES } from '../editor/schema';
import { SvgIcon } from './icons';
import { docToolSettings } from '../editor/doc-tools';
import { cardToolSettings } from '../editor/card-tools';
import { navSettings } from '../editor/nav-keys';
import '../editor/keymap'; // registers the editor's bindings
import { BINDINGS, IS_MAC, keyOf, keyText } from '../editor/keybinds';
import { KeyField, type KeyNote } from './KeyField';
import { safeSet } from './storage';
import { readSetting, type SettingSpec } from '../editor/tools';
import { P, onPrefs, pref, resetPrefs, setPref, type Pref } from '../editor/prefs';
import { newFileName, speechFileName } from './files';
import { bridge, setActiveColor, type IndexFolder, type IndexedFile, type LinkedApp } from '../editor/host';
import { collectHits, hiddenTest, rankHits, type FileHit } from './file-search';
import { PinIcon, StarIcon, loadHidden, loadPinned, loadStarred, toggleHidden, togglePinned, toggleStarred } from './starred';
import { StarTree } from './StarTree';
import { downloadSettings, importSettings } from './settings-file';
import { FORMAT_NAME, FORMAT_PREP } from './round-clock';
import { PRESETS, SYSTEM, addCustomTheme, chromeLook, customThemes, deleteCustomTheme, isDark, resolveTheme, updateCustomTheme, type Theme } from './theme';

/** Settings the features declare in their own files (see SettingSpec), shown on the Editor page. */
const FEATURE_SETTINGS: SettingSpec[] = [...navSettings, ...docToolSettings, ...cardToolSettings];
export const DEFAULTS = { zoom: 1, speechMin: 8, showOutline: true, depth: 3, highlight: 'yellow' };

import { FONTS, SIZE_PREFS, UI_FONTS } from './display';
import { MAX as MAX_RECENTS } from './recents';

const STYLE_OPTS: [string, string][] = [['normal', 'Normal text'], ['pocket', 'Pocket'], ['hat', 'Hat'], ['block', 'Block'], ['tag', 'Tag'], ['analytic', 'Analytic'], ['undertag', 'Undertag']];
const MARKERS: [string, string][] = [['#FF0000', 'Red'], ['#0070C0', 'Blue'], ['#00B050', 'Green'], ['#7030A0', 'Purple']];

type Props = {
  open: boolean; onClose: () => void;
  /** the page to show when Settings opens (default: the last one shown) */
  startPage?: string;
  /** what to search for when Settings opens (the command center's Tab) */
  startQuery?: string;
  zoom: number; onZoom: (z: number) => void;
  speechMin: number; onSpeechMin: (m: number) => void;
  showOutline: boolean; onShowOutline: (s: boolean) => void;
  depth: number; onDepth: (d: number) => void;
  highlight: string | null; onHighlight: (c: string) => void;
};
type Row = { id?: string; lead?: ReactNode; label: string; hint?: string; bad?: boolean; search?: string; preview?: ReactNode; control: ReactNode; path?: boolean; wide?: boolean };
type Page = { id: string; title: string; icon: string; group?: string; sections: [string, Row[]][] };

/** A theme in miniature: its chrome around a strip of its paper, with a few lines of each one's text. */
function ThemeLook({ t }: { t: Theme }) {
  return (
    <span className="st-look" style={{ background: t.bg }}>
      <i style={{ background: t.text }} /><i style={{ background: t.text }} />
      <b style={{ background: t.paper }}><i style={{ background: t.paperInk }} /><i style={{ background: t.paperInk }} /><i style={{ background: t.paperInk }} /></b>
    </span>
  );
}

/** A whole number typed in a box, clamped to min..max and saved on Enter or leaving the box. Escape puts the saved one back. */
function CountField({ p, label, min, max, unit }: { p: Pref<number>; label: string; min: number; max: number; unit: string }) {
  const saved = String(pref(p));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const n = parseInt(draft, 10);
    if (Number.isFinite(n)) setPref(p, Math.min(max, Math.max(min, n)));
  };
  return (
    <span className="st-num">
      <input className="st-text" aria-label={label} inputMode="numeric" maxLength={String(max).length} spellCheck={false}
        value={draft ?? saved} onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))} data-draft={draft === null ? undefined : ''} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setDraft(null); }} />
      <span className="st-unit">{unit}</span>
    </span>
  );
}

/**
 * A reading speed typed as a number, saved on Enter or leaving the box. Escape while typing puts the saved one
 * back (App lets that Escape through instead of closing Settings: `data-draft`).
 * With `blank`, an empty box saves 0, which the read time takes as "same as cards".
 */
function WpmField({ p, label, blank }: { p: Pref<number>; label: string; blank?: string }) {
  const saved = pref(p);
  const shown = saved || blank === undefined ? String(saved) : '';
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n > 0) setPref(p, Math.min(1000, Math.max(50, n)));
    else if (blank !== undefined && !draft.trim()) setPref(p, 0);
  };
  return (
    <span className="st-num">
      <input className="st-text" aria-label={label} inputMode="numeric" maxLength={4} spellCheck={false} placeholder={blank}
        value={draft ?? shown} onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))} data-draft={draft === null ? undefined : ''} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setDraft(null); }} />
      {(draft ?? shown) && <span className="st-unit">wpm</span>}
    </span>
  );
}

/** Settings, laid out like the prototype's: a section list on the left, cards of rows on the right. */
export function Settings(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pageId, setPageId] = useState('general');
  const [query, setQuery] = useState('');
  const [, setSpecTick] = useState(0); // a feature setting changed: redraw its row
  const [keyNote, setKeyNote] = useState<KeyNote>(null); // the recorder's note under a shortcut's label
  const [importNote, setImportNote] = useState<{ text: string; bad?: boolean } | null>(null); // how the last Import went
  const fileInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { if (props.open) { setQuery(props.startQuery ?? ''); if (props.startPage) setPageId(props.startPage); ref.current?.focus({ preventScroll: true }); } }, [props.open, props.startPage, props.startQuery]);
  // File search folders live in the desktop app's main process, not in prefs
  const [folders, setFolders] = useState<IndexFolder[] | null>(null);
  useEffect(() => {
    if (!props.open || !bridge.indexFolders) return;
    let live = true;
    const load = () => bridge.indexFolders!().then((f) => { if (!live) return; setFolders(f); if (f.some((x) => x.count === null)) setTimeout(load, 500); }, () => {});
    void load();
    return () => { live = false; };
  }, [props.open]);
  // the spelling dictionary lives in the desktop app's session too
  const [words, setWords] = useState<string[]>([]);
  useEffect(() => { if (props.open && bridge.dictionaryWords) bridge.dictionaryWords().then(setWords, () => {}); }, [props.open]);
  useEffect(() => onPrefs(() => setSpecTick((t) => t + 1)), []);
  // apps that asked to send cards in (Nimbus...), kept by the main process
  const [linked, setLinked] = useState<LinkedApp[]>([]);
  useEffect(() => { if (props.open && bridge.linkedApps) bridge.linkedApps().then(setLinked, () => {}); }, [props.open]);
  const [aiKeys, setAiKeys] = useState<string[]>([]); // which providers have a key saved, by name
  const [promptOpen, setPromptOpen] = useState(false);
  const [delArmed, setDelArmed] = useState(false); // Delete takes two clicks
  useEffect(() => { if (props.open && bridge.secretList) bridge.secretList().then(setAiKeys, () => {}); }, [props.open]);
  // starred and pinned files get picked here, from what the search folders hold
  const [starred, setStarred] = useState<string[]>(loadStarred);
  const [pinned, setPinned] = useState<string[]>(loadPinned);
  const [hidden, setHidden] = useState<string[]>(loadHidden);
  const [files, setFiles] = useState<IndexedFile[]>([]);
  const [starQuery, setStarQuery] = useState('');
  const [openFolders, setOpenFolders] = useState<string[]>([]); // search folders opened to star inside them
  useEffect(() => {
    if (!props.open) return;
    setStarred(loadStarred());
    setPinned(loadPinned());
    setHidden(loadHidden());
    setStarQuery('');
    let live = true;
    void bridge.indexedFiles?.().then((f) => live && setFiles(f), () => {});
    return () => { live = false; };
  }, [props.open]);
  // every file, copies included, to find one to mark; and the marked ones, with the copies each hides
  const plainHits = useMemo(() => collectHits([], [], files), [files]);
  const markedHits = useMemo(() => collectHits([], [], files, starred, pinned).filter((h) => h.starred || h.pinned), [files, starred, pinned]);
  const markedPaths = useMemo(() => [...new Set([...pinned, ...starred])], [pinned, starred]);
  const isHidden = useMemo(() => hiddenTest(hidden), [hidden]);
  if (!props.open) return null;

  const zoomTo = (z: number) => props.onZoom(Math.max(0.5, Math.min(3, +z.toFixed(2))));
  const toggle = (label: string, on: boolean, set: (v: boolean) => void) => (
    <button className="st-tog" role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)}><i /></button>
  );
  const seg = (label: string, opts: [string, boolean, () => void][]) => (
    <span className="st-seg" role="group" aria-label={label}>
      {opts.map(([n, on, pick]) => <button key={n} data-on={on || undefined} aria-pressed={on} onClick={pick}>{n}</button>)}
    </span>
  );
  // a color choice: one dot per color, like the toolbar's pickers
  const swatches = (label: string, opts: [string, string, boolean, () => void][]) => (
    <span className="st-sws" role="radiogroup" aria-label={label}>
      {opts.map(([n, css, on, pick]) => <button key={n} className="st-sw" role="radio" aria-checked={on} aria-label={n} title={n} style={{ background: css }} onClick={pick} />)}
    </span>
  );
  const select = (label: string, value: string | number, opts: [string | number, string][], set: (v: string) => void) => (
    <span className="st-sel">
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
        {opts.map(([o, n]) => <option key={o} value={o}>{n}</option>)}
      </select>
      <SvgIcon name="chev" />
    </span>
  );
  /** a font choice as tiles, each drawing "Aa" in its own font (empty css = the stylesheet's default stack) */
  const fontTiles = (p: Pref<string>, label: string, hint: string, fonts: [string, string, string][], fallback: string): Row => ({
    label, hint, wide: true, control: (
      <span className="st-themes" role="radiogroup" aria-label={label}>
        {fonts.map(([id, n, css]) => (
          <button key={id} className="st-th" role="radio" aria-checked={pref(p) === id} aria-label={n} title={n} onClick={() => setPref(p, id)}>
            <span className="st-thp st-aa" style={{ fontFamily: css || fallback }}>Aa</span><span>{n}</span>
          </button>
        ))}
      </span>) });

  // rows for Falcon's own settings (prefs.ts): each control reads and writes its pref
  const tog = (p: Pref<boolean>, label: string, hint: string): Row => ({ label, hint, control: toggle(label, pref(p), (on) => setPref(p, on)) });
  const pick = <T extends string>(p: Pref<T>, label: string, hint: string, opts: [T, string][]): Row => ({
    label, hint, control: opts.length > 5
      ? select(label, pref(p), opts, (o) => setPref(p, o as T))
      : seg(label, opts.map(([o, n]) => [n, pref(p) === o, () => setPref(p, o)])),
  });
  const pickNum = (p: Pref<number>, label: string, hint: string, opts: [number, string][]): Row => ({
    label, hint, control: opts.length > 5
      ? select(label, pref(p), opts, (o) => setPref(p, Number(o)))
      : seg(label, opts.map(([o, n]) => [n, pref(p) === o, () => setPref(p, o)])),
  });
  const wpm = (p: Pref<number>, label: string, hint: string, tags = false): Row =>
    ({ label, hint, control: <WpmField key={p.key} p={p} label={label} blank={tags ? 'Same as cards' : undefined} /> });
  const sizes = (p: Pref<number>, label: string, from: number, to: number, step = 1) =>
    select(label, pref(p), Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => [from + i * step, `${from + i * step} pt`]), (o) => setPref(p, Number(o)));
  /** A style shown in its own look, beside the control that changes it. */
  const styled = (label: string, cls: string, sample: ReactNode, control: ReactNode, hint?: string): Row => ({ label, hint, control, preview: <span className={`st-pv ${cls}`}><span className="s">{sample}</span></span> });
  const color = (p: Pref<string>, label: string, hint: string, fallback: string): Row => ({
    label, hint, control: <input type="color" className="st-color" aria-label={label} value={pref(p) || fallback} onChange={(e) => setPref(p, e.target.value)} />,
  });

  const prefixRow = (p: Pref<string>, kind: string): Row => ({
    label: `${kind} filename prefix`, hint: `Prepended to ${kind} saves when the option above is on. Default ${p.default}. Leave empty for no prefix.`,
    control: <input className="st-text" aria-label={`${kind} filename prefix`} spellCheck={false} maxLength={40} value={pref(p)}
      disabled={!pref(P.savePrefix)} onChange={(e) => setPref(p, e.target.value)} />,
  });

  const setSpec = (spec: SettingSpec, v: string | boolean) => {
    safeSet(spec.key, typeof v === 'boolean' ? (v ? 'on' : 'off') : v);
    setSpecTick((t) => t + 1);
  };
  const specRow = (spec: SettingSpec): Row => {
    const v = readSetting(spec);
    return { label: spec.label, hint: spec.hint, control: spec.kind === 'toggle'
      ? toggle(spec.label, v as boolean, (on) => setSpec(spec, on))
      : spec.colors ? swatches(spec.label, spec.options.map(([o, n]) => [n, spec.colors![o], v === o, () => setSpec(spec, o)]))
      : seg(spec.label, spec.options.map(([o, n]) => [n, v === o, () => setSpec(spec, o)])) };
  };
  const specSections = [...new Set(FEATURE_SETTINGS.map((x) => x.section))]
    .map((sec): [string, Row[]] => [sec, FEATURE_SETTINGS.filter((x) => x.section === sec).map(specRow)]);
  const keyRows = (group: string): Row[] => BINDINGS.filter((b) => b.group === group).map((b) => {
    const note = keyNote?.id === b.id ? keyNote : null;
    return { label: b.label, hint: note?.text, bad: note?.bad, search: `${keyOf(b.id)} ${keyText(keyOf(b.id))}`,
      control: <KeyField id={b.id} label={b.label} onNote={setKeyNote} /> };
  });
  const keyLabel = (id: string) => keyText(keyOf(id)) || 'no shortcut';

  // Starred and pinned files: typing finds files to mark, otherwise the marked ones, sorted by search folder
  const where = (h: FileHit) => (h.source && h.source !== h.folder ? `${h.source} › ${h.folder}` : h.folder);
  // inside a hidden folder there's nothing to do on the file itself: show the folder to bring it back
  const hideBtn = (path: string, name: string) => {
    const on = hidden.includes(path), off = isHidden(path);
    return (
      <button className="st-eye" aria-pressed={off} aria-label={`${on ? 'Show' : 'Hide'} ${name}`} disabled={off && !on}
        title={on ? 'Show it in search again' : off ? 'Hidden with its folder' : `Hide from ${keyLabel('search')} and Search cards`} onClick={() => setHidden(toggleHidden(path))}><SvgIcon name={off ? 'eyeOff' : 'eye'} /></button>);
  };
  const markBtns = (path: string, name: string) => {
    const pin = pinned.includes(path), star = starred.includes(path);
    return (<>
      {hideBtn(path, name)}
      <button className="st-star st-pin" aria-pressed={pin} aria-label={`${pin ? 'Unpin' : 'Pin'} ${name}`}
        title={pin ? 'Unpin' : `Pin: always list it first in ${keyLabel('search')}`} onClick={() => setPinned(togglePinned(path))}><PinIcon /></button>
      <button className="st-star" aria-pressed={star} aria-label={`${star ? 'Unstar' : 'Star'} ${name}`}
        title={star ? 'Unstar' : `Star: put it first in ${keyLabel('search')} when it matches`} onClick={() => setStarred(toggleStarred(path))}><StarIcon /></button>
    </>);
  };
  const fileRow = (h: FileHit, note: string): Row => ({ label: h.name, hint: h.path, path: true, search: 'starred star pinned pin', control: (
    <span className="st-fold"><output>{note}</output>{markBtns(h.path!, h.name)}</span>) });
  const sq = starQuery.trim();
  const byPath = new Map(markedHits.map((h) => [h.path!, h]));
  const starRows: Row[] = sq
    ? rankHits(plainHits, sq, 8).map((h) => fileRow(h, where(h)))
    : markedPaths
      .map((p): FileHit => byPath.get(p) ?? { key: p, name: p.split(/[\\/]/).pop()!.replace(/\.docx$/i, ''), folder: '', path: p, kind: 'file' as const, when: 0 })
      .sort((a, b) => (a.source ?? '~').localeCompare(b.source ?? '~') || a.name.localeCompare(b.name))
      .map((h) => fileRow(h, !byPath.has(h.path!) ? 'Not found' : h.hidden ? `${where(h)} · hides ${h.hidden} ${h.hidden === 1 ? 'copy' : 'copies'}` : where(h)));
  const starFind: Row = { label: 'Star or pin a file', search: 'starred star pinned pin', hint: `A starred file goes first in ${keyLabel('search')} when it matches what you type. A pinned one always shows there, first, before you type. Both hide their copies in your other search folders.`, control: (
    <input className="st-text st-find" aria-label="Find a file to star or pin" placeholder="Find a file…" spellCheck={false} value={starQuery}
      onChange={(e) => setStarQuery(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && starQuery) { e.preventDefault(); e.stopPropagation(); setStarQuery(''); }
        // Enter stars the top match (and leaves it starred if it already is)
        else if (e.key === 'Enter' && sq) { const h = rankHits(plainHits, sq, 1)[0]; if (h && !starred.includes(h.path!)) setStarred(toggleStarred(h.path!)); }
      }} />) };
  const hiddenRows: Row[] = hidden.length
    ? hidden.map((p) => { const name = p.split(/[\\/]/).filter(Boolean).pop()!.replace(/\.docx$/i, ''); return { label: name, hint: p, path: true, search: 'hidden hide remove exclude', control: <span className="st-fold">{hideBtn(p, name)}</span> }; })
    : [{ label: 'Nothing hidden', search: 'hidden hide remove exclude', hint: `Click the eye next to a file, or a folder inside a search folder, to keep it out of ${keyLabel('search')} and Search cards. Nothing on disk changes.`, control: null }];
  const starNone: Row = { label: sq ? `No files match “${sq}”` : 'No starred or pinned files yet', hint: sq ? 'Only .docx files in your search folders can be starred or pinned.' : 'Find a file above and click its star or pin.', control: null };
  const prep = pref(P.prepMin);
  const round = pref(P.round);

  // themes: a tile per theme, each a small picture of it; a custom theme's colors and name edit in place
  const themeId = pref(P.theme);
  const current = resolveTheme(themeId);
  const custom = customThemes().find((t) => t.id === themeId);
  const shownId = themeId === SYSTEM ? SYSTEM : current.id; // a deleted theme's id shows Dark, its fallback, as checked
  const paperDark = document.documentElement.classList.contains('page-dark');
  const themeTiles: [string, string, ReactNode][] = [
    [SYSTEM, 'System', <span className="st-thp sys"><ThemeLook t={resolveTheme('dark')} /><ThemeLook t={resolveTheme('light')} /></span>],
    ...[...PRESETS, ...customThemes()].map((t): [string, string, ReactNode] => [t.id, t.name, <span className="st-thp"><ThemeLook t={t} /></span>]),
  ];
  const themeColor = (t: Theme, k: 'bg' | 'text' | 'paper' | 'paperInk', label: string, hint: string): Row => ({
    label, hint, control: <input type="color" className="st-color" aria-label={label} value={t[k]} onChange={(e) => updateCustomTheme(t.id, { [k]: e.target.value })} />,
  });
  const customRows = (t: Theme): Row[] => [
    { label: 'Theme name', control: <input className="st-text" aria-label="Theme name" spellCheck={false} value={t.name} maxLength={40}
      onChange={(e) => updateCustomTheme(t.id, { name: e.target.value })} onBlur={(e) => { if (!e.target.value.trim()) updateCustomTheme(t.id, { name: 'My theme' }); }} /> },
    themeColor(t, 'bg', 'Background', 'The bars, rail, outline and panels. Their lighter and darker shades follow from it.'),
    themeColor(t, 'text', 'Text', 'Labels and icons. Dim text and lines are this, faded into the background.'),
    themeColor(t, 'paper', 'Paper', 'The page behind the document.'),
    themeColor(t, 'paperInk', 'Paper text', 'Text on the page that has no color of its own.'),
    { label: 'Delete theme', hint: isDark(t.bg) ? 'Goes back to Dark.' : 'Goes back to Light.', control: (
      <button className="st-btn" onClick={() => { setPref(P.theme, isDark(t.bg) ? 'dark' : 'light'); deleteCustomTheme(t.id); }}>Delete</button>) },
  ];
  const profile = (speech: number, prepMin: number) => () => { props.onSpeechMin(speech); setPref(P.prepMin, prepMin); };

  const preset = currentPreset();
  const router = pref(P.aiProvider) === 'openrouter';
  const aiId = router ? 'openrouter' : 'anthropic';
  const aiModelPref = router ? P.aiRouterModel : P.aiModel; // each provider keeps its own, ids don't carry over
  const pages: Page[] = [
    { id: 'general', title: 'General', icon: 'sliders', sections: [
      ['Startup', [
        { label: 'Open on launch', hint: 'What Falcon shows when it starts.', control:
          select('Open on launch', pref(P.openHome) ? 'home' : 'doc', [['home', 'Home'], ['doc', 'Last document']], (o) => setPref(P.openHome, o === 'home')) },
        tog(P.reopen, 'Restore open files', 'Reopen the files you had open when you quit. Desktop app only.'),
      ]],
      ['Notifications', [
        pickNum(P.lowTime, 'Low time flash', 'The running clock flashes red for its last seconds.', [[0, 'Off'], [10, '10 s'], [30, '30 s'], [60, '1 min']]),
        tog(P.beep, 'Timer sound', 'Two short tones when a timer reaches zero.'),
      ]],
      ['Files', [
        tog(P.confirmClose, 'Unsaved changes confirmation', 'Ask before closing a file or quitting with unsaved changes.'),
        tog(P.crashRecovery, 'Crash recovery', 'Keep a copy of open files, brought back if Falcon closes unexpectedly.'),
        { label: 'Recent files', hint: `How many files Home lists, up to ${MAX_RECENTS}.`, control: <CountField key={P.recentCount.key} p={P.recentCount} label="Recent files" min={1} max={MAX_RECENTS} unit="files" /> },
        { label: 'Name new files', hint: 'What an Untitled document is called when you first save it.', control:
          select('Name new files', pref(P.newName), (['untitled', 'speech', 'date'] as const).map((h) => [h, newFileName(h)]), (h) => setPref(P.newName, h as 'untitled')) },
        { label: 'Speech doc name', wide: true, search: 'speech filename template date',
          hint: `What New speech doc names the file. {speech} is the name you type at the prompt. {date:…} is the date and time: YYYY YY, M MM MMM MMMM, D DD ddd dddd, h hh (12-hour), H HH (24-hour), m mm, s ss, and A or a for AM/PM. Anything else stays as typed; inside {date:…} put a word in [brackets]. Example: ${speechFileName('1NC')}.docx`,
          control: <input className="st-text st-wide" aria-label="Speech doc name" spellCheck={false} maxLength={120} value={pref(P.speechName)}
            onChange={(e) => setPref(P.speechName, e.target.value)} /> },
        tog(P.savePrefix, 'Prefix Save As copies', 'Send, Read and Marked Doc copies start with a prefix, so you can tell them apart from the file.'),
        prefixRow(P.prefixSend, 'Send Doc'), prefixRow(P.prefixRead, 'Read Doc'), prefixRow(P.prefixMarked, 'Marked Doc'),
      ]],
      ['Transfer', [
        { label: 'Export settings', hint: 'Save every setting to a .json file, to move them to another computer or keep a copy.', control:
          <button className="st-btn" onClick={downloadSettings}>Export</button> },
        { label: 'Import settings', hint: importNote?.text ?? 'Load a settings file from Falcon, or one exported from CardMirror.', bad: importNote?.bad, control: (
          <button className="st-btn" onClick={() => fileInput.current?.click()}>Import</button>) },
      ]],
      ...(bridge.linkedApps ? [['Linked apps', linked.length
        ? linked.map((a): Row => ({ label: a.name[0].toUpperCase() + a.name.slice(1), search: 'linked apps nimbus bridge cards send', hint: a.allowed ? 'Can send cards into your open docs.' : 'Blocked from sending cards in.', control: (
          <span className="st-fold">
            {toggle(`Let ${a.name} send cards`, a.allowed, (on) => void bridge.allowLinkedApp!(a.id, on).then(setLinked))}
            <button className="sb-ico" aria-label={`Forget ${a.name}`} title="Forget it: it asks again next time" onClick={() => void bridge.allowLinkedApp!(a.id, null).then(setLinked)}><SvgIcon name="x" /></button>
          </span>) }))
        : [{ label: 'No linked apps yet', search: 'linked apps nimbus bridge cards send', hint: 'Debate apps like Nimbus can send cards into your open docs, the way they do with CardMirror. The first time one tries, Falcon asks you.', control: null }]] as [string, Row[]]] : []),
      ['Privacy', [
        tog(P.usageStats, 'Share usage statistics', 'Send anonymous counts of which features get used, like opening and saving files. Never file names or anything you type. Desktop app only.'),
      ]],
    ] },
    { id: 'ai', title: 'AI', icon: 'spark', sections: [
      ['Cites', !bridge.aiAsk
        ? [{ label: 'AI features', hint: 'AI needs the desktop app.', control: null }]
        : [
          tog(P.aiOn, 'AI features', `${keyLabel('aiCite')} turns a selected citation or URL into a styled cite. The text you format goes to ${router ? 'OpenRouter and the company running the model' : 'Anthropic'}. Nothing is sent until you run it.`),
          pick(P.aiProvider, 'AI provider', 'Anthropic runs Claude models. OpenRouter reaches models from many companies, like GPT, Gemini and DeepSeek, on one key.', [['anthropic', 'Anthropic'], ['openrouter', 'OpenRouter']]),
          { label: `${aiService()} API key`, search: 'key claude console openrouter', hint: aiKeys.includes(aiId) ? 'Saved on this computer, encrypted. Falcon\'s pages and settings files never see it.' : `${router ? 'Make one at openrouter.ai/keys. It needs a little credit.' : 'Make one at console.anthropic.com. It\'s separate from a Claude subscription and needs a little credit.'} It\'s typed into its own window, and isn\'t saved if this computer can\'t encrypt it.`, control: aiKeys.includes(aiId)
            ? <button className="st-btn" onClick={() => void bridge.secretRemove!(aiId).then(setAiKeys)}>Remove key</button>
            : <button className="st-btn" onClick={() => void bridge.secretPrompt!(aiId, chromeLook()).then(() => bridge.secretList!()).then(setAiKeys)}>Add key…</button> },
          { label: 'AI model', search: 'claude opus sonnet haiku gpt gemini deepseek openrouter', hint: router ? 'Paste any model id from openrouter.ai/models and it goes there as is.' : 'Paste any model id your key can use and it goes to Anthropic as is. Leave blank for Claude Opus 5.5.', control: (
            <input className="st-text st-wide" aria-label="AI model" spellCheck={false} placeholder={router ? 'deepseek/deepseek-chat' : 'claude-opus-5-5'} maxLength={200} value={pref(aiModelPref)} onChange={(e) => setPref(aiModelPref, e.target.value)} />) },
          { label: 'Max output tokens', search: 'budget thinking', hint: 'Thinking spends from this too, so too low a number can cut the cite off. Minimum 1024.', control: (
            <input className="st-text" aria-label="Max output tokens" inputMode="numeric" maxLength={6} spellCheck={false} value={pref(P.aiMaxTokens) || ''} onChange={(e) => setPref(P.aiMaxTokens, Number(e.target.value.replace(/\D/g, '')))} />) },
          { label: 'AI cite-creator prompt', wide: true, search: 'format style preset instructions', hint: `What the AI is told when it formats a cite, so it sets your citation style. Pick the built-in prompt or save up to ${MAX_PRESETS} of your own.`, control: (
            <span className="st-fold">
              {select('AI cite-creator prompt', preset?.id ?? '', [['', 'Built-in prompt'], ...citePresets().map((f): [string, string] => [f.id, f.name])], (v) => { setPref(P.aiCitePreset, v); setDelArmed(false); })}
              {preset && <button className="st-btn" onClick={() => setPromptOpen((o) => !o)}>{promptOpen ? 'Done' : 'Edit'}</button>}
              <button className="st-btn" disabled={citePresets().length >= MAX_PRESETS} onClick={() => { newPreset(); setPromptOpen(true); setDelArmed(false); }}>New preset</button>
              {preset && <button className="st-btn" onClick={() => { if (delArmed) { deletePreset(preset.id); setPromptOpen(false); } setDelArmed(!delArmed); }}>{delArmed ? 'Really delete?' : 'Delete'}</button>}
            </span>) },
          ...(preset && promptOpen ? [
            { label: 'Preset name', control: <input className="st-text st-wide" aria-label="Preset name" spellCheck={false} maxLength={40} value={preset.name} onChange={(e) => editPreset(preset.id, { name: e.target.value })} /> },
            { id: 'ai-prompt', label: '', wide: true, control: (
              <textarea className="st-area" aria-label="Preset prompt" spellCheck={false} rows={20} value={preset.prompt} onChange={(e) => editPreset(preset.id, { prompt: e.target.value })} />) },
            { label: 'Writing your own prompt', hint: 'Ask for any style. Whatever the AI answers becomes the cite. To say which part gets the cite style, have it answer with [[CITE]], [[TOKENS]] and [[END]] like the built-in prompt. {DATE} becomes today.', control: null },
          ] : []),
        ]],
    ] },
    { id: 'search', title: 'File search', icon: 'search', sections: [
      ['Folders', !bridge.indexFolders
        ? [{ label: 'Search folders', hint: `File search reaches into your folders in the desktop app. Here, ${keyLabel('search')} searches open and recent files.`, control: null }]
        : [
          ...(folders ?? []).flatMap((f): Row[] => {
            const name = f.path.split(/[\\/]/).filter(Boolean).pop() ?? f.path;
            const isOpen = openFolders.includes(f.path);
            const canOpen = !!bridge.indexedFiles && !f.missing && !!f.count;
            return [{ label: name, hint: f.path, path: true, lead: canOpen && (
              <button className="sb-ico st-chev" aria-expanded={isOpen} aria-label={`${isOpen ? 'Close' : 'Open'} ${name}`} title={isOpen ? 'Close' : 'Show its files, to star or hide them'}
                onClick={() => setOpenFolders((o) => (isOpen ? o.filter((x) => x !== f.path) : [...o, f.path]))}><SvgIcon name="chev" /></button>), control: (
              <span className="st-fold">
                <output>{f.missing ? 'Not found' : f.count === null ? 'Indexing…' : `${f.count.toLocaleString('en-US')} ${f.count === 1 ? 'file' : 'files'}`}</output>
                <button className="sb-ico" aria-label={`Remove ${f.path}`} title="Remove from file search"
                  onClick={() => void bridge.removeIndexFolder!(f.path).then(setFolders)}><SvgIcon name="x" /></button>
              </span>) },
            ...(canOpen && isOpen ? [{ id: `tree:${f.path}`, label: '', wide: true, control: (
              <StarTree root={f.path} files={files} starred={markedPaths} star={markBtns} hide={hideBtn} isHidden={isHidden} />) }] : [])];
          }),
          { label: folders?.length ? 'Add another folder' : 'No folders yet', hint: `Files in these folders, and the folders inside them, show up in ${keyLabel('search')}, and their cards in Search cards (${keyLabel('searchCards')}). Only .docx files are listed.`, control: (
            <button className="st-btn" onClick={() => void bridge.addIndexFolder!().then(setFolders)}><SvgIcon name="plus" />Add folder…</button>) },
        ]],
      ...(bridge.indexedFiles ? [['Starred and pinned files', [starFind, ...(starRows.length ? starRows : [starNone])]], ['Hidden from search', hiddenRows]] as [string, Row[]][] : []),
    ] },
    { id: 'appearance', title: 'Appearance', icon: 'contrast', sections: [
      ['Theme', [
        { label: 'Theme', hint: 'The colors of Falcon and the page. + makes your own, starting from the one you have on.', wide: true, control: (
          <span className="st-themes" role="radiogroup" aria-label="Theme">
            {themeTiles.map(([id, name, look]) => (
              <button key={id} className="st-th" role="radio" aria-checked={shownId === id} aria-label={name} title={name} onClick={() => setPref(P.theme, id)}>
                {look}<span>{name}</span>
              </button>
            ))}
            <button className="st-th add" aria-label="New theme" title={`New theme, starting from ${current.name}`}
              onClick={() => setPref(P.theme, addCustomTheme(current).id)}>
              <span className="st-thp"><SvgIcon name="plus" /></span><span>New theme</span>
            </button>
          </span>) },
        ...(custom ? customRows(custom) : []),
        { label: 'Document paper', hint: 'Dark to read at night in any theme. The saved file stays black on white.', control:
          seg('Document paper', (['theme', 'white', 'dark'] as const).map((o) => [{ theme: 'Theme', white: 'White', dark: 'Dark' }[o], pref(P.paper) === o, () => setPref(P.paper, o)])) },
        { label: 'Highlighter', hint: 'Your highlight color, also used for the current location in the outline.', control: (
          <span className="st-pens" role="radiogroup" aria-label="Highlighter">
            {Object.keys(HIGHLIGHTS).map((p) => <button key={p} role="radio" aria-checked={props.highlight === p} aria-label={HIGHLIGHT_NAMES[p]} title={HIGHLIGHT_NAMES[p]}
              style={{ background: HIGHLIGHTS[p] }} onClick={() => props.onHighlight(p)} />)}
          </span>) },
      ]],
      ['Fonts', [
        fontTiles(P.uiFont, 'Interface font', 'Menus, tooltips, Settings and the top bar. The document\'s font is under Formatting.', UI_FONTS, "system-ui, 'Segoe UI', sans-serif"),
      ]],
      ['Layout', [
        { label: 'Zoom', hint: `How big the page is. Also ${keyLabel('zoomIn')} and ${keyLabel('zoomOut')}.`, control: (
          <span className="st-step">
            <button aria-label="Less zoom" onClick={() => zoomTo(props.zoom - 0.1)}>−</button>
            <output>{Math.round(props.zoom * 100)}%</output>
            <button aria-label="More zoom" onClick={() => zoomTo(props.zoom + 0.1)}>+</button>
          </span>) },
        tog(P.wheelZoom, 'Zoom with the scroll wheel', `${IS_MAC ? '⌘' : 'Ctrl'} and scroll. Pinching the trackpad always zooms.`),
        pick(P.textWidth, 'Text width', 'Narrower lines are easier to follow.', [['full', 'Full'], ['wide', 'Wide'], ['narrow', 'Narrow']]),
        pick(P.margins, 'Margins', 'Space at the left and right of the text.', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]),
        tog(P.railResize, 'Resizable rail', 'Drag the rail\'s right edge to show the names of open files. Double-click the edge to go back to icons.'),
        pickNum(P.joinMax, 'Files side by side', 'The most files Join shows at once. Shift-click files in the rail, then right-click and pick Join.', [[2, '2'], [3, '3'], [4, '4'], [5, '5']]),
      ]],
      ['Cursor and motion', [
        pick(P.caret, 'Cursor color', 'Highlighter matches your highlight color.', [['auto', 'Text'], ['blue', 'Blue'], ['red', 'Red'], ['ink', 'Highlighter']]),
        pick(P.selection, 'Selection color', 'The color behind selected text.', [['blue', 'Blue'], ['gray', 'Gray'], ['ink', 'Highlighter']]),
        tog(P.cardBar, 'Mark the current card', 'A thin line beside the card the cursor is in.'),
        tog(P.reduceMotion, 'Reduce motion', 'Turn off animations. Also on when your system asks for less motion.'),
        tog(P.launchFalcon, 'Falcon on launch', 'The falcon sweeps in over Home when Falcon starts. Any key or click lands it.'),
      ]],
    ] },
    { id: 'editor', title: 'Editor', icon: 'doc', sections: [
      ['Spelling', [
        tog(P.spellcheck, 'Check spelling', 'Misspelled words get a red underline. Right-click one for suggestions or Add to Dictionary.'),
        ...words.map((w): Row => ({ label: w, hint: 'In your dictionary', control: (
          <button className="sb-ico" aria-label={`Remove ${w} from the dictionary`} title="Remove from the dictionary"
            onClick={() => void bridge.removeDictionaryWord!(w).then(setWords)}><SvgIcon name="x" /></button>) })),
        ...(bridge.dictionaryWords && !words.length ? [{ label: 'Your dictionary', hint: 'Words you add show up here, so you can take them back out.', control: null }] : []),
      ]],
      ['Outline', [
        { label: 'Show outline pane', hint: `The nav pane on the document's left edge. Also ${keyLabel('outline')}.`, control: toggle('Show outline pane', props.showOutline, props.onShowOutline) },
        { label: 'Outline depth', hint: 'How many heading levels the outline shows.', control:
          seg('Outline depth', [1, 2, 3, 4].map((n) => [String(n), props.depth === n, () => props.onDepth(n)])) },
        pickNum(P.openDepth, 'Depth for opened files', 'The depth a file opens at. Keep leaves it as it is.', [[0, 'Keep'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]),
      ]],
      ['Reading', [
        tog(P.readParas, 'Keep paragraphs apart', 'In read mode, each paragraph stays on its own line.'),
        tog(P.readWholeCite, 'Show the whole cite', 'All of a cite line, not just its cite-marked words.'),
        tog(P.readUndertags, 'Show undertags', 'Undertags stay visible while you read.'),
        tog(P.readShading, 'Show background color', 'Text with a background color shows, like highlighted text.'),
        tog(P.readTop, 'Jump to the top', 'Turning read mode on or off moves to the start of the file.'),
        pick(P.markerColor, 'Marker color', 'The Marked note Space drops.', MARKERS),
        tog(P.markerTime, 'Marker shows the time', 'Marked 3:42, or just Marked.'),
      ]],
      ['Condensing', [
        pick(P.condense, 'F3 condenses to', 'Merge joins paragraphs; with ¶ marks where they were.', [['integrity', 'Keep paragraphs'], ['merge', 'Merge'], ['pilcrows', 'Merge with ¶']]),
        tog(P.smallPilcrows, 'Small ¶ marks', 'Set the ¶ marks at 6 pt so they take less room.'),
        tog(P.pasteCondense, 'Condense after Paste Text', 'F2 condenses what it pastes, the way F3 does.'),
        tog(P.shrinkProtect, 'Keep omission notes full size', 'Shrink leaves notes like [Table Omitted] alone.'),
        tog(P.smartShrink, 'Smart Shrink', 'Mod-8 shrinks in one pass: paragraphs you don\'t read drop to 5 pt, the words between read ones to 8 pt.'),
      ]],
      ['Pasting', [
        tog(P.smartQuotes, 'Smart quotes', 'Typed \' and " curl the right way. Backspace right after one puts the straight quote back, and a space curls it again.'),
        tog(P.smartPaste, 'Smart paste', 'Word and Verbatim formatting pastes as cites, underlining and highlights. F2 always pastes plain.'),
        tog(P.citeNearest, 'Copy previous cite: first line only', 'Off, Alt-F8 also copies the cite lines right after it.'),
        tog(P.hlUnderlined, 'Highlight underlined text only', 'Highlighting skips text that isn\'t underlined, emphasized or cited.'),
        tog(P.styleOffClears, 'Clear formatting when underline comes off', 'Taking underline off also clears size, bold, italic, highlight and background color, so the text goes back to plain.'),
      ]],
      ['Enter at the end of a heading', (['pocket', 'hat', 'block', 'tag', 'analytic', 'undertag'] as const).map((st) => {
        const n = STYLE_OPTS.find(([o]) => o === st)![1];
        const p = { pocket: P.enterPocket, hat: P.enterHat, block: P.enterBlock, tag: P.enterTag, analytic: P.enterAnalytic, undertag: P.enterUndertag }[st];
        return { label: `After ${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n.toLowerCase()}`, control:
          select(`After ${n.toLowerCase()}`, pref(p), STYLE_OPTS, (o) => setPref(p, o as 'normal')) };
      })],
      ...specSections,
    ] },
    { id: 'formatting', title: 'Formatting', icon: 'format', sections: [
      ['Styles', [
        styled('Pocket', `pocket${pref(P.pocketBox) ? ' box' : ''}`, '1AC', sizes(P.szPocket, 'Pocket size', 18, 36, 2)),
        styled('Hat', `hat${pref(P.hatLine) === 'single' ? ' single' : ''}`, 'Advantage 1', sizes(P.szHat, 'Hat size', 14, 28, 2)),
        styled('Block', 'block', 'AT: Politics DA', sizes(P.szBlock, 'Block size', 12, 22)),
        styled('Tag', 'tag', 'Tag 1.', sizes(P.szTag, 'Tag size', 10, 16)),
        styled('Analytic', 'analytic', 'Analytic', sizes(P.szAnalytic, 'Analytic size', 10, 16)),
        styled('Undertag', 'undertag', 'Undertag', sizes(P.szUndertag, 'Undertag size', 8, 14)),
        styled('Cite', `cite${pref(P.citeBold) ? '' : ' plain'}`, <b>Clare ’23</b>, sizes(P.szCite, 'Cite size', 10, 16)),
        styled('Body text', 'und', 'Body text', sizes(P.szNormal, 'Body text size', 8, 14)),
        styled('Emphasis', `emph${pref(P.emphasisBox) ? '' : ' nobox'}`, <>only the <span>plan</span> solves</>,
          select('Emphasis', pref(P.emphasisBox) ? 'box' : 'bold', [['box', 'Bold and box'], ['bold', 'Bold only']], (o) => setPref(P.emphasisBox, o === 'box'))),
        styled('Unread text', 'small', 'the rest of the paragraph, shrunk so the card stays short',
          select('Shrink down to', pref(P.shrinkMin), [[4, '4 pt'], [6, '6 pt'], [8, '8 pt']], (o) => setPref(P.shrinkMin, Number(o))), 'The smallest size Shrink steps down to.'),
      ]],
      ['Look', [
        fontTiles(P.font, 'Editor font', 'The document\'s text. Verdana and Comic Sans are easier for some readers with dyslexia.', FONTS, 'Calibri, Carlito, Arial, sans-serif'),
        pick(P.lineHeight, 'Line spacing', 'Space between the lines of a paragraph.', [['1', '1.0'], ['1.2', '1.2'], ['1.3', '1.3'], ['1.5', '1.5'], ['2', '2.0']]),
        tog(P.pocketBox, 'Box around pockets', 'Draw the box around pocket headings.'),
        pick(P.hatLine, 'Hat underline', 'Hats are underlined twice, or once.', [['double', 'Double'], ['single', 'Single']]),
        tog(P.citeBold, 'Bold cites', 'Off shows cites at normal weight.'),
        color(P.colorAnalytic, 'Analytic color', 'The color analytics show in.', paperDark ? '#8aa4d6' : '#1f3f8a'),
        color(P.colorUndertag, 'Undertag color', 'The color undertags show in.', paperDark ? '#8fae7a' : '#2a6a3a'),
        tog(P.shadingDots, 'Dots on background color', 'A faint dot pattern, so background color can be told from highlighting.'),
      ]],
    ] },
    { id: 'keys', title: 'Keybindings', icon: 'keyboard', sections: [...new Set(BINDINGS.map((b) => b.group))].map((g) => [g, keyRows(g)]) },
    { id: 'speech', title: 'Speech and timers', icon: 'timer', group: 'Debate', sections: [
      ['Format', [
        { label: 'Round', hint: 'The speeches the timer window steps through. Choosing one sets Prep time to its usual length: Policy 8, LD 4, PF 3.', control:
          seg('Round', (['policy', 'ld', 'pf'] as const).map((f) => [FORMAT_NAME[f], round === f, () => { setPref(P.round, f); setPref(P.prepMin, f === 'policy' && props.speechMin === 9 ? 10 : FORMAT_PREP[f]); }])) },
        { label: 'Event', hint: 'Policy. High school: 8 minute speeches, 8 of prep. College: 9 and 10.', control:
          seg('Event', [['High school', props.speechMin === 8 && prep === 8, profile(8, 8)], ['College', props.speechMin === 9 && prep === 10, profile(9, 10)]]) },
        { label: 'Speech length', hint: 'Policy: how long constructives run. Rebuttals are 3 minutes shorter, and cross-ex is 3 minutes. LD and PF use their usual times.', control:
          select('Speech length', props.speechMin, Array.from({ length: 30 }, (_, i) => [i + 1, `${i + 1}:00`]), (m) => props.onSpeechMin(Number(m))) },
        tog(P.showSend, 'Send button', `A Send button beside Read in the top bar. ${keyLabel('sendToSpeech')} sends either way.`),
        tog(P.showPrep, 'Prep timer', 'Our prep clock in the top bar, beside the speech timer. Click to start or pause, right-click to reset. Both sides\' prep is always in the timer window.'),
        { label: 'Prep time', hint: 'Each side\'s prep for the round.', control:
          select('Prep time', prep, Array.from({ length: 15 }, (_, i) => [i + 1, `${i + 1}:00`]), (m) => setPref(P.prepMin, Number(m))) },
      ]],
      ['Reading speed', [
        wpm(P.wpm1, 'Reader 1: cards', 'How fast Reader 1 reads highlighted card text. The first read time in the status bar.'),
        wpm(P.wpm1Tags, 'Reader 1: tags and analytics', 'How fast Reader 1 reads tags, analytics and cites, usually faster than cards.', true),
        wpm(P.wpm2, 'Reader 2: cards', 'How fast Reader 2 reads highlighted card text. The second read time.'),
        wpm(P.wpm2Tags, 'Reader 2: tags and analytics', 'How fast Reader 2 reads tags, analytics and cites.', true),
      ]],
    ] },
  ];

  const q = query.trim().toLowerCase();
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  // searching shows every matching row, under its page and section
  const shown: [string, Row[]][] = q
    ? pages.flatMap((p) => p.sections.map(([s, rows]) => [`${p.title} · ${s}`, rows.filter((r) => `${r.label} ${r.hint ?? ''} ${r.search ?? ''} ${s} ${p.title}`.toLowerCase().includes(q))] as [string, Row[]]))
      .filter(([, rows]) => rows.length)
    : page.sections;
  const restore = () => {
    props.onZoom(DEFAULTS.zoom); props.onSpeechMin(DEFAULTS.speechMin); props.onShowOutline(DEFAULTS.showOutline);
    props.onDepth(DEFAULTS.depth); props.onHighlight(DEFAULTS.highlight);
    FEATURE_SETTINGS.forEach((x) => localStorage.removeItem(x.key));
    resetPrefs();
    setSpecTick((t) => t + 1);
    setKeyNote(null);
  };

  /** Apply a picked settings file. Zoom, speech length, outline, depth and the pens live in App's state, so they're handed over too. */
  const importFile = async (f: File) => {
    const r = importSettings(await f.text());
    if (!r.ok) { setImportNote({ text: r.error, bad: true }); return; }
    const get = (k: string) => localStorage.getItem(`falcon.${k}`);
    props.onZoom(Number(get('zoom')) || DEFAULTS.zoom);
    props.onSpeechMin(Number(get('speech')) || DEFAULTS.speechMin);
    props.onShowOutline(get('outline') !== 'off');
    props.onDepth(Number(get('depth')) || DEFAULTS.depth);
    props.onHighlight(get('highlight') ?? DEFAULTS.highlight);
    setActiveColor('shading', get('shading') ?? '#D9D9D9');
    setSpecTick((t) => t + 1);
    const n = (x: number) => `${x} setting${x === 1 ? '' : 's'}`;
    if (r.folders?.length && bridge.importIndexFolders) void bridge.importIndexFolders(r.folders).then(setFolders, () => {});
    const shortcuts = r.keys ? ` and ${r.keys} ${r.keys === 1 ? 'shortcut' : 'shortcuts'}` : '';
    const kept = r.keysKept?.length ? ` Not brought over: ${r.keysKept.join(', ')}.` : '';
    setImportNote({ text: r.from === 'CardMirror'
      ? `Brought over ${n(r.applied)}${shortcuts} from CardMirror.${kept} ${r.skipped ? `${n(r.skipped)} ${r.skipped === 1 ? "has" : "have"} no Falcon match yet.` : ''}`.trim()
      : `Loaded ${n(r.applied)}.` });
  };

  let lastGroup: string | undefined;
  return (
    <div className="st-back" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div ref={ref} className="st" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          if (e.key === '/' && t.tagName !== 'INPUT') { e.preventDefault(); ref.current?.querySelector<HTMLInputElement>('.st-search input')?.focus(); }
        }}>
        <nav className="st-nav" aria-label="Settings sections">
          <label className="st-search">
            <SvgIcon name="search" />
            <input placeholder="Search" aria-label="Search settings" spellCheck={false} value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); } }} />
            <kbd>/</kbd>
          </label>
          {pages.map((p) => {
            const head = p.group !== lastGroup ? p.group : undefined;
            lastGroup = p.group;
            return (
              <div key={p.id} className="st-navgrp">
                {head && <div className="st-navhead">{head}</div>}
                <button className="st-navb" data-on={(!q && p.id === page.id) || undefined} aria-current={(!q && p.id === page.id) || undefined}
                  onClick={() => { setQuery(''); setPageId(p.id); }}>
                  <SvgIcon name={p.icon} />{p.title}
                </button>
              </div>
            );
          })}
          <div className="grow" />
          <div className="st-ver">Falcon {version}</div>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Settings file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        </nav>
        <div className="st-main">
          <div className="st-head">
            <div className="st-crumb"><span>Settings</span><span>/</span><b>{q ? 'Search' : page.title}</b></div>
            <button className="st-restore" onClick={restore}><SvgIcon name="undo" />Restore defaults</button>
            <button className="sb-ico" aria-label="Close settings" title="Close (Esc)" onClick={props.onClose}><SvgIcon name="x" /></button>
          </div>
          <div className="st-body" key={q ? 'search' : page.id}>
            {shown.length === 0 && <p className="st-none">No settings match “{query.trim()}”.</p>}
            {shown.map(([title, rows]) => (
              <section key={title}>
                <h3>{title}</h3>
                <div className="st-card">
                  {rows.map((r) => (
                    <div key={r.id ?? (r.path ? r.hint : r.label)} className={`st-row${r.wide ? ' wide' : ''}${r.id ? ' st-tree' : ''}`}>
                      {r.lead}
                      {r.label && <div className="st-txt"><span>{r.label}</span>{r.hint && (r.path ? <small className="path"><span dir="ltr">{r.hint}</span></small> : <small data-bad={r.bad || undefined}>{r.hint}</small>)}</div>}
                      {r.preview}
                      {r.control}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
