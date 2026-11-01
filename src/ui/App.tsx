import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { Node as PMNode } from 'prosemirror-model';
import { createState, createView, brushKey, emptyDoc } from '../editor/editor';
import { falconKeys } from '../editor/keymap';
import { activeColors, bridge, setActiveColor } from '../editor/host';
import { HIGHLIGHTS, schema, type ParaStyle } from '../editor/schema';
import { buildOutline, currentItem, readWords, type OutlineItem } from '../editor/outline';
import { toggleColorMark } from '../editor/commands';
import { selectionState } from './selection-state';
import { Icon, SvgIcon } from './icons';
import { openDocument, openPath, saveDocument, type DocMeta } from './files';
import { clearFind, findInfo, setQuery, step } from '../editor/find';
import { isReading, toggleRead } from '../editor/read';
import { Home } from './Home';
import { loadRecents, noteRecent, saveRecents, tidy, type Recent } from './recents';

const AUTOSAVE_KEY = 'falcon.autosave.v1';
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

// Above this size the JSON copy takes tens of ms and won't fit in browser storage anyway.
const AUTOSAVE_MAX = 400_000;

/** Crash-recovery copy of the open doc. Returns false when the doc is too big to keep a copy. */
function autosave(doc: PMNode): boolean {
  if (doc.content.size > AUTOSAVE_MAX) { localStorage.removeItem(AUTOSAVE_KEY); return false; }
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(doc.toJSON())); return true; }
  catch { localStorage.removeItem(AUTOSAVE_KEY); return false; }
}
const whenIdle = (f: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 0));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Smooth-scroll the page so `pos` sits just below the top. Paragraphs off screen have estimated
 *  heights (content-visibility), so the target moves as they render: the animation re-reads it every frame. */
let stopScroll = () => {};
function scrollToPos(view: EditorView, pos: number) {
  const sc = view.dom.closest('.f-scroll') as HTMLElement | null;
  const el = view.nodeDOM(pos) as HTMLElement | null;
  if (!sc || !el) return;
  stopScroll();
  const target = () => Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 16));
  if (reducedMotion()) { for (let i = 0; i < 4; i++) sc.scrollTop = target(); return; }
  const from = sc.scrollTop, t0 = performance.now();
  const dur = Math.min(700, 300 + Math.abs(target() - from) / 20);
  let raf = 0, still = 0;
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
    const goal = target();
    sc.scrollTop = from + (goal - from) * e;
    // keep going after the curve ends until the target stops moving
    if (t === 1) still = Math.abs(sc.scrollTop - goal) < 1 ? still + 1 : 0;
    if (still < 3) raf = requestAnimationFrame(step); else stopScroll();
  };
  // the user's own scrolling wins
  const cancel = () => stopScroll();
  stopScroll = () => { cancelAnimationFrame(raf); sc.removeEventListener('wheel', cancel); sc.removeEventListener('pointerdown', cancel); stopScroll = () => {}; };
  sc.addEventListener('wheel', cancel, { passive: true });
  sc.addEventListener('pointerdown', cancel);
  raf = requestAnimationFrame(step);
}

export function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [tick, setTick] = useState(0);
  const [docVersion, setDocVersion] = useState(0);
  const [showOutline, setShowOutline] = useState(() => localStorage.getItem('falcon.outline') !== 'off');
  const [depth, setDepth] = useState(() => Number(localStorage.getItem('falcon.depth')) || 3);
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('falcon.zoom')) || 1);
  const [meta, setMeta] = useState<DocMeta>(() => JSON.parse(localStorage.getItem('falcon.meta') ?? 'null') ?? { name: 'Untitled' });
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(true);
  const [recents, setRecents] = useState<Recent[]>(loadRecents);
  const [readTop, setReadTop] = useState(0); // doc position at the reading line (top of the page + 90px)
  const findRef = useRef<HTMLInputElement>(null);
  const lastDoc = useRef<PMNode | null>(null);

  const warnedBig = useRef(false);
  const warnBig = () => {
    if (warnedBig.current) return;
    warnedBig.current = true;
    flashRef.current?.(`This file is too big for crash recovery. Save often (${MOD}S).`);
  };
  const flashRef = useRef<((m: string) => void) | null>(null);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), msg.includes('crash recovery') ? 6000 : 2200);
  }, []);
  flashRef.current = flash;

  useEffect(() => {
    let doc: PMNode | undefined;
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) doc = PMNode.fromJSON(schema, JSON.parse(saved));
    } catch { /* corrupt autosave: start blank */ }
    // a recovered doc isn't saved anywhere yet, so New/Open must ask before dropping it
    if (doc && doc.textContent.trim()) setDirty(true);
    let saveTimer = 0, outlineTimer = 0;
    const view = createView(mountRef.current!, (v) => {
      setTick((t) => t + 1);
      if (v.state.doc !== lastDoc.current) {
        lastDoc.current = v.state.doc;
        setDirty(true);
        // the outline and word count walk the whole doc: refresh them when typing pauses, not per keystroke
        window.clearTimeout(outlineTimer);
        outlineTimer = window.setTimeout(() => setDocVersion((n) => n + 1), 150);
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => whenIdle(() => { if (!autosave(v.state.doc)) warnBig(); }), 800);
      }
    }, doc);
    lastDoc.current = view.state.doc;
    viewRef.current = view;
    setTick(1);
    return () => view.destroy();
  }, []);

  useEffect(() => { document.documentElement.style.setProperty('--zoom', String(zoom)); localStorage.setItem('falcon.zoom', String(zoom)); }, [zoom]);
  useEffect(() => { localStorage.setItem('falcon.outline', showOutline ? 'on' : 'off'); }, [showOutline]);
  useEffect(() => { localStorage.setItem('falcon.depth', String(depth)); }, [depth]);
  useEffect(() => { localStorage.setItem('falcon.meta', JSON.stringify(meta)); }, [meta]);
  useEffect(() => { saveRecents(recents); }, [recents]);
  const view = viewRef.current;
  // home covers the editor: the editor gives up the keyboard while it shows, and gets it back after
  const hasView = tick > 0;
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    if (homeOpen) (v.dom as HTMLElement).blur(); else v.focus();
  }, [homeOpen, hasView]);

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
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    const backedUp = autosave(doc);
    warnedBig.current = !backedUp; // the open message carries the warning
    setHomeOpen(false);
    v.focus();
    setTick((t) => t + 1);
    return backedUp;
  }, []);

  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const okToDiscard = () => !dirtyRef.current || window.confirm('Discard unsaved changes?');
  const opened = useCallback((r: { doc: PMNode; meta: DocMeta }) => {
    setRecents((list) => noteRecent(list, r.doc, r.meta));
    flash(replaceDoc(r.doc, r.meta) ? `Opened ${r.meta.name}` : `Opened ${r.meta.name}. It's too big for crash recovery, so save often (${MOD}S).`);
  }, [replaceDoc, flash]);
  const fileNew = useCallback(() => { if (okToDiscard()) replaceDoc(emptyDoc(), { name: 'Untitled' }); }, [replaceDoc]);
  const fileOpen = useCallback(async () => {
    if (!okToDiscard()) return;
    try {
      const r = await openDocument();
      if (r) opened(r);
    } catch (e) { flash(`Couldn't open: ${(e as Error).message}`); }
  }, [opened, flash]);
  const openRecent = useCallback(async (r: Recent) => {
    if (r.path && r.path === meta.path) { setHomeOpen(false); return; }
    if (!r.path || !bridge.openPath) { void fileOpen(); return; }
    if (!okToDiscard()) return;
    try { opened(await openPath(r.path)); } catch (e) { flash(`Couldn't open ${r.name}: ${(e as Error).message}`); }
  }, [meta.path, opened, fileOpen, flash]);
  const fileSave = useCallback(async (as = false) => {
    const v = viewRef.current!;
    const saved = v.state.doc;
    try {
      const m = await saveDocument(saved, meta, as);
      // typing during the save keeps the doc marked unsaved
      if (m) { setMeta(m); setDirty(v.state.doc !== saved); setRecents((list) => noteRecent(list, saved, m)); flash(`Saved ${m.name}`); }
    } catch (e) { flash(`Couldn't save: ${(e as Error).message}`); }
  }, [meta, flash]);

  const openFind = useCallback(() => { setHomeOpen(false); setFindOpen(true); setTimeout(() => { findRef.current?.focus(); findRef.current?.select(); }, 0); }, []);

  // app-level shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey; // Ctrl-N/O/F are caret keys on macOS
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); void fileSave(e.shiftKey); }
      else if (mod && k === 'f') { e.preventDefault(); openFind(); }
      else if (mod && k === 'o') { e.preventDefault(); void fileOpen(); }
      else if (mod && k === 'n' && !e.shiftKey) { e.preventDefault(); fileNew(); }
      else if (mod && k === 't' && !e.shiftKey) { e.preventDefault(); setHomeOpen((h) => !h); }
      else if (mod && e.key === '\\') { e.preventDefault(); setShowOutline((s) => !s); }
      else if (e.key === 'Escape' && homeRef.current) { e.preventDefault(); e.stopPropagation(); setHomeOpen(false); }
      else if (mod && (e.key === '=' || e.key === '+') && !e.shiftKey) { e.preventDefault(); setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2))); }
      else if (mod && e.key === '-') { e.preventDefault(); setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2))); }
      else if (mod && e.key === '0') { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fileSave, fileOpen, fileNew, openFind]);
  const homeRef = useRef(homeOpen);
  homeRef.current = homeOpen;

  const sel = useMemo(() => (view ? selectionState(view.state) : null), [view, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outline = useMemo(() => (view ? buildOutline(view.state.doc) : []), [view, docVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const words = useMemo(() => (view ? readWords(view.state.doc) : 0), [view, docVersion]);
  const brush = view ? brushKey.getState(view.state)?.kind ?? null : null;

  // the block you're reading is the last heading above the reading line, so the outline follows the scroll
  const measureRead = useCallback(() => {
    const v = viewRef.current, sc = scrollRef.current;
    if (!v || !sc) return;
    const pm = v.dom.getBoundingClientRect(), top = sc.getBoundingClientRect().top + 90;
    if (pm.top > top) { setReadTop(0); return; }
    const hit = v.posAtCoords({ left: pm.left + 4, top: Math.min(top, pm.bottom - 2) });
    setReadTop(hit ? hit.pos : v.state.doc.content.size);
  }, []);
  useEffect(() => {
    const sc = scrollRef.current!;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measureRead); };
    sc.addEventListener('scroll', on, { passive: true });
    return () => { sc.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
  }, [measureRead]);
  useEffect(() => { requestAnimationFrame(measureRead); }, [docVersion, zoom, measureRead]);
  const cur = outline.length ? Math.max(0, currentItem(outline, readTop)) : -1;

  const jump = useCallback((stale: OutlineItem, index: number) => {
    const v = viewRef.current!;
    const item = buildOutline(v.state.doc)[index] ?? stale;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, item.pos + 1)));
    (v.dom as HTMLElement).focus({ preventScroll: true });
    scrollToPos(v, item.pos);
  }, []);

  const colorButton = (kind: 'highlight' | 'shading') => {
    const v = viewRef.current;
    if (!v) return;
    if (v.state.selection.empty) {
      // nothing selected: arm (or disarm) the paintbrush
      v.dispatch(v.state.tr.setMeta(brushKey, brush === kind ? null : kind));
      v.focus();
    } else run(falconKeys[kind === 'highlight' ? 'F11' : 'Mod-F11']);
  };

  const ink = activeColors.highlight === null ? '#00e5ff' : HIGHLIGHTS[activeColors.highlight] ?? activeColors.highlight;
  const reading = view ? isReading(view.state) : false;
  const name = meta.name || 'Untitled';

  return (
    <div className={`app${showOutline ? '' : ' no-outline'}`} style={{ '--ink': ink } as React.CSSProperties}>
      <Files current={{ name, path: meta.path }} recents={recents}
        onHome={() => setHomeOpen(true)} onSearch={openFind} onRecent={(r) => void openRecent(r)} onCurrent={() => setHomeOpen(false)} />

      <Toolbar
        sel={sel}
        run={run}
        brush={brush}
        onColor={colorButton}
        onPick={(kind, c) => { setActiveColor(kind, c); setTick((t) => t + 1); const v = viewRef.current; if (v && !v.state.selection.empty) run(falconKeys[kind === 'highlight' ? 'F11' : 'Mod-F11']); }}
        flash={flash}
        reading={reading}
        onRead={() => run(toggleRead)}
      />

      <OutlinePane name={name} dirty={dirty} shown={showOutline} items={outline} depth={depth} cur={cur}
        onDepth={setDepth} onJump={jump} onShow={setShowOutline} />

      <div ref={scrollRef} className="f-scroll" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); viewRef.current?.focus(); } }}>
        <div className="page"><div ref={mountRef} /></div>
      </div>
      {findOpen && view && (
        <div className="findbar">
          <SvgIcon name="search" />
          <input ref={findRef} placeholder="Find" defaultValue={findInfo(view.state)?.query ?? ''}
            onChange={(e) => setQuery(view, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); step(view, e.shiftKey ? -1 : 1); }
              else if (e.key === 'Escape') { e.preventDefault(); clearFind(view); setFindOpen(false); view.focus(); }
            }} />
          <span className="count">{(() => { const f = findInfo(view.state); return f && f.query ? (f.matches.length ? `${f.index + 1}/${f.matches.length}` : 'No results') : ''; })()}</span>
          <button title="Previous (Shift-Enter)" onMouseDown={(e) => { e.preventDefault(); step(view, -1); }}><Icon name="chevronUp" /></button>
          <button title="Next (Enter)" onMouseDown={(e) => { e.preventDefault(); step(view, 1); }}><Icon name="chevron" /></button>
          <button title="Close (Esc)" onMouseDown={(e) => { e.preventDefault(); clearFind(view); setFindOpen(false); view.focus(); }}><Icon name="x" /></button>
        </div>
      )}

      <footer className="status">
        <span>Σ</span>
        <span>Doc: {words.toLocaleString('en-US')} · Reader 1: {mmss(words / 200)} · Reader 2: {mmss(words / 300)}{sel && sel.selWords ? ` | Sel: ${sel.selWords}` : ''}</span>
        {brush && <span className="lit">Paintbrush on · Esc to stop</span>}
        {reading && <span className="lit">Read mode · keyboard locked · Space drops a marker</span>}
        <span className="grow" />
        <button title={`Zoom out (${MOD}−)`} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}>−</button>
        <button className="zoom" title={`Actual size (${MOD}0)`} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button title={`Zoom in (${MOD}+)`} onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}>+</button>
      </footer>

      <Home open={homeOpen} current={dirty || meta.path ? name : ''} recents={recents}
        onNew={fileNew} onOpen={() => void fileOpen()} onRecent={(r) => void openRecent(r)}
        onClear={(keep) => setRecents(keep ?? [])} />
      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </div>
  );
}

const mmss = (min: number) => { const s = Math.round(min * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- files: a slim strip on the far left; hovering it slides the files panel out ----------

function Files(props: { current: { name: string; path?: string }; recents: Recent[]; onHome: () => void; onSearch: () => void; onRecent: (r: Recent) => void; onCurrent: () => void }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const stripRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const others = props.recents.filter((r) => !(props.current.path ? r.path === props.current.path : !r.path && r.name === props.current.name)).slice(0, 8);
  const enter = () => { clearTimeout(timer.current); setOpen(true); };
  const leave = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), 180); };
  const pick = (f: () => void) => () => { clearTimeout(timer.current); setOpen(false); f(); };

  // each strip icon sits at the height of its row in the panel, so opening the panel reads as the strip widening
  useLayoutEffect(() => {
    const strip = stripRef.current!, panel = panelRef.current!;
    const align = () => {
      const mid = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
      strip.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => {
        const y = mid(panel.querySelector(`[data-k="${b.dataset.k}"]`));
        if (y !== null) b.style.top = `${Math.round(y - b.offsetHeight / 2)}px`;
      });
    };
    align();
    addEventListener('resize', align);
    return () => removeEventListener('resize', align);
  });

  const row = (k: string, label: string, onClick: () => void, on = false) => (
    <button key={k} className="sb-row" data-k={k} data-on={on || undefined} onClick={pick(onClick)}>
      <span className="ic"><SvgIcon name="doc" /></span><span className="nm">{tidy(label)}</span>
    </button>
  );
  return (
    <>
      <nav ref={stripRef} className="fstrip" aria-label="Files" onPointerEnter={enter} onPointerLeave={leave}>
        <button className="sb-logo" data-k="logo" title={`Home (${MOD}T)`} onClick={pick(props.onHome)}><SvgIcon name="logo" /></button>
        <button className="fs-b" data-k="search" title={`Find (${MOD}F)`} onClick={pick(props.onSearch)}><SvgIcon name="search" /></button>
        <button className="fs-b" data-k="cur" data-on="" title={props.current.name} onClick={pick(props.onCurrent)}><SvgIcon name="doc" /></button>
        {others.map((r, i) => <button key={i} className="fs-b" data-k={`r${i}`} title={r.name} onClick={pick(() => props.onRecent(r))}><SvgIcon name="doc" /></button>)}
      </nav>
      <aside ref={panelRef} className={`rail-panel${open ? ' open' : ''}`} onPointerEnter={enter} onPointerLeave={leave} aria-hidden={!open}>
        <div className="sb-head"><button className="sb-logo" data-k="logo" onClick={pick(props.onHome)}><SvgIcon name="logo" /></button><button className="sb-name" onClick={pick(props.onHome)}>Falcon</button></div>
        <button className="sb-search" data-k="search" onClick={pick(props.onSearch)}><SvgIcon name="search" /><span>Find</span><kbd>{MOD}F</kbd></button>
        <div className="sb-scroll">
          <div className="sb-label">Open</div>
          <div className="sb-list">{row('cur', props.current.name, props.onCurrent, true)}</div>
          {others.length > 0 && <>
            <div className="sb-label">Recent</div>
            <div className="sb-list">{others.map((r, i) => (
              <button key={i} className="sb-row" data-k={`r${i}`} onClick={pick(() => props.onRecent(r))} title={r.folder ? `${r.folder}/${r.name}` : r.name}>
                <span className="ic"><SvgIcon name="doc" /></span><span className="nm">{tidy(r.name)}</span>{r.cards > 0 && <span className="ct">{r.cards}</span>}
              </button>
            ))}</div>
          </>}
        </div>
      </aside>
    </>
  );
}

// ---------- the top bar: the Classic layout, a two-row grid where each button previews its style ----------

type SelState = ReturnType<typeof selectionState>;
type PopKind = 'highlight' | 'shading' | 'font';
const SHADES = ['#D9D9D9', '#BFBFBF', '#F2F2F2', '#FFF2CC', '#FCE4D6', '#E2EFDA', '#DDEBF7', '#EDE7F6', '#FDE2E4', '#C6E0B4', '#BDD7EE', '#F8CBAD', '#FFE699', '#A9D08E', '#9BC2E6'];
const FONT_COLORS: [string | null, string][] = [[null, 'Automatic'], ['#1F3864', 'Dark blue'], ['#385623', 'Dark green'], ['#C00000', 'Dark red'], ['#FF0000', 'Red']];
const SPEECH_SECONDS = 8 * 60;

function Toolbar(props: { sel: SelState | null; run: (c: Command) => void; brush: string | null; onColor: (k: 'highlight' | 'shading') => void; onPick: (k: 'highlight' | 'shading', c: string | null) => void; flash: (m: string) => void; reading: boolean; onRead: () => void }) {
  const { sel, run } = props;
  const [pop, setPop] = useState<{ kind: PopKind; x: number; y: number; origin: number } | null>(null);
  const [fontColor, setFontColor] = useState<string | null>(() => localStorage.getItem('falcon.fontColor'));
  const popRef = useRef<HTMLDivElement>(null);

  const style = (s: ParaStyle, key: string, label: string, cls: string) => (
    <button className="b" data-on={sel?.style === s || undefined} title={`${label} (${key})`} onMouseDown={(e) => { e.preventDefault(); run(falconKeys[key]); }}>
      <span className={cls}>{label}</span>
    </button>
  );
  const mark = (name: string, key: string, label: string, cls: string) => (
    <button className="b" data-on={sel?.marks.has(name) || undefined} title={`${label} (${key})`} onMouseDown={(e) => { e.preventDefault(); run(falconKeys[key]); }}>
      <span className={cls}>{label}</span>
    </button>
  );
  const openPop = (kind: PopKind, t: HTMLElement) => {
    if (pop?.kind === kind) { setPop(null); return; }
    const r = t.getBoundingClientRect();
    setPop({ kind, x: r.left + r.width / 2, y: r.bottom + 6, origin: 0 });
  };
  // center the popover under its caret, inside the window
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el || !pop) return;
    const w = el.offsetWidth, x = Math.max(8, Math.min(pop.x - w / 2, innerWidth - w - 8));
    el.style.left = `${x}px`;
    el.style.transformOrigin = `${pop.x - x}px 0`;
    requestAnimationFrame(() => el.classList.add('in'));
  }, [pop]);
  useEffect(() => {
    if (!pop) return;
    const down = (e: PointerEvent) => { if (!popRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-pop]')) setPop(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPop(null); };
    const close = () => setPop(null);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); removeEventListener('resize', close); };
  }, [pop]);

  const swatch = (kind: 'highlight' | 'shading') => {
    const c = activeColors[kind];
    return c === null ? undefined : kind === 'highlight' ? HIGHLIGHTS[c] ?? c : c;
  };
  const pair = (kind: PopKind, glyph: React.ReactNode, label: string, onMain: () => void, bar: string | undefined, armed = false) => (
    <span className="pair">
      <button className="b ic" data-on={armed || undefined} aria-label={label} title={label} onMouseDown={(e) => { e.preventDefault(); onMain(); }}>
        <span className="glyph">{glyph}<i className={bar === undefined ? 'none' : ''} style={{ background: bar }} /></span>
      </button>
      <button className="b cr" data-pop={kind} aria-label={`${label} options`} aria-haspopup="menu" aria-expanded={pop?.kind === kind}
        onMouseDown={(e) => { e.preventDefault(); openPop(kind, e.currentTarget); }}><SvgIcon name="caret" /></button>
    </span>
  );
  const applyFont = (c: string | null) => run(toggleColorMark(schema.marks.color, c));

  const STYLE_PT: Record<string, number> = { pocket: 26, hat: 22, block: 16, tag: 13, analytic: 13 };
  const fontSize = sel?.size ?? (sel?.marks.has('cite') ? 13 : STYLE_PT[sel?.style ?? ''] ?? null);
  const bump = (d: number) => run((state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (empty) return false;
    const base = fontSize ?? 11;
    const next = Math.max(4, Math.min(72, base + d));
    dispatch?.(state.tr.addMark(from, to, schema.marks.size.create({ pt: next })));
    return true;
  });

  // the speech timer: click to start or pause, right-click to reset
  const [left, setLeft] = useState(SPEECH_SECONDS);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setLeft((s) => {
      if (s <= 1) { setRunning(false); props.flash('Time is up'); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [running]);

  return (
    <header className="toolbar">
      <div className="bar">
        <div className="g">
          {style('pocket', 'F4', 'Pocket', 'pv box')}{style('tag', 'F7', 'Tag', 'pv')}
          {style('hat', 'F5', 'Hat', 'pv uu')}{style('block', 'F6', 'Block', 'pv u')}
          {style('analytic', 'Mod-F7', 'Analytic', 'pv an')}{style('undertag', 'Mod-F8', 'Undertag', 'ut')}
        </div>
        <div className="g">
          {mark('cite', 'F8', 'Cite', 'pv')}{mark('underline', 'F9', 'Underline', 'u')}
          {mark('emphasis', 'F10', 'Emphasis', 'pv u box')}
          <button className="b" title="Clear (F12)" onMouseDown={(e) => { e.preventDefault(); run(falconKeys.F12); }}>Clear</button>
        </div>
        <div className="g">
          {pair('highlight', <SvgIcon name="pen" />, 'Highlight (F11): with nothing selected, a paintbrush', () => props.onColor('highlight'), swatch('highlight'), props.brush === 'highlight')}
          {pair('shading', <SvgIcon name="bucket" />, `Background color (${MOD}F11)`, () => props.onColor('shading'), swatch('shading'), props.brush === 'shading')}
          {pair('font', <b className="fa">A</b>, 'Font color', () => applyFont(fontColor), fontColor ?? '#ececee')}
          <button className="b sm" title={`Shrink card (${MOD}8)`} onMouseDown={(e) => { e.preventDefault(); run(falconKeys['Mod-8']); }}>Shrink</button>
          <button className="b sz" title={`Bigger (${fontSize ?? 11} pt)`} onMouseDown={(e) => { e.preventDefault(); bump(1); }}>A<SvgIcon name="up" /></button>
          <button className="b sz" title={`Smaller (${fontSize ?? 11} pt)`} onMouseDown={(e) => { e.preventDefault(); bump(-1); }}>A<SvgIcon name="caret" /></button>
        </div>
        <div className="end">
          <button className="b" data-on={props.reading || undefined} title={`Read mode (${IS_MAC ? '⌘⇧R' : 'Ctrl+Shift+R'}): only what's read aloud, keyboard locked; Space drops a marker`} onMouseDown={(e) => { e.preventDefault(); props.onRead(); }}>Read</button>
          <button className="b timer" data-on={running || undefined} title="Speech timer: click to start or pause, right-click to reset"
            onMouseDown={(e) => { e.preventDefault(); if (e.button === 0) { if (left === 0) setLeft(SPEECH_SECONDS); setRunning((r) => !r); } }}
            onContextMenu={(e) => { e.preventDefault(); setRunning(false); setLeft(SPEECH_SECONDS); }}>
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </button>
        </div>
      </div>
      {pop && (
        <div ref={popRef} key={pop.kind} className="pop" role="menu" style={{ top: pop.y }}>
          {pop.kind === 'font'
            ? FONT_COLORS.map(([c, n]) => (
              <button key={n} className="sw" role="menuitem" aria-label={n} title={n} aria-current={fontColor === c || undefined} style={{ background: c ?? '#222222' }}
                onMouseDown={(e) => { e.preventDefault(); setFontColor(c); if (c) localStorage.setItem('falcon.fontColor', c); else localStorage.removeItem('falcon.fontColor'); setPop(null); applyFont(c); }} />
            ))
            : <>
              <button className="sw none" role="menuitem" aria-label={pop.kind === 'highlight' ? 'No highlight' : 'No background'} title={pop.kind === 'highlight' ? 'No highlight' : 'No background'}
                aria-current={activeColors[pop.kind] === null || undefined} onMouseDown={(e) => { e.preventDefault(); props.onPick(pop.kind as 'highlight', null); setPop(null); }} />
              {(pop.kind === 'highlight' ? Object.entries(HIGHLIGHTS) : SHADES.map((s) => [s, s])).map(([n, css]) => (
                <button key={n} className="sw" role="menuitem" aria-label={n} title={n} aria-current={activeColors[pop.kind as 'highlight'] === n || undefined} style={{ background: css }}
                  onMouseDown={(e) => { e.preventDefault(); props.onPick(pop.kind as 'highlight', n); setPop(null); }} />
              ))}
            </>}
        </div>
      )}
    </header>
  );
}

// ---------- the outline: attached to the document, docked on the page's left edge ----------

function OutlinePane(props: { name: string; dirty: boolean; shown: boolean; items: OutlineItem[]; depth: number; cur: number; onDepth: (n: number) => void; onJump: (item: OutlineItem, index: number) => void; onShow: (s: boolean) => void }) {
  const { shown, items, cur } = props;
  const [peek, setPeek] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const timer = useRef(0);
  const lvRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLSpanElement>(null);
  const peekOn = () => { if (shown) return; clearTimeout(timer.current); setPeek(true); };
  const peekOff = () => { if (shown) return; clearTimeout(timer.current); timer.current = window.setTimeout(() => setPeek(false), 180); };
  useEffect(() => { setPeek(false); }, [shown]);
  // the 1-4 highlight slides to the chosen level
  useLayoutEffect(() => {
    const b = lvRef.current?.querySelector<HTMLElement>(`[data-lv="${props.depth}"]`);
    if (b && hlRef.current) hlRef.current.style.transform = `translateX(${b.offsetLeft - 2}px)`;
  }, [props.depth, shown, peek]);
  // hidden: a strip of ticks, one per hat and block, on the page's edge
  const ticks = useMemo(() => items.map((it, i) => ({ it, i })).filter(({ it }) => it.level === 2 || it.level === 3), [items]);
  const curBlock = useMemo(() => { let b = -1; for (const t of ticks) { if (t.i <= cur) b = t.i; else break; } return b; }, [ticks, cur]);
  const open = shown || peek;
  return (
    <>
      <aside className={`olp${shown ? ' shown' : ''}${peek ? ' peek' : ''}`} aria-hidden={!open} onPointerEnter={peekOn} onPointerLeave={peekOff}>
        <div className="olp-head">
          <span className="olp-name" title={props.name}>{tidy(props.name)}{props.dirty ? ' •' : ''}</span>
          <button className="sb-ico" title={shown ? `Hide outline (${MOD}\\)` : `Keep the outline open (${MOD}\\)`} onClick={() => props.onShow(!shown)}><SvgIcon name={shown ? 'x' : 'plus'} /></button>
        </div>
        <div className="sb-scroll">
          <div className="ol-head">
            <span className="sb-label">Outline</span>
            <div ref={lvRef} className="lv" role="group" aria-label="Outline depth">
              <span ref={hlRef} className="lv-hl" />
              {[1, 2, 3, 4].map((l) => <button key={l} data-lv={l} data-on={props.depth === l || undefined} aria-label={`Show ${['pockets', 'hats', 'blocks', 'tags'][l - 1]}`} onClick={() => props.onDepth(l)}>{l}</button>)}
            </div>
            <button className="sb-ico" title="Filter outline" onClick={() => setQuery((q) => (q === null ? '' : null))}><SvgIcon name="search" /></button>
          </div>
          {query !== null && <input className="ol-q" autoFocus placeholder="Filter this outline" aria-label="Filter outline" spellCheck={false} value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null); } }} />}
          <OutlineRows items={items} depth={props.depth} cur={cur} query={(query ?? '').trim().toLowerCase()} onJump={props.onJump} visible={open} />
        </div>
      </aside>
      <div className={`olt${shown ? '' : ' shown'}`} title={`Show outline (${MOD}\\)`} onPointerEnter={peekOn} onPointerLeave={peekOff} onClick={() => props.onShow(true)}>
        <div className="rail-ticks">
          {ticks.map(({ it, i }) => <span key={it.pos} className={`rail-tick ${it.level === 2 ? 'h' : 'b'}`} data-on={i === curBlock || undefined} />)}
        </div>
      </div>
    </>
  );
}

const OutlineRows = memo(function OutlineRows({ items, depth, cur, query, onJump, visible }: { items: OutlineItem[]; depth: number; cur: number; query: string; onJump: (item: OutlineItem, index: number) => void; visible: boolean }) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const actRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  // folds follow the heading (level + text), so typing above it doesn't move them to another heading
  const keyOf = (item: OutlineItem) => `${item.level}:${item.text}`;
  useEffect(() => { setFolded(new Set()); setOpened(new Set()); }, [depth]);

  // filtering keeps a heading when it or anything under it matches, and opens everything
  const keep = useMemo(() => {
    if (!query) return null;
    const k = items.map((it) => it.text.toLowerCase().includes(query));
    const stack: number[] = [];
    items.forEach((it, i) => {
      while (stack.length && items[stack[stack.length - 1]].level >= it.level) stack.pop();
      if (k[i]) stack.forEach((s) => (k[s] = true));
      stack.push(i);
    });
    return k;
  }, [items, query]);

  const rows: { item: OutlineItem; i: number; open: boolean }[] = [];
  let hideBelow = Infinity;
  items.forEach((item, i) => {
    if (keep) { if (keep[i]) rows.push({ item, i, open: item.hasKids }); return; }
    if (item.level > hideBelow) return;
    hideBelow = Infinity;
    if (item.level > depth) return;
    const open = item.hasKids && (folded.has(keyOf(item)) ? false : item.level < depth || opened.has(keyOf(item)));
    rows.push({ item, i, open });
    if (!open) hideBelow = item.level;
  });
  const toggle = (item: OutlineItem, open: boolean) => {
    const k = keyOf(item);
    if (open) { setFolded((s) => new Set(s).add(k)); setOpened((s) => { const n = new Set(s); n.delete(k); return n; }); }
    else { setOpened((s) => new Set(s).add(k)); setFolded((s) => { const n = new Set(s); n.delete(k); return n; }); }
  };

  // the row to light: the current heading, or the nearest shown heading above it when it's folded away
  let lit = -1;
  if (cur >= 0) {
    const shownIdx = new Set(rows.map((r) => r.i));
    let level = Infinity;
    for (let i = cur; i >= 0; i--) {
      if (items[i].level < level || i === cur) {
        if (shownIdx.has(i)) { lit = i; break; }
        level = Math.min(level, items[i].level);
      }
    }
  }

  // one lit pill slides to the active row; the list scrolls to keep it in view
  useLayoutEffect(() => {
    const list = listRef.current, act = actRef.current;
    if (!list || !act) return;
    const row = list.querySelector<HTMLElement>(`[data-i="${lit}"]`);
    if (!row) { act.style.opacity = '0'; return; }
    act.style.height = `${row.offsetHeight}px`;
    act.style.transform = `translateY(${row.offsetTop}px)`;
    act.style.opacity = '1';
    if (!visible) return;
    const s = list.closest('.sb-scroll') as HTMLElement | null;
    if (!s) return;
    const rt = row.getBoundingClientRect(), st = s.getBoundingClientRect();
    if (rt.top < st.top + 40 || rt.bottom > st.bottom - 40) s.scrollTo({ top: s.scrollTop + rt.top - st.top - st.height / 3, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
  // the pill only animates after the first placement
  useEffect(() => { const r = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true))); return () => cancelAnimationFrame(r); }, []);

  if (!rows.length) return <div className="ol-none">{query ? 'Nothing in this file matches.' : 'Pockets, hats, blocks and tags show up here.'}</div>;
  return (
    <div ref={listRef} className="sb-list" data-ready={ready || undefined}>
      <span ref={actRef} className="sb-act" />
      {rows.map(({ item, i, open }) => (
        <button key={item.pos} data-i={i} className={`sb-row ol l${item.level}`} data-on={i === lit || undefined} aria-expanded={item.hasKids ? open : undefined}
          style={{ paddingLeft: 6 + (item.level - 1) * 14 }}
          onMouseDown={(e) => { e.preventDefault(); if ((e.target as HTMLElement).closest('[data-tw]') && item.hasKids && !keep) toggle(item, open); else onJump(item, i); }}
          onDoubleClick={() => item.hasKids && !keep && toggle(item, open)}>
          {item.hasKids ? <span className="ic tw" data-tw><SvgIcon name="chev" /></span> : <span className="ic sp" />}
          <span className={`nm${item.text ? '' : ' empty'}`}>{tidy(item.text) || 'Untitled'}</span>
          {item.level < 4 && item.cards > 0 && <span className="ct">{item.cards}</span>}
        </button>
      ))}
    </div>
  );
});
