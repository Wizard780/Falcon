import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { Node as PMNode } from 'prosemirror-model';
import { createState, createView, brushKey, emptyDoc } from '../editor/editor';
import { falconKeys } from '../editor/keymap';
import { activeColors, setActiveColor } from '../editor/host';
import { HIGHLIGHTS, schema, type ParaStyle } from '../editor/schema';
import { buildOutline, currentItem, readWords, type OutlineItem } from '../editor/outline';
import { selectionState } from './selection-state';
import { Icon } from './icons';
import { openDocument, saveDocument, type DocMeta } from './files';

const AUTOSAVE_KEY = 'falcon.autosave.v1';

export function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [tick, setTick] = useState(0);
  const [docVersion, setDocVersion] = useState(0);
  const [showOutline, setShowOutline] = useState(() => localStorage.getItem('falcon.outline') !== 'off');
  const [depth, setDepth] = useState(() => Number(localStorage.getItem('falcon.depth')) || 3);
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('falcon.zoom')) || 1);
  const [meta, setMeta] = useState<DocMeta>(() => JSON.parse(localStorage.getItem('falcon.meta') ?? 'null') ?? { name: 'Untitled' });
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const lastDoc = useRef<PMNode | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  }, []);

  useEffect(() => {
    let doc: PMNode | undefined;
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) doc = PMNode.fromJSON(schema, JSON.parse(saved));
    } catch { /* corrupt autosave: start blank */ }
    let timer = 0;
    const view = createView(mountRef.current!, (v) => {
      setTick((t) => t + 1);
      if (v.state.doc !== lastDoc.current) {
        lastDoc.current = v.state.doc;
        setDocVersion((n) => n + 1);
        setDirty(true);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(v.state.doc.toJSON())), 800);
      }
    }, doc);
    lastDoc.current = view.state.doc;
    viewRef.current = view;
    view.focus();
    setTick(1);
    return () => view.destroy();
  }, []);

  useEffect(() => { document.documentElement.style.setProperty('--zoom', String(zoom)); localStorage.setItem('falcon.zoom', String(zoom)); }, [zoom]);
  useEffect(() => { localStorage.setItem('falcon.outline', showOutline ? 'on' : 'off'); }, [showOutline]);
  useEffect(() => { localStorage.setItem('falcon.depth', String(depth)); }, [depth]);
  useEffect(() => { localStorage.setItem('falcon.meta', JSON.stringify(meta)); }, [meta]);

  const view = viewRef.current;
  const run = useCallback((cmd: Command) => {
    const v = viewRef.current;
    if (!v) return;
    cmd(v.state, v.dispatch, v);
    v.focus();
  }, []);

  const replaceDoc = useCallback((doc: PMNode, m: DocMeta) => {
    const v = viewRef.current!;
    v.updateState(createState(doc));
    lastDoc.current = v.state.doc;
    setMeta(m);
    setDirty(false);
    setDocVersion((n) => n + 1);
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(doc.toJSON()));
    v.focus();
    setTick((t) => t + 1);
  }, []);

  const fileNew = useCallback(() => replaceDoc(emptyDoc(), { name: 'Untitled' }), [replaceDoc]);
  const fileOpen = useCallback(async () => {
    try {
      const r = await openDocument();
      if (r) { replaceDoc(r.doc, r.meta); flash(`Opened ${r.meta.name}`); }
    } catch (e) { flash(`Couldn't open: ${(e as Error).message}`); }
  }, [replaceDoc, flash]);
  const fileSave = useCallback(async (as = false) => {
    const v = viewRef.current!;
    try {
      const m = await saveDocument(v.state.doc, meta, as);
      if (m) { setMeta(m); setDirty(false); flash(`Saved ${m.name}`); }
    } catch (e) { flash(`Couldn't save: ${(e as Error).message}`); }
  }, [meta, flash]);

  // app-level shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void fileSave(e.shiftKey); }
      else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void fileOpen(); }
      else if (mod && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); fileNew(); }
      else if (mod && (e.key === '=' || e.key === '+') && !e.shiftKey) { e.preventDefault(); setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2))); }
      else if (mod && e.key === '-') { e.preventDefault(); setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2))); }
      else if (mod && e.key === '0') { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fileSave, fileOpen, fileNew]);

  const sel = useMemo(() => (view ? selectionState(view.state) : null), [view, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outline = useMemo(() => (view ? buildOutline(view.state.doc) : []), [view, docVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const words = useMemo(() => (view ? readWords(view.state.doc) : 0), [view, docVersion]);
  const cur = view ? currentItem(outline, view.state.selection.from) : -1;
  const brush = view ? brushKey.getState(view.state)?.kind ?? null : null;

  const jump = (item: OutlineItem) => {
    const v = viewRef.current!;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, item.pos + 1)));
    const el = v.nodeDOM(item.pos) as HTMLElement | null;
    const sc = v.dom.closest('.f-scroll') as HTMLElement;
    if (el && sc) sc.scrollTop = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 24;
    v.focus();
  };

  const colorButton = (kind: 'highlight' | 'shading') => {
    const v = viewRef.current;
    if (!v) return;
    if (v.state.selection.empty) {
      // nothing selected: arm (or disarm) the paintbrush
      v.dispatch(v.state.tr.setMeta(brushKey, brush === kind ? null : kind));
      v.focus();
    } else run(falconKeys[kind === 'highlight' ? 'F11' : 'Mod-F11']);
  };

  return (
    <div className="app">
      <nav className="rail">
        <Icon name="falcon" className="logo" />
        <button title="New (⌘N)" onClick={fileNew}><Icon name="plus" /></button>
        <button title="Open (⌘O)" onClick={() => void fileOpen()}><Icon name="folder" /></button>
        <button title="Save (⌘S)" onClick={() => void fileSave()}><Icon name="save" /></button>
        <button title="Outline" className={showOutline ? 'on' : ''} onClick={() => setShowOutline((s) => !s)}><Icon name="outline" /></button>
        <div className="grow" />
      </nav>

      <Toolbar
        sel={sel}
        run={run}
        brush={brush}
        onColor={colorButton}
        onPick={(kind, c) => { setActiveColor(kind, c); setTick((t) => t + 1); const v = viewRef.current; if (v && !v.state.selection.empty) run(falconKeys[kind === 'highlight' ? 'F11' : 'Mod-F11']); }}
      />

      <aside className={`outline${showOutline ? '' : ' hidden'}`}>
        <div className="head"><span className="name">{meta.name}{dirty ? ' •' : ''}</span>
          <button title="Hide outline" onClick={() => setShowOutline(false)} style={{ color: 'var(--chrome-dim)' }}><Icon name="x" /></button></div>
        <div className="levels"><span className="label">Outline</span>
          <span className="lv">{[1, 2, 3, 4].map((l) => <button key={l} className={depth === l ? 'on' : ''} onClick={() => setDepth(l)}>{l}</button>)}</span></div>
        <OutlineRows items={outline} depth={depth} cur={cur} onJump={jump} />
      </aside>

      <div className="f-scroll" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); viewRef.current?.focus(); } }}>
        <div className="page"><div ref={mountRef} /></div>
      </div>

      <footer className="status">
        <span>Σ</span>
        <span>Doc: {words} · Reader 1: {mmss(words / 200)} · Reader 2: {mmss(words / 300)}{sel && sel.selWords ? ` | Sel: ${sel.selWords}` : ''}</span>
        {brush && <span className="dirty">Paintbrush on · Esc to stop</span>}
        <span className="grow" />
        <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}>−</button>
        <button className="zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}>+</button>
      </footer>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

const mmss = (min: number) => { const s = Math.round(min * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

type SelState = ReturnType<typeof selectionState>;

function Toolbar(props: { sel: SelState | null; run: (c: Command) => void; brush: string | null; onColor: (k: 'highlight' | 'shading') => void; onPick: (k: 'highlight' | 'shading', c: string | null) => void }) {
  const { sel, run } = props;
  const [picker, setPicker] = useState<{ kind: 'highlight' | 'shading'; x: number; y: number } | null>(null);
  const style = (s: ParaStyle, key: string, label: string) => (
    <button className={`tb${sel?.style === s ? ' on' : ''}`} title={`${label} (${key})`} onMouseDown={(e) => { e.preventDefault(); run(falconKeys[key]); }}>
      <span className={`pv-${s}`}>{label}</span>
    </button>
  );
  const mark = (name: string, key: string, label: string) => (
    <button className={`tb${sel?.marks.has(name) ? ' on' : ''}`} title={`${label} (${key})`} onMouseDown={(e) => { e.preventDefault(); run(falconKeys[key]); }}>
      <span className={`pv-${name}`}>{label}</span>
    </button>
  );
  const colorSplit = (kind: 'highlight' | 'shading', title: string) => {
    const c = activeColors[kind];
    const css = c === null ? undefined : kind === 'highlight' ? HIGHLIGHTS[c] ?? c : c;
    return (
      <span className="split">
        <button className={`main${props.brush === kind ? ' armed' : ''}`} title={`${title}: click with nothing selected for the paintbrush`} onMouseDown={(e) => { e.preventDefault(); props.onColor(kind); }}>
          <Icon name={kind === 'highlight' ? 'highlighter' : 'bucket'} />
          <span className={`swatchbar${c === null ? ' none' : ''}`} style={{ background: css }} />
        </button>
        <button className="chev" title={`${title} color`} onMouseDown={(e) => { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPicker(picker ? null : { kind, x: r.left - 30, y: r.bottom + 6 }); }}>
          <Icon name="chevron" />
        </button>
      </span>
    );
  };
  const fontSize = sel?.size ?? null;
  const bump = (d: number) => run((state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    const base = fontSize ?? 11;
    const next = Math.max(4, Math.min(72, base + d));
    dispatch?.(state.tr.addMark(from, to, schema.marks.size.create({ pt: next })));
    return true;
  });
  return (
    <header className="toolbar">
      <div className="tgroup">
        {style('pocket', 'F4', 'Pocket')}{style('tag', 'F7', 'Tag')}
        {style('hat', 'F5', 'Hat')}{style('block', 'F6', 'Block')}
        {style('analytic', 'Mod-F7', 'Analytic')}{style('undertag', 'Mod-F8', 'Undertag')}
      </div>
      <div className="tgroup">
        {mark('cite', 'F8', 'Cite')}{mark('underline', 'F9', 'Underline')}
        {mark('emphasis', 'F10', 'Emphasis')}
        <button className="tb" title="Clear (F12)" onMouseDown={(e) => { e.preventDefault(); run(falconKeys.F12); }}>Clear</button>
      </div>
      <div className="tgroup">
        {colorSplit('highlight', 'Highlight (F11)')}
        {colorSplit('shading', 'Background color (⌘F11)')}
        <span className="size-ctl">
          <button title="Bigger" onMouseDown={(e) => { e.preventDefault(); bump(1); }}>A<sup style={{ fontSize: 8 }}>+</sup></button>
          <span className="val">{fontSize ?? 11}</span>
        </span>
        <span className="size-ctl">
          <button title="Smaller" onMouseDown={(e) => { e.preventDefault(); bump(-1); }} style={{ fontSize: 11 }}>A<sup style={{ fontSize: 8 }}>−</sup></button>
          <button title="Shrink card (⌘8)" onMouseDown={(e) => { e.preventDefault(); run(falconKeys['Mod-8']); }} style={{ fontSize: 11, color: 'var(--chrome-dim)' }}>Shrink</button>
        </span>
      </div>
      {picker && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onMouseDown={() => setPicker(null)} />
          <div className="popover" style={{ left: picker.x, top: picker.y }}>
            <button className={`none${activeColors[picker.kind] === null ? ' cur' : ''}`} title={picker.kind === 'highlight' ? 'No highlight' : 'No background'} onMouseDown={(e) => { e.preventDefault(); props.onPick(picker.kind, null); setPicker(null); }} />
            {(picker.kind === 'highlight' ? Object.entries(HIGHLIGHTS) : SHADES.map((s) => [s, s])).map(([name, css]) => (
              <button key={name} title={name} className={activeColors[picker.kind] === name ? 'cur' : ''} style={{ background: css }} onMouseDown={(e) => { e.preventDefault(); props.onPick(picker.kind, name); setPicker(null); }} />
            ))}
          </div>
        </>
      )}
    </header>
  );
}

const SHADES = ['#D9D9D9', '#BFBFBF', '#F2F2F2', '#FFF2CC', '#FCE4D6', '#E2EFDA', '#DDEBF7', '#EDE7F6', '#FDE2E4', '#C6E0B4', '#BDD7EE', '#F8CBAD', '#FFE699', '#A9D08E', '#9BC2E6'];

function OutlineRows({ items, depth, cur, onJump }: { items: OutlineItem[]; depth: number; cur: number; onJump: (i: OutlineItem) => void }) {
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const [opened, setOpened] = useState<Set<number>>(new Set());
  useEffect(() => { setFolded(new Set()); setOpened(new Set()); }, [depth]);
  const rows: { item: OutlineItem; i: number; open: boolean }[] = [];
  let hideBelow = Infinity;
  items.forEach((item, i) => {
    if (item.level > hideBelow) return;
    hideBelow = Infinity;
    const visibleByDepth = item.level <= depth;
    if (!visibleByDepth) return;
    const open = item.hasKids && (folded.has(item.pos) ? false : item.level < depth || opened.has(item.pos));
    rows.push({ item, i, open });
    if (!open) hideBelow = item.level;
  });
  const toggle = (item: OutlineItem, open: boolean) => {
    if (open) { setFolded((s) => new Set(s).add(item.pos)); setOpened((s) => { const n = new Set(s); n.delete(item.pos); return n; }); }
    else { setOpened((s) => new Set(s).add(item.pos)); setFolded((s) => { const n = new Set(s); n.delete(item.pos); return n; }); }
  };
  return (
    <div className="rows">
      {rows.map(({ item, i, open }) => (
        <div key={item.pos} className={`orow l${item.level}${i === cur ? ' cur' : ''}`} style={{ paddingLeft: 4 + (item.level - 1) * 14 }}
          onMouseDown={(e) => { e.preventDefault(); onJump(item); }} onDoubleClick={() => item.hasKids && toggle(item, open)}>
          <span className="tw" onMouseDown={(e) => { if (item.hasKids) { e.preventDefault(); e.stopPropagation(); toggle(item, open); } }}>
            {item.hasKids && <Icon name={open ? 'chevron' : 'chevronRight'} />}
          </span>
          <span className={`t${item.text ? '' : ' empty'}`}>{item.text || 'Untitled'}</span>
          {item.level < 4 && item.cards > 0 && <span className="n">{item.cards}</span>}
        </div>
      ))}
    </div>
  );
}
