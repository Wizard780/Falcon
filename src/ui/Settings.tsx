import { useEffect, useRef, useState, type ReactNode } from 'react';
import { version } from '../../package.json';
import { HIGHLIGHTS } from '../editor/schema';
import { SvgIcon } from './icons';
import { docToolSettings, docToolShortcuts } from '../editor/doc-tools';
import { cardToolSettings, cardToolShortcuts } from '../editor/card-tools';
import { navSettings, navShortcuts } from '../editor/nav-keys';
import { readSetting, type SettingSpec } from '../editor/tools';
import { P, onPrefs, pref, resetPrefs, setPref, type Pref } from '../editor/prefs';
import { newFileName } from './files';
import './settings.css';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
/** "Mod-Shift-8" as ⌘ ⇧ 8 on macOS, Ctrl Shift 8 elsewhere: one chip per key. */
const keyChips = (k: string) => k.split('-').filter(Boolean).map((p) => ({
  Mod: IS_MAC ? '⌘' : 'Ctrl', Ctrl: IS_MAC ? '⌃' : 'Ctrl', Alt: IS_MAC ? '⌥' : 'Alt', Shift: IS_MAC ? '⇧' : 'Shift',
  ArrowUp: '↑', ArrowDown: '↓', PageUp: 'Page Up', PageDown: 'Page Down',
}[p] ?? p)).concat(k.endsWith('--') ? ['−'] : []);

const SHORTCUTS: [string, [string, string][]][] = [
  ['App', [
    ['Mod-T', 'Home'], ['Mod-,', 'Settings'], ['Mod-\\', 'Show or hide the outline'], ['Mod-F', 'Find'],
    ['Mod-=', 'Zoom in'], ['Mod--', 'Zoom out'], ['Mod-0', 'Actual size'],
  ]],
  ['Files', [
    ['Mod-N', 'New document'], ['Mod-O', 'Open'], ['Mod-S', 'Save'], ['Mod-Shift-S', 'Save As'], ['Mod-W', 'Close document'],
    ['Ctrl-Tab', 'Next open document'], ['Ctrl-Shift-Tab', 'Previous open document'],
  ]],
  ['Cutting', [
    ['F2', 'Paste as plain text'], ['F3', 'Condense paragraph'], ['Shift-F3', 'Change case'],
    ['F4', 'Pocket'], ['F5', 'Hat'], ['F6', 'Block'], ['F7', 'Tag'], ['Mod-F7', 'Analytic'], ['Mod-F8', 'Undertag'],
    ['F8', 'Cite'], ['Alt-F8', 'Copy previous cite'], ['F9', 'Underline'], ['F10', 'Emphasis'], ['F11', 'Highlight'],
    ['Mod-F11', 'Background color'], ['F12', 'Clear formatting'], ['Mod-8', 'Shrink card'], ['Mod-Shift-8', 'Undo shrink'],
  ]],
  ['Moving around', [
    ['PageUp', 'Previous heading'], ['PageDown', 'Next heading'], ['Mod-Alt-ArrowUp', 'Move card up'], ['Mod-Alt-ArrowDown', 'Move card down'],
    ['Mod-Shift-R', 'Read mode'], ['Mod-Shift-D', 'Read marker'],
    ...navShortcuts,
  ]],
  ['Doc tools', docToolShortcuts],
  ['Card tools', cardToolShortcuts],
];

const PENS = ['yellow', 'green', 'cyan', 'magenta', 'lightGray'];
const PEN_NAMES: Record<string, string> = { yellow: 'Yellow', green: 'Green', cyan: 'Cyan', magenta: 'Magenta', lightGray: 'Gray' };
/** Settings the features declare in their own files (see SettingSpec), shown on the Editor page. */
const FEATURE_SETTINGS: SettingSpec[] = [...navSettings, ...docToolSettings, ...cardToolSettings];
export const DEFAULTS = { zoom: 1, speechMin: 8, showOutline: true, depth: 3, highlight: 'yellow' };

// ---------- display settings: CSS variables and root classes (settings.css); none of them change the file ----------

const FONTS: [string, string, string][] = [
  ['calibri', 'Calibri', ''], ['arial', 'Arial', 'Arial, Helvetica, sans-serif'], ['verdana', 'Verdana', 'Verdana, Geneva, sans-serif'],
  ['georgia', 'Georgia', 'Georgia, serif'], ['times', 'Times New Roman', "'Times New Roman', Times, serif"],
  ['comic', 'Comic Sans', "'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', sans-serif"],
];
const SIZE_PREFS: [string, string, Pref<number>][] = [
  ['normal', 'Body text', P.szNormal], ['pocket', 'Pocket', P.szPocket], ['hat', 'Hat', P.szHat], ['block', 'Block', P.szBlock],
  ['tag', 'Tag', P.szTag], ['cite', 'Cite', P.szCite], ['analytic', 'Analytic', P.szAnalytic], ['undertag', 'Undertag', P.szUndertag],
];
function applyDisplay() {
  const root = document.documentElement;
  const v = (k: string, val: string) => (val ? root.style.setProperty(k, val) : root.style.removeProperty(k));
  v('--doc-font', FONTS.find(([id]) => id === pref(P.font))?.[2] ?? '');
  v('--doc-lh', pref(P.lineHeight));
  for (const [id, , p] of SIZE_PREFS) v(`--sz-${id}`, `${pref(p)}pt`);
  v('--c-analytic', pref(P.colorAnalytic));
  v('--c-undertag', pref(P.colorUndertag));
  v('--text-w', { full: '', wide: '900px', narrow: '680px' }[pref(P.textWidth)]);
  v('--margin-x', { narrow: '12px', normal: '', wide: '72px' }[pref(P.margins)]);
  root.dataset.caret = pref(P.caret);
  root.dataset.sel = pref(P.selection);
  const cls: [string, boolean][] = [
    ['page-dark', pref(P.pageDark)], ['cite-plain', !pref(P.citeBold)], ['emph-nobox', !pref(P.emphasisBox)], ['pocket-nobox', !pref(P.pocketBox)],
    ['hat-single', pref(P.hatLine) === 'single'], ['shade-dots', pref(P.shadingDots)], ['no-card-bar', !pref(P.cardBar)], ['reduce-motion', pref(P.reduceMotion)],
  ];
  for (const [c, on] of cls) root.classList.toggle(c, on);
}
applyDisplay();
onPrefs(applyDisplay);

const STYLE_OPTS: [string, string][] = [['normal', 'Normal text'], ['pocket', 'Pocket'], ['hat', 'Hat'], ['block', 'Block'], ['tag', 'Tag'], ['analytic', 'Analytic'], ['undertag', 'Undertag']];
const WPM: [number, string][] = Array.from({ length: 12 }, (_, i) => [150 + i * 25, `${150 + i * 25} wpm`]);
const MARKERS: [string, string][] = [['#FF0000', 'Red'], ['#0070C0', 'Blue'], ['#00B050', 'Green'], ['#7030A0', 'Purple']];

type Props = {
  open: boolean; onClose: () => void;
  zoom: number; onZoom: (z: number) => void;
  speechMin: number; onSpeechMin: (m: number) => void;
  showOutline: boolean; onShowOutline: (s: boolean) => void;
  depth: number; onDepth: (d: number) => void;
  highlight: string | null; onHighlight: (c: string) => void;
};
type Row = { label: string; hint?: string; preview?: ReactNode; control: ReactNode };
type Page = { id: string; title: string; icon: string; group?: string; sections: [string, Row[]][] };

/** Settings, laid out like the prototype's: a section list on the left, cards of rows on the right. */
export function Settings(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pageId, setPageId] = useState('general');
  const [query, setQuery] = useState('');
  const [, setSpecTick] = useState(0); // a feature setting changed: redraw its row
  useEffect(() => { if (props.open) { setQuery(''); ref.current?.focus({ preventScroll: true }); } }, [props.open]);
  useEffect(() => onPrefs(() => setSpecTick((t) => t + 1)), []);
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
  const select = (label: string, value: string | number, opts: [string | number, string][], set: (v: string) => void) => (
    <span className="st-sel">
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
        {opts.map(([o, n]) => <option key={o} value={o}>{n}</option>)}
      </select>
      <SvgIcon name="chev" />
    </span>
  );
  const stepper = (label: string, value: number, show: string, less: () => void, more: () => void) => (
    <span className="st-step" role="group" aria-label={label}>
      <button aria-label={`Less ${label.toLowerCase()}`} onClick={less}>−</button>
      <output>{show}</output>
      <button aria-label={`More ${label.toLowerCase()}`} onClick={more}>+</button>
    </span>
  );

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
  const sizes = (p: Pref<number>, label: string, from: number, to: number, step = 1) =>
    select(label, pref(p), Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => [from + i * step, `${from + i * step} pt`]), (o) => setPref(p, Number(o)));
  /** A style shown in its own look, beside the control that changes it. */
  const styled = (label: string, cls: string, sample: ReactNode, control: ReactNode, hint?: string): Row => ({ label, hint, control, preview: <span className={`st-pv ${cls}`}><span className="s">{sample}</span></span> });
  const color = (p: Pref<string>, label: string, hint: string, fallback: string): Row => ({
    label, hint, control: <input type="color" className="st-color" aria-label={label} value={pref(p) || fallback} onChange={(e) => setPref(p, e.target.value)} />,
  });

  const setSpec = (spec: SettingSpec, v: string | boolean) => {
    localStorage.setItem(spec.key, typeof v === 'boolean' ? (v ? 'on' : 'off') : v);
    setSpecTick((t) => t + 1);
  };
  const specRow = (spec: SettingSpec): Row => {
    const v = readSetting(spec);
    return { label: spec.label, hint: spec.hint, control: spec.kind === 'toggle'
      ? toggle(spec.label, v as boolean, (on) => setSpec(spec, on))
      : seg(spec.label, spec.options.map(([o, n]) => [n, v === o, () => setSpec(spec, o)])) };
  };
  const specSections = [...new Set(FEATURE_SETTINGS.map((x) => x.section))]
    .map((sec): [string, Row[]] => [sec, FEATURE_SETTINGS.filter((x) => x.section === sec).map(specRow)]);
  const keys = (k: string) => <span className="st-kbd">{keyChips(k).map((c, i) => <kbd key={i}>{c}</kbd>)}</span>;
  const prep = pref(P.prepMin);
  const profile = (speech: number, prepMin: number) => () => { props.onSpeechMin(speech); setPref(P.prepMin, prepMin); };

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
        pickNum(P.recentCount, 'Recent files', 'How many files Home lists.', [[6, '6'], [12, '12'], [24, '24']]),
        { label: 'Name new files', hint: 'What an Untitled document is called when you first save it.', control:
          select('Name new files', pref(P.newName), (['untitled', 'speech', 'date'] as const).map((h) => [h, newFileName(h)]), (h) => setPref(P.newName, h as 'untitled')) },
      ]],
    ] },
    { id: 'appearance', title: 'Appearance', icon: 'contrast', sections: [
      ['Theme', [
        { label: 'Document paper', hint: 'Dark to read at night. The saved file stays black on white.', control:
          seg('Document paper', [['White', !pref(P.pageDark), () => setPref(P.pageDark, false)], ['Dark', pref(P.pageDark), () => setPref(P.pageDark, true)]]) },
        { label: 'Highlighter', hint: 'Your highlight color, also used for the current location in the outline.', control: (
          <span className="st-pens" role="radiogroup" aria-label="Highlighter">
            {PENS.map((p) => <button key={p} role="radio" aria-checked={props.highlight === p} aria-label={PEN_NAMES[p]} title={PEN_NAMES[p]}
              style={{ background: HIGHLIGHTS[p] }} onClick={() => props.onHighlight(p)} />)}
          </span>) },
      ]],
      ['Layout', [
        { label: 'Zoom', hint: `How big the page is. Also ${IS_MAC ? '⌘+ and ⌘−' : 'Ctrl+ and Ctrl−'}.`, control: (
          <span className="st-step">
            <button aria-label="Less zoom" onClick={() => zoomTo(props.zoom - 0.1)}>−</button>
            <output>{Math.round(props.zoom * 100)}%</output>
            <button aria-label="More zoom" onClick={() => zoomTo(props.zoom + 0.1)}>+</button>
          </span>) },
        tog(P.wheelZoom, 'Zoom with the scroll wheel', `${IS_MAC ? '⌘' : 'Ctrl'} and scroll, or pinch the trackpad.`),
        pick(P.textWidth, 'Text width', 'Narrower lines are easier to follow.', [['full', 'Full'], ['wide', 'Wide'], ['narrow', 'Narrow']]),
        pick(P.margins, 'Margins', 'Space at the left and right of the text.', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]),
      ]],
      ['Cursor and motion', [
        pick(P.caret, 'Cursor color', 'Highlighter matches your highlight color.', [['auto', 'Text'], ['blue', 'Blue'], ['red', 'Red'], ['ink', 'Highlighter']]),
        pick(P.selection, 'Selection color', 'The color behind selected text.', [['blue', 'Blue'], ['gray', 'Gray'], ['ink', 'Highlighter']]),
        tog(P.cardBar, 'Mark the current card', 'A thin line beside the card the cursor is in.'),
        tog(P.reduceMotion, 'Reduce motion', 'Turn off animations. Also on when your system asks for less motion.'),
      ]],
    ] },
    { id: 'editor', title: 'Editor', icon: 'doc', sections: [
      ['Outline', [
        { label: 'Show outline pane', hint: `The nav pane on the document's left edge. Also ${IS_MAC ? '⌘\\' : 'Ctrl+\\'}.`, control: toggle('Show outline pane', props.showOutline, props.onShowOutline) },
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
      ]],
      ['Pasting', [
        tog(P.smartPaste, 'Smart paste', 'Word and Verbatim formatting pastes as cites, underlining and highlights. F2 always pastes plain.'),
        tog(P.citeNearest, 'Copy previous cite: first line only', 'Off, Alt-F8 also copies the cite lines right after it.'),
        tog(P.hlUnderlined, 'Highlight underlined text only', 'Highlighting skips text that isn\'t underlined, emphasized or cited.'),
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
        styled('Pocket', `pocket${pref(P.pocketBox) ? ' box' : ''}`, 'Moratorium Aff', sizes(P.szPocket, 'Pocket size', 18, 36, 2)),
        styled('Hat', `hat${pref(P.hatLine) === 'single' ? ' single' : ''}`, 'DIB Advantage', sizes(P.szHat, 'Hat size', 14, 28, 2)),
        styled('Block', 'block', 'AT Offshoring DA', sizes(P.szBlock, 'Block size', 12, 22)),
        styled('Tag', 'tag', 'Power is the binding constraint', sizes(P.szTag, 'Tag size', 10, 16)),
        styled('Analytic', 'analytic', 'Their ev assumes no stockpiles', sizes(P.szAnalytic, 'Analytic size', 10, 16)),
        styled('Undertag', 'undertag', 'Read with the DIB link', sizes(P.szUndertag, 'Undertag size', 8, 14)),
        styled('Cite', `cite${pref(P.citeBold) ? '' : ' plain'}`, <><b>Nystuen 25</b> Senior fellow</>, sizes(P.szCite, 'Cite size', 10, 16)),
        styled('Body text', 'und', 'data centers outbid factories', sizes(P.szNormal, 'Body text size', 8, 14)),
        styled('Emphasis', `emph${pref(P.emphasisBox) ? '' : ' nobox'}`, <>hollow <span>DIB</span> can’t deter</>,
          select('Emphasis', pref(P.emphasisBox) ? 'box' : 'bold', [['box', 'Bold and box'], ['bold', 'Bold only']], (o) => setPref(P.emphasisBox, o === 'box'))),
        styled('Unread text', 'small', 'the rest of the paragraph, shrunk so the card stays short',
          select('Shrink down to', pref(P.shrinkMin), [[4, '4 pt'], [6, '6 pt'], [8, '8 pt']], (o) => setPref(P.shrinkMin, Number(o))), 'The smallest size Shrink steps down to.'),
      ]],
      ['Look', [
        pick(P.font, 'Font', 'Verdana and Comic Sans are easier for some readers with dyslexia.', FONTS.map(([id, n]) => [id, n])),
        pick(P.lineHeight, 'Line spacing', 'Space between the lines of a paragraph.', [['1', '1.0'], ['1.2', '1.2'], ['1.5', '1.5'], ['2', '2.0']]),
        tog(P.pocketBox, 'Box around pockets', 'Draw the box around pocket headings.'),
        pick(P.hatLine, 'Hat underline', 'Hats are underlined twice, or once.', [['double', 'Double'], ['single', 'Single']]),
        tog(P.citeBold, 'Bold cites', 'Off shows cites at normal weight.'),
        color(P.colorAnalytic, 'Analytic color', 'The color analytics show in.', pref(P.pageDark) ? '#8aa4d6' : '#1f3f8a'),
        color(P.colorUndertag, 'Undertag color', 'The color undertags show in.', pref(P.pageDark) ? '#8fae7a' : '#2a6a3a'),
        tog(P.shadingDots, 'Dots on background color', 'A faint dot pattern, so background color can be told from highlighting.'),
      ]],
    ] },
    { id: 'keys', title: 'Keybindings', icon: 'keyboard', sections: SHORTCUTS.filter(([, ks]) => ks.length).map(([g, ks]) => [g, ks.map(([k, what]) => ({ label: what, control: keys(k) }))]) },
    { id: 'speech', title: 'Speech and timers', icon: 'timer', group: 'Debate', sections: [
      ['Format', [
        { label: 'Event', hint: 'High school: 8 minute speeches, 8 of prep. College: 9 and 10.', control:
          seg('Event', [['High school', props.speechMin === 8 && prep === 8, profile(8, 8)], ['College', props.speechMin === 9 && prep === 10, profile(9, 10)]]) },
        { label: 'Speech length', hint: 'Where the speech timer in the top bar starts.', control:
          select('Speech length', props.speechMin, Array.from({ length: 30 }, (_, i) => [i + 1, `${i + 1}:00`]), (m) => props.onSpeechMin(Number(m))) },
        tog(P.showPrep, 'Prep timer', 'A prep clock beside the speech timer. Click to start or pause, right-click to reset.'),
        { label: 'Prep time', hint: 'Where the prep timer starts.', control:
          select('Prep time', prep, Array.from({ length: 15 }, (_, i) => [i + 1, `${i + 1}:00`]), (m) => setPref(P.prepMin, Number(m))) },
      ]],
      ['Reading speed', [
        pickNum(P.wpm1, 'Reader 1', 'Words per minute for the first read time in the status bar.', WPM),
        pickNum(P.wpm2, 'Reader 2', 'Words per minute for the second read time.', WPM),
      ]],
    ] },
  ];

  const q = query.trim().toLowerCase();
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  // searching shows every matching row, under its page and section
  const shown: [string, Row[]][] = q
    ? pages.flatMap((p) => p.sections.map(([s, rows]) => [`${p.title} · ${s}`, rows.filter((r) => `${r.label} ${r.hint ?? ''} ${s} ${p.title}`.toLowerCase().includes(q))] as [string, Row[]]))
      .filter(([, rows]) => rows.length)
    : page.sections;
  const restore = () => {
    props.onZoom(DEFAULTS.zoom); props.onSpeechMin(DEFAULTS.speechMin); props.onShowOutline(DEFAULTS.showOutline);
    props.onDepth(DEFAULTS.depth); props.onHighlight(DEFAULTS.highlight);
    FEATURE_SETTINGS.forEach((x) => localStorage.removeItem(x.key));
    resetPrefs();
    setSpecTick((t) => t + 1);
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
                    <div key={r.label} className="st-row">
                      <div className="st-txt"><span>{r.label}</span>{r.hint && <small>{r.hint}</small>}</div>
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
