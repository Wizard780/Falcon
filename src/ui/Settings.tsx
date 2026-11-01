import { useEffect, useRef, useState, type ReactNode } from 'react';
import { version } from '../../package.json';
import { HIGHLIGHTS } from '../editor/schema';
import { SvgIcon } from './icons';

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
  ]],
];

const PENS = ['yellow', 'green', 'cyan', 'magenta', 'lightGray'];
const PEN_NAMES: Record<string, string> = { yellow: 'Yellow', green: 'Green', cyan: 'Cyan', magenta: 'Magenta', lightGray: 'Gray' };
export const DEFAULTS = { zoom: 1, speechMin: 8, showOutline: true, depth: 3, highlight: 'yellow' };

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
  const [pageId, setPageId] = useState('appearance');
  const [query, setQuery] = useState('');
  useEffect(() => { if (props.open) { setQuery(''); ref.current?.focus({ preventScroll: true }); } }, [props.open]);
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
  const keys = (k: string) => <span className="st-kbd">{keyChips(k).map((c, i) => <kbd key={i}>{c}</kbd>)}</span>;

  const pages: Page[] = [
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
      ]],
    ] },
    { id: 'editor', title: 'Editor', icon: 'doc', sections: [
      ['Outline', [
        { label: 'Show outline pane', hint: `The nav pane on the document's left edge. Also ${IS_MAC ? '⌘\\' : 'Ctrl+\\'}.`, control: toggle('Show outline pane', props.showOutline, props.onShowOutline) },
        { label: 'Outline depth', hint: 'How many heading levels the outline shows: pockets, hats, blocks, tags.', control:
          seg('Outline depth', [1, 2, 3, 4].map((n) => [String(n), props.depth === n, () => props.onDepth(n)])) },
      ]],
    ] },
    { id: 'keys', title: 'Keybindings', icon: 'keyboard', sections: SHORTCUTS.map(([g, ks]) => [g, ks.map(([k, what]) => ({ label: what, control: keys(k) }))]) },
    { id: 'speech', title: 'Speech and timers', icon: 'timer', group: 'Debate', sections: [
      ['Timer', [
        { label: 'Speech length', hint: 'Where the speech timer in the top bar starts.', control: (
          <span className="st-sel">
            <select aria-label="Speech length" value={props.speechMin} onChange={(e) => props.onSpeechMin(Number(e.target.value))}>
              {Array.from({ length: 30 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}:00</option>)}
            </select>
            <SvgIcon name="chev" />
          </span>) },
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
          <div className="st-body">
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
