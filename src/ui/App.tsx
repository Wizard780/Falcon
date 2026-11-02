import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { Node as PMNode } from 'prosemirror-model';
import { undo } from 'prosemirror-history';
import { createState, createView, brushKey, emptyDoc } from '../editor/editor';
import { commandOf } from '../editor/keymap';
import { IS_MAC, isRecording, keyOf, keyText, pressedId, titled } from '../editor/keybinds';
import { activeColors, bridge, setActiveColor } from '../editor/host';
import { HIGHLIGHTS, schema, type ParaStyle } from '../editor/schema';
import { buildOutline, currentItem, readWords, type OutlineItem } from '../editor/outline';
import { toggleColorMark } from '../editor/commands';
import { fontSizeOf, setFontSize } from '../editor/font-size';
import { FONT_COLORS } from './swatches';
import { TIMER_EVENT, type TimerRequest } from './cc-sources';
import { insertIntoSpeech, sendContent } from '../editor/speech';
import { selectionState } from './selection-state';
import { SvgIcon } from './icons';
import { newFileName, openDocument, openPath, saveDocument, type DocMeta } from './files';
import { Palette } from './Palette';
import { CommandCenter } from './CommandCenter';
import type { Ctx } from './cc-sources';
import type { FileHit } from './file-search';
import { clearFind, findInfo, requestFind, setQuery as setFindQuery } from '../editor/find';
import { readSetting } from '../editor/tools';
import { findOrderSetting } from '../editor/nav-keys';
import { isReading, toggleRead } from '../editor/read';
import { Home } from './Home';
import { Settings } from './Settings';
import { Confirm, nameList, type Ask } from './Confirm';
import { SaveAs } from './SaveAs';
import { docForMode, type SaveMode } from '../editor/save-modes';
import { Tips, parseTip } from './Tips';
import { OutlinePane } from './Outline';
import { FindBar } from './FindBar';
import { outlineNumbers } from '../editor/nav/numbering';
import { DOC_TOOLS } from '../editor/doc-tools';
import { CARD_TOOLS } from '../editor/card-tools';
import type { ToolSection } from '../editor/tools';
import { loadRecents, noteRecent, saveRecents, tidy, type Recent } from './recents';
import { P, onPrefs, pref } from '../editor/prefs';
import { readJson, safeSet } from './storage';
import { reducedMotion } from './motion';

const MODE_NAME: Record<SaveMode, string> = { asis: '', send: 'send doc', read: 'read doc', marked: 'marked doc' };
const AUTOSAVE_KEY = 'falcon.autosave.v2'; // [{ meta, doc, active, dirty, speech }]: the open doc and every unsaved one
const OLD_AUTOSAVE_KEY = 'falcon.autosave.v1'; // one doc, before several could be open
/** A command's key as text, for messages: ⌘S. */
const keyLabel = (id: string) => keyText(keyOf(id));
/** The keys that swap the document out, which read mode and Settings hold back. */
const SWAPS = ['home', 'new', 'open', 'close', 'nextDoc', 'prevDoc'];
/** The commands the app runs itself (the editor's keymap runs the rest). */
const APP_IDS = ['search', 'commands', 'save', 'saveAs', 'find', 'open', 'new', 'close', 'nextDoc', 'prevDoc', 'home', 'settings', 'outline', 'zoomIn', 'zoomOut', 'zoomReset'];

// Above this size the JSON copy takes tens of ms and won't fit in browser storage anyway.
const AUTOSAVE_MAX = 400_000;

// Pictures (data URLs) are counted in characters; browser storage holds about 5M of them in all.
const AUTOSAVE_MEDIA_MAX = 3_000_000;

type Backup = { meta: DocMeta; doc: PMNode; active: boolean; dirty?: boolean; speech?: boolean };
type Json = { type?: string; attrs?: Record<string, unknown>; content?: Json[] };
const MEDIA_REF = 'falcon-media:';
/** A doc's JSON with each picture's data kept once in `media` (a file can use one logo hundreds of times). */
function packDoc(doc: PMNode, media: string[], index: Map<string, number>): Json {
  const walk = (n: Json) => {
    if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith('data:')) {
      let i = index.get(n.attrs.src);
      if (i === undefined) { i = media.push(n.attrs.src) - 1; index.set(n.attrs.src, i); }
      n.attrs = { ...n.attrs, src: `${MEDIA_REF}${i}` };
    }
    n.content?.forEach(walk);
  };
  const json = doc.toJSON() as Json;
  walk(json);
  return json;
}
function unpackDoc(json: Json, media: string[] | undefined): Json {
  if (!media) return json;
  const walk = (n: Json) => {
    const src = n.attrs?.src;
    if (n.type === 'image' && typeof src === 'string' && src.startsWith(MEDIA_REF)) n.attrs = { ...n.attrs, src: media[Number(src.slice(MEDIA_REF.length))] ?? '' };
    n.content?.forEach(walk);
  };
  walk(json);
  return json;
}
/** Characters of picture data a doc holds, each picture counted once. */
function mediaSize(doc: PMNode): number {
  const seen = new Set<string>();
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === 'image' && !seen.has(node.attrs.src)) { seen.add(node.attrs.src); n += node.attrs.src.length; }
    return true;
  });
  return n;
}
/** Crash-recovery copy of the open doc and every unsaved one. Docs too big to keep are left out;
 *  returns false when the active doc was one of them. */
function autosave(list: Backup[]): boolean {
  if (!pref(P.crashRecovery)) { localStorage.removeItem(AUTOSAVE_KEY); return true; } // turned off in Settings
  // a doc whose pictures don't fit is left out whole: a copy without its pictures, saved, would lose them
  const keep = list.filter((b) => b.doc.content.size <= AUTOSAVE_MAX && mediaSize(b.doc) <= AUTOSAVE_MEDIA_MAX);
  const write = (l: Backup[]) => {
    const media: string[] = [], index = new Map<string, number>();
    const docs = l.map((b) => ({ meta: b.meta, active: b.active, dirty: b.dirty, speech: b.speech, doc: packDoc(b.doc, media, index) }));
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(media.length ? docs.map((d, i) => (i === 0 ? { ...d, media } : d)) : docs));
  };
  const kept = [...keep];
  for (;;) {
    try { write(kept); break; }
    catch { // storage full: let go of the biggest copy that isn't the open doc, the open doc last
      if (!kept.length) { localStorage.removeItem(AUTOSAVE_KEY); return false; }
      const drop = kept.filter((b) => !b.active).sort((a, b) => b.doc.content.size - a.doc.content.size)[0] ?? kept[0];
      kept.splice(kept.indexOf(drop), 1);
    }
  }
  localStorage.removeItem(OLD_AUTOSAVE_KEY);
  return kept.some((b) => b.active);
}
function loadBackups(): Backup[] {
  if (!pref(P.crashRecovery)) { localStorage.removeItem(AUTOSAVE_KEY); return []; } // turned off in Settings
  try {
    const v2 = localStorage.getItem(AUTOSAVE_KEY);
    if (v2) {
      const list = JSON.parse(v2) as { meta: DocMeta; doc: Json; active: boolean; dirty?: boolean; speech?: boolean; media?: string[] }[];
      const media = list[0]?.media;
      return list.map(({ media: _m, ...b }) => ({ ...b, doc: PMNode.fromJSON(schema, unpackDoc(b.doc, media)) }));
    }
    const v1 = localStorage.getItem(OLD_AUTOSAVE_KEY);
    if (v1) return [{ meta: readJson<DocMeta>('falcon.meta', { name: 'Untitled' }), doc: PMNode.fromJSON(schema, JSON.parse(v1)), active: true }];
  } catch { /* corrupt autosave: start blank */ }
  return [];
}
const whenIdle = (f: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 0));

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

/** A toast message, with an optional button (Undo after a send). */
type Toast = { msg: string; action?: { label: string; run: () => void } };

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
  const [docs, setDocs] = useState<OpenDoc[]>(() => [{ id: 1, meta: { name: 'Untitled' }, dirty: false, state: null, scroll: 0 }]);
  const [activeId, setActiveId] = useState(1);
  const activeRef = useRef(1);
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const active = docs.find((d) => d.id === activeId) ?? docs[0];
  const meta = active.meta, dirty = active.dirty;
  // the one open doc that `~` sends to; null until the first send or the Speech doc button
  const [speechId, setSpeechId] = useState<number | null>(null);
  const speechRef = useRef(speechId);
  speechRef.current = speechId;
  const [toast, setToast] = useState<Toast | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(() => pref(P.openHome));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<string | undefined>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [settingsQuery, setSettingsQuery] = useState<string | undefined>();
  // the open warning dialog, if any: everything else waits for it
  const [ask, setAsk] = useState<Ask | null>(null);
  const [saveAsName, setSaveAsName] = useState<string | null>(null); // the Save As dialog is up, offering this name
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
    flashRef.current?.(`This file is too big for crash recovery. Save often (${keyLabel('save')}).`);
  };
  const flashRef = useRef<((m: string) => void) | null>(null);
  const flash = useCallback((msg: string, action?: Toast['action']) => {
    const t: Toast = { msg, action };
    setToast(t);
    window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), action || msg.includes('crash recovery') ? 6000 : 2200);
  }, []);
  flashRef.current = flash;

  /** Back up the active doc and every unsaved one (state is read from refs, so call it after renders). */
  const backup = useCallback(() => autosave(docsRef.current.flatMap((d) => {
    const isActive = d.id === activeRef.current;
    const doc = isActive ? viewRef.current?.state.doc : d.state?.doc;
    const speech = d.id === speechRef.current;
    // the speech doc is kept even when saved, so its marker comes back after a crash
    return doc && (isActive || d.dirty || speech) ? [{ meta: d.meta, doc, active: isActive, dirty: d.dirty, speech: speech || undefined }] : [];
  })), []);
  const backupSoon = useRef(() => {});
  useEffect(() => {
    const backups = loadBackups();
    const first = backups.find((b) => b.active) ?? backups[0];
    const doc = first?.doc;
    // a recovered doc with unsaved changes must ask before closing; the file you last had open, untouched
    // since its save, comes back clean (backups from before the flag guess: anything with text is unsaved)
    const restored: OpenDoc[] = backups.map((b) => ({ id: b === first ? 1 : nextDocId++, meta: b.meta, dirty: b.dirty ?? (b !== first || !!b.doc.textContent.trim()), state: b === first ? null : createState(b.doc), scroll: 0 }));
    if (restored.length) {
      setDocs(restored);
      const spoken = backups.findIndex((b) => b.speech);
      if (spoken >= 0) setSpeechId(restored[spoken].id);
    }
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

  useEffect(() => { document.documentElement.style.setProperty('--zoom', String(zoom)); safeSet('falcon.zoom', String(zoom)); }, [zoom]);
  useEffect(() => { safeSet('falcon.outline', showOutline ? 'on' : 'off'); }, [showOutline]);
  useEffect(() => { safeSet('falcon.depth', String(depth)); }, [depth]);
  useEffect(() => { safeSet('falcon.speech', String(speechMin)); }, [speechMin]);
  useEffect(() => { saveRecents(recents); }, [recents]);
  // the list changed (switch, open, close, saved): refresh the crash-recovery copy once React has settled
  useEffect(() => { if (viewRef.current) whenIdle(() => { backup(); }); }, [docs, activeId, speechId, backup]);
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
    const blank = !cur.dirty && !cur.meta.path && !v.state.doc.textContent.trim() && v.state.doc.childCount <= 1 && cur.id !== speechRef.current;
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
    setSpeechId((s) => (s === id ? null : s));
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
    flash(addDoc(r.doc, r.meta) ? `Opened ${r.meta.name}` : `Opened ${r.meta.name}. It's too big for crash recovery, so save often (${keyLabel('save')}).`);
  }, [addDoc, switchTo, flash]);
  const fileNew = useCallback(() => { addDoc(emptyDoc(), { name: 'Untitled' }); }, [addDoc]);
  const fileOpen = useCallback(async () => {
    try {
      const r = await openDocument();
      if (r) opened(r);
    } catch (e) { flash(`Couldn't open: ${(e as Error).message}`); }
  }, [opened, flash]);
  /** Opening `path` failed (moved, deleted): say so, and stop listing it in the recents. */
  const openFailed = useCallback((name: string, path: string, e: unknown) => {
    setRecents((list) => list.filter((r) => r.path !== path));
    flash(`Couldn't open ${name}: ${(e as Error).message}`);
  }, [flash]);
  const openRecent = useCallback(async (r: Recent) => {
    const already = openedPath(r.path) ?? (!r.path ? docsRef.current.find((d) => !d.meta.path && d.meta.name === r.name) : undefined);
    if (already) { switchTo(already.id); return; }
    if (!r.path || !bridge.openPath) { void fileOpen(); return; }
    try { opened(await openPath(r.path)); }
    catch (e) { openFailed(r.name, r.path, e); }
  }, [opened, fileOpen, switchTo, openFailed]);
  // Cmd-K: an open doc switches to it; anything else opens by path (indexed folders and recents are allowed)
  const openHit = useCallback(async (h: FileHit) => {
    setHomeOpen(false);
    if (h.docId !== undefined && docsRef.current.some((d) => d.id === h.docId)) { switchTo(h.docId); return; }
    const already = openedPath(h.path);
    if (already) { switchTo(already.id); return; }
    if (!h.path || !bridge.openPath) { void fileOpen(); return; }
    try { opened(await openPath(h.path)); }
    catch (e) { openFailed(h.name, h.path, e); }
  }, [opened, fileOpen, switchTo, openFailed]);
  /**
   * Write the active doc. As-Is is the document itself, so the open file takes its new name and path;
   * Send, Read and Marked docs are copies and the open file stays as it was.
   */
  const writeDoc = useCallback(async (meta: DocMeta, mode: SaveMode, as: boolean) => {
    const v = viewRef.current!;
    const id = activeRef.current;
    const saved = v.state.doc;
    const out = docForMode(saved, mode);
    if (!out) { flash(mode === 'marked' ? 'No marked cards: mark one with red text first' : 'Nothing to save'); return; }
    try {
      const m = await saveDocument(out, meta, as);
      if (!m) return;
      // another tab on this file would overwrite it on Save: close it if clean, else keep its edits but unbind it.
      // dropDoc sets the tab list from a snapshot, so this runs before patch(id) below or it would undo the new path
      for (const o of docsRef.current) {
        if (o.id === id || !m.path || o.meta.path !== m.path) continue;
        if (o.dirty) patch(o.id, { meta: { name: o.meta.name } }); else dropDoc(o.id);
      }
      if (mode !== 'asis') { flash(`Saved ${MODE_NAME[mode]} ${m.name}`); return; }
      // typing during the save keeps the doc marked unsaved
      const now = activeRef.current === id ? viewRef.current!.state.doc : docsRef.current.find((x) => x.id === id)?.state?.doc;
      patch(id, { meta: m, dirty: now !== saved });
      setRecents((list) => noteRecent(list, saved, m));
      flash(`Saved ${m.name}`);
    } catch (e) { flash(`Couldn't save: ${(e as Error).message}`); }
  }, [patch, flash, dropDoc]);
  /** Save writes the open file; Save As opens the dialog, which calls `saveCopy`. */
  const fileSave = useCallback(async (as = false) => {
    const d = docsRef.current.find((x) => x.id === activeRef.current)!;
    if (as) { setSaveAsName(!d.meta.path && (d.meta.name || 'Untitled') === 'Untitled' ? newFileName() : d.meta.name); return; }
    await writeDoc(d.meta, 'asis', false);
  }, [writeDoc]);
  const saveCopy = (mode: SaveMode, name: string) => { setSaveAsName(null); void writeDoc({ name }, mode, true); };
  const closeSaveAs = useCallback(() => setSaveAsName(null), []);

  const openFind = useCallback(() => { setHomeOpen(false); setFindOpen(true); setTimeout(() => { findRef.current?.focus(); findRef.current?.select(); }, 0); }, []);
  const zoomBy = useCallback((d: number) => setZoom((z) => Math.max(0.5, Math.min(3, +(z + d).toFixed(2)))), []);

  /** `~`: copy the selection (or the card or section at the caret) into the speech doc without leaving this file. */
  const sendToSpeech = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    if (speechRef.current === activeRef.current) { flash('This is the speech doc. Switch to a file to send from it.'); return; }
    const sent = sendContent(v.state);
    if (!sent) { flash('Nothing to send. Put the caret in a card or select some text.'); return; }
    let target = docsRef.current.find((d) => d.id === speechRef.current);
    let base = target?.state;
    if (!target || !base) {
      // the speech doc is made on the first send, beside this file, and stays in the background
      const names = new Set(docsRef.current.map((d) => d.meta.name));
      let name = 'Speech';
      for (let n = 2; names.has(name); n++) name = `Speech ${n}`;
      target = { id: nextDocId++, meta: { name }, dirty: false, state: null, scroll: 0 };
      base = createState(emptyDoc());
      const made = target;
      setDocs((ds) => { const i = ds.findIndex((d) => d.id === activeRef.current); const n = [...ds]; n.splice(i + 1, 0, made); return n; });
      speechRef.current = made.id;
      setSpeechId(made.id);
    }
    const { id } = target, speechName = target.meta.name || 'Speech';
    const next = base.apply(insertIntoSpeech(base, sent.content));
    patch(id, { state: next, dirty: true });
    // Undo only while the speech doc is still exactly as the send left it, so it can't undo later typing
    const takeBack = () => {
      const isView = id === activeRef.current;
      const now = isView ? viewRef.current?.state : docsRef.current.find((d) => d.id === id)?.state;
      if (!now) return;
      if (now.doc !== next.doc) { flash(`${speechName} has changed since. Undo it there with ${keyText('Mod-z')}.`); return; }
      undo(now, (tr) => { if (isView) viewRef.current!.dispatch(tr); else patch(id, { state: now.apply(tr), dirty: true }); });
    };
    flash(`Sent “${sent.label}” to ${speechName}`, { label: 'Undo', run: takeBack });
  }, [flash, patch]);
  const toggleSpeech = useCallback(() => {
    const here = activeRef.current;
    speechRef.current = speechRef.current === here ? null : here;
    setSpeechId(speechRef.current);
  }, []);

  // the Mac File menu (its shortcuts are labels only: the keys arrive here as usual)
  const menuRef = useRef<(c: string) => void>(() => {});
  // nothing swaps the document out behind Settings or during a read-mode speech
  const locked = () => settingsRef.current || paletteRef.current || ccRef.current || !!askRef.current || saveAsRef.current !== null || (!!viewRef.current && isReading(viewRef.current.state));
  menuRef.current = (c) => {
    if (askRef.current || saveAsRef.current) return; // a warning or Save As is up: it gets answered first
    if (paletteRef.current || ccRef.current) return; // file search or the command center is up: it gets closed first
    if (c === 'settings') { setSettingsOpen(true); return; }
    if (locked() && c !== 'save' && c !== 'saveAs') return;
    if (c === 'new') fileNew(); else if (c === 'open') void fileOpen(); else if (c === 'save') void fileSave(false);
    else if (c === 'saveAs') void fileSave(true); else if (c === 'close') closeDoc(activeRef.current); else if (c === 'settings') setSettingsOpen(true);
  };
  useEffect(() => bridge.onMenu?.((c) => menuRef.current(c)), []);
  // the Mac menu shows the keys Settings > Keybindings has for its items
  useEffect(() => {
    const send = () => bridge.setMenuKeys?.(Object.fromEntries(['settings', 'new', 'open', 'save', 'saveAs', 'close'].map((id) => [id, keyOf(id)])));
    send();
    return onPrefs(send);
  }, []);

  /** The app's own commands, by binding id: its keys and the command center both run them here. */
  const appCommand = useCallback((id: string) => {
    if (id === 'nextDoc' || id === 'prevDoc') cycle(id === 'nextDoc' ? 1 : -1);
    else if (id === 'save' || id === 'saveAs') void fileSave(id === 'saveAs');
    else if (id === 'find') openFind();
    else if (id === 'open') void fileOpen();
    else if (id === 'new') fileNew();
    else if (id === 'close') closeDoc(activeRef.current);
    else if (id === 'home') setHomeOpen((h) => !h);
    else if (id === 'settings') setSettingsOpen((o) => !o);
    else if (id === 'outline') setShowOutline((o) => !o);
    else if (id === 'zoomIn') zoomBy(0.1);
    else if (id === 'zoomOut') zoomBy(-0.1);
    else if (id === 'zoomReset') setZoom(1);
    else if (id === 'commands') setCcOpen((o) => !o);
  }, [fileSave, fileOpen, fileNew, openFind, closeDoc, cycle, zoomBy]);

  // app-level shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Settings is listening for a new shortcut: every key goes to it
      if (isRecording()) return;
      // a warning is up: its own keys (Tab, Enter, Esc) and nothing else
      if (askRef.current) { if (e.ctrlKey || e.metaKey) e.preventDefault(); return; }
      // Save As is up: its name field keeps text editing keys, nothing else
      if (saveAsRef.current) { if ((e.ctrlKey || e.metaKey) && !/^[acvxz]$/i.test(e.key)) e.preventDefault(); return; }
      // ~ sends to the speech doc, so the page can never type one (AltGr layouts too: their ~ arrives with Ctrl+Alt held). Boxes with their own text field keep it.
      if (e.key === '~' && (!e.ctrlKey || e.getModifierState?.('AltGraph')) && !e.metaKey && !settingsRef.current && !e.isComposing && !homeRef.current && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && !(viewRef.current && isReading(viewRef.current.state))) {
        e.preventDefault(); e.stopPropagation();
        if (!e.repeat) sendToSpeech();
        return;
      }
      // AltGr types characters (it arrives as Ctrl+Alt on Windows: AltGr+ß is "\\"), never shortcuts
      if (e.getModifierState?.('AltGraph') || (!IS_MAC && e.ctrlKey && e.altKey)) return;
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      // Mod-Shift-] and [ also switch documents
      const bracket = mod && e.shiftKey && !e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft');
      const id = bracket ? (e.code === 'BracketRight' ? 'nextDoc' : 'prevDoc') : pressedId(e, APP_IDS);
      const v = viewRef.current;
      // read mode locks the keyboard: nothing that swaps the document out
      if (id && SWAPS.includes(id) && v && isReading(v.state)) return;
      // Search files opens the palette (or closes it); while it's up, only its own keys get through
      if (id === 'search') { e.preventDefault(); e.stopPropagation(); if (paletteRef.current) setPaletteOpen(false); else if (!locked()) setPaletteOpen(true); return; }
      if (paletteRef.current) { if (mod && !/^[acvxz]$/i.test(e.key)) e.preventDefault(); return; }
      // the command center opens over anything but Settings (or closes); while it's up, its box gets the keys
      if (id === 'commands') { e.preventDefault(); e.stopPropagation(); if (ccRef.current) setCcOpen(false); else if (!settingsRef.current) { setHomeOpen(false); setCcOpen(true); } return; }
      if (ccRef.current) { if (mod && !/^[acvxyz]$/i.test(e.key)) e.preventDefault(); return; }
      // Settings is modal: only its own keys (Esc, its shortcut) get through
      if (settingsRef.current && !(e.key === 'Escape' || id === 'settings')) { if (mod) e.preventDefault(); return; }
      // Esc in a filled Settings search clears the search before it closes Settings
      if (e.key === 'Escape' && settingsRef.current && e.target instanceof HTMLInputElement && e.target.closest('.st-search') && e.target.value) return;
      if (e.key === 'Escape' && settingsRef.current) { e.preventDefault(); e.stopPropagation(); setSettingsOpen(false); return; }
      if (e.key === 'Escape' && homeRef.current) { e.preventDefault(); e.stopPropagation(); setHomeOpen(false); return; }
      if (!id) return;
      e.preventDefault();
      if (id === 'nextDoc' || id === 'prevDoc') { e.stopPropagation(); if (locked()) return; }
      appCommand(id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [appCommand, sendToSpeech]);
  const homeRef = useRef(homeOpen);
  homeRef.current = homeOpen;
  const settingsRef = useRef(settingsOpen);
  const saveAsRef = useRef(saveAsName);
  saveAsRef.current = saveAsName;
  settingsRef.current = settingsOpen;
  const paletteRef = useRef(paletteOpen);
  paletteRef.current = paletteOpen;
  const ccRef = useRef(ccOpen);
  ccRef.current = ccOpen;
  useEffect(() => { if (!settingsOpen && !ask && saveAsName === null && !paletteOpen && !ccOpen && !homeRef.current) viewRef.current?.focus(); }, [settingsOpen, ask, saveAsName, paletteOpen, ccOpen]);

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
    } else run(commandOf(kind));
  };

  const ink = activeColors.highlight === null ? '#00e5ff' : HIGHLIGHTS[activeColors.highlight] ?? activeColors.highlight;
  const reading = view ? isReading(view.state) : false;
  const name = meta.name || 'Untitled';
  const docList = docs.map((d) => ({ id: d.id, name: d.meta.name || 'Untitled', path: d.meta.path, dirty: d.dirty, speech: d.id === speechId }));

  // ---- settings that act on the app (the rest act through CSS or in the editor) ----
  const [, setPrefTick] = useState(0);
  useEffect(() => onPrefs(() => setPrefTick((t) => t + 1)), []); // redraw: word-count speeds, recents, the timer
  // Opens by path run one at a time: two at once both read the tab list before either adds its tab,
  // and one is lost (or the same file opens twice). Last session's files and OS opens share the queue.
  const pathQueue = useRef(Promise.resolve());
  const queueOpens = useCallback((paths: string[], quiet: boolean) => {
    pathQueue.current = pathQueue.current.then(async () => {
      for (const p of paths) {
        if (quiet && openedPath(p)) continue;
        try { opened(await openPath(p)); }
        catch (e) { if (!quiet) flash(`Couldn't open ${p.split(/[\\/]/).pop()}: ${(e as Error).message}`); }
      }
    });
  }, [opened, flash]);
  const queueRef = useRef(queueOpens);
  queueRef.current = queueOpens;
  // reopen last files: the files open at the last quit, read before the list below is rewritten
  const [lastSession] = useState(() => readJson<string[]>('falcon.session', []));
  const reopened = useRef(false);
  useEffect(() => {
    if (!hasView || reopened.current) return;
    reopened.current = true;
    if (pref(P.reopen) && bridge.openPath) queueOpens(lastSession, true); // moved or deleted since: skipped
  }, [hasView]); // eslint-disable-line react-hooks/exhaustive-deps
  // files double-clicked in Finder/Explorer (or Open With): open each, or switch to it if it's already open
  useEffect(() => (hasView ? bridge.onOpenPaths?.((ps) => queueRef.current(ps, false)) : undefined), [hasView]);
  useEffect(() => { safeSet('falcon.session', JSON.stringify(docs.flatMap((d) => (d.meta.path ? [d.meta.path] : [])))); }, [docs]);
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

  // what the command center can reach: every app action, the editor, and the state Settings shows
  const openSettingsAt = useCallback((page: string, query?: string) => { setSettingsPage(page); setSettingsQuery(query); setSettingsOpen(true); }, []);
  const ccCtx: Ctx = {
    view, zoom, setZoom, depth, setDepth, showOutline, setShowOutline, speechMin, setSpeechMin,
    run: (cmd) => { const v = viewRef.current; if (!v) return false; setHomeOpen(false); return cmd(v.state, v.dispatch, v); },
    app: appCommand,
    blocked: (id) => SWAPS.includes(id) && reading,
    highlight: activeColors.highlight, setHighlight: (c) => { setActiveColor('highlight', c); setTick((t) => t + 1); },
    isSpeech: speechId === activeId, toggleSpeech, sendToSpeech,
    jump: (i) => { const v = viewRef.current; const it = v && buildOutline(v.state.doc)[i]; if (it) { setHomeOpen(false); jump(it, i); } },
    peek: (i) => { const v = viewRef.current, it = outlineRef.current[i]; if (v && it && it.pos < v.state.doc.content.size) scrollToPos(v, it.pos); },
    find: (text, replace) => {
      const v = viewRef.current;
      if (!v) return;
      setFindQuery(v, text, readSetting(findOrderSetting) === 'grouped');
      if (replace) requestFind({ replace: true }); else openFind();
      // an open find bar keeps what it had typed: give it the new text
      requestAnimationFrame(() => { if (findRef.current) findRef.current.value = text; });
    },
    openSettings: openSettingsAt,
    docs: docList, recents, openFile: (h) => void openHit(h),
  };
  const saveScroll = useCallback(() => {
    const sc = scrollRef.current, top = sc?.scrollTop ?? 0;
    return () => { stopScroll(); if (sc) sc.scrollTop = top; };
  }, []);

  const modal = settingsOpen || paletteOpen || ccOpen || !!ask || saveAsName !== null;
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
        onSend={sendToSpeech}
        onPick={(kind, c) => { setActiveColor(kind, c); setTick((t) => t + 1); const v = viewRef.current; if (v && !v.state.selection.empty) run(commandOf(kind)); }}
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
        onRead={() => { setHomeOpen(false); run(toggleRead); }}
        speech={speechId === activeId} onSpeech={toggleSpeech} />
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
        <span>Doc: {words.toLocaleString('en-US')} · Reader 1: {clock((words / pref(P.wpm1)) * 60)} · Reader 2: {clock((words / pref(P.wpm2)) * 60)}{sel && sel.selWords ? ` | Sel: ${sel.selWords}` : ''}</span>
        {brush && <span className="lit">Paintbrush on · Esc to stop</span>}
        {reading && <span className="lit">Read mode · keyboard locked · Space drops a marker</span>}
        <span className="grow" />
        <button title={titled('Zoom out', 'zoomOut', 'make the page smaller')} onClick={() => zoomBy(-0.1)}>−</button>
        <button className="zoom" title={titled('Actual size', 'zoomReset', 'back to 100%')} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button title={titled('Zoom in', 'zoomIn', 'make the page bigger')} onClick={() => zoomBy(0.1)}>+</button>
      </footer>
      </div>

      <div className="covered" inert={!!ask}>
      <Home open={homeOpen} current={dirty || meta.path ? name : ''} recents={recents.slice(0, pref(P.recentCount))}
        onNew={fileNew} onOpen={() => void fileOpen()} onRecent={(r) => void openRecent(r)}
        onClear={(keep) => setRecents((cur) => (keep ? [...cur, ...keep.filter((k) => !cur.some((c) => c.name === k.name && c.path === k.path))] : []))} />
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} docs={docList} recents={recents} onPick={(h) => void openHit(h)}
        onSettings={() => { setSettingsPage('search'); setSettingsOpen(true); }} />
      <CommandCenter open={ccOpen} onClose={() => setCcOpen(false)} ctx={ccCtx} flash={flash} saveScroll={saveScroll} />
      <Settings open={settingsOpen} onClose={() => { setSettingsOpen(false); setSettingsPage(undefined); setSettingsQuery(undefined); }} startPage={settingsPage} startQuery={settingsQuery}
        zoom={zoom} onZoom={setZoom} speechMin={speechMin} onSpeechMin={setSpeechMin}
        showOutline={showOutline} onShowOutline={setShowOutline} depth={depth} onDepth={setDepth}
        highlight={activeColors.highlight} onHighlight={(c) => { setActiveColor('highlight', c); setTick((t) => t + 1); }} />
      </div>
      <Confirm ask={ask} />
      <SaveAs name={saveAsName} onSave={saveCopy} onClose={closeSaveAs} />
      <div className={`toast${toast ? ' show' : ''}${toast?.action ? ' has-action' : ''}`} role="status">
        {toast?.msg}
        {toast?.action && <button onMouseDown={(e) => e.preventDefault()} onClick={() => { const a = toast.action!; setToast(null); a.run(); }}>{toast.action.label}</button>}
      </div>
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

/** Seconds as m:ss. */
const clock = (sec: number) => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- the rail: Home, one button per open document, and Settings, down the far left ----------

type DocRow = { id: number; name: string; path?: string; dirty: boolean; speech: boolean };
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
      <button ref={logo} className="sb-logo" title={titled('Home', 'home', 'recent files and new documents')} aria-label="Home" data-on={props.home || undefined} onClick={props.onHome}><SvgIcon name="logo" /></button>
      <div ref={strip} className="fs-docs" role="tablist" aria-label="Open documents" onPointerEnter={show} onPointerLeave={hide}
        onScroll={(e) => { if (list.current) list.current.scrollTop = e.currentTarget.scrollTop; }}>
        {props.docs.map((d) => (
          <div key={d.id} className="doc-row" data-on={isOn(d) || undefined}>
            <button className="fs-b doc-nm" role="tab" aria-selected={isOn(d)} aria-label={d.speech ? `${d.name} (speech doc)` : d.name} data-on={isOn(d) || undefined}
              onClick={() => props.onSwitch(d.id)} onAuxClick={(e) => { if (e.button === 1) props.onClose(d.id); }}>
              <SvgIcon name="doc" />{d.dirty && <i className="dot" aria-label="unsaved" />}{d.speech && <i className="spk" aria-hidden="true">S</i>}
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
                <SvgIcon name="doc" /><span className="nm">{tidy(d.name)}</span>{d.speech && <i className="spk" aria-hidden="true">S</i>}{d.dirty && <i className="dot" />}
              </button>
              <button tabIndex={-1} className="files-x" title={titled('Close', 'close', 'close this file')} onClick={() => props.onClose(d.id)}><SvgIcon name="x" /></button>
            </div>
          ))}
        </div>
      </aside>
      <div className="grow" />
      <button className="fs-b" title={titled('Settings', 'settings', 'highlight color, speech time, keys and more')} aria-label="Settings" data-on={props.settings || undefined} onClick={props.onSettings}><SvgIcon name="gear" /></button>
    </nav>
  );
}

// ---------- the tools: file and view buttons in a row above the outline ----------

function Tools(props: { outline: boolean; reading: boolean; speech: boolean; onNew: () => void; onOpen: () => void; onSave: (as: boolean) => void; onFind: () => void; onOutline: () => void; onRead: () => void; onSpeech: () => void }) {
  const b = (icon: string, title: string, onClick: (e: React.MouseEvent) => void, on = false) => (
    <button className="fs-b" title={title} aria-label={parseTip(title).label} data-on={on || undefined} aria-pressed={on || undefined} onClick={onClick}><SvgIcon name={icon} /></button>
  );
  return (
    <div className="tools" role="toolbar" aria-label="File and view">
      {b('plus', titled('New document', 'new', 'start a blank file'), props.onNew)}
      {b('open', titled('Open…', 'open', 'open a .docx file'), props.onOpen)}
      {b('save', titled('Save', 'save', 'save this file. Shift-click for Save As'), (e) => props.onSave(e.shiftKey))}
      {b('saveAs', titled('Save As…', 'saveAs', 'save a copy, as-is or as a send, read or marked doc'), () => props.onSave(true))}
      <span className="sep" />
      {b('search', titled('Find', 'find', 'search this file'), props.onFind)}
      {b('list', titled('Outline', 'outline', 'show or hide the list of pockets, hats, blocks and tags'), props.onOutline, props.outline)}
      {b('eye', titled('Read mode', 'read', 'show only what\'s read aloud'), props.onRead, props.reading)}
      {b('mic', 'Speech doc: make this file the speech doc, where ~ sends the selection. Click again to unmark it', props.onSpeech, props.speech)}
    </div>
  );
}

// ---------- the top bar: the Classic layout, a two-row grid where each button previews its style ----------

type SelState = ReturnType<typeof selectionState>;
type PopKind = 'highlight' | 'shading' | 'font' | 'size' | 'doc' | 'card';
const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48];
const SHADES = ['#D9D9D9', '#BFBFBF', '#F2F2F2', '#FFF2CC', '#FCE4D6', '#E2EFDA', '#DDEBF7', '#EDE7F6', '#FDE2E4', '#C6E0B4', '#BDD7EE', '#F8CBAD', '#FFE699', '#A9D08E', '#9BC2E6'];

function Toolbar(props: { sel: SelState | null; run: (c: Command) => void; brush: string | null; onColor: (k: 'highlight' | 'shading') => void; onPick: (k: 'highlight' | 'shading', c: string | null) => void; flash: (m: string) => void; reading: boolean; onRead: () => void; onSend: () => void; speechSeconds: number }) {
  const { sel, run } = props;
  const SPEECH_SECONDS = props.speechSeconds;
  const [pop, setPop] = useState<{ kind: PopKind; x: number; y: number; origin: number } | null>(null);
  const [fontColor, setFontColor] = useState<string | null>(() => localStorage.getItem('falcon.fontColor'));
  const popRef = useRef<HTMLDivElement>(null);

  // each button runs its key's command, and its tip shows the key Settings has for it now
  const style = (s: ParaStyle, label: string, cls: string, desc: string) => (
    <button className="b" data-on={sel?.style === s || undefined} title={titled(label, s, desc)} onMouseDown={(e) => { e.preventDefault(); run(commandOf(s)); }}>
      <span className={cls}>{label}</span>
    </button>
  );
  const mark = (name: string, label: string, cls: string, desc: string) => (
    <button className="b" data-on={sel?.marks.has(name) || undefined} title={titled(label, name, desc)} onMouseDown={(e) => { e.preventDefault(); run(commandOf(name)); }}>
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
  const toolMenu = (sections: ToolSection[]) => sections.length === 0
    ? <p className="mn-none">Nothing here yet</p>
    : sections.map((sec) => (
      <div key={sec.title} className="mn-sec" role="group" aria-label={sec.title}>
        <div className="mn-h">{sec.title}</div>
        {sec.items.map((it) => (
          <button key={it.label} className="mn-i" role="menuitem" title={it.hint}
            onMouseDown={(e) => { e.preventDefault(); setPop(null); run(it.run); }}>
            <span>{it.label}</span>{keyOf(it.id) && <kbd>{keyText(keyOf(it.id))}</kbd>}
          </button>
        ))}
      </div>
    ));

  const fontSize = fontSizeOf(sel);
  // with nothing selected the size applies to what you type next
  const setSize = (pt: number) => run(setFontSize(pt));
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
  // the command center starts, pauses and resets the clocks the same way a click does
  useEffect(() => {
    const on = (e: Event) => {
      const { which, op } = (e as CustomEvent<TimerRequest>).detail;
      const [full, setL, setR] = which === 'prep' ? [PREP_SECONDS, setPrepLeft, setPrepRunning] : [SPEECH_SECONDS, setLeft, setRunning];
      if (op === 'reset') { setR(false); setL(full); return; }
      setL((s) => (s === 0 ? full : s));
      setR((r) => !r);
    };
    addEventListener(TIMER_EVENT, on);
    return () => removeEventListener(TIMER_EVENT, on);
  }, [SPEECH_SECONDS, PREP_SECONDS]);
  const low = (on: boolean, s: number) => (on && s <= pref(P.lowTime) ? ' low' : '');

  return (
    <header className="toolbar">
      <div className="bar">
        <div className="g">
          {style('pocket', 'Pocket', 'pv box', 'turn this line into a pocket, the biggest heading')}{style('tag', 'Tag', 'pv', 'turn this line into a card tag')}
          {style('hat', 'Hat', 'pv uu', 'turn this line into a hat, the heading above blocks')}{style('block', 'Block', 'pv u', 'turn this line into a block heading')}
          {style('analytic', 'Analytic', 'pv an', 'turn this line into an analytic, a tag with no card')}{style('undertag', 'Undertag', 'ut', 'turn this line into an undertag, the note under a tag')}
        </div>
        <div className="g">
          {mark('cite', 'Cite', 'pv', 'mark the selection as the cite')}{mark('underline', 'Underline', 'u', 'underline the selection')}
          {mark('emphasis', 'Emphasis', 'pv u box', 'bold, underline and box the selection')}
          <button className="b" title={titled('Clear', 'clear', 'remove formatting from the selection, or this line')} onMouseDown={(e) => { e.preventDefault(); run(commandOf('clear')); }}>Clear</button>
        </div>
        <div className="g">
          {pair('highlight', <SvgIcon name="pen" />, titled('Highlight', 'highlight', 'highlight the selection. With nothing selected, turns on a paintbrush'), () => props.onColor('highlight'), swatch('highlight'), props.brush === 'highlight')}
          {pair('shading', <SvgIcon name="bucket" />, titled('Background color', 'shading', 'shade the selection'), () => props.onColor('shading'), swatch('shading'), props.brush === 'shading')}
          {pair('font', <b className="fa">A</b>, 'Font color: color the selection\'s text', () => applyFont(fontColor), fontColor ?? 'var(--u-tx)')}
          <button className="b sm" title={titled('Shrink', 'shrink', 'make the text you don\'t read smaller. Press again to shrink more')} onMouseDown={(e) => { e.preventDefault(); run(commandOf('shrink')); }}>Shrink</button>
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
          <button className="b" data-on={props.reading || undefined} title={titled('Read mode', 'read', 'show only what\'s read aloud. Typing is locked and Space drops a marker')} onMouseDown={(e) => { e.preventDefault(); props.onRead(); }}>Read</button>
          <button className={`b timer${low(running, left)}`} data-on={running || undefined} title="Speech timer: click to start or pause. Right-click to reset"
            onMouseDown={(e) => { e.preventDefault(); if (e.button === 0) { if (left === 0) setLeft(SPEECH_SECONDS); setRunning((r) => !r); } }}
            onContextMenu={(e) => { e.preventDefault(); setRunning(false); setLeft(SPEECH_SECONDS); }}>
            {clock(left)}
          </button>
          <button className="b" title="Send to speech (~): copy the selection, or the card or section at the caret, into the speech doc. The file isn't changed, and the page can't type ~" onMouseDown={(e) => { e.preventDefault(); props.onSend(); }}>Send</button>
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
                onMouseDown={(e) => { e.preventDefault(); setFontColor(c); if (c) safeSet('falcon.fontColor', c); else localStorage.removeItem('falcon.fontColor'); setPop(null); applyFont(c); }} />
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
