import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import { TextSelection, type EditorState } from 'prosemirror-state';
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
import { clearFind, findInfo } from '../editor/find';
import { isReading, toggleRead } from '../editor/read';
import { Home } from './Home';
import { Settings } from './Settings';
import { Confirm, nameList, type Ask } from './Confirm';
import { Tips, parseTip } from './Tips';
import { OutlinePane } from './Outline';
import { FindBar } from './FindBar';
import { outlineNumbers } from '../editor/nav/numbering';
import { DOC_TOOLS } from '../editor/doc-tools';
import { CARD_TOOLS } from '../editor/card-tools';
import type { ToolSection } from '../editor/tools';
import { loadRecents, noteRecent, saveRecents, tidy, type Recent } from './recents';
import { P, onPrefs, pref } from '../editor/prefs';

const AUTOSAVE_KEY = 'falcon.autosave.v2'; // [{ meta, doc, active, dirty }]: the open doc and every unsaved one
const OLD_AUTOSAVE_KEY = 'falcon.autosave.v1'; // one doc, before several could be open
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

// Above this size the JSON copy takes tens of ms and won't fit in browser storage anyway.
const AUTOSAVE_MAX = 400_000;

type Backup = { meta: DocMeta; doc: PMNode; active: boolean; dirty?: boolean };
/** Crash-recovery copy of the open doc and every unsaved one. Docs too big to keep are left out;
 *  returns false when the active doc was one of them. */
function autosave(list: Backup[]): boolean {
  if (!pref(P.crashRecovery)) { localStorage.removeItem(AUTOSAVE_KEY); return true; } // turned off in Settings
  const keep = list.filter((b) => b.doc.content.size <= AUTOSAVE_MAX);
  const write = (l: Backup[]) => localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(l.map((b) => ({ meta: b.meta, active: b.active, dirty: b.dirty, doc: b.doc.toJSON() }))));
  try { write(keep); }
  catch { // storage full: the active doc alone is the most useful copy
    try { write(keep.filter((b) => b.active)); } catch { localStorage.removeItem(AUTOSAVE_KEY); return false; }
  }
  localStorage.removeItem(OLD_AUTOSAVE_KEY);
  return keep.some((b) => b.active);
}
function loadBackups(): Backup[] {
  if (!pref(P.crashRecovery)) { localStorage.removeItem(AUTOSAVE_KEY); return []; } // turned off in Settings
  try {
    const v2 = localStorage.getItem(AUTOSAVE_KEY);
    if (v2) return (JSON.parse(v2) as { meta: DocMeta; doc: unknown; active: boolean; dirty?: boolean }[]).map((b) => ({ ...b, doc: PMNode.fromJSON(schema, b.doc) }));
    const v1 = localStorage.getItem(OLD_AUTOSAVE_KEY);
    if (v1) return [{ meta: JSON.parse(localStorage.getItem('falcon.meta') ?? 'null') ?? { name: 'Untitled' }, doc: PMNode.fromJSON(schema, JSON.parse(v1)), active: true }];
  } catch { /* corrupt autosave: start blank */ }
  return [];
}
const whenIdle = (f: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 0));
const reducedMotion = () => pref(P.reduceMotion) || matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    if (!el.isConnected) { stopScroll(); return; }
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

/** One open document. The active one lives in the editor view; the others keep their state (undo history included) here. */
type OpenDoc = { id: number; meta: DocMeta; dirty: boolean; state: EditorState | null; scroll: number };
let nextDocId = 2;

export function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [tick, setTick] = useState(0);
  const [docVersion, setDocVersion] = useState(0);
  const [showOutline, setShowOutline] = useState(() => localStorage.getItem('falcon.outline') !== 'off');
  const [depth, setDepth] = useState(() => Number(localStorage.getItem('falcon.depth')) || 3);
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('falcon.zoom')) || 1);
  const [speechMin, setSpeechMin] = useState(() => Number(localStorage.getItem('falcon.speech')) || 8);
  const [docs, setDocs] = useState<OpenDoc[]>(() => [{ id: 1, meta: JSON.parse(localStorage.getItem('falcon.meta') ?? 'null') ?? { name: 'Untitled' }, dirty: false, state: null, scroll: 0 }]);
  const [activeId, setActiveId] = useState(1);
  const activeRef = useRef(1);
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const active = docs.find((d) => d.id === activeId) ?? docs[0];
  const meta = active.meta, dirty = active.dirty;
  const [toast, setToast] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(() => pref(P.openHome));
  const [settingsOpen, setSettingsOpen] = useState(false);
  // the open warning dialog, if any: everything else waits for it
  const [ask, setAsk] = useState<Ask | null>(null);
  const askRef = useRef(ask);
  askRef.current = ask;
  const confirmAsk = useCallback((a: Omit<Ask, 'done'>) => new Promise<boolean>((resolve) => {
    askRef.current?.done(false);
    setAsk({ ...a, done: (yes) => { setAsk(null); resolve(yes); } });
  }), []);
  const [recents, setRecents] = useState<Recent[]>(loadRecents);
  const [curItem, setCurItem] = useState(-1); // the outline row to light (see measureRead)
  const findRef = useRef<HTMLInputElement>(null);
  const lastDoc = useRef<PMNode | null>(null);

  const patch = useCallback((id: number, p: Partial<OpenDoc>) => setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d))), []);

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

  /** Back up the active doc and every unsaved one (state is read from refs, so call it after renders). */
  const backup = useCallback(() => autosave(docsRef.current.flatMap((d) => {
    const isActive = d.id === activeRef.current;
    const doc = isActive ? viewRef.current?.state.doc : d.state?.doc;
    return doc && (isActive || d.dirty) ? [{ meta: d.meta, doc, active: isActive, dirty: d.dirty }] : [];
  })), []);
  const backupSoon = useRef(() => {});
  useEffect(() => {
    const backups = loadBackups();
    const first = backups.find((b) => b.active) ?? backups[0];
    const doc = first?.doc;
    // a recovered doc with unsaved changes must ask before closing; the file you last had open, untouched
    // since its save, comes back clean (backups from before the flag guess: anything with text is unsaved)
    const restored: OpenDoc[] = backups.map((b) => ({ id: b === first ? 1 : nextDocId++, meta: b.meta, dirty: b.dirty ?? (b !== first || !!b.doc.textContent.trim()), state: b === first ? null : createState(b.doc), scroll: 0 }));
    if (restored.length) setDocs(restored);
    let saveTimer = 0, outlineTimer = 0;
    backupSoon.current = () => { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => whenIdle(() => { if (!backup()) warnBig(); }), 800); };
    const view = createView(mountRef.current!, (v) => {
      setTick((t) => t + 1);
      if (v.state.doc !== lastDoc.current) {
        lastDoc.current = v.state.doc;
        const id = activeRef.current;
        setDocs((ds) => (ds.some((d) => d.id === id && !d.dirty) ? ds.map((d) => (d.id === id ? { ...d, dirty: true } : d)) : ds));
        // the outline and word count walk the whole doc: refresh them when typing pauses, not per keystroke
        window.clearTimeout(outlineTimer);
        outlineTimer = window.setTimeout(() => setDocVersion((n) => n + 1), 150);
        backupSoon.current();
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
  useEffect(() => { localStorage.setItem('falcon.speech', String(speechMin)); }, [speechMin]);
  useEffect(() => { localStorage.setItem('falcon.meta', JSON.stringify(meta)); }, [meta]);
  useEffect(() => { saveRecents(recents); }, [recents]);
  // the list changed (switch, open, close, saved): refresh the crash-recovery copy once React has settled
  useEffect(() => { if (viewRef.current) whenIdle(() => { backup(); }); }, [docs, activeId, backup]);
  // quitting or closing the window with unsaved docs: the page blocks it, the main process passes
  // the question back here, and Falcon's own dialog asks it
  useEffect(() => bridge.onConfirmClose?.((quit) => {
    if (!pref(P.confirmClose)) { bridge.forceClose?.(quit); return; }
    const names = docsRef.current.filter((d) => d.dirty).map((d) => d.meta.name || 'Untitled');
    const what = quit ? 'Quit' : 'Close';
    void confirmAsk({
      title: `${what} Falcon without saving?`,
      body: `${nameList(names)} ${names.length > 1 ? 'have' : 'has'} unsaved changes. They'll be lost.`,
      ok: `${what} Without Saving`,
    }).then((yes) => { if (yes) bridge.forceClose?.(quit); });
  }), [confirmAsk]);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (docsRef.current.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', onUnload);
    return () => removeEventListener('beforeunload', onUnload);
  }, []);
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

  /** Put `state` in the editor as document `id`. The caller has already stashed the outgoing doc. */
  const show = useCallback((id: number, state: EditorState, scroll: number) => {
    const v = viewRef.current!;
    stopScroll();
    v.updateState(state);
    lastDoc.current = v.state.doc;
    activeRef.current = id;
    setActiveId(id);
    setDocVersion((n) => n + 1);
    if (scrollRef.current) scrollRef.current.scrollTop = scroll;
    setFindOpen(false); // find state belongs to the outgoing doc
    const backedUp = v.state.doc.content.size <= AUTOSAVE_MAX;
    warnedBig.current = !backedUp; // the open message carries the warning
    setHomeOpen(false);
    v.focus();
    setTick((t) => t + 1);
    return backedUp;
  }, []);
  /** The outgoing doc, ready to stash: its state and where it was scrolled to. */
  const stash = () => {
    const v = viewRef.current!;
    if (findInfo(v.state)) clearFind(v);
    setFindOpen(false);
    return { state: v.state, scroll: scrollRef.current?.scrollTop ?? 0 };
  };

  const switchTo = useCallback((id: number) => {
    if (id === activeRef.current) { setHomeOpen(false); viewRef.current?.focus(); return; }
    const target = docsRef.current.find((d) => d.id === id);
    if (!target?.state) return;
    const out = stash(), cur = activeRef.current;
    setDocs((ds) => ds.map((d) => (d.id === cur ? { ...d, ...out } : d.id === id ? { ...d, state: null } : d)));
    show(id, target.state, target.scroll);
  }, [show]);

  /** A new tab for `doc`, after the current one. An untouched blank Untitled is replaced instead. */
  const addDoc = useCallback((doc: PMNode, m: DocMeta) => {
    const v = viewRef.current!;
    const cur = docsRef.current.find((d) => d.id === activeRef.current)!;
    const blank = !cur.dirty && !cur.meta.path && !v.state.doc.textContent.trim() && v.state.doc.childCount <= 1;
    const id = blank ? cur.id : nextDocId++;
    const fresh: OpenDoc = { id, meta: m, dirty: false, state: null, scroll: 0 };
    if (blank) setDocs((ds) => ds.map((d) => (d.id === id ? fresh : d)));
    else {
      const out = stash();
      setDocs((ds) => { const i = ds.findIndex((d) => d.id === cur.id); const n = ds.map((d) => (d.id === cur.id ? { ...d, ...out } : d)); n.splice(i + 1, 0, fresh); return n; });
    }
    return show(id, createState(doc), 0);
  }, [show]);

  const dropDoc = useCallback((id: number) => {
    const list = docsRef.current, i = list.findIndex((d) => d.id === id);
    if (i < 0) return;
    const rest = list.filter((x) => x.id !== id);
    if (id !== activeRef.current) { setDocs(rest); return; }
    if (!rest.length) {
      const nid = nextDocId++;
      setDocs([{ id: nid, meta: { name: 'Untitled' }, dirty: false, state: null, scroll: 0 }]);
      show(nid, createState(emptyDoc()), 0);
      setHomeOpen(true);
      return;
    }
    const next = rest[Math.min(i, rest.length - 1)];
    setDocs(rest.map((x) => (x.id === next.id ? { ...x, state: null } : x)));
    show(next.id, next.state!, next.scroll);
  }, [show]);
  const closeDoc = useCallback((id: number) => {
    const d = docsRef.current.find((x) => x.id === id);
    if (!d) return;
    if (!d.dirty || !pref(P.confirmClose)) { dropDoc(id); return; }
    const name = d.meta.name || 'Untitled';
    void confirmAsk({ title: `Close ${name} without saving?`, body: 'Your changes will be lost.', ok: 'Close Without Saving' })
      .then((yes) => { if (yes) dropDoc(id); });
  }, [dropDoc, confirmAsk]);

  const cycle = useCallback((dir: 1 | -1) => {
    const list = docsRef.current;
    if (list.length < 2) return;
    const i = list.findIndex((d) => d.id === activeRef.current);
    switchTo(list[(i + dir + list.length) % list.length].id);
  }, [switchTo]);

  const openedPath = (p?: string) => (p ? docsRef.current.find((d) => d.meta.path === p) : undefined);
  const opened = useCallback((r: { doc: PMNode; meta: DocMeta }) => {
    setRecents((list) => noteRecent(list, r.doc, r.meta));
    const already = openedPath(r.meta.path);
    if (already) { switchTo(already.id); flash(`${r.meta.name} is already open`); return; }
    if (pref(P.openDepth)) setDepth(pref(P.openDepth));
    flash(addDoc(r.doc, r.meta) ? `Opened ${r.meta.name}` : `Opened ${r.meta.name}. It's too big for crash recovery, so save often (${MOD}S).`);
  }, [addDoc, switchTo, flash]);
  const fileNew = useCallback(() => { addDoc(emptyDoc(), { name: 'Untitled' }); }, [addDoc]);
  const fileOpen = useCallback(async () => {
    try {
      const r = await openDocument();
      if (r) opened(r);
    } catch (e) { flash(`Couldn't open: ${(e as Error).message}`); }
  }, [opened, flash]);
  const openRecent = useCallback(async (r: Recent) => {
    const already = openedPath(r.path) ?? (!r.path ? docsRef.current.find((d) => !d.meta.path && d.meta.name === r.name) : undefined);
    if (already) { switchTo(already.id); return; }
    if (!r.path || !bridge.openPath) { void fileOpen(); return; }
    try { opened(await openPath(r.path)); }
    catch (e) { flash(`Couldn't open ${r.name}: ${(e as Error).message}`); }
  }, [opened, fileOpen, switchTo, flash]);
  const fileSave = useCallback(async (as = false) => {
    const v = viewRef.current!;
    const id = activeRef.current;
    const d = docsRef.current.find((x) => x.id === id)!;
    const saved = v.state.doc;
    try {
      const m = await saveDocument(saved, d.meta, as);
      if (!m) return;
      // typing during the save keeps the doc marked unsaved
      const now = activeRef.current === id ? viewRef.current!.state.doc : docsRef.current.find((x) => x.id === id)?.state?.doc;
      patch(id, { meta: m, dirty: now !== saved });
      setRecents((list) => noteRecent(list, saved, m));
      flash(`Saved ${m.name}`);
    } catch (e) { flash(`Couldn't save: ${(e as Error).message}`); }
  }, [patch, flash]);

  const openFind = useCallback(() => { setHomeOpen(false); setFindOpen(true); setTimeout(() => { findRef.current?.focus(); findRef.current?.select(); }, 0); }, []);
  const zoomBy = useCallback((d: number) => setZoom((z) => Math.max(0.5, Math.min(3, +(z + d).toFixed(2)))), []);

  // the Mac File menu (its shortcuts are labels only: the keys arrive here as usual)
  const menuRef = useRef<(c: string) => void>(() => {});
  // nothing swaps the document out behind Settings or during a read-mode speech
  const locked = () => settingsRef.current || !!askRef.current || (!!viewRef.current && isReading(viewRef.current.state));
  menuRef.current = (c) => {
    if (askRef.current) return; // a warning is up: it gets answered first
    if (c === 'settings') { setSettingsOpen(true); return; }
    if (locked() && c !== 'save' && c !== 'saveAs') return;
    if (c === 'new') fileNew(); else if (c === 'open') void fileOpen(); else if (c === 'save') void fileSave(false);
    else if (c === 'saveAs') void fileSave(true); else if (c === 'close') closeDoc(activeRef.current); else if (c === 'settings') setSettingsOpen(true);
  };
  useEffect(() => bridge.onMenu?.((c) => menuRef.current(c)), []);

  // app-level shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // a warning is up: its own keys (Tab, Enter, Esc) and nothing else
      if (askRef.current) { if (e.ctrlKey || e.metaKey) e.preventDefault(); return; }
      // Ctrl-Tab switches documents on every platform
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); if (!locked()) cycle(e.shiftKey ? -1 : 1); return; }
      // AltGr arrives as Ctrl+Alt on Windows: those keys type characters (AltGr+ß is "\\"), never shortcuts
      if (e.altKey || e.getModifierState?.('AltGraph')) return;
      const v = viewRef.current;
      // read mode locks the keyboard: nothing that swaps the document out
      if (v && isReading(v.state) && (/^[notw]$/i.test(e.key) || /^Bracket/.test(e.code))) return;
      const mod = IS_MAC ? e.metaKey : e.ctrlKey; // Ctrl-N/O/F are caret keys on macOS
      // Settings is modal: only its own keys (Esc, Mod-,) get through
      if (settingsRef.current && !(e.key === 'Escape' || (mod && e.key === ','))) { if (mod) e.preventDefault(); return; }
      // Esc in a filled Settings search clears the search before it closes Settings
      if (e.key === 'Escape' && settingsRef.current && e.target instanceof HTMLInputElement && e.target.closest('.st-search') && e.target.value) return;
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); void fileSave(e.shiftKey); }
      else if (mod && k === 'f') { e.preventDefault(); openFind(); }
      else if (mod && k === 'o') { e.preventDefault(); void fileOpen(); }
      else if (mod && k === 'n' && !e.shiftKey) { e.preventDefault(); fileNew(); }
      else if (mod && k === 'w' && !e.shiftKey) { e.preventDefault(); closeDoc(activeRef.current); }
      else if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft') && e.shiftKey) { e.preventDefault(); cycle(e.code === 'BracketRight' ? 1 : -1); }
      else if (mod && k === 't' && !e.shiftKey) { e.preventDefault(); setHomeOpen((h) => !h); }
      else if (mod && e.key === ',') { e.preventDefault(); setSettingsOpen((s) => !s); }
      else if (mod && e.key === '\\') { e.preventDefault(); setShowOutline((s) => !s); }
      else if (e.key === 'Escape' && settingsRef.current) { e.preventDefault(); e.stopPropagation(); setSettingsOpen(false); }
      else if (e.key === 'Escape' && homeRef.current) { e.preventDefault(); e.stopPropagation(); setHomeOpen(false); }
      else if (mod && (e.key === '=' || e.key === '+') && !e.shiftKey) { e.preventDefault(); zoomBy(0.1); }
      else if (mod && e.key === '-') { e.preventDefault(); zoomBy(-0.1); }
      else if (mod && e.key === '0') { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fileSave, fileOpen, fileNew, openFind, closeDoc, cycle, zoomBy]);
  const homeRef = useRef(homeOpen);
  homeRef.current = homeOpen;
  const settingsRef = useRef(settingsOpen);
  settingsRef.current = settingsOpen;
  useEffect(() => { if (!settingsOpen && !ask && !homeRef.current) viewRef.current?.focus(); }, [settingsOpen, ask]);

  const sel = useMemo(() => (view ? selectionState(view.state) : null), [view, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outline = useMemo(() => (view ? buildOutline(view.state.doc) : []), [view, docVersion]);
  const outlineRef = useRef(outline);
  outlineRef.current = outline;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const words = useMemo(() => (view ? readWords(view.state.doc) : 0), [view, docVersion]);
  const brush = view ? brushKey.getState(view.state)?.kind ?? null : null;

  // The outline marks the block holding the cursor while the cursor is on screen (so an outline click
  // or a click in the page marks what you clicked); scrolled away from it, the outline follows the
  // scroll: the last heading above the reading line.
  const measureRead = useCallback(() => {
    const v = viewRef.current, sc = scrollRef.current;
    if (!v || !sc) return;
    const box = sc.getBoundingClientRect(), head = v.state.selection.head;
    const caret = v.coordsAtPos(head);
    // stores the row index, not the position, so typing within a block doesn't re-render the app
    const mark = (pos: number) => setCurItem(currentItem(outlineRef.current, pos));
    if (caret.bottom > box.top && caret.top < box.bottom) { mark(head); return; }
    const pm = v.dom.getBoundingClientRect(), top = box.top + 90;
    if (pm.top > top) { mark(0); return; }
    const hit = v.posAtCoords({ left: pm.left + 4, top: Math.min(top, pm.bottom - 2) });
    mark(hit ? hit.pos : v.state.doc.content.size);
  }, []);
  useEffect(() => {
    const sc = scrollRef.current!;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measureRead); };
    sc.addEventListener('scroll', on, { passive: true });
    return () => { sc.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
  }, [measureRead]);
  useEffect(() => { requestAnimationFrame(measureRead); }, [docVersion, zoom, tick, measureRead]);
  const cur = outline.length ? Math.max(0, Math.min(curItem, outline.length - 1)) : -1;

  const jump = useCallback((stale: OutlineItem, index: number) => {
    const v = viewRef.current!;
    const item = buildOutline(v.state.doc)[index] ?? stale;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, item.pos + 1)));
    (v.dom as HTMLElement).focus({ preventScroll: true });
    scrollToPos(v, item.pos);
  }, []);
  const getView = useCallback(() => viewRef.current, []);
  // outline search: Up/Down scroll the page to a match without leaving the search box
  const peek = useCallback((item: OutlineItem) => { const v = viewRef.current; if (v) scrollToPos(v, item.pos); }, []);
  // Find and Replace and find-by-position keys live in the editor keymap and ask for the bar here
  useEffect(() => { addEventListener('falcon-find', openFind); return () => removeEventListener('falcon-find', openFind); }, [openFind]);

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
  const docList = docs.map((d) => ({ id: d.id, name: d.meta.name || 'Untitled', path: d.meta.path, dirty: d.dirty }));

  // ---- settings that act on the app (the rest act through CSS or in the editor) ----
  const [, setPrefTick] = useState(0);
  useEffect(() => onPrefs(() => setPrefTick((t) => t + 1)), []); // redraw: word-count speeds, recents, the timer
  // reopen last files: the files open at the last quit, read before the list below is rewritten
  const lastSession = useRef<string[]>(JSON.parse(localStorage.getItem('falcon.session') ?? '[]'));
  const reopened = useRef(false);
  useEffect(() => {
    if (!hasView || reopened.current) return;
    reopened.current = true;
    if (!pref(P.reopen) || !bridge.openPath) return;
    void (async () => {
      for (const p of lastSession.current) {
        if (openedPath(p)) continue;
        try { opened(await openPath(p)); } catch { /* moved or deleted since */ }
      }
    })();
  }, [hasView]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { localStorage.setItem('falcon.session', JSON.stringify(docs.flatMap((d) => (d.meta.path ? [d.meta.path] : [])))); }, [docs]);
  // Ctrl/Cmd + scroll wheel or trackpad pinch zooms, in the same 10% steps
  useEffect(() => {
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !pref(P.wheelZoom) || settingsRef.current) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      zoomBy(acc < 0 ? 0.1 : -0.1);
      acc = 0;
    };
    addEventListener('wheel', onWheel, { passive: false });
    return () => removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const modal = settingsOpen || !!ask;
  return (
    <div className={`app${showOutline ? '' : ' no-outline'}`} style={{ '--ink': ink } as React.CSSProperties}>
      <div className="covered" inert={modal}>
      <Rail home={homeOpen} settings={settingsOpen} docs={docList} active={activeId} onSwitch={switchTo} onClose={closeDoc}
        onHome={() => setHomeOpen((h) => !h)} onSettings={() => setSettingsOpen((s) => !s)} />
      </div>

      <div className="covered" inert={homeOpen || modal}>
      <Toolbar
        sel={sel}
        run={run}
        brush={brush}
        onColor={colorButton}
        onPick={(kind, c) => { setActiveColor(kind, c); setTick((t) => t + 1); const v = viewRef.current; if (v && !v.state.selection.empty) run(falconKeys[kind === 'highlight' ? 'F11' : 'Mod-F11']); }}
        flash={flash}
        reading={reading}
        onRead={() => run(toggleRead)}
        speechSeconds={speechMin * 60}
      />
      </div>

      {/* After the toolbar on purpose: Electron applies drag regions in document order, so the toolbar's
          drag area (which runs under these buttons) would swallow their clicks if they came first. */}
      <div className="covered" inert={modal}>
      <Tools outline={showOutline} reading={reading}
        onNew={fileNew} onOpen={() => void fileOpen()} onSave={(as) => void fileSave(as)}
        onFind={openFind} onOutline={() => { setHomeOpen(false); setShowOutline((s) => !s); }}
        onRead={() => { setHomeOpen(false); run(toggleRead); }} />
      </div>

      <div className="covered" inert={homeOpen || modal}>

      <OutlinePane active={activeId}
        shown={showOutline} items={outline} depth={depth} cur={cur}
        numbers={view ? outlineNumbers(view.state) : []} getView={getView} onPeek={peek} flash={flash}
        onDepth={setDepth} onJump={jump} />

      <div ref={scrollRef} className="f-scroll" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); viewRef.current?.focus(); } }}>
        <div className="page"><div ref={mountRef} /></div>
      </div>
      {findOpen && view && <FindBar view={view} inputRef={findRef} flash={flash} onClose={() => setFindOpen(false)} />}

      <footer className="status">
        <span>Σ</span>
        <span>Doc: {words.toLocaleString('en-US')} · Reader 1: {mmss(words / pref(P.wpm1))} · Reader 2: {mmss(words / pref(P.wpm2))}{sel && sel.selWords ? ` | Sel: ${sel.selWords}` : ''}</span>
        {brush && <span className="lit">Paintbrush on · Esc to stop</span>}
        {reading && <span className="lit">Read mode · keyboard locked · Space drops a marker</span>}
        <span className="grow" />
        <button title={`Zoom out (${MOD}−): make the page smaller`} onClick={() => zoomBy(-0.1)}>−</button>
        <button className="zoom" title={`Actual size (${MOD}0): back to 100%`} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button title={`Zoom in (${MOD}+): make the page bigger`} onClick={() => zoomBy(0.1)}>+</button>
      </footer>
      </div>

      <div className="covered" inert={!!ask}>
      <Home open={homeOpen} current={dirty || meta.path ? name : ''} recents={recents.slice(0, pref(P.recentCount))}
        onNew={fileNew} onOpen={() => void fileOpen()} onRecent={(r) => void openRecent(r)}
        onClear={(keep) => setRecents((cur) => (keep ? [...cur, ...keep.filter((k) => !cur.some((c) => c.name === k.name && c.path === k.path))] : []))} />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)}
        zoom={zoom} onZoom={setZoom} speechMin={speechMin} onSpeechMin={setSpeechMin}
        showOutline={showOutline} onShowOutline={setShowOutline} depth={depth} onDepth={setDepth}
        highlight={activeColors.highlight} onHighlight={(c) => { setActiveColor('highlight', c); setTick((t) => t + 1); }} />
      </div>
      <Confirm ask={ask} />
      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
      <Tips />
    </div>
  );
}

/** Time's up, out loud: two short tones (Settings, Speech and timers). */
function beep() {
  try {
    const ctx = new AudioContext();
    for (const at of [0, 0.3]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.18);
    }
    setTimeout(() => void ctx.close(), 1000);
  } catch { /* no audio device */ }
}

const mmss = (min: number) => { const s = Math.round(min * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- the rail: Home, one button per open document, and Settings, down the far left ----------

type DocRow = { id: number; name: string; path?: string; dirty: boolean };
function Rail(props: { home: boolean; settings: boolean; docs: DocRow[]; active: number; onSwitch: (id: number) => void; onClose: (id: number) => void; onHome: () => void; onSettings: () => void }) {
  // hovering the file icons slides the files panel out beside the rail, its rows level with the
  // icons, so it reads as the rail widening to show every name
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ head: 0, list: 0 });
  const timer = useRef(0);
  const logo = useRef<HTMLButtonElement>(null), strip = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const show = () => {
    clearTimeout(timer.current);
    if (open) return;
    // the panel sits 8px from the window's top
    setAt({ head: logo.current!.getBoundingClientRect().top - 8, list: strip.current!.getBoundingClientRect().top - 8 });
    setOpen(true);
  };
  const hide = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), 180); };
  useEffect(() => () => clearTimeout(timer.current), []);
  // both lists scroll together, so each row stays level with its icon
  useLayoutEffect(() => { if (open && list.current && strip.current) list.current.scrollTop = strip.current.scrollTop; }, [open, props.docs.length]);
  const isOn = (d: DocRow) => d.id === props.active && !props.home;
  return (
    <nav className="fstrip" aria-label="Open documents">
      <button ref={logo} className="sb-logo" title={`Home (${MOD}T): recent files and new documents`} aria-label="Home" data-on={props.home || undefined} onClick={props.onHome}><SvgIcon name="logo" /></button>
      <div ref={strip} className="fs-docs" role="tablist" aria-label="Open documents" onPointerEnter={show} onPointerLeave={hide}
        onScroll={(e) => { if (list.current) list.current.scrollTop = e.currentTarget.scrollTop; }}>
        {props.docs.map((d) => (
          <div key={d.id} className="doc-row" data-on={isOn(d) || undefined}>
            <button className="fs-b doc-nm" role="tab" aria-selected={isOn(d)} aria-label={d.name} data-on={isOn(d) || undefined}
              onClick={() => props.onSwitch(d.id)} onAuxClick={(e) => { if (e.button === 1) props.onClose(d.id); }}>
              <SvgIcon name="doc" />{d.dirty && <i className="dot" aria-label="unsaved" />}
            </button>
          </div>
        ))}
      </div>
      {/* mouse-only: the tabs in the rail are what the keyboard and screen readers use; inert while
          closed so its rows can't take clicks */}
      <aside className="files" data-open={open || undefined} inert={!open} aria-hidden="true" onPointerEnter={show} onPointerLeave={hide}>
        <div className="files-h" style={{ top: at.head }}><b>Falcon</b><span>{props.docs.length} open</span></div>
        <div ref={list} className="files-l" style={{ top: at.list }}
          onScroll={(e) => { if (strip.current) strip.current.scrollTop = e.currentTarget.scrollTop; }}>
          {props.docs.map((d) => (
            <div key={d.id} className="files-r" data-on={isOn(d) || undefined}>
              <button tabIndex={-1} className="files-b" onClick={() => props.onSwitch(d.id)} onAuxClick={(e) => { if (e.button === 1) props.onClose(d.id); }}>
                <SvgIcon name="doc" /><span className="nm">{tidy(d.name)}</span>{d.dirty && <i className="dot" />}
              </button>
              <button tabIndex={-1} className="files-x" title={`Close (${MOD}W): close this file`} onClick={() => props.onClose(d.id)}><SvgIcon name="x" /></button>
            </div>
          ))}
        </div>
      </aside>
      <div className="grow" />
      <button className="fs-b" title={`Settings (${MOD},): highlight color, speech time, keys and more`} aria-label="Settings" data-on={props.settings || undefined} onClick={props.onSettings}><SvgIcon name="gear" /></button>
    </nav>
  );
}

// ---------- the tools: file and view buttons in a row above the outline ----------

function Tools(props: { outline: boolean; reading: boolean; onNew: () => void; onOpen: () => void; onSave: (as: boolean) => void; onFind: () => void; onOutline: () => void; onRead: () => void }) {
  const b = (icon: string, title: string, onClick: (e: React.MouseEvent) => void, on = false) => (
    <button className="fs-b" title={title} aria-label={title.replace(/ \(.*/, '')} data-on={on || undefined} aria-pressed={on || undefined} onClick={onClick}><SvgIcon name={icon} /></button>
  );
  return (
    <div className="tools" role="toolbar" aria-label="File and view">
      {b('plus', `New document (${MOD}N): start a blank file`, props.onNew)}
      {b('open', `Open… (${MOD}O): open a .docx file`, props.onOpen)}
      {b('save', `Save (${MOD}S): save this file. Shift-click to save a copy`, (e) => props.onSave(e.shiftKey))}
      {b('saveAs', `Save As… (${IS_MAC ? '⌘⇧S' : 'Ctrl+Shift+S'}): save a copy under a new name`, () => props.onSave(true))}
      <span className="sep" />
      {b('search', `Find (${MOD}F): search this file`, props.onFind)}
      {b('list', `Outline (${MOD}\\): show or hide the list of pockets, hats, blocks and tags`, props.onOutline, props.outline)}
      {b('eye', `Read mode (${IS_MAC ? '⌘⇧R' : 'Ctrl+Shift+R'}): show only what's read aloud`, props.onRead, props.reading)}
    </div>
  );
}

// ---------- the top bar: the Classic layout, a two-row grid where each button previews its style ----------

type SelState = ReturnType<typeof selectionState>;
type PopKind = 'highlight' | 'shading' | 'font' | 'size' | 'doc' | 'card';
const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48];
const SHADES = ['#D9D9D9', '#BFBFBF', '#F2F2F2', '#FFF2CC', '#FCE4D6', '#E2EFDA', '#DDEBF7', '#EDE7F6', '#FDE2E4', '#C6E0B4', '#BDD7EE', '#F8CBAD', '#FFE699', '#A9D08E', '#9BC2E6'];
const FONT_COLORS: [string | null, string][] = [[null, 'Automatic'], ['#1F3864', 'Dark blue'], ['#385623', 'Dark green'], ['#C00000', 'Dark red'], ['#FF0000', 'Red']];

function Toolbar(props: { sel: SelState | null; run: (c: Command) => void; brush: string | null; onColor: (k: 'highlight' | 'shading') => void; onPick: (k: 'highlight' | 'shading', c: string | null) => void; flash: (m: string) => void; reading: boolean; onRead: () => void; speechSeconds: number }) {
  const { sel, run } = props;
  const SPEECH_SECONDS = props.speechSeconds;
  const [pop, setPop] = useState<{ kind: PopKind; x: number; y: number; origin: number } | null>(null);
  const [fontColor, setFontColor] = useState<string | null>(() => localStorage.getItem('falcon.fontColor'));
  const popRef = useRef<HTMLDivElement>(null);

  const keyName = (k: string) => k.replace('Mod-', MOD);
  const style = (s: ParaStyle, key: string, label: string, cls: string, desc: string) => (
    <button className="b" data-on={sel?.style === s || undefined} title={`${label} (${keyName(key)}): ${desc}`} onMouseDown={(e) => { e.preventDefault(); run(falconKeys[key]); }}>
      <span className={cls}>{label}</span>
    </button>
  );
  const mark = (name: string, key: string, label: string, cls: string, desc: string) => (
    <button className="b" data-on={sel?.marks.has(name) || undefined} title={`${label} (${keyName(key)}): ${desc}`} onMouseDown={(e) => { e.preventDefault(); run(falconKeys[key]); }}>
      <span className={cls}>{label}</span>
    </button>
  );
  const openPop = (kind: PopKind, t: HTMLElement) => {
    if (pop?.kind === kind) { setPop(null); return; }
    const r = t.getBoundingClientRect();
    // the Doc and Card menus open below the whole bar, so the open Doc menu doesn't cover the Card button
    const below = kind === 'doc' || kind === 'card' ? t.closest('.toolbar')!.getBoundingClientRect().bottom : r.bottom;
    setPop({ kind, x: r.left + r.width / 2, y: below + 6, origin: 0 });
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
      <button className="b ic" data-on={armed || undefined} aria-label={parseTip(label).label} title={label} onMouseDown={(e) => { e.preventDefault(); onMain(); }}>
        <span className="glyph">{glyph}<i className={bar === undefined ? 'none' : ''} style={{ background: bar }} /></span>
      </button>
      <button className="b cr" data-pop={kind} aria-label={`${parseTip(label).label} options`} title={`${parseTip(label).label} colors: pick the color`} aria-haspopup="menu" aria-expanded={pop?.kind === kind}
        onMouseDown={(e) => { e.preventDefault(); openPop(kind, e.currentTarget); }}><SvgIcon name="caret" /></button>
    </span>
  );
  const applyFont = (c: string | null) => run(toggleColorMark(schema.marks.color, c));
  const menuBtn = (kind: 'doc' | 'card', label: string, tip: string) => (
    <button className="b mn" data-pop={kind} title={tip} aria-haspopup="menu" aria-expanded={pop?.kind === kind}
      onMouseDown={(e) => { e.preventDefault(); openPop(kind, e.currentTarget); }}>{label}<SvgIcon name="caret" /></button>
  );
  // "Mod-Alt-F3" as ⌘⌥F3 on macOS, Ctrl+Alt+F3 elsewhere
  const menuKey = (k: string) => IS_MAC
    ? k.split('-').map((p) => ({ Mod: '⌘', Alt: '⌥', Shift: '⇧', Ctrl: '⌃' }[p] ?? p)).join('')
    : k.replace(/Mod/g, 'Ctrl').replace(/-/g, '+');
  const toolMenu = (sections: ToolSection[]) => sections.length === 0
    ? <p className="mn-none">Nothing here yet</p>
    : sections.map((sec) => (
      <div key={sec.title} className="mn-sec" role="group" aria-label={sec.title}>
        <div className="mn-h">{sec.title}</div>
        {sec.items.map((it) => (
          <button key={it.label} className="mn-i" role="menuitem" title={it.hint}
            onMouseDown={(e) => { e.preventDefault(); setPop(null); run(it.run); }}>
            <span>{it.label}</span>{it.key && <kbd>{menuKey(it.key)}</kbd>}
          </button>
        ))}
      </div>
    ));

  const STYLE_PT: Record<string, number> = { pocket: 26, hat: 22, block: 16, tag: 13, analytic: 13 };
  const fontSize = sel?.size ?? (sel?.marks.has('cite') ? 13 : STYLE_PT[sel?.style ?? ''] ?? null);
  // with nothing selected the size applies to what you type next
  const setSize = (pt: number) => run((state, dispatch) => {
    const { from, to, empty } = state.selection;
    const mark = schema.marks.size.create({ pt: Math.max(4, Math.min(72, pt)) });
    dispatch?.(empty ? state.tr.addStoredMark(mark) : state.tr.addMark(from, to, mark));
    return true;
  });
  const bump = (d: number) => setSize((fontSize ?? 11) + d);

  // the speech timer (and the prep timer, when Settings shows it): click to start or pause, right-click to reset
  const [left, setLeft] = useState(SPEECH_SECONDS);
  const [running, setRunning] = useState(false);
  const PREP_SECONDS = pref(P.prepMin) * 60;
  const [prepLeft, setPrepLeft] = useState(PREP_SECONDS);
  const [prepRunning, setPrepRunning] = useState(false);
  // a new length from Settings resets an idle timer
  useEffect(() => { if (!running) setLeft(SPEECH_SECONDS); }, [SPEECH_SECONDS]);
  useEffect(() => { if (!prepRunning) setPrepLeft(PREP_SECONDS); }, [PREP_SECONDS]);
  const showPrep = pref(P.showPrep);
  // hiding the prep timer stops and resets it
  useEffect(() => { if (!showPrep) { setPrepRunning(false); setPrepLeft(PREP_SECONDS); } }, [showPrep]);
  const countdown = (on: boolean, setOn: (b: boolean) => void, setLeftOf: (f: (s: number) => number) => void, what: string) => {
    if (!on) return;
    const t = window.setInterval(() => setLeftOf((s) => {
      if (s <= 1) { setOn(false); props.flash(what); if (pref(P.beep)) beep(); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  };
  useEffect(() => countdown(running, setRunning, setLeft, 'Time is up'), [running]);
  useEffect(() => countdown(prepRunning, setPrepRunning, setPrepLeft, 'Prep is up'), [prepRunning]);
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const low = (on: boolean, s: number) => (on && s <= pref(P.lowTime) ? ' low' : '');

  return (
    <header className="toolbar">
      <div className="bar">
        <div className="g">
          {style('pocket', 'F4', 'Pocket', 'pv box', 'turn this line into a pocket, the biggest heading')}{style('tag', 'F7', 'Tag', 'pv', 'turn this line into a card tag')}
          {style('hat', 'F5', 'Hat', 'pv uu', 'turn this line into a hat, the heading above blocks')}{style('block', 'F6', 'Block', 'pv u', 'turn this line into a block heading')}
          {style('analytic', 'Mod-F7', 'Analytic', 'pv an', 'turn this line into an analytic, a tag with no card')}{style('undertag', 'Mod-F8', 'Undertag', 'ut', 'turn this line into an undertag, the note under a tag')}
        </div>
        <div className="g">
          {mark('cite', 'F8', 'Cite', 'pv', 'mark the selection as the cite')}{mark('underline', 'F9', 'Underline', 'u', 'underline the selection')}
          {mark('emphasis', 'F10', 'Emphasis', 'pv u box', 'bold, underline and box the selection')}
          <button className="b" title="Clear (F12): remove formatting from the selection, or this line" onMouseDown={(e) => { e.preventDefault(); run(falconKeys.F12); }}>Clear</button>
        </div>
        <div className="g">
          {pair('highlight', <SvgIcon name="pen" />, 'Highlight (F11): highlight the selection. With nothing selected, turns on a paintbrush', () => props.onColor('highlight'), swatch('highlight'), props.brush === 'highlight')}
          {pair('shading', <SvgIcon name="bucket" />, `Background color (${MOD}F11): shade the selection`, () => props.onColor('shading'), swatch('shading'), props.brush === 'shading')}
          {pair('font', <b className="fa">A</b>, 'Font color: color the selection\'s text', () => applyFont(fontColor), fontColor ?? '#ececee')}
          <button className="b sm" title={`Shrink (${MOD}8): make the text you don't read smaller. Press again to shrink more`} onMouseDown={(e) => { e.preventDefault(); run(falconKeys['Mod-8']); }}>Shrink</button>
          <button className="b fsz" data-pop="size" title="Font size: pick a size for the selection" aria-label={`Font size ${fontSize ?? 11} pt`} aria-haspopup="menu" aria-expanded={pop?.kind === 'size'}
            onMouseDown={(e) => { e.preventDefault(); openPop('size', e.currentTarget); }}>{fontSize ?? 11}<SvgIcon name="caret" /></button>
          <button className="b sz" title={`Bigger: one point bigger (now ${fontSize ?? 11} pt)`} onMouseDown={(e) => { e.preventDefault(); bump(1); }}>A<SvgIcon name="up" /></button>
          <button className="b sz" title={`Smaller: one point smaller (now ${fontSize ?? 11} pt)`} onMouseDown={(e) => { e.preventDefault(); bump(-1); }}>A<SvgIcon name="caret" /></button>
        </div>
        <div className="g tl">
          {menuBtn('doc', 'Doc', 'Doc tools: cleanup for the whole document')}
          {menuBtn('card', 'Card', 'Card tools: condense, extract and convert the card at the cursor')}
        </div>
        <div className="end">
          <button className="b" data-on={props.reading || undefined} title={`Read mode (${IS_MAC ? '⌘⇧R' : 'Ctrl+Shift+R'}): show only what's read aloud. Typing is locked and Space drops a marker`} onMouseDown={(e) => { e.preventDefault(); props.onRead(); }}>Read</button>
          <button className={`b timer${low(running, left)}`} data-on={running || undefined} title="Speech timer: click to start or pause. Right-click to reset"
            onMouseDown={(e) => { e.preventDefault(); if (e.button === 0) { if (left === 0) setLeft(SPEECH_SECONDS); setRunning((r) => !r); } }}
            onContextMenu={(e) => { e.preventDefault(); setRunning(false); setLeft(SPEECH_SECONDS); }}>
            {clock(left)}
          </button>
          {showPrep && (
            <button className={`b timer prep${low(prepRunning, prepLeft)}`} data-on={prepRunning || undefined} title="Prep timer: click to start or pause. Right-click to reset"
              onMouseDown={(e) => { e.preventDefault(); if (e.button === 0) { if (prepLeft === 0) setPrepLeft(PREP_SECONDS); setPrepRunning((r) => !r); } }}
              onContextMenu={(e) => { e.preventDefault(); setPrepRunning(false); setPrepLeft(PREP_SECONDS); }}>
              Prep {clock(prepLeft)}
            </button>
          )}
        </div>
      </div>
      {pop && (
        <div ref={popRef} key={pop.kind} className={`pop${pop.kind === 'size' ? ' sizes' : pop.kind === 'doc' || pop.kind === 'card' ? ' menu' : ''}`} role="menu" aria-label={pop.kind === 'doc' ? 'Doc tools' : pop.kind === 'card' ? 'Card tools' : undefined} style={{ top: pop.y }}>
          {pop.kind === 'doc' ? toolMenu(DOC_TOOLS)
            : pop.kind === 'card' ? toolMenu(CARD_TOOLS)
            : pop.kind === 'size'
            ? SIZES.map((n) => (
              <button key={n} className="szi" role="menuitem" aria-current={(fontSize ?? 11) === n || undefined}
                onMouseDown={(e) => { e.preventDefault(); setPop(null); setSize(n); }}>{n}</button>
            ))
            : pop.kind === 'font'
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
