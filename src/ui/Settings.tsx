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
const MARKERS: [string, string][] = [['#FF0000', 'Red'], ['#0070C0', 'Blue'], ['#00B050', 'Green'], ['#7030A0', 'Purple']];

type Props = {
  open: boolean; onClose: () => void;
  zoom: number; onZoom: (z: number) => void;
  speechMin: number; onSpeechMin: (m: number) => void;
  showOutline: boolean; onShowOutline: (s: boolean) => void;
  depth: number; onDepth: (d: number) => void;
  highlight: string | null; onHighlight: (c: string) => void;
};
type Row = { label: string; hint?: string; control: ReactNode };
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
  const num = (p: Pref<number>, label: string, hint: string, step: number, min: number, max: number, unit: string): Row => {
    const val = pref(p), to = (n: number) => setPref(p, Math.max(min, Math.min(max, n)));
    return { label, hint, control: stepper(label, val, `${val} ${unit}`, () => to(val - step), () => to(val + step)) };
  };
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
    { id: 'general', title: 'General', icon: 'gear', sections: [
      ['Startup', [
        tog(P.openHome, 'Open Home at launch', 'Start on Home, with your recent files. Off goes straight to the document.'),
        tog(P.reopen, 'Reopen last files', 'Open the files you had open when you quit. Desktop app only.'),
      ]],
      ['Files', [
        tog(P.confirmClose, 'Ask before closing unsaved files', 'Closing a file or quitting with unsaved changes asks first.'),
        tog(P.crashRecovery, 'Crash recovery', 'Keep a copy of open and unsaved files, brought back if Falcon closes unexpectedly.'),
        pickNum(P.recentCount, 'Recent files', 'How many files Home lists.', [[6, '6'], [12, '12'], [24, '24']]),
        { label: 'Name for new files', hint: 'What an Untitled document is called when you first save it.', control:
          select('Name for new files', pref(P.newName), (['untitled', 'speech', 'date'] as const).map((h) => [h, newFileName(h)]), (h) => setPref(P.newName, h as 'untitled')) },
      ]],
      ['Outline', [
        { label: 'Show outline pane', hint: `The nav pane on the document's left edge. Also ${IS_MAC ? '⌘\\' : 'Ctrl+\\'}.`, control: toggle('Show outline pane', props.showOutline, props.onShowOutline) },
        { label: 'Outline depth', hint: 'How many heading levels the outline shows: pockets, hats, blocks, tags.', control:
          seg('Outline depth', [1, 2, 3, 4].map((n) => [String(n), props.depth === n, () => props.onDepth(n)])) },
        pickNum(P.openDepth, 'Depth for opened files', 'The outline depth a file opens at. Keep leaves it where it is.', [[0, 'Keep'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]),
      ]],
    ] },
    { id: 'appearance', title: 'Appearance', icon: 'contrast', sections: [
      ['Page', [
        { label: 'Highlighter', hint: 'Your highlight pen, also the color of the current place in the outline.', control: (
          <span className="st-pens" role="radiogroup" aria-label="Highlighter">
            {PENS.map((p) => <button key={p} role="radio" aria-checked={props.highlight === p} aria-label={PEN_NAMES[p]} title={PEN_NAMES[p]}
              style={{ background: HIGHLIGHTS[p] }} onClick={() => props.onHighlight(p)} />)}
          </span>) },
        { label: 'Zoom', hint: `How big the page is. Also ${IS_MAC ? '⌘+ and ⌘−' : 'Ctrl+ and Ctrl−'}.`, control: (
          <span className="st-step">
            <button aria-label="Less zoom" onClick={() => zoomTo(props.zoom - 0.1)}>−</button>
            <output>{Math.round(props.zoom * 100)}%</output>
            <button aria-label="More zoom" onClick={() => zoomTo(props.zoom + 0.1)}>+</button>
          </span>) },
        tog(P.wheelZoom, 'Zoom with the scroll wheel', `${IS_MAC ? '⌘' : 'Ctrl'} and scroll, or pinch the trackpad, to make the page bigger or smaller.`),
        tog(P.pageDark, 'Dark page', 'Light text on a dark page. The saved file stays black on white.'),
        pick(P.textWidth, 'Text width', 'Cap how wide the text runs, so lines are easier to follow.', [['full', 'Full'], ['wide', 'Wide'], ['narrow', 'Narrow']]),
        pick(P.margins, 'Margins', 'Space at the left and right of the text.', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]),
      ]],
      ['Cursor and selection', [
        pick(P.caret, 'Cursor color', 'The color of the text cursor. Highlighter matches your pen.', [['auto', 'Text'], ['blue', 'Blue'], ['red', 'Red'], ['ink', 'Highlighter']]),
        pick(P.selection, 'Selection color', 'The color behind selected text.', [['blue', 'Blue'], ['gray', 'Gray'], ['ink', 'Highlighter']]),
        tog(P.cardBar, 'Mark the current card', 'A thin line beside the card the cursor is in.'),
        tog(P.reduceMotion, 'Reduce motion', 'Turn off animations. Also on when your system asks for less motion.'),
      ]],
    ] },
    { id: 'text', title: 'Text and styles', icon: 'pen', sections: [
      ['Text', [
        pick(P.font, 'Font', 'The font the document shows in. Verdana and Comic Sans are easier for some readers with dyslexia.', FONTS.map(([id, n]) => [id, n])),
        pick(P.lineHeight, 'Line spacing', 'Space between the lines of a paragraph.', [['1', '1.0'], ['1.2', '1.2'], ['1.5', '1.5'], ['2', '2.0']]),
        ...SIZE_PREFS.map(([, n, p]) => num(p, `${n} size`, `How big ${n === 'Body text' ? 'body text shows' : `${n.toLowerCase()}s show`}. The file keeps its own sizes.`, 1, 6, 48, 'pt')),
      ]],
      ['Styles', [
        color(P.colorAnalytic, 'Analytic color', 'The color analytics show in.', pref(P.pageDark) ? '#8aa4d6' : '#1f3f8a'),
        color(P.colorUndertag, 'Undertag color', 'The color undertags show in.', pref(P.pageDark) ? '#8fae7a' : '#2a6a3a'),
        tog(P.citeBold, 'Bold cites', 'Off shows cites at normal weight, for readers who find dense bold crowded.'),
        tog(P.emphasisBox, 'Box around emphasis', 'Draw the box around emphasized text.'),
        tog(P.pocketBox, 'Box around pockets', 'Draw the box around pocket headings.'),
        pick(P.hatLine, 'Hat underline', 'Hats are underlined twice, or once.', [['double', 'Double'], ['single', 'Single']]),
        tog(P.shadingDots, 'Dots on background color', 'A faint dot pattern on background color, so it can be told apart from highlighting.'),
      ]],
    ] },
    { id: 'editor', title: 'Editor', icon: 'doc', sections: [
      ['Condense', [
        pick(P.condense, 'F3 condenses to', 'Keep paragraphs collapses spaces only. Merge joins the paragraphs; with ¶ marks where they were.', [['integrity', 'Keep paragraphs'], ['merge', 'Merge'], ['pilcrows', 'Merge with ¶']]),
        tog(P.smallPilcrows, 'Small ¶ marks', 'Merging with ¶ sets the marks at 6 pt, so they take less room.'),
        tog(P.pasteCondense, 'Condense after Paste Text', 'F2 condenses what it pastes, the way F3 does.'),
      ]],
      ['Shrink', [
        pickNum(P.shrinkMin, 'Shrink down to', 'The smallest size Shrink steps down to before it starts over.', [[4, '4 pt'], [6, '6 pt'], [8, '8 pt']]),
        tog(P.shrinkProtect, 'Keep omission notes full size', 'Shrink leaves notes like [Table Omitted] at their size.'),
      ]],
      ['Paste and cites', [
        tog(P.smartPaste, 'Smart paste', 'Turn Word and Verbatim formatting into cites, underlining, emphasis and highlights. F2 always pastes plain.'),
        tog(P.citeNearest, 'Copy previous cite: first line only', 'Alt-F8 copies the cite line. Off also copies the cite lines right after it.'),
        tog(P.hlUnderlined, 'Highlight underlined text only', 'Highlight and background color skip text that isn\'t underlined, emphasized or cited. Headings take it whole.'),
      ]],
      ['Enter at the end of a heading', (['pocket', 'hat', 'block', 'tag', 'analytic', 'undertag'] as const).map((st) => {
        const n = STYLE_OPTS.find(([o]) => o === st)![1];
        const p = { pocket: P.enterPocket, hat: P.enterHat, block: P.enterBlock, tag: P.enterTag, analytic: P.enterAnalytic, undertag: P.enterUndertag }[st];
        return { label: `After ${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n.toLowerCase()}`, hint: `What Enter at the end of ${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n.toLowerCase()} starts.`, control:
          select(`After ${n.toLowerCase()}`, pref(p), STYLE_OPTS, (o) => setPref(p, o as 'normal')) };
      })],
      ...specSections,
    ] },
    { id: 'keys', title: 'Keybindings', icon: 'keyboard', sections: SHORTCUTS.filter(([, ks]) => ks.length).map(([g, ks]) => [g, ks.map(([k, what]) => ({ label: what, control: keys(k) }))]) },
    { id: 'read', title: 'Read mode', icon: 'eye', group: 'Debate', sections: [
      ['Showing', [
        tog(P.readParas, 'Keep paragraphs apart', 'Each paragraph stays on its own line instead of running together.'),
        tog(P.readWholeCite, 'Show the whole cite', 'Show all of a cite line, not just its cite-marked words.'),
        tog(P.readUndertags, 'Show undertags', 'Undertags stay visible while you read.'),
        tog(P.readShading, 'Show background color', 'Text with a background color shows, like highlighted text.'),
        tog(P.readTop, 'Jump to the top', 'Turning read mode on or off moves to the start of the file.'),
      ]],
      ['Markers', [
        pick(P.markerColor, 'Marker color', 'The color of the Marked note Space drops.', MARKERS),
        tog(P.markerTime, 'Marker shows the time', 'Marked 3:42 or just Marked.'),
      ]],
    ] },
    { id: 'speech', title: 'Speech and timers', icon: 'timer', group: 'Debate', sections: [
      ['Timer', [
        { label: 'Speech length', hint: 'Where the speech timer in the top bar starts.', control: (
          <span className="st-sel">
            <select aria-label="Speech length" value={props.speechMin} onChange={(e) => props.onSpeechMin(Number(e.target.value))}>
              {Array.from({ length: 30 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}:00</option>)}
            </select>
            <SvgIcon name="chev" />
          </span>) },
        { label: 'Timer preset', hint: 'High school: 8 minute speeches, 8 of prep. College: 9 and 10.', control:
          seg('Timer preset', [['High school', props.speechMin === 8 && prep === 8, profile(8, 8)], ['College', props.speechMin === 9 && prep === 10, profile(9, 10)]]) },
        tog(P.showPrep, 'Prep timer', 'A prep clock beside the speech timer. Click to start or pause, right-click to reset.'),
        { label: 'Prep time', hint: 'Where the prep timer starts.', control:
          select('Prep time', prep, Array.from({ length: 15 }, (_, i) => [i + 1, `${i + 1}:00`]), (m) => setPref(P.prepMin, Number(m))) },
      ]],
      ['Alerts', [
        pickNum(P.lowTime, 'Flash when time is low', 'The running clock flashes red for its last seconds.', [[0, 'Off'], [10, '10 s'], [30, '30 s'], [60, '1 min']]),
        tog(P.beep, 'Sound when time is up', 'Two short tones when a timer reaches zero.'),
      ]],
      ['Reading speed', [
        num(P.wpm1, 'Reader 1', 'Words per minute for the first read time in the status bar.', 10, 50, 600, 'wpm'),
        num(P.wpm2, 'Reader 2', 'Words per minute for the second read time.', 10, 50, 600, 'wpm'),
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
