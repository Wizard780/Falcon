import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { EditorView } from 'prosemirror-view';
import type { Command } from 'prosemirror-state';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { Fragment, Node as PMNode } from 'prosemirror-model';
import { undo } from 'prosemirror-history';
import { createState, createView, brushKey, emptyDoc } from '../editor/editor';
import { topChildAt } from '../editor/window';
import { commandOf } from '../editor/keymap';
import { useSmoothZoom } from './smooth-zoom';
import { IS_MAC, bindingOf, isRecording, keyOf, keyText, norm, pressed, pressedId, recordKey, titled } from '../editor/keybinds';
import { activeColors, bridge, setActiveColor, type CardHit, type CardSpot, type UpdateInfo, type WindowStart } from '../editor/host';
import { cardContent, findCard } from './card-search';
import { ago, releaseNotes } from './update';
import { HIGHLIGHTS, HIGHLIGHT_NAMES, SHADES, schema, type ParaStyle } from '../editor/schema';
import { buildOutline, currentItem, readSeconds, readSplit, type OutlineItem, type ReadSplit } from '../editor/outline';
import { toggleColorMark } from '../editor/commands';
import { fontSizeOf, setFontSize } from '../editor/font-size';
import { FONT_COLORS } from './swatches';
import { TIMER_EVENT, type TimerRequest } from './timer-event';
import { TimerWindow, useRoundClocks } from './TimerWindow';
import { insertIntoSpeech, sendContent } from '../editor/speech';
import { insertContent, insertLabel } from '../editor/linked-insert';
import { selectionState } from './selection-state';
import { Stopwatch, SvgIcon } from './icons';
import { newFileName, openDocument, speechFileName, openPath, saveDocument, type DocMeta } from './files';
import { trimSoon } from './quiet';
import type { Ctx } from './cc-sources';
import type { FileHit } from './file-search';
import { clearFind, findInfo, requestFind, setQuery as setFindQuery } from '../editor/find';
import { readSetting } from '../editor/tools';
import { findOrderSetting } from '../editor/nav-keys';
import { isReading, toggleRead } from '../editor/read';
import { Home } from './Home';
import { SHOW_EVENT, SpeechDrop, type SdTab } from './SpeechDrop';
import './display'; // the display settings (fonts, sizes, root classes) apply at startup
import './theme'; // so does the saved theme (Settings and the command center, which also import it, load later)
import { aiService, formatCite, reformatCites, reformatCount, usePreset } from '../editor/ai-cite';
import { Confirm, nameList, type Ask } from './Confirm';
import { ComparePanel } from './ComparePanel';
import { COMPARE_EVENT, selectionText } from '../editor/doc-tools/compare';
import { NewDoc, NewSpeech, SaveAs } from './SaveAs';
import { copyName, docForMode, type SaveMode } from '../editor/save-modes';
import { Tips, parseTip } from './Tips';
import { OutlinePane } from './Outline';
import { FindBar } from './FindBar';
import { outlineNumbers } from '../editor/nav/numbering';
import { DOC_TOOLS } from '../editor/doc-tools';
import { CARD_TOOLS } from '../editor/card-tools';
import type { ToolSection } from '../editor/tools';
import { RECENTS_KEY, loadRecents, noteRecent, peekHtml, saveRecents, tidy, type Recent } from './recents';
import { P, onPrefs, pref } from '../editor/prefs';
import { track, type DocSource } from './analytics';
import { pathName, templateName, type Template } from './templates';
import { readJson, safeSet } from './storage';
import { RAIL_MAX, RAIL_MIN, RAIL_NAMES, loadRail, railMax, railWidth, saveRail } from './rail';
import { reducedMotion } from './motion';
import { Switcher, holdMods, recentOrder, type Mod } from './Switcher';

// Settings, the command center and file search load the first time they open (and in the background once the
// app is up), so the first screen downloads and starts less code; so does the .docx code (files.ts)
function later<T extends { open: boolean }>(load: () => Promise<ComponentType<T>>) {
  let C: ComponentType<T> | null = null, loading: Promise<void> | null = null;
  // a failed load (offline, a newer build's chunk names) is tried again on the next open
  const preload = () => (loading ??= load().then((c) => { C = c; }, (e) => { loading = null; throw e; }));
  /** Mounts the component the first time `open` is true, and keeps it after (its closing animation needs it). */
  function Later(props: T) {
    const ever = useRef(false), [, loaded] = useState(0);
    if (props.open) ever.current = true;
    useEffect(() => { if (ever.current && !C) preload().then(() => loaded((n) => n + 1), () => {}); });
    return ever.current && C ? <C {...props} /> : null;
  }
  return Object.assign(Later, { preload });
}
const Settings = later(() => import('./Settings').then((m) => m.Settings));
const CommandCenter = later(() => import('./CommandCenter').then((m) => m.CommandCenter));
const Palette = later(() => import('./Palette').then((m) => m.Palette));
const CardSearch = later(() => import('./CardSearch').then((m) => m.CardSearch));
export const prefetch = () => Promise.all([Settings.preload(), CommandCenter.preload(), Palette.preload(), CardSearch.preload(), import('../docx/import'), import('../docx/export')]).catch(() => {}); // a miss loads again when used

const MODE_NAME: Record<SaveMode, string> = { asis: '', send: 'send doc', read: 'read doc', marked: 'marked doc' };
const MODE_PREFIX = { send: P.prefixSend, read: P.prefixRead, marked: P.prefixMarked };
const AUTOSAVE_KEY = 'falcon.autosave.v2'; // [{ meta, doc, active, dirty, speech }]: the open doc and every unsaved one
const OLD_AUTOSAVE_KEY = 'falcon.autosave.v1'; // one doc, before several could be open
let windowSlot = ''; // which recovery file is this window's ('' for the first window: see electron/main.cjs)
/** A command's key as text, for messages: ⌘S. */
const keyLabel = (id: string) => keyText(keyOf(id));
/** The keys that swap the document out, which read mode and Settings hold back. */
const SWAPS = ['home', 'new', 'newSpeech', 'open', 'close', 'nextDoc', 'prevDoc', 'recentDoc', 'recentDocBack', 'speechdrop'];
/** The commands the app runs itself (the editor's keymap runs the rest). */
/** Does this keydown send to speech? A changed key matches the way Settings recorded it (Shift-` is ~), an AltGr-typed character counts,
 *  and ` still counts on layouts where it's a dead accent key (US International). */
function sendPressed(e: KeyboardEvent) {
  const k = keyOf('sendToSpeech');
  if (!k) return false;
  return pressed(e, k) || (k !== bindingOf('sendToSpeech')?.key && norm(recordKey(e) ?? '') === norm(k)) || (!!e.getModifierState?.('AltGraph') && e.key === k)
    || (k === '`' && e.key === 'Dead' && e.code === 'Backquote' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey);
}
const APP_IDS = ['aiCite', 'reformatCites', ...Array.from({ length: 11 }, (_, i) => `aiPreset${i}`), 'search', 'searchCards', 'commands', 'save', 'saveAs', 'find', 'open', 'new', 'newSpeech', 'close', 'nextDoc', 'prevDoc', 'recentDoc', 'recentDocBack', 'speechdrop', 'home', 'settings', 'outline', 'zoomIn', 'zoomOut', 'zoomReset'];

// Above this size the JSON copy takes tens of ms and won't fit in browser storage anyway.
const AUTOSAVE_MAX = 400_000;

// Pictures (data URLs) are counted in characters; browser storage holds about 5M of them in all.
const AUTOSAVE_MEDIA_MAX = 3_000_000;

// The desktop app keeps the docs browser storage can't hold in a file instead (bridge.recovery), up to this
// size: a 30 MB backfile with pictures is about 6.5M and takes ~60 ms to copy; a block file is under 1M (~7 ms).
const DISK_MAX = 10_000_000;

type Backup = { meta: DocMeta; doc: PMNode; active: boolean; dirty?: boolean; speech?: boolean; at?: number };
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
/** Backups as JSON, each picture's data kept once (on the first entry), each with its place in the rail. */
function packList(list: Backup[], all: Backup[]): string {
  const media: string[] = [], index = new Map<string, number>();
  const docs = list.map((b) => ({ meta: b.meta, active: b.active, dirty: b.dirty, speech: b.speech, at: all.indexOf(b), doc: packDoc(b.doc, media, index) }));
  return JSON.stringify(media.length ? docs.map((d, i) => (i === 0 ? { ...d, media } : d)) : docs);
}
function unpackList(text: string): Backup[] {
  const list = JSON.parse(text) as { meta: DocMeta; doc: Json; active: boolean; dirty?: boolean; speech?: boolean; at?: number; media?: string[] }[];
  const media = list[0]?.media;
  return list.map(({ media: _m, ...b }) => ({ ...b, doc: PMNode.fromJSON(schema, unpackDoc(b.doc, media)) }));
}
let diskHeld = true; // the desktop recovery file may hold docs (from the last run, until the first backup)
/** Crash-recovery copy of the open doc and every unsaved one. Docs too big for browser storage go to the
 *  desktop app's recovery file, or are left out on the web; returns false when the active doc was left out. */
function autosave(list: Backup[]): boolean {
  if (!pref(P.crashRecovery)) { clearStorage(); clearDisk(); return true; } // turned off in Settings
  // Browser storage reaches disk seconds late, and later still with several windows writing to it, so a crash
  // can take the last edits. With a window per file, every copy goes straight to that window's recovery file
  const toDisk = !!bridge.recovery && (!!windowSlot || pref(P.fileWindows));
  // a doc whose pictures don't fit is left out whole: a copy without its pictures, saved, would lose them
  const kept = toDisk ? [] : list.filter((b) => b.doc.content.size <= AUTOSAVE_MAX && mediaSize(b.doc) <= AUTOSAVE_MEDIA_MAX);
  for (;;) {
    if (!kept.length) { clearStorage(); break; }
    try { localStorage.setItem(AUTOSAVE_KEY, packList(kept, list)); break; }
    catch { // storage full: let go of the biggest copy that isn't the open doc, the open doc last
      const drop = kept.filter((b) => !b.active).sort((a, b) => b.doc.content.size - a.doc.content.size)[0] ?? kept[0];
      kept.splice(kept.indexOf(drop), 1);
    }
  }
  localStorage.removeItem(OLD_AUTOSAVE_KEY);
  const disk = bridge.recovery ? list.filter((b) => !kept.includes(b) && b.doc.content.size <= DISK_MAX) : [];
  if (disk.length) { bridge.recovery!.write(packList(disk, list)); diskHeld = true; } else clearDisk();
  return kept.some((b) => b.active) || disk.some((b) => b.active);
}
/** The first window's copy in browser storage. The others have none, and this one isn't theirs to touch. */
function clearStorage() {
  if (!windowSlot) localStorage.removeItem(AUTOSAVE_KEY);
}
function clearDisk() {
  if (diskHeld && bridge.recovery) bridge.recovery.write('');
  diskHeld = false;
}
/** What windows that closed or crashed left behind: their unsaved docs and the speech doc. Taken once, by the only window left. */
function orphanBackups(): Backup[] {
  return (bridge.recovery?.orphans?.() ?? []).flatMap((t) => {
    try { return unpackList(t).filter((b) => b.dirty || b.speech).map((b) => ({ ...b, active: false })); }
    catch { return []; } // corrupt: skip it
  });
}
function loadBackups(start: WindowStart): Backup[] {
  diskHeld = true; // a new page: the file may hold the last run's docs
  if (start.backup) { // a doc handed to this new window, not a crash copy: it comes whatever Crash recovery says
    try { return unpackList(start.backup); } catch { return []; }
  }
  const orphans = start.alone ? orphanBackups() : []; // taking them removes them, so this comes after the return above
  if (!pref(P.crashRecovery)) { clearStorage(); clearDisk(); return []; } // turned off in Settings
  const out: Backup[] = [];
  try {
    const v2 = windowSlot ? null : localStorage.getItem(AUTOSAVE_KEY);
    const v1 = v2 || windowSlot ? null : localStorage.getItem(OLD_AUTOSAVE_KEY);
    if (v2) out.push(...unpackList(v2));
    else if (v1) out.push({ meta: readJson<DocMeta>('falcon.meta', { name: 'Untitled' }), doc: PMNode.fromJSON(schema, JSON.parse(v1)), active: true });
  } catch { /* corrupt autosave: start blank */ }
  try {
    const disk = bridge.recovery?.read();
    if (disk) out.push(...unpackList(disk));
  } catch { /* corrupt recovery file: skip it */ }
  // the two stores split one rail: put it back in order
  return [...(out.some((b) => b.at != null) ? out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)) : out), ...orphans];
}
const whenIdle = (f: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 0));

/** Smooth-scroll the page so `pos` sits just below the top. Paragraphs off screen have estimated
 *  heights (content-visibility), so the target moves as they render: the animation re-reads it every frame. */
let stopScroll = () => {};
function scrollToPos(view: EditorView, pos: number) {
  const sc = view.dom.closest('.f-scroll') as HTMLElement | null;
  // looked up each frame: a far paragraph's placeholder is replaced by the real one as the page nears it (window.ts).
  // Null once that paragraph is gone (another file shown, the paragraph edited, the pane closed), which ends the scroll
  const want = view.state.doc.nodeAt(pos);
  const node = () => (!view.isDestroyed && view.state.doc.nodeAt(pos) === want ? view.nodeDOM(pos) as HTMLElement | null : null);
  if (!sc || !node()) return;
  stopScroll();
  const target = () => Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, (node()?.getBoundingClientRect().top ?? 0) - sc.getBoundingClientRect().top + sc.scrollTop - 16));
  if (reducedMotion()) { for (let i = 0; i < 4; i++) sc.scrollTop = target(); return; }
  const from = sc.scrollTop, t0 = performance.now();
  const dur = Math.min(700, 300 + Math.abs(target() - from) / 20);
  let raf = 0, still = 0;
  const step = (now: number) => {
    if (!node()) { stopScroll(); return; }
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
/** A joined file's editor, side by side with the others (Join in the rail). */
type Pane = { view: EditorView; el: HTMLElement; scroll: HTMLDivElement; head: HTMLElement };
type Held = { state: EditorState; scroll: number };
const setTestView = (v: EditorView | null) => { (window as unknown as Record<string, unknown>).__falconView = v; };

export function App() {
  const appRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  // the main editor, which docs swap in and out of; joined files each get their own (panes). viewRef and
  // scrollRef are whichever one has focus: the toolbar, outline, find and keys act on it
  const mainView = useRef<EditorView | null>(null);
  const mainScroll = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const panes = useRef(new Map<number, Pane>());
  // read before anything touches the crash-recovery copy: it says which copy is this window's
  const [start] = useState<WindowStart>(() => { const s = bridge.windowStart?.() ?? { slot: '' }; windowSlot = s.slot; return s; });
  const splitBox = useRef<HTMLDivElement>(null);
  // the joined files, in rail order (one group at a time); shown side by side while one of them is the open doc
  const [group, setGroupState] = useState<number[] | null>(null);
  const groupRef = useRef(group);
  const setGroup = (g: number[] | null) => { groupRef.current = g; setGroupState(g); };
  const [splitOn, setSplitOn] = useState(false);
  /** The editor holding doc `id` right now (the focused one or another pane), or null when it's put away. */
  const liveView = (id: number) => (id === activeRef.current ? viewRef.current : panes.current.get(id)?.view ?? null);
  const liveState = (id: number) => liveView(id)?.state ?? docsRef.current.find((d) => d.id === id)?.state ?? null;
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
  // the one open doc that Send to speech sends to; null until the first send or the Speech doc button
  const [speechId, setSpeechId] = useState<number | null>(null);
  const speechRef = useRef(speechId);
  speechRef.current = speechId;
  const otherSpeech = useRef<string | null>(null); // the speech doc's name, when another window holds it
  const sentAway = useRef(new Map<string, () => string | undefined>()); // Undo for sends from other windows
  const nextSent = useRef(1);
  const [toast, setToast] = useState<Toast | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(() => pref(P.openHome) && !start.slot);
  // the SpeechDrop tabs, one per room (or the lobby), each a row in the rail after the docs; `sdLit` is the one
  // covering the page, as Home does. Home and it never both show.
  const [sdTabs, setSdTabs] = useState<{ key: number; info: SdTab }[]>([]);
  const [sdLit, setSdLit] = useState<number | null>(null);
  const sdOn = sdLit !== null;
  const sdTabsRef = useRef(sdTabs), sdLitRef = useRef(sdLit), sdOnRef = useRef(sdOn), sdLast = useRef<number | null>(null), sdNext = useRef(0);
  sdTabsRef.current = sdTabs;
  sdLitRef.current = sdLit;
  sdOnRef.current = sdOn;
  useEffect(() => { if (homeOpen) setSdLit(null); }, [homeOpen]);
  const showSd = useCallback((key: number) => { sdLast.current = key; setSdLit(key); setHomeOpen(false); }, []);
  const newSd = useCallback(() => {
    const key = sdNext.current++;
    setSdTabs((t) => [...t, { key, info: { room: null, fresh: 0 } }]);
    showSd(key);
  }, [showSd]);
  /** The SpeechDrop tab last shown, else the last one, else a new one. */
  const openSd = useCallback(() => {
    const t = sdTabsRef.current;
    const key = t.some((x) => x.key === sdLast.current) ? sdLast.current : t.at(-1)?.key;
    if (key === undefined || key === null) newSd(); else showSd(key);
  }, [newSd, showSd]);
  /** Before acting on the open doc: take Home or SpeechDrop off it, so the change is seen. */
  const showEditor = () => { setHomeOpen(false); setSdLit(null); };
  const closeSd = useCallback((key = sdLitRef.current) => {
    if (key === null) return;
    setSdTabs((t) => t.filter((x) => x.key !== key));
    if (sdLitRef.current === key) { setSdLit(null); viewRef.current?.focus(); }
  }, []);
  const sdInfo = useCallback((key: number, info: SdTab) => setSdTabs((t) => t.map((x) => (x.key === key ? { ...x, info } : x))), []);
  /** A room open in another SpeechDrop tab: that tab shows instead, and the lobby that asked closes. */
  const sdElsewhere = useCallback((key: number, code: string) => {
    const o = sdTabsRef.current.find((x) => x.key !== key && x.info.room?.code === code);
    if (!o) return false;
    setSdTabs((t) => t.filter((x) => x.key !== key));
    showSd(o.key);
    return true;
  }, [showSd]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<string | undefined>();
  // Search files (Cmd-K) or Search cards: one box at a time
  const [paletteOpen, setPaletteOpen] = useState<false | 'files' | 'cards'>(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [settingsQuery, setSettingsQuery] = useState<string | undefined>();
  // the open warning dialog, if any: everything else waits for it
  const [ask, setAsk] = useState<Ask | null>(null);
  const [compareWith, setCompareWith] = useState<string | null>(null); // Compare Text is open, Text 1 from this selection
  const [speechAsk, setSpeechAsk] = useState(false); // the New speech doc dialog is up
  const [newAsk, setNewAsk] = useState(false); // the + button's New Document dialog is up
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
  const lastDocs = useRef(new WeakMap<EditorView, PMNode>()); // each editor's doc at its last change
  // each doc as it was last opened or saved: an edit that puts it back the same makes it clean again
  const savedDocs = useRef(new Map<number, PMNode>());
  const isDirty = (id: number, doc: PMNode) => {
    const saved = savedDocs.current.get(id);
    return !saved || saved.content.size !== doc.content.size || !saved.eq(doc);
  };

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
  const mounted = useRef(true);
  const backup = useCallback(() => !mounted.current || autosave(docsRef.current.flatMap((d) => {
    const isActive = d.id === activeRef.current;
    const doc = liveState(d.id)?.doc;
    const speech = d.id === speechRef.current;
    // the speech doc is kept even when saved, so its marker comes back after a crash
    return doc && (isActive || d.dirty || speech) ? [{ meta: d.meta, doc, active: isActive, dirty: d.dirty, speech: speech || undefined }] : [];
  })), []);
  const backupSoon = useRef(() => {});
  const viewChanged = useRef<(v: EditorView, id: number) => void>(() => {});
  const measureRef = useRef(() => {}); // measureRead, for the panes' scroll listeners
  const paneDrag = useRef((_id: number, _e: PointerEvent) => {}); // dragPane, for the panes' name bars
  useEffect(() => {
    const backups = loadBackups(start);
    const first = backups.find((b) => b.active) ?? backups[0];
    const doc = first?.doc;
    // a recovered doc with unsaved changes must ask before closing; the file you last had open, untouched
    // since its save, comes back clean (backups from before the flag guess: anything with text is unsaved)
    const restored: OpenDoc[] = backups.map((b) => ({ id: b === first ? 1 : nextDocId++, meta: b.meta, dirty: b.dirty ?? (b !== first || !!b.doc.textContent.trim()), state: b === first ? null : createState(b.doc), scroll: 0 }));
    restored.forEach((d, i) => { if (!d.dirty) savedDocs.current.set(d.id, backups[i].doc); });
    if (restored.length) {
      setDocs(restored);
      const spoken = backups.findIndex((b) => b.speech);
      if (spoken >= 0) { speechRef.current = restored[spoken].id; setSpeechId(restored[spoken].id); }
    }
    let saveTimer = 0, outlineTimer = 0;
    backupSoon.current = () => { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => whenIdle(() => { if (!backup()) warnBig(); }), 800); };
    // an editor changed: `id` is the doc it holds. Only the focused one redraws the toolbar and outline
    viewChanged.current = (v, id) => {
      const focused = v === viewRef.current;
      if (focused) setTick((t) => t + 1);
      if (v.state.doc === lastDocs.current.get(v)) return;
      lastDocs.current.set(v, v.state.doc);
      const dirty = isDirty(id, v.state.doc);
      setDocs((ds) => (ds.some((d) => d.id === id && d.dirty !== dirty) ? ds.map((d) => (d.id === id ? { ...d, dirty } : d)) : ds));
      if (focused) {
        // the outline and word count walk the whole doc: refresh them when typing pauses, not per keystroke
        window.clearTimeout(outlineTimer);
        outlineTimer = window.setTimeout(() => setDocVersion((n) => n + 1), 150);
      }
      backupSoon.current();
    };
    // the main editor sits empty and hidden while joined files show: a settings redraw there isn't an edit
    const view = createView(mountRef.current!, (v) => { if (v === viewRef.current) viewChanged.current(v, activeRef.current); }, doc);
    lastDocs.current.set(view, view.state.doc);
    if (!restored.length) savedDocs.current.set(1, view.state.doc);
    mainView.current = viewRef.current = view;
    if (start.caretEnd) view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc))); // a new speech doc: typing starts under the pocket
    scrollRef.current = mainScroll.current;
    setTick(1);
    mounted.current = true;
    // leaving the page (reload, window closed) with a backup still waiting: write it now, or the last edits are lost
    const flush = () => { window.clearTimeout(saveTimer); backup(); };
    addEventListener('pagehide', flush);
    // a backup still waiting for idle time must not write over storage the next page (or test) starts from
    return () => {
      mounted.current = false; removeEventListener('pagehide', flush); window.clearTimeout(saveTimer); window.clearTimeout(outlineTimer); view.destroy();
      for (const p of panes.current.values()) p.view.destroy();
      panes.current.clear();
    };
  }, []);

  useEffect(() => { document.documentElement.style.setProperty('--zoom', String(zoom)); safeSet('falcon.zoom', String(zoom)); }, [zoom]);
  useEffect(() => { safeSet('falcon.outline', showOutline ? 'on' : 'off'); }, [showOutline]);
  useEffect(() => { safeSet('falcon.depth', String(depth)); }, [depth]);
  useEffect(() => { safeSet('falcon.speech', String(speechMin)); }, [speechMin]);
  useEffect(() => { saveRecents(recents); }, [recents]);
  // the list changed (switch, open, close, saved): refresh the crash-recovery copy once React has settled
  useEffect(() => { if (viewRef.current) whenIdle(() => { backup(); }); }, [docs, activeId, speechId, backup]);
  // a file closed or another one shows: what it held (its old page, the import, the backup's copy) can go
  const shown = useRef('');
  useEffect(() => { const k = `${activeId} ${docs.length}`; if (k !== shown.current) { shown.current = k; trimSoon(); } }, [docs.length, activeId]);
  // nothing clears the crash-recovery copy on the way out, so with it on these changes come back
  const unsavedFate = () => (pref(P.crashRecovery) ? "They won't be saved to the file, but Falcon brings them back next time it opens." : "They'll be lost.");
  // quitting or closing the window with unsaved docs: the page blocks it, the main process passes
  // the question back here, and Falcon's own dialog asks it
  useEffect(() => bridge.onConfirmClose?.((quit) => {
    if (!pref(P.confirmClose)) { bridge.forceClose?.(quit); return; }
    const names = docsRef.current.filter((d) => d.dirty).map((d) => d.meta.name || 'Untitled');
    const what = quit ? 'Quit' : 'Close';
    void confirmAsk({
      title: `${what} Falcon without saving?`,
      body: `${nameList(names)} ${names.length > 1 ? 'have' : 'has'} unsaved changes. ${unsavedFate()}`,
      ok: `${what} Without Saving`,
    }).then((yes) => { if (yes) bridge.forceClose?.(quit); });
  }), [confirmAsk]);
  // a newer Falcon: the button in the rail shows its download, then installs it and restarts
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const updateRef = useRef(update);
  useEffect(() => bridge.onUpdate?.((u) => {
    if (!u && updateRef.current?.state === 'downloading') flash("The update didn't finish downloading. Try again when you're online.");
    updateRef.current = u;
    setUpdate(u);
  }), [flash]);
  const installUpdate = useCallback(async () => {
    if (!update) return;
    if (!update.manual) { // manual only opens the disk image: nothing restarts
      const names = docsRef.current.filter((d) => d.dirty).map((d) => d.meta.name || 'Untitled');
      if (!(await confirmAsk({
        title: `Install Falcon ${update.version} and restart?`,
        body: names.length ? `${nameList(names)} ${names.length > 1 ? 'have' : 'has'} unsaved changes. ${unsavedFate()}` : 'Falcon will close and reopen on the new version.',
        ok: names.length ? 'Restart Without Saving' : 'Install and Restart',
      }))) return;
    }
    void bridge.installUpdate?.(update.version);
  }, [confirmAsk, update]);
  // no update waiting: the same spot in the rail checks now
  const [checking, setChecking] = useState(false);
  const checkUpdate = useCallback(async () => {
    setChecking(true);
    const r = await bridge.checkUpdate!().catch(() => 'failed' as const);
    setChecking(false);
    if (r === 'none') flash('Falcon is up to date');
    else if (r === 'failed') flash("Couldn't check for updates. Try again when you're online.");
  }, [flash]);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (docsRef.current.some((d) => d.dirty)) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', onUnload);
    return () => removeEventListener('beforeunload', onUnload);
  }, []);
  const view = viewRef.current;
  // home covers the editor: the editor gives up the keyboard while it shows, and gets it back after
  const hasView = tick > 0;
  useLayoutEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    if (homeOpen || sdOn) (v.dom as HTMLElement).blur(); else v.focus();
  }, [homeOpen, sdOn, hasView]);

  const run = useCallback((cmd: Command) => {
    const v = viewRef.current;
    if (!v) return;
    cmd(v.state, v.dispatch, v);
    v.focus();
  }, []);

  /** Where the page on screen starts: the doc position at the top of the view, for the switcher's previews. */
  const topPos = () => {
    const v = viewRef.current, sc = scrollRef.current;
    if (!v || !sc) return 0;
    const box = sc.getBoundingClientRect(), pm = v.dom.getBoundingClientRect();
    try { return v.posAtCoords({ left: pm.left + 4, top: Math.min(Math.max(box.top + 4, pm.top + 2), pm.bottom - 2) })?.pos ?? 0; } catch { return 0; }
  };
  const tops = useRef(new Map<number, number>());
  /** Put `state` in the editor as document `id`. The caller has already stashed the outgoing doc. */
  const show = useCallback((id: number, state: EditorState, scroll: number) => {
    const v = viewRef.current!;
    stopScroll();
    v.updateState(state);
    lastDocs.current.set(v, v.state.doc);
    activeRef.current = id;
    setActiveId(id);
    setDocVersion((n) => n + 1);
    if (scrollRef.current) scrollRef.current.scrollTop = scroll;
    setFindOpen(false); // find state belongs to the outgoing doc
    const backedUp = v.state.doc.content.size <= (bridge.recovery ? DISK_MAX : AUTOSAVE_MAX);
    warnedBig.current = !backedUp; // the open message carries the warning
    setHomeOpen(false);
    setSdLit(null);
    v.focus();
    setTick((t) => t + 1);
    return backedUp;
  }, []);
  /** The outgoing doc, ready to stash: its state and where it was scrolled to. */
  const stash = () => {
    const v = viewRef.current!;
    tops.current.set(activeRef.current, topPos());
    if (findInfo(v.state)) clearFind(v);
    setFindOpen(false);
    return { state: v.state, scroll: scrollRef.current?.scrollTop ?? 0 };
  };

  // ---- joined files: one editor per file, side by side ----
  /** Make pane `id` the one the toolbar, outline, find and keys act on; `take` moves the keyboard into it too. */
  const focusPane = useCallback((id: number, take = true) => {
    const p = panes.current.get(id);
    if (!p) return;
    if (viewRef.current !== p.view) {
      const old = viewRef.current;
      if (old && !old.isDestroyed && findInfo(old.state)) clearFind(old); // find belongs to the file it searched
      setFindOpen(false);
      stopScroll();
      viewRef.current = p.view;
      scrollRef.current = p.scroll;
      activeRef.current = id;
      setTestView(p.view);
      for (const [k, q] of panes.current) q.el.toggleAttribute('data-on', k === id);
      setActiveId(id);
      setDocVersion((n) => n + 1);
      setTick((t) => t + 1);
    }
    setHomeOpen(false);
    setSdLit(null);
    if (take) p.view.focus();
  }, []);
  /** Take pane `id` down; returns its doc as it was, to keep. */
  const dropPane = (id: number): Held | null => {
    const p = panes.current.get(id);
    if (!p) return null;
    if (findInfo(p.view.state)) clearFind(p.view);
    const held = { state: p.view.state, scroll: p.scroll.scrollTop };
    p.view.destroy();
    p.el.remove();
    panes.current.delete(id);
    return held;
  };
  /** Take every pane down and hand the keyboard back to the main editor; returns each doc as it was. */
  const releasePanes = () => {
    const held = new Map<number, Held>();
    for (const id of [...panes.current.keys()]) held.set(id, dropPane(id)!);
    delete appRef.current?.dataset.split;
    viewRef.current = mainView.current;
    scrollRef.current = mainScroll.current;
    setTestView(mainView.current);
    setSplitOn(false);
    setFindOpen(false);
    return held;
  };
  /**
   * Show `ids` side by side with `focus` focused, or with `ids` null, `focus` alone in the main editor.
   * Docs leaving an editor keep their state (undo history and scroll) in the tab list. `keepMain` false:
   * the doc in the main editor is being closed, so it isn't kept.
   */
  const arrange = useCallback((ids: number[] | null, focus: number, keepMain = true) => {
    const held = new Map<number, Held>();
    const fromMain = !panes.current.size;
    if (fromMain && keepMain) held.set(activeRef.current, stash());
    const want = new Set(ids ?? []);
    if (!ids) for (const [id, h] of releasePanes()) held.set(id, h);
    else for (const id of [...panes.current.keys()]) if (!want.has(id)) held.set(id, dropPane(id)!);
    const stateOf = (id: number): Held | null => {
      const d = docsRef.current.find((x) => x.id === id);
      return held.get(id) ?? (d?.state ? { state: d.state, scroll: d.scroll } : null);
    };
    const keep = (ds: OpenDoc[], live: Set<number>) => ds.map((d) => (live.has(d.id) ? { ...d, state: null } : held.has(d.id) ? { ...d, ...held.get(d.id)! } : d));
    if (!ids) {
      const s = stateOf(focus)!;
      setDocs((ds) => keep(ds, new Set([focus])));
      show(focus, s.state, s.scroll);
      return;
    }
    const box = splitBox.current!;
    if (fromMain) {
      // the main editor lets go of its doc (it would hold a second, stale copy) and hides
      const m = mainView.current!;
      m.updateState(createState(emptyDoc()));
      lastDocs.current.set(m, m.state.doc);
      appRef.current!.dataset.split = '';
    }
    ids.forEach((id, i) => {
      let p = panes.current.get(id);
      const s = p ? null : stateOf(id);
      if (!p && s) {
        const el = document.createElement('section'), head = document.createElement('div'), scroll = document.createElement('div'), page = document.createElement('div'), mount = document.createElement('div');
        el.className = 'pane';
        head.className = 'pane-h';
        scroll.className = 'f-scroll';
        page.className = 'page';
        page.append(mount);
        scroll.append(page);
        el.append(head, scroll);
        box.append(el);
        const view = createView(mount, (v) => viewChanged.current(v, id), s.state);
        lastDocs.current.set(view, view.state.doc);
        // clicking into a pane focuses it; a click in its margin puts the caret in it, as the main page does
        el.addEventListener('focusin', () => { if (activeRef.current !== id) focusPane(id, false); });
        el.addEventListener('mousedown', (e) => { if (e.target === scroll || head.contains(e.target as Node)) { e.preventDefault(); focusPane(id); } });
        head.addEventListener('pointerdown', (e) => paneDrag.current(id, e));
        scroll.addEventListener('scroll', () => { if (scrollRef.current === scroll) measureRef.current(); }, { passive: true });
        p = { view, el, scroll, head };
        panes.current.set(id, p);
        scroll.scrollTop = s.scroll;
      }
      // in group order; a pane already in place isn't moved (taking it out of the page would lose its scroll)
      if (p && box.children[i] !== p.el) { const top = p.scroll.scrollTop; box.insertBefore(p.el, box.children[i] ?? null); p.scroll.scrollTop = top; }
    });
    setDocs((ds) => keep(ds, new Set(panes.current.keys())));
    setSplitOn(true);
    focusPane(panes.current.has(focus) ? focus : panes.current.keys().next().value!);
    setTestView(viewRef.current); // createView points it at the newest pane
  }, [focusPane]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchTo = useCallback((id: number) => {
    if (id === activeRef.current) { setHomeOpen(false); setSdLit(null); viewRef.current?.focus(); return; }
    if (panes.current.has(id)) { focusPane(id); return; }
    const target = docsRef.current.find((d) => d.id === id);
    if (!target?.state) return;
    // a joined file shows its group side by side; any other file shows alone (the group stays joined)
    if (groupRef.current?.includes(id)) { arrange(groupRef.current, id); return; }
    if (panes.current.size) { arrange(null, id); return; }
    const out = stash(), cur = activeRef.current;
    setDocs((ds) => ds.map((d) => (d.id === cur ? { ...d, ...out } : d.id === id ? { ...d, state: null } : d)));
    show(id, target.state, target.scroll);
  }, [show, arrange, focusPane]);

  /** The window shows an untouched blank Untitled, which a new file takes the place of. */
  const isBlank = useCallback(() => {
    const v = viewRef.current!, cur = docsRef.current.find((d) => d.id === activeRef.current)!;
    return !panes.current.size && !cur.dirty && !cur.meta.path && !v.state.doc.textContent.trim() && v.state.doc.childCount <= 1 && cur.id !== speechRef.current;
  }, []);
  /** Open files in new windows is on, and this window has its file already. */
  const wantsWindow = useCallback(() => !!bridge.openWindow && pref(P.fileWindows) && !isBlank(), [isBlank]);
  /** A new tab for `doc`, after the current one. An untouched blank Untitled is replaced instead. */
  const addDoc = useCallback((doc: PMNode, m: DocMeta) => {
    const cur = docsRef.current.find((d) => d.id === activeRef.current)!;
    // joined files showing: the new one opens alone in the main editor, after the group, which stays joined
    const split = panes.current.size > 0;
    const blank = isBlank();
    const id = blank ? cur.id : nextDocId++;
    const fresh: OpenDoc = { id, meta: m, dirty: false, state: null, scroll: 0 };
    savedDocs.current.set(id, doc);
    if (blank) setDocs((ds) => ds.map((d) => (d.id === id ? fresh : d)));
    else if (split) {
      const held = releasePanes(), g = groupRef.current ?? [];
      setDocs((ds) => {
        const n = ds.map((d) => (held.has(d.id) ? { ...d, ...held.get(d.id)! } : d));
        n.splice(Math.max(...n.map((d, i) => (g.includes(d.id) ? i : -1))) + 1, 0, fresh);
        return n;
      });
    }
    else {
      const out = stash();
      setDocs((ds) => { const i = ds.findIndex((d) => d.id === cur.id); const n = ds.map((d) => (d.id === cur.id ? { ...d, ...out } : d)); n.splice(i + 1, 0, fresh); return n; });
    }
    return show(id, createState(doc), 0);
  }, [show, isBlank]);

  const dropDoc = useCallback((id: number) => {
    const list = docsRef.current, i = list.findIndex((d) => d.id === id);
    if (i < 0) return;
    setSpeechId((s) => (s === id ? null : s));
    savedDocs.current.delete(id);
    const rest = list.filter((x) => x.id !== id);
    // a joined file closing: the group shrinks, and comes apart below two
    const g = groupRef.current, left = g?.filter((x) => x !== id) ?? null;
    if (g?.includes(id)) setGroup(left!.length >= 2 ? left : null);
    if (panes.current.has(id)) {
      dropPane(id);
      if (left!.length >= 2) {
        setDocs(rest);
        if (id === activeRef.current) focusPane(left![Math.min(g!.indexOf(id), left!.length - 1)]);
        return;
      }
      // one file left: it goes back to the main editor on its own
      const held = releasePanes(), [only] = left!;
      const h = held.get(only)!;
      setDocs(rest.map((x) => (x.id === only ? { ...x, state: null } : held.has(x.id) ? { ...x, ...held.get(x.id)! } : x)));
      show(only, h.state, h.scroll);
      return;
    }
    if (id !== activeRef.current) { setDocs(rest); return; }
    if (!rest.length) {
      if (pref(P.fileWindows) && bridge.leaveWindow?.()) { // its doc is gone on purpose, so nothing is left to recover
        mounted.current = false;
        clearStorage();
        clearDisk();
        return;
      }
      const nid = nextDocId++, blankDoc = emptyDoc();
      savedDocs.current.set(nid, blankDoc);
      setDocs([{ id: nid, meta: { name: 'Untitled' }, dirty: false, state: null, scroll: 0 }]);
      show(nid, createState(blankDoc), 0);
      setHomeOpen(true);
      return;
    }
    const next = rest[Math.min(i, rest.length - 1)];
    // the next file is joined: its group shows, side by side (the closed file's doc isn't kept)
    const ng = groupRef.current;
    if (ng?.includes(next.id)) { setDocs(rest); arrange(ng, next.id, false); return; }
    setDocs(rest.map((x) => (x.id === next.id ? { ...x, state: null } : x)));
    show(next.id, next.state!, next.scroll);
  }, [show, arrange, focusPane]);
  // dragging a file in the rail or the files panel moves it to slot `to`
  const moveDoc = useCallback((id: number, to: number) => {
    setDocs((ds) => {
      const i = ds.findIndex((d) => d.id === id);
      if (i < 0 || i === to) return ds;
      const n = [...ds];
      n.splice(to, 0, ...n.splice(i, 1));
      return n;
    });
    backupSoon.current();
  }, []);
  const closeDoc = useCallback((id: number) => {
    const d = docsRef.current.find((x) => x.id === id);
    if (!d) return;
    if (!d.dirty || !pref(P.confirmClose)) { dropDoc(id); return; }
    const name = d.meta.name || 'Untitled';
    void confirmAsk({ title: `Close ${name} without saving?`, body: 'Your changes will be lost.', ok: 'Close Without Saving' })
      .then((yes) => { if (yes) dropDoc(id); });
  }, [dropDoc, confirmAsk]);

  /** Join: show these files side by side (in rail order, gathered where the first one sits in the rail). */
  const join = useCallback((ids: number[]) => {
    const order = docsRef.current.map((d) => d.id).filter((x) => ids.includes(x));
    if (order.length < 2) return;
    const max = pref(P.joinMax);
    if (order.length > max) { flash(`You can join up to ${max} files. Change it in Settings > Appearance.`); return; }
    if (viewRef.current && isReading(viewRef.current.state)) { flash('Leave read mode to join files.'); return; }
    setDocs((ds) => {
      const at = ds.findIndex((d) => order.includes(d.id));
      const n = ds.filter((d) => !order.includes(d.id));
      n.splice(at, 0, ...order.map((x) => ds.find((d) => d.id === x)!));
      return n;
    });
    setGroup(order);
    arrange(order, order.includes(activeRef.current) ? activeRef.current : order[0]);
  }, [arrange, flash]);
  /** A pane's X: that file leaves the split (it stays open, just after the group in the rail); below two, the split comes apart. */
  const leave = useCallback((id: number) => {
    const g = groupRef.current;
    if (!g?.includes(id)) return;
    if (viewRef.current && isReading(viewRef.current.state)) { flash('Leave read mode to unjoin files.'); return; }
    const left = g.filter((x) => x !== id), keep = left.length >= 2;
    setDocs((ds) => {
      const n = ds.filter((d) => d.id !== id);
      n.splice(Math.max(...n.map((d, i) => (left.includes(d.id) ? i : -1))) + 1, 0, ds.find((d) => d.id === id)!);
      return n;
    });
    const focus = id === activeRef.current ? left[Math.min(g.indexOf(id), left.length - 1)] : activeRef.current;
    setGroup(keep ? left : null);
    arrange(keep ? left : null, focus);
    backupSoon.current();
  }, [arrange, flash]);
  /** Dragging a pane by its name onto another swaps the two, in the split and in the rail. */
  paneDrag.current = (id, e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.pane-x')) return;
    const src = panes.current.get(id)?.el, x0 = e.clientX, y0 = e.clientY;
    if (!src) return;
    let on = false, to: number | null = null;
    const move = (m: PointerEvent) => {
      if (!on) {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
        on = true;
        src.toggleAttribute('data-drag', true);
        document.documentElement.classList.add('f-dragging');
      }
      m.preventDefault();
      to = null;
      for (const [k, p] of panes.current) {
        const b = p.el.getBoundingClientRect(), hit = k !== id && m.clientX >= b.left && m.clientX < b.right;
        p.el.toggleAttribute('data-drop', hit);
        if (hit) to = k;
      }
    };
    const end = (ok: boolean) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      removeEventListener('keydown', key, true);
      document.documentElement.classList.remove('f-dragging');
      for (const p of panes.current.values()) { p.el.removeAttribute('data-drag'); p.el.removeAttribute('data-drop'); }
      const g = groupRef.current;
      if (!ok || to === null || !g?.includes(id) || !g.includes(to)) return;
      if (viewRef.current && isReading(viewRef.current.state)) { flash('Leave read mode to move files.'); return; }
      const a = g.indexOf(id), b = g.indexOf(to), n = [...g];
      [n[a], n[b]] = [n[b], n[a]];
      // the rail keeps the group's slots, filled in the new order
      setDocs((ds) => { const slot = n.map((x) => ds.find((d) => d.id === x)!); let k = 0; return ds.map((d) => (g.includes(d.id) ? slot[k++] : d)); });
      setGroup(n);
      arrange(n, activeRef.current);
      backupSoon.current();
    };
    const up = () => end(true), cancel = () => end(false);
    const key = (k: KeyboardEvent) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); end(false); } };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
    addEventListener('keydown', key, true);
  };
  /** Unjoin: the files go back to one at a time, the focused one staying on screen. */
  const unjoin = useCallback(() => {
    if (viewRef.current && isReading(viewRef.current.state)) { flash('Leave read mode to unjoin files.'); return; }
    setGroup(null);
    if (panes.current.size) arrange(null, activeRef.current);
  }, [arrange, flash]);

  // Ctrl-Tab's order: docs by when you were last on them
  const mru = useRef<number[]>([]);
  useEffect(() => { mru.current = [activeId, ...mru.current.filter((x) => x !== activeId)]; }, [activeId]);
  // the switcher: up while its keys are held (it draws after a moment, so a quick tap just flips to the last doc)
  type Sw = { ids: number[]; sel: number; shown: boolean; mods: Mod[] };
  const [sw, setSwState] = useState<Sw | null>(null);
  const swRef = useRef<Sw | null>(null);
  const swTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setSw = (s: Sw | null) => { swRef.current = s; setSwState(s); };
  /** Recent docs, one step `dir` from this one; with `mods` held, the switcher stays up until they're let go. */
  const recent = useCallback((dir: 1 | -1, mods: Mod[] = []) => {
    if (sdOnRef.current) { switchTo(activeRef.current); return; } // from the SpeechDrop tab: back to the doc you were in
    const ids = recentOrder(docsRef.current.map((d) => d.id), mru.current, activeRef.current);
    if (ids.length < 2) { bridge.cycleWindow?.(dir); return; } // one doc in this window: on to the next window
    const sel = dir > 0 ? 1 : ids.length - 1;
    if (!mods.length) { switchTo(ids[sel]); return; }
    tops.current.set(activeRef.current, topPos());
    setSw({ ids, sel, shown: false, mods });
    clearTimeout(swTimer.current);
    swTimer.current = setTimeout(() => { if (swRef.current) setSw({ ...swRef.current, shown: true }); }, 150);
  }, [switchTo]);
  const endSw = useCallback((go: boolean, at?: number) => {
    const s = swRef.current;
    if (!s) return;
    clearTimeout(swTimer.current);
    setSw(null);
    const i = at ?? s.sel;
    if (go && s.ids[i] !== undefined && s.ids[i] !== activeRef.current) switchTo(s.ids[i]); else viewRef.current?.focus();
  }, [switchTo]);
  // a doc opened, closed or switched to some other way under the switcher: its list is stale, so it closes
  useEffect(() => { if (swRef.current && swRef.current.ids[0] !== activeId) endSw(false); }, [activeId, endSw]);
  useEffect(() => { if (swRef.current && swRef.current.ids.length !== docs.length) endSw(false); }, [docs.length, endSw]);
  useEffect(() => {
    const up = (e: KeyboardEvent) => { const s = swRef.current; if (s && !s.mods.some((m) => e[m])) endSw(true); };
    const blur = () => endSw(false);
    addEventListener('keyup', up, true);
    addEventListener('blur', blur);
    return () => { removeEventListener('keyup', up, true); removeEventListener('blur', blur); };
  }, [endSw]);

  // the SpeechDrop tabs (-1 - key; doc ids are positive) come after the docs, as their rows do in the rail
  const cycle = useCallback((dir: 1 | -1) => {
    const ring = [...docsRef.current.map((d) => d.id), ...sdTabsRef.current.map((x) => -1 - x.key)];
    if (ring.length < 2) { bridge.cycleWindow?.(dir); return; }
    const lit = sdLitRef.current;
    const i = ring.indexOf(lit !== null ? -1 - lit : activeRef.current);
    const next = ring[(i + dir + ring.length) % ring.length];
    if (next < 0) showSd(-1 - next); else switchTo(next);
  }, [switchTo, showSd]);

  const openedPath = (p?: string) => (p ? docsRef.current.find((d) => d.meta.path === p) : undefined);
  /** `path` opens in another window: the one that has it, or a new one when Open files in new windows wants that. */
  const elsewhere = useCallback((path?: string, card?: CardSpot) => !!path && !openedPath(path) && !!bridge.openWindow?.({ path, card, alone: wantsWindow() }), [wantsWindow]);
  const opened = useCallback((r: { doc: PMNode; meta: DocMeta }, source: DocSource) => {
    setRecents((list) => noteRecent(list, r.doc, r.meta));
    if (elsewhere(r.meta.path)) return;
    const already = openedPath(r.meta.path);
    if (already) { switchTo(already.id); flash(`${r.meta.name} is already open`); return; }
    if (source !== 'restore') track('doc_opened', { source }); // reopening last session's files isn't a user action
    if (pref(P.openDepth)) setDepth(pref(P.openDepth));
    flash(addDoc(r.doc, r.meta) ? `Opened ${r.meta.name}` : `Opened ${r.meta.name}. It's too big for crash recovery, so save often (${keyLabel('save')}).`);
  }, [addDoc, switchTo, flash, elsewhere]);
  const fileNew = useCallback(() => {
    track('doc_new');
    if (wantsWindow()) bridge.openWindow!({ alone: true }); else addDoc(emptyDoc(), { name: 'Untitled' });
  }, [addDoc, wantsWindow]);
  /** New speech doc: a file that opens on a pocket with the speech's name, already marked as the speech doc. */
  const fileNewSpeech = useCallback(() => {
    if (viewRef.current && isReading(viewRef.current.state)) { flash('Leave read mode to make a new speech doc.'); return; }
    setSpeechAsk(true);
  }, [flash]);
  const closeNewSpeech = useCallback(() => setSpeechAsk(false), []);
  const closeNewDoc = useCallback(() => setNewAsk(false), []);
  const makeSpeech = useCallback((speech: string) => {
    setSpeechAsk(false);
    track('doc_new', { speech: true });
    const p = (style: string, text = '') => schema.node('paragraph', { style }, text ? schema.text(text) : undefined);
    const doc = schema.node('doc', null, speech ? [p('pocket', speech), p('normal')] : [p('normal')]), name = speechFileName(speech);
    if (wantsWindow()) {
      const b = [{ meta: { name }, doc, active: true, dirty: false, speech: true }];
      bridge.openWindow!({ alone: true, backup: packList(b, b), speech: name, caretEnd: true });
      return;
    }
    addDoc(doc, { name });
    const v = viewRef.current!;
    v.dispatch(v.state.tr.setSelection(TextSelection.atEnd(v.state.doc))); // typing starts under the pocket
    speechRef.current = activeRef.current;
    setSpeechId(activeRef.current);
  }, [addDoc, wantsWindow]);
  const fileOpen = useCallback(async () => {
    try {
      const r = await openDocument();
      if (r) opened(r, 'dialog');
    } catch (e) { flash(`Couldn't open: ${(e as Error).message}`); }
  }, [opened, flash]);
  /** Opening `path` failed (moved, deleted): say so, and stop listing it in the recents. */
  const openFailed = useCallback((name: string, path: string, e: unknown) => {
    setRecents((list) => list.filter((r) => r.path !== path));
    flash(`Couldn't open ${name}: ${(e as Error).message}`);
  }, [flash]);
  // recents saved before they kept a preview: read each once, the first time Home shows it
  const peeked = useRef(new Set<string>());
  const peekRecent = useCallback(async (r: Recent) => {
    if (!r.path || !bridge.openPath || peeked.current.has(r.path)) return;
    peeked.current.add(r.path);
    try {
      const preview = peekHtml((await openPath(r.path)).doc);
      setRecents((list) => list.map((x) => (x.path === r.path ? { ...x, preview } : x)));
    } catch { /* moved or deleted: the page shows its name, and opening it says why */ }
  }, []);
  const openRecent = useCallback(async (r: Recent) => {
    const already = openedPath(r.path) ?? (!r.path ? docsRef.current.find((d) => !d.meta.path && d.meta.name === r.name) : undefined);
    if (already) { switchTo(already.id); return; }
    if (!r.path || !bridge.openPath) { void fileOpen(); return; }
    try { if (!elsewhere(r.path)) opened(await openPath(r.path), 'recent'); }
    catch (e) { openFailed(r.name, r.path, e); }
  }, [opened, fileOpen, switchTo, openFailed, elsewhere]);
  // Cmd-K: an open doc switches to it; anything else opens by path (indexed folders and recents are allowed)
  const openHit = useCallback(async (h: FileHit): Promise<boolean> => {
    showEditor();
    if (h.docId !== undefined && docsRef.current.some((d) => d.id === h.docId)) { switchTo(h.docId); return true; }
    const already = openedPath(h.path);
    if (already) { switchTo(already.id); return true; }
    if (!h.path || !bridge.openPath) { void fileOpen(); return false; }
    try { if (!elsewhere(h.path)) opened(await openPath(h.path), 'search'); return true; }
    catch (e) { openFailed(h.name, h.path, e); return false; }
  }, [opened, fileOpen, switchTo, openFailed, elsewhere]);
  /** Put the caret on a card in the file on screen. */
  const gotoCard = useCallback((c: CardSpot) => {
    const v = viewRef.current!;
    const pos = findCard(v.state.doc, c.tag, c.ordinal);
    if (pos === null) { flash(`Couldn't find “${c.tag}” in ${c.file}. It may have changed since it was indexed.`); return; }
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos + 1)));
    (v.dom as HTMLElement).focus({ preventScroll: true });
    requestAnimationFrame(() => scrollToPos(v, pos)); // once the page has laid the new file out
  }, [flash]);
  // Search cards: Enter opens the card's file at the card; Mod-Enter puts a copy of the card into the open document
  const pickCard = useCallback(async (h: CardHit, insert: boolean) => {
    const open = openedPath(h.path);
    if (insert) {
      if (viewRef.current && isReading(viewRef.current.state)) return;
      showEditor();
      const into = activeRef.current;
      let doc: PMNode | undefined;
      try { doc = open ? liveState(open.id)?.doc : (await openPath(h.path)).doc; }
      catch (e) { flash(`Couldn't open ${h.file}: ${(e as Error).message}`); return; }
      const pos = doc ? findCard(doc, h.tag, h.ordinal, true) : null; // a copy has to be the right card, not just the right spot
      const content = doc && pos !== null ? cardContent(doc, pos) : null;
      const v = viewRef.current;
      if (activeRef.current !== into) { flash('Switched documents while the card loaded. Try again.'); return; }
      if (!content || !v) { flash(`Couldn't find “${h.tag}” in ${h.file}. It may have changed since it was indexed.`); return; }
      v.dispatch(insertIntoSpeech(v.state, content).scrollIntoView());
      v.focus();
      return;
    }
    const spot = { tag: h.tag, ordinal: h.ordinal, file: h.file };
    if (elsewhere(h.path, spot)) return; // that window goes to the card
    if (!(await openHit({ key: `c:${h.path}`, name: h.file, folder: '', path: h.path, kind: 'file', when: 0 }))) return; // openHit said why
    gotoCard(spot); // it shows the file now
  }, [openHit, flash, elsewhere, gotoCard]);
  /**
   * Write the active doc. As-Is is the document itself, so the open file takes its new name and path;
   * Send, Read and Marked docs are copies and the open file stays as it was.
   */
  const writeDoc = useCallback(async (meta: DocMeta, mode: SaveMode, as: boolean, id = activeRef.current) => {
    const saved = liveState(id)?.doc;
    if (!saved) { flash('That file closed, so nothing was saved.'); return; }
    const out = docForMode(saved, mode);
    if (!out) { flash(mode === 'marked' ? 'No marked cards: mark one with red text first' : 'Nothing to save'); return; }
    try {
      const m = await saveDocument(out, meta, as);
      if (!m) return;
      track('doc_saved', { mode, save_as: as });
      // another tab on this file would overwrite it on Save: close it if clean, else keep its edits but unbind it.
      // dropDoc sets the tab list from a snapshot, so this runs before patch(id) below or it would undo the new path
      for (const o of docsRef.current) {
        if (o.id === id || !m.path || o.meta.path !== m.path) continue;
        if (o.dirty) patch(o.id, { meta: { name: o.meta.name } }); else dropDoc(o.id);
      }
      if (mode !== 'asis') { flash(`Saved ${MODE_NAME[mode]} ${m.name}`); return; }
      // typing during the save keeps the doc marked unsaved
      const now = liveState(id)?.doc;
      savedDocs.current.set(id, saved);
      patch(id, { meta: m, dirty: !!now && isDirty(id, now) });
      setRecents((list) => noteRecent(list, saved, m));
      flash(`Saved ${m.name}`);
    } catch (e) { flash(`Couldn't save: ${(e as Error).message}`); }
  }, [patch, flash, dropDoc]);
  /** Save writes the open file; Save As opens the dialog, which calls `saveCopy`. A file opening meanwhile can change the active doc, so the dialog keeps the one it was opened on. */
  const saveAsDoc = useRef(0);
  const fileSave = useCallback(async (as = false) => {
    const d = docsRef.current.find((x) => x.id === activeRef.current)!;
    if (as) { saveAsDoc.current = d.id; setSaveAsName(!d.meta.path && (d.meta.name || 'Untitled') === 'Untitled' ? newFileName() : d.meta.name); return; }
    await writeDoc(d.meta, 'asis', false);
  }, [writeDoc]);
  const saveCopy = (mode: SaveMode, name: string) => {
    setSaveAsName(null);
    const prefix = mode !== 'asis' && pref(P.savePrefix) ? pref(MODE_PREFIX[mode]) : '';
    void writeDoc({ name: copyName(mode, name, prefix) }, mode, true, saveAsDoc.current);
  };
  const closeSaveAs = useCallback(() => setSaveAsName(null), []);

  const closeCompare = useCallback(() => { setCompareWith(null); viewRef.current?.focus(); }, []);
  const readSelection = useCallback(() => (viewRef.current ? selectionText(viewRef.current.state) : ''), []);
  useEffect(() => {
    const on = (e: Event) => setCompareWith((e as CustomEvent<string>).detail);
    addEventListener(COMPARE_EVENT, on);
    return () => removeEventListener(COMPARE_EVENT, on);
  }, []);
  const openFind = useCallback(() => { showEditor(); setFindOpen(true); setTimeout(() => { findRef.current?.focus(); findRef.current?.select(); }, 0); }, []);
  const getScroller = useCallback(() => scrollRef.current, []);
  const { zoomTo, zoomBy, zoomWheel } = useSmoothZoom(zoom, setZoom, getScroller);

  /** Undo a send, only while the doc is still exactly as the send left it, so it can't undo later typing. Says so when it can't. */
  const takeBack = useCallback((id: number, sent: EditorState, name: string): string | undefined => {
    const on = liveView(id);
    const now = on?.state ?? docsRef.current.find((d) => d.id === id)?.state;
    if (!now) return undefined;
    if (now.doc !== sent.doc) return `${name} has changed since. Undo it there with ${keyText('Mod-z')}.`;
    undo(now, (t) => { if (on) on.dispatch(t); else patch(id, { state: now.apply(t), dirty: true }); });
    return undefined;
  }, [patch]);
  /** The speech doc is in another window (or, with Open files in new windows, the first send makes it there, behind this one). */
  const sendAway = useCallback(async (sent: { content: Fragment; label: string }) => {
    if (!otherSpeech.current) {
      const b = [{ meta: { name: 'Speech' }, doc: emptyDoc(), active: true, dirty: false, speech: true }];
      bridge.openWindow!({ alone: true, inactive: true, backup: packList(b, b), speech: 'Speech' });
      otherSpeech.current = 'Speech';
    }
    const a = await bridge.speechAsk!('speech-send', { content: sent.content.toJSON() });
    if (!a.ok) { flash(a.error === 'doc-readonly' ? `${a.docTitle} is in read mode. Leave it to send.` : "Couldn't reach the speech doc."); return; }
    flash(`Sent “${sent.label}” to ${a.docTitle}`, { label: 'Undo', run: () => { void bridge.speechAsk!('speech-undo', { undo: a.undo }).then((u) => { if (u.note) flash(u.note); }); } });
  }, [flash]);
  /** Send to speech: copy the selection (or the card or section at the caret) into the speech doc without leaving this file. */
  const sendToSpeech = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    if (speechRef.current === activeRef.current) { flash('This is the speech doc. Switch to a file to send from it.'); return; }
    const sent = sendContent(v.state);
    if (!sent) { flash('Nothing to send. Put the caret in a card or select some text.'); return; }
    let target = docsRef.current.find((d) => d.id === speechRef.current);
    if (!target && bridge.speechAsk && (otherSpeech.current || pref(P.fileWindows))) { void sendAway(sent); return; }
    let base = target ? liveState(target.id) : null; // it may be showing beside this file, joined
    if (!target || !base) {
      // the speech doc is made on the first send, beside this file, and stays in the background
      const names = new Set(docsRef.current.map((d) => d.meta.name));
      let name = 'Speech';
      for (let n = 2; names.has(name); n++) name = `Speech ${n}`;
      target = { id: nextDocId++, meta: { name }, dirty: false, state: null, scroll: 0 };
      base = createState(emptyDoc());
      const made = target;
      // after this file, or after its group when files are joined, so the group stays together in the rail
      const g = panes.current.size ? groupRef.current ?? [] : [];
      setDocs((ds) => { const i = Math.max(ds.findIndex((d) => d.id === activeRef.current), ...ds.map((d, j) => (g.includes(d.id) ? j : -1))); const n = [...ds]; n.splice(i + 1, 0, made); return n; });
      speechRef.current = made.id;
      setSpeechId(made.id);
    }
    const { id } = target, speechName = target.meta.name || 'Speech';
    const tr = insertIntoSpeech(base, sent.content), shown = liveView(id);
    let next: EditorState;
    if (shown) { shown.dispatch(tr.scrollIntoView()); next = shown.state; } // joined: you see the card land
    else { next = base.apply(tr); patch(id, { state: next, dirty: true }); }
    flash(`Sent “${sent.label}” to ${speechName}`, { label: 'Undo', run: () => { const note = takeBack(id, next, speechName); if (note) flash(note); } });
  }, [flash, sendAway, takeBack, patch]);
  // Nimbus and other debate apps send cards in over the bridge (electron/editor-bridge.cjs), the way they do
  // into CardMirror: they list the open docs, then insert into one (usually the speech doc) without taking focus
  // the main process stopped waiting for a consent answer: an Allow clicked now would go nowhere
  const consentAsk = useRef<Ask | null>(null);
  useEffect(() => bridge.onBridgeExpired?.(() => { if (askRef.current === consentAsk.current) askRef.current?.done(false); }), []);
  useEffect(() => bridge.onBridge?.(async (kind, p) => {
    const target = (d: OpenDoc) => `falcon-${start.slot ? `${start.slot}-` : ''}${d.id}`;
    const name = typeof p.name === 'string' && p.name ? p.name[0].toUpperCase() + p.name.slice(1) : 'An app';
    if (kind === 'ping') return { hasActiveDoc: !!viewRef.current };
    if (kind === 'docs') return { docs: docsRef.current.map((d) => ({ target: target(d), title: d.meta.name || 'Untitled', focusedWindow: d.id === activeRef.current, isSpeech: d.id === speechRef.current })) };
    if (kind === 'consent') {
      if (askRef.current) return { answer: null }; // another question is up: it asks again next time
      return new Promise((resolve) => {
        const a = {
        title: `Let ${name} send cards to Falcon?`,
        body: `${name} wants to put cards into your open docs, the way it does with CardMirror. You can change this in Settings > General > Linked apps.`,
        ok: 'Allow', done: (yes: boolean) => { setAsk(null); resolve({ answer: yes ? 'allow' : null }); },
        };
        consentAsk.current = a;
        setAsk(a);
      });
    }
    if (kind === 'jump') return { ok: false, error: 'not-found' }; // nothing hands out source tokens yet
    // another window asked for a file this one has: show it
    if (kind === 'shown') {
      const d = openedPath(p.path as string);
      if (d) switchTo(d.id);
      if (p.card) gotoCard(p.card as CardSpot); else if (d) flash(`${d.meta.name} is already open`);
      return { ok: true };
    }
    if (kind === 'speech-undo') {
      const back = sentAway.current.get(String(p.undo));
      return back ? { ok: true, note: back() } : { ok: false };
    }
    const fromWindow = kind === 'speech-send';
    if (kind !== 'insert' && !fromWindow) return { ok: false, error: 'bad-request' };
    const want = typeof p.target === 'string' ? p.target : null;
    // no target: the speech doc, else the doc on screen (CardMirror's fallback is the focused doc)
    const doc = want ? docsRef.current.find((d) => target(d) === want) : docsRef.current.find((d) => d.id === speechRef.current) ?? docsRef.current.find((d) => d.id === activeRef.current);
    if (!doc || (fromWindow && doc.id !== speechRef.current)) return { ok: false, error: 'target-not-found' };
    const shown = liveView(doc.id);
    const base = shown?.state ?? doc.state;
    if (!base) return { ok: false, error: 'no-target-doc' };
    if (isReading(base)) return { ok: false, error: 'doc-readonly', docTitle: doc.meta.name };
    const content = fromWindow ? Fragment.fromJSON(schema, p.content as object[]) : insertContent(p.html, p.text);
    if (!content) return { ok: false, error: 'bad-request' };
    const tr = insertIntoSpeech(base, content);
    let next = base.apply(tr);
    if (shown) { shown.dispatch(fromWindow ? tr.scrollIntoView() : tr); next = shown.state; } else patch(doc.id, { state: next, dirty: true });
    const docName = doc.meta.name || 'Untitled';
    if (fromWindow) {
      const undoId = String(nextSent.current++);
      sentAway.current.set(undoId, () => takeBack(doc.id, next, docName));
      return { ok: true, docTitle: docName, undo: undoId };
    }
    flash(`${name} sent “${insertLabel(content)}” to ${docName}`, { label: 'Undo', run: () => { const note = takeBack(doc.id, next, docName); if (note) flash(note); } });
    return { ok: true, docTitle: docName };
  }), [flash, patch, takeBack, switchTo, gotoCard, start.slot]);
  const toggleSpeech = useCallback(() => {
    const here = activeRef.current;
    speechRef.current = speechRef.current === here ? null : here;
    setSpeechId(speechRef.current);
  }, []);

  // the Mac File menu (its shortcuts are labels only: the keys arrive here as usual)
  const menuRef = useRef<(c: string) => void>(() => {});
  // nothing swaps the document out behind Settings or during a read-mode speech
  const locked = () => compareRef.current !== null || settingsRef.current || paletteRef.current || ccRef.current || !!askRef.current || saveAsRef.current !== null || speechAskRef.current || newAskRef.current || (!!viewRef.current && isReading(viewRef.current.state));
  menuRef.current = (c) => {
    if (swRef.current) { endSw(false); return; } // a menu key or click while Ctrl-Tab is held: the switcher closes on the current doc
    if (askRef.current || saveAsRef.current || speechAskRef.current || newAskRef.current) return; // a warning, Save As, New speech doc or New Document is up: it gets answered first
    if (paletteRef.current || ccRef.current) return; // file search or the command center is up: it gets closed first
    if (c === 'settings') { setSettingsOpen(true); return; }
    if (locked() && c !== 'save' && c !== 'saveAs') return;
    if (c === 'new') fileNew(); else if (c === 'newSpeech') fileNewSpeech(); else if (c === 'open') void fileOpen(); else if (c === 'save') void fileSave(false);
    else if (c === 'saveAs') void fileSave(true); else if (c === 'close') { if (sdOnRef.current) closeSd(); else closeDoc(activeRef.current); } else if (c === 'settings') setSettingsOpen(true);
  };
  useEffect(() => bridge.onMenu?.((c) => menuRef.current(c)), []);
  // the Mac menu shows the keys Settings > Keybindings has for its items
  useEffect(() => {
    const send = () => bridge.setMenuKeys?.(Object.fromEntries(['settings', 'new', 'newSpeech', 'open', 'save', 'saveAs', 'close'].map((id) => [id, keyOf(id)])));
    send();
    return onPrefs(send);
  }, []);

  // one pass per doc is plenty; Esc stops it after the cite in flight
  const citePass = useRef<{ stop: boolean } | null>(null);
  const clearedRecents = useRef<Recent[]>([]); // what Home's Clear took, for its Undo
  const reformatAll = async () => {
    const view = viewRef.current;
    if (!view) return;
    if (citePass.current) { flash('Cites are already being reformatted. Esc stops it.'); return; }
    const n = reformatCount(view);
    if (typeof n === 'string') { flash(n); return; }
    if (!n) { flash('No cites in this document.'); return; }
    const yes = await confirmAsk({ title: 'Reformat every cite with AI?', body: `${n} ${n === 1 ? 'cite goes' : 'cites go'} to ${aiService()} one at a time and get rewritten, so this makes ${n} ${n === 1 ? 'request' : 'requests'} on your API key. Each one is its own undo step.`, ok: 'Reformat' });
    if (!yes) return;
    const pass = { stop: false };
    citePass.current = pass;
    let r;
    try { r = await reformatCites(view, { stopped: () => pass.stop, progress: (i, total) => flash(`Reformatting cite ${i + 1} of ${total}. Esc stops.`) }); }
    finally { citePass.current = null; }
    const tail = [r.failed && `${r.failed} failed`, r.unmarked && `${r.unmarked} left unmarked`].filter(Boolean).join(', ');
    flash(`${r.stopped ? 'Stopped. ' : ''}${r.done} ${r.done === 1 ? 'cite' : 'cites'} reformatted${tail ? `, ${tail}` : ''}.${r.failed && r.error ? ` ${r.error}` : ''}`);
  };

  /** The app's own commands, by binding id: its keys and the command center both run them here. */
  const appCommand = useCallback((id: string) => {
    if (id === 'nextDoc' || id === 'prevDoc') cycle(id === 'nextDoc' ? 1 : -1);
    else if (id === 'recentDoc' || id === 'recentDocBack') recent(id === 'recentDoc' ? 1 : -1);
    else if (id === 'save' || id === 'saveAs') void fileSave(id === 'saveAs');
    else if (id === 'find') openFind();
    else if (id === 'open') void fileOpen();
    else if (id === 'new') fileNew();
    else if (id === 'newSpeech') fileNewSpeech();
    else if (id === 'close') { if (sdOnRef.current) closeSd(); else closeDoc(activeRef.current); }
    else if (id === 'speechdrop') openSd();
    else if (id === 'aiCite') { if (viewRef.current) void formatCite(viewRef.current, flash); }
    else if (id === 'reformatCites') void reformatAll();
    else if (id.startsWith('aiPreset')) { const n = Number(id.slice(8)); const name = usePreset(n); flash(name ? `Cites now use ${name}.` : `There's no prompt preset ${n}.`); }
    else if (id === 'home') setHomeOpen((h) => !h);
    else if (id === 'settings') setSettingsOpen((o) => !o);
    else if (id === 'outline') setShowOutline((o) => !o);
    else if (id === 'zoomIn') zoomBy(0.1);
    else if (id === 'zoomOut') zoomBy(-0.1);
    else if (id === 'zoomReset') zoomTo(1);
    else if (id === 'commands') setCcOpen((o) => !o);
    else if (id === 'searchCards') setPaletteOpen('cards');
    else if (id === 'sendToSpeech') sendToSpeech();
  }, [fileSave, fileOpen, fileNew, fileNewSpeech, openFind, closeDoc, cycle, recent, zoomBy, zoomTo, sendToSpeech, openSd, closeSd]);

  // app-level shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Settings is listening for a new shortcut: every key goes to it
      if (isRecording()) return;
      // the switcher is up: Tab (its keys) and the arrows move, Enter opens, Esc stays put; nothing reaches the page
      const s = swRef.current;
      if (s) {
        e.preventDefault(); e.stopPropagation();
        const hit = pressedId(e, ['recentDoc', 'recentDocBack']), n = s.ids.length;
        const step = hit ? (hit === 'recentDoc' ? 1 : -1) : /^Arrow(Right|Down)$/.test(e.key) ? 1 : /^Arrow(Left|Up)$/.test(e.key) ? -1 : 0;
        if (step) setSw({ ...s, sel: (s.sel + step + n) % n });
        else if (e.key === 'Escape') endSw(false);
        else if (e.key === 'Enter') endSw(true);
        return;
      }
      // a warning is up: its own keys (Tab, Enter, Esc) and nothing else
      if (askRef.current) { if (e.ctrlKey || e.metaKey) e.preventDefault(); return; }
      // Save As is up: its name field keeps text editing keys, nothing else
      if (saveAsRef.current) { if ((e.ctrlKey || e.metaKey) && !/^[acvxz]$/i.test(e.key)) e.preventDefault(); return; }
      // Compare Text is up: text editing keys and its own (Mod-Enter), nothing else
      // (inside the panel its text boxes keep every editing key: word jumps, AltGr characters)
      if (compareRef.current !== null) { if ((e.ctrlKey || e.metaKey) && !(e.target as Element | null)?.closest?.('.cmp') && !/^([acvxz]|Enter)$/i.test(e.key)) e.preventDefault(); return; }
      // so are New speech doc and New Document (their own Esc and Enter included)
      if (speechAskRef.current || newAskRef.current) { if ((e.ctrlKey || e.metaKey) && !/^[acvxz]$/i.test(e.key)) e.preventDefault(); return; }
      // Send to speech (` unless changed in Settings), so the page can't type that key (AltGr layouts too: their character arrives with Ctrl+Alt held). Boxes with their own text field keep it.
      if (sendPressed(e) && !settingsRef.current && !e.isComposing && !homeRef.current && !sdOnRef.current && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && !(viewRef.current && isReading(viewRef.current.state))) {
        e.preventDefault(); e.stopPropagation();
        if (!e.repeat) sendToSpeech();
        return;
      }
      // AltGr types characters (it arrives as Ctrl+Alt on Windows: AltGr+ß is "\\"), never shortcuts
      if (e.getModifierState?.('AltGraph') || (!IS_MAC && e.ctrlKey && e.altKey)) return;
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      // Mod-Shift-] and [ also switch documents
      const bracket = mod && e.shiftKey && !e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft');
      // Mod-+ (Shift-=) zooms in too, the way every other app does it
      const plus = mod && e.key === '+' && !e.altKey && keyOf('zoomIn') === 'Mod-=';
      const id = bracket ? (e.code === 'BracketRight' ? 'nextDoc' : 'prevDoc') : plus ? 'zoomIn' : pressedId(e, APP_IDS);
      const v = viewRef.current;
      // read mode locks the keyboard: nothing that swaps the document out
      if (id && SWAPS.includes(id) && v && isReading(v.state)) return;
      // Search files opens the palette (or closes it); while it's up, only its own keys get through
      if (id === 'search' || id === 'searchCards') {
        e.preventDefault(); e.stopPropagation();
        const want = id === 'search' ? 'files' : 'cards';
        if (paletteRef.current) setPaletteOpen(paletteRef.current === want ? false : want); else if (!locked()) setPaletteOpen(want);
        return;
      }
      if (paletteRef.current) { if (mod && !/^[acvxz]$/i.test(e.key)) e.preventDefault(); return; }
      // the command center opens over anything but Settings (or closes); while it's up, its box gets the keys
      if (id === 'commands') { e.preventDefault(); e.stopPropagation(); if (ccRef.current) setCcOpen(false); else if (!settingsRef.current) { setHomeOpen(false); setCcOpen(true); } return; }
      if (ccRef.current) { if (mod && !/^[acvxyz]$/i.test(e.key)) e.preventDefault(); return; }
      // Settings is modal: only its own keys (Esc, its shortcut) get through
      if (settingsRef.current && !(e.key === 'Escape' || id === 'settings')) { if (mod) e.preventDefault(); return; }
      // Esc in a filled Settings search clears the search before it closes Settings, and in a half-typed number puts it back
      if (e.key === 'Escape' && settingsRef.current && e.target instanceof HTMLInputElement && ((e.target.closest('.st-search') || e.target.classList.contains('st-find')) && e.target.value || 'draft' in e.target.dataset)) return;
      if (e.key === 'Escape' && settingsRef.current) { e.preventDefault(); e.stopPropagation(); setSettingsOpen(false); return; }
      if (e.key === 'Escape' && citePass.current && !citePass.current.stop) { e.preventDefault(); e.stopPropagation(); citePass.current.stop = true; flash('Stopping after this cite…'); return; }
      if (e.key === 'Escape' && homeRef.current) { e.preventDefault(); e.stopPropagation(); setHomeOpen(false); return; }
      if (!id) return;
      e.preventDefault();
      if (id === 'nextDoc' || id === 'prevDoc') { e.stopPropagation(); if (locked()) return; }
      if (id === 'recentDoc' || id === 'recentDocBack') { e.stopPropagation(); if (!locked() && !e.repeat) recent(id === 'recentDoc' ? 1 : -1, holdMods(keyOf(id))); return; }
      appCommand(id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [appCommand, sendToSpeech, recent, endSw]);
  const homeRef = useRef(homeOpen);
  homeRef.current = homeOpen;
  const settingsRef = useRef(settingsOpen);
  const saveAsRef = useRef(saveAsName);
  const compareRef = useRef(compareWith);
  compareRef.current = compareWith;
  saveAsRef.current = saveAsName;
  const speechAskRef = useRef(speechAsk);
  speechAskRef.current = speechAsk;
  const newAskRef = useRef(newAsk);
  newAskRef.current = newAsk;
  settingsRef.current = settingsOpen;
  const paletteRef = useRef(paletteOpen);
  paletteRef.current = paletteOpen;
  const ccRef = useRef(ccOpen);
  ccRef.current = ccOpen;
  useLayoutEffect(() => { if (!settingsOpen && !ask && saveAsName === null && !speechAsk && !newAsk && !paletteOpen && !ccOpen && !homeRef.current) viewRef.current?.focus(); }, [settingsOpen, ask, saveAsName, speechAsk, newAsk, paletteOpen, ccOpen]);

  const sel = useMemo(() => (view ? selectionState(view.state) : null), [view, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outline = useMemo(() => (view ? buildOutline(view.state.doc) : []), [view, docVersion]);
  const outlineRef = useRef(outline);
  outlineRef.current = outline;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const split = useMemo(() => (view ? readSplit(view.state.doc) : { cards: 0, tags: 0 }), [view, docVersion]);
  const words = split.cards + split.tags;
  // each reader reads cards at one speed, and tags, analytics and cites at another (Settings, Speech and timers)
  const r1 = (r: ReadSplit) => clock(readSeconds(r, pref(P.wpm1), pref(P.wpm1Tags))), r2 = (r: ReadSplit) => clock(readSeconds(r, pref(P.wpm2), pref(P.wpm2Tags)));
  const brush = view ? brushKey.getState(view.state)?.kind ?? null : null;

  // The outline marks the block holding the cursor while the cursor is on screen (so an outline click
  // or a click in the page marks what you clicked); scrolled away from it, the outline follows the
  // scroll: the last heading above the reading line.
  const measureRead = useCallback(() => {
    const v = viewRef.current, sc = scrollRef.current;
    if (!v || !sc || v.isDestroyed) return; // a frame queued before its pane closed
    const box = sc.getBoundingClientRect(), head = v.state.selection.head;
    const caret = v.coordsAtPos(head);
    // stores the row index, not the position, so typing within a block doesn't re-render the app
    const mark = (pos: number) => setCurItem(currentItem(outlineRef.current, pos));
    if (caret.bottom > box.top && caret.top < box.bottom) { mark(head); return; }
    const pm = v.dom.getBoundingClientRect(), top = box.top + 90;
    if (pm.top > top) { mark(0); return; }
    const y = Math.min(top, pm.bottom - 2), at = topChildAt(v, y); // outline rows are top-level paragraphs: which one is enough
    mark(at ?? v.posAtCoords({ left: pm.left + 4, top: y })?.pos ?? v.state.doc.content.size);
  }, []);
  measureRef.current = measureRead;
  useEffect(() => {
    const sc = mainScroll.current!;
    let raf = 0;
    const on = () => { if (scrollRef.current !== sc) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(measureRead); };
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
  useEffect(() => { if (!start.slot) track('app_opened'); whenIdle(() => void prefetch()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Opens by path run one at a time: two at once both read the tab list before either adds its tab,
  // and one is lost (or the same file opens twice). Last session's files and OS opens share the queue.
  const pathQueue = useRef(Promise.resolve());
  const queueOpens = useCallback((paths: string[], quiet: boolean) => {
    pathQueue.current = pathQueue.current.then(async () => {
      for (const p of paths) {
        if (quiet && openedPath(p)) continue;
        try { if (!elsewhere(p)) opened(await openPath(p), quiet ? 'restore' : 'os'); }
        catch (e) { if (!quiet) flash(`Couldn't open ${p.split(/[\\/]/).pop()}: ${(e as Error).message}`); }
      }
    });
  }, [opened, flash, elsewhere]);
  // a template's files, in its order, then back to the first; ones already open stay put, and one that won't open doesn't stop the rest
  const openTemplate = useCallback((t: Template) => {
    pathQueue.current = pathQueue.current.then(async () => {
      showEditor();
      const failed: string[] = [];
      for (const p of t.paths) {
        if (openedPath(p) || elsewhere(p)) continue;
        // drawn before the next step: docsRef only catches up on a render, and switchTo reads it
        try { const r = await openPath(p); flushSync(() => opened(r, 'template')); }
        catch { failed.push(pathName(p)); }
      }
      const first = t.paths.map(openedPath).find(Boolean);
      if (first) switchTo(first.id);
      flash(failed.length ? `${templateName(t)}: couldn't open ${failed.join(', ')}` : `Opened ${templateName(t)}`);
    });
  }, [opened, switchTo, flash]);
  const queueRef = useRef(queueOpens);
  queueRef.current = queueOpens;
  // reopen last files: the files open at the last quit, read before the list below is rewritten
  const [lastSession] = useState(() => readJson<string[]>('falcon.session', []));
  const reopened = useRef(false);
  useEffect(() => {
    if (!hasView || reopened.current) return;
    reopened.current = true;
    if (pref(P.reopen) && bridge.openPath && !start.slot) queueOpens(lastSession, true); // moved or deleted since: skipped
    if (start.path && !start.backup) {
      queueOpens([start.path], false);
      void pathQueue.current.then(() => {
        loadingPath.current = undefined;
        if (start.card && openedPath(start.path)) gotoCard(start.card);
        reportRef.current();
      });
    }
  }, [hasView]); // eslint-disable-line react-hooks/exhaustive-deps
  // files double-clicked in Finder/Explorer (or Open With): open each, or switch to it if it's already open
  useEffect(() => (hasView ? bridge.onOpenPaths?.((ps) => queueRef.current(ps, false)) : undefined), [hasView]);
  // Restore open files keeps every window's files, so the main process gathers them and each page hears the list.
  // The file this window is still reading counts, so it can't be opened a second time meanwhile
  const loadingPath = useRef(start.backup ? undefined : start.path);
  const reportRef = useRef(() => {});
  reportRef.current = () => {
    const paths = docs.flatMap((d) => (d.meta.path ? [d.meta.path] : []));
    if (!bridge.reportWindow) { safeSet('falcon.session', JSON.stringify(paths)); return; }
    bridge.reportWindow({ paths: loadingPath.current ? [loadingPath.current, ...paths] : paths, speech: docs.find((d) => d.id === speechId) ? docs.find((d) => d.id === speechId)!.meta.name || 'Speech' : null });
  };
  useEffect(() => { if (hasView) reportRef.current(); }, [docs, speechId, hasView]);
  useEffect(() => bridge.onWindows?.((w) => {
    safeSet('falcon.session', JSON.stringify(w.session));
    otherSpeech.current = w.speech;
    if (w.speech && speechRef.current !== null) { speechRef.current = null; setSpeechId(null); } // marked in another window: there's one speech doc
  }), []);
  // a file opened in another window belongs in this one's recents too, or the next save here writes over it
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === RECENTS_KEY) setRecents(loadRecents()); };
    addEventListener('storage', on);
    return () => removeEventListener('storage', on);
  }, []);
  // Open files in new windows: every doc past the first moves to a window of its own, unsaved edits and all
  const spreading = !!bridge.openWindow && pref(P.fileWindows);
  useEffect(() => {
    if (!spreading || !hasView || docs.length < 2) return;
    if (panes.current.size) { setGroup(null); arrange(null, activeRef.current); return; } // comes back here once they've come apart
    const moved = new Set<number>();
    for (const d of docsRef.current) {
      const doc = d.id === activeRef.current ? null : liveState(d.id)?.doc;
      if (!doc) continue;
      const speech = d.id === speechRef.current, b = [{ meta: d.meta, doc, active: true, dirty: d.dirty, speech: speech || undefined }];
      bridge.openWindow!({ alone: true, inactive: true, backup: packList(b, b), path: d.meta.path, speech: speech ? d.meta.name || 'Speech' : undefined });
      moved.add(d.id);
      savedDocs.current.delete(d.id);
      if (speech) { speechRef.current = null; setSpeechId(null); }
    }
    setDocs((ds) => ds.filter((d) => !moved.has(d.id)));
  }, [spreading, hasView, docs.length, group]); // eslint-disable-line react-hooks/exhaustive-deps
  // the window list and Mission Control tell one file's window from another by its title
  const activeName = docs.find((d) => d.id === activeId)?.meta.name;
  useEffect(() => { if (bridge.openWindow) document.title = spreading && activeName ? activeName : 'Falcon'; }, [spreading, activeName]);
  // a trackpad pinch zooms smoothly, always. it shows up as a wheel event with ctrlKey set while Ctrl isn't
  // actually down, so a held Ctrl (or Cmd) plus a real wheel only zooms with the setting on
  useEffect(() => {
    let ctrlDown = false;
    const onKey = (e: KeyboardEvent) => { ctrlDown = e.ctrlKey; };
    const onBlur = () => { ctrlDown = false; };
    const onWheel = (e: WheelEvent) => {
      const pinch = e.ctrlKey && !ctrlDown && !e.metaKey;
      if (!pinch && !((e.ctrlKey || e.metaKey) && pref(P.wheelZoom))) return;
      e.preventDefault();
      if (settingsRef.current || !(e.target as Element | null)?.closest?.('.f-scroll')) return;
      // a mouse wheel notch is ~100, way more than a pinch frame
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomWheel(pinch ? dy : Math.max(-12, Math.min(12, dy)), e.clientX, e.clientY);
    };
    addEventListener('keydown', onKey, true);
    addEventListener('keyup', onKey, true);
    addEventListener('blur', onBlur);
    addEventListener('wheel', onWheel, { passive: false });
    return () => { removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKey, true); removeEventListener('blur', onBlur); removeEventListener('wheel', onWheel); };
  }, [zoomWheel]);

  // what the command center can reach: every app action, the editor, and the state Settings shows
  const openSettingsAt = useCallback((page: string, query?: string) => { setSettingsPage(page); setSettingsQuery(query); setSettingsOpen(true); }, []);
  const ccCtx: Ctx = {
    view, zoom, setZoom, depth, setDepth, showOutline, setShowOutline, speechMin, setSpeechMin,
    run: (cmd) => { const v = viewRef.current; if (!v) return false; showEditor(); return cmd(v.state, v.dispatch, v); },
    app: appCommand,
    blocked: (id) => (SWAPS.includes(id) || id === 'sendToSpeech' || id === 'searchCards') && reading,
    highlight: activeColors.highlight, setHighlight: (c) => { setActiveColor('highlight', c); setTick((t) => t + 1); },
    isSpeech: speechId === activeId, toggleSpeech,
    jump: (i) => { const v = viewRef.current; const it = v && buildOutline(v.state.doc)[i]; if (it) { showEditor(); jump(it, i); } },
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
    docs: docList, recents, openFile: (h) => void openHit(h), openTemplate: bridge.openPath ? openTemplate : undefined,
  };
  const saveScroll = useCallback(() => {
    const sc = scrollRef.current, top = sc?.scrollTop ?? 0;
    return () => { stopScroll(); if (sc) sc.scrollTop = top; };
  }, []);

  // SpeechDrop's Upload sends the doc you came from, as it is now; a .docx from the room opens as a tab
  const exportActive = useCallback(async () => (await import('../docx/export')).docToDocx(viewRef.current!.state.doc), []);
  const openFromSd = useCallback(async (p: string) => {
    try { if (!elsewhere(p)) opened(await openPath(p), 'speechdrop'); }
    catch (e) { flash(`Couldn't open it: ${(e as Error).message}`); }
  }, [opened, flash, elsewhere]);
  useEffect(() => {
    addEventListener(SHOW_EVENT, openSd);
    return () => removeEventListener(SHOW_EVENT, openSd);
  }, [openSd]);

  const modal = settingsOpen || !!paletteOpen || ccOpen || !!ask || saveAsName !== null || speechAsk || newAsk;
  return (
    <div ref={appRef} className={`app${showOutline ? '' : ' no-outline'}`} style={{ '--ink': ink } as React.CSSProperties}>
      <div className="covered" inert={modal}>
      <Rail home={homeOpen} settings={settingsOpen} docs={docList} active={activeId} onSwitch={switchTo} onClose={closeDoc} onMove={moveDoc}
        group={group} onJoin={join} onUnjoin={unjoin} flash={flash}
        sd={sdTabs.map((x) => ({ key: x.key, on: sdLit === x.key, name: x.info.room?.name ?? 'SpeechDrop', fresh: x.info.fresh }))} onSd={showSd} onSdClose={closeSd}
        onHome={() => setHomeOpen((h) => !h)} onSettings={() => setSettingsOpen((s) => !s)} update={update} onUpdate={installUpdate} checking={checking} onCheck={bridge.checkUpdate && checkUpdate} />
      </div>

      <div className="covered" inert={homeOpen || sdOn || modal}>
      <Toolbar
        sel={sel}
        run={run}
        brush={brush}
        onColor={colorButton}
        onSend={sendToSpeech}
        onPick={(kind, c) => { setActiveColor(kind, c); setTick((t) => t + 1); const v = viewRef.current; if (v && !v.state.selection.empty) run(commandOf(kind)); }}
        flash={flash}
        speechSeconds={speechMin * 60}
      />
      </div>

      {/* After the toolbar on purpose: Electron applies drag regions in document order, so the toolbar's
          drag area (which runs under these buttons) would swallow their clicks if they came first. */}
      <div className="covered" inert={sdOn || modal}>
      <Tools outline={showOutline} reading={reading}
        onNew={(speech) => (speech ? fileNewSpeech() : setNewAsk(true))} onOpen={() => void fileOpen()} onSave={(as) => void fileSave(as)}
        onFind={openFind} onOutline={() => { showEditor(); setShowOutline((s) => !s); }}
        onRead={() => { showEditor(); run(toggleRead); }}
        speech={speechId === activeId} onSpeech={toggleSpeech} />
      </div>

      <div className="covered" inert={homeOpen || sdOn || modal}>

      <OutlinePane active={activeId}
        shown={showOutline} items={outline} depth={depth} cur={cur}
        numbers={view ? outlineNumbers(view.state) : []} getView={getView} onPeek={peek} flash={flash}
        onDepth={setDepth} onJump={jump} />

      <div ref={mainScroll} className="f-scroll f-main" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); viewRef.current?.focus(); } }}>
        <div className="page"><div ref={mountRef} /></div>
      </div>
      {/* joined files: arrange() builds a pane per file in here, each with its own editor; React draws their names */}
      <div ref={splitBox} className="split" />
      {splitOn && [...panes.current].map(([id, p]) => {
        const d = docs.find((x) => x.id === id);
        return d && createPortal(<><span className="nm">{tidy(d.meta.name || 'Untitled')}</span>{d.dirty && <i className="dot" aria-label="unsaved" />}{id === speechId && <i className="spk" aria-hidden="true">S</i>}
          <button className="pane-x" title="Take out of the split (the file stays open)" aria-label={`Take ${tidy(d.meta.name || 'Untitled')} out of the split`} onClick={() => leave(id)}><SvgIcon name="x" /></button></>, p.head, String(id));
      })}
      {findOpen && view && <FindBar view={view} inputRef={findRef} flash={flash} onClose={() => setFindOpen(false)} />}

      <footer className="status">
        <span>Σ</span>
        <span>Doc: {words.toLocaleString('en-US')} · Reader 1: {r1(split)} · Reader 2: {r2(split)}</span>
        {/* only what's read aloud counts, the same rule as Doc: highlighted text, tags, analytics and cites */}
        {sel && sel.selRead > 0 && <span className="sel" title="Words you'd read aloud in the selection (highlighted text, tags, analytics and cites), and how long Reader 1 and Reader 2 take">Sel: {sel.selRead.toLocaleString('en-US')} {sel.selRead === 1 ? 'word' : 'words'} · {r1(sel.selSplit)} / {r2(sel.selSplit)}</span>}
        {brush && <span className="lit">Paintbrush on · Esc to stop</span>}
        {reading && <span className="lit">Read mode · keyboard locked · Space drops a marker</span>}
        <span className="grow" />
        <button title={titled('Zoom out', 'zoomOut', 'make the page smaller')} onClick={() => zoomBy(-0.1)}>−</button>
        <button className="zoom" title={titled('Actual size', 'zoomReset', 'back to 100%')} onClick={() => zoomTo(1)}>{Math.round(zoom * 100)}%</button>
        <button title={titled('Zoom in', 'zoomIn', 'make the page bigger')} onClick={() => zoomBy(0.1)}>+</button>
      </footer>
      </div>

      <div className="covered" inert={modal}>
      {sdTabs.map((x) => (
        <SpeechDrop key={x.key} open={sdLit === x.key} docName={name} exportDoc={exportActive} onOpenDocx={openFromSd} onTab={(t) => sdInfo(x.key, t)} flash={flash} confirm={confirmAsk}
          onShow={() => showSd(x.key)} onAnother={newSd} openElsewhere={(code) => sdElsewhere(x.key, code)} />
      ))}
      </div>
      <div className="covered" inert={!!ask}>
      <Home open={homeOpen} recents={recents.slice(0, pref(P.recentCount))}
        onNew={fileNew} onNewSpeech={fileNewSpeech} onOpen={() => void fileOpen()} onSpeechDrop={openSd} onRecent={(r) => void openRecent(r)} onPeek={peekRecent}
        onClear={(undo) => {
          if (!undo) { clearedRecents.current = recents; setRecents([]); return; }
          // Home lists only the newest few; Undo brings back the whole list, behind anything opened since
          setRecents((cur) => [...cur, ...clearedRecents.current.filter((k) => !cur.some((c) => c.name === k.name && c.path === k.path))]);
        }} />
      <Palette open={paletteOpen === 'files'} onClose={() => setPaletteOpen(false)} docs={docList} recents={recents} onPick={(h) => void openHit(h)}
        onSettings={() => { setSettingsPage('search'); setSettingsOpen(true); }} />
      <CardSearch open={paletteOpen === 'cards'} onClose={() => setPaletteOpen(false)} onPick={(h, insert) => void pickCard(h, insert)}
        onSettings={() => { setSettingsPage('search'); setSettingsOpen(true); }} />
      {sw?.shown && <Switcher sel={sw.sel} onHover={(i) => { if (swRef.current) setSw({ ...swRef.current, sel: i }); }} onPick={(i) => endSw(true, i)} onCancel={() => endSw(false)}
        docs={sw.ids.flatMap((id) => {
          const d = docs.find((x) => x.id === id), doc = liveState(id)?.doc;
          return d && doc ? [{ id, name: d.meta.name || 'Untitled', dirty: d.dirty, doc, top: tops.current.get(id) ?? 0 }] : [];
        })} />}
      <CommandCenter open={ccOpen} onClose={() => setCcOpen(false)} ctx={ccCtx} flash={flash} saveScroll={saveScroll} />
      <Settings open={settingsOpen} onClose={() => { setSettingsOpen(false); setSettingsPage(undefined); setSettingsQuery(undefined); }} startPage={settingsPage} startQuery={settingsQuery}
        zoom={zoom} onZoom={setZoom} speechMin={speechMin} onSpeechMin={setSpeechMin}
        showOutline={showOutline} onShowOutline={setShowOutline} depth={depth} onDepth={setDepth}
        highlight={activeColors.highlight} onHighlight={(c) => { setActiveColor('highlight', c); setTick((t) => t + 1); }} />
      </div>
      <Confirm ask={ask} />
      <SaveAs name={saveAsName} onSave={saveCopy} onClose={closeSaveAs} />
      <ComparePanel open={compareWith} onClose={closeCompare} readSelection={readSelection} />
      <NewDoc open={newAsk} onBlank={() => { setNewAsk(false); fileNew(); }} onSpeech={() => { setNewAsk(false); fileNewSpeech(); }} onClose={closeNewDoc} />
      <NewSpeech open={speechAsk} onMake={makeSpeech} onClose={closeNewSpeech} />
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
/** A SpeechDrop tab's row: lit or not, the room's name, and how many files came that you haven't seen. */
type SdRow = { key: number; on: boolean; name: string; fresh: number };
function Rail(props: { home: boolean; settings: boolean; docs: DocRow[]; active: number; onSwitch: (id: number) => void; onClose: (id: number) => void; onMove: (id: number, to: number) => void;
  group: number[] | null; onJoin: (ids: number[]) => void; onUnjoin: () => void; flash: (m: string) => void; sd: SdRow[]; onSd: (key: number) => void; onSdClose: (key: number) => void; onHome: () => void; onSettings: () => void; update: UpdateInfo | null; onUpdate: () => void; checking: boolean; onCheck?: () => void }) {
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
  const hide = () => { clearTimeout(timer.current); if (!moving.current) timer.current = window.setTimeout(() => setOpen(false), 180); };
  useEffect(() => () => clearTimeout(timer.current), []);

  // press a file and drag it up or down to reorder, the way the outline's rows go: a line marks the gap it
  // will land in, letting go moves it there, Escape puts it back. A press that doesn't move 5px stays a
  // click, and the click after a real drag is swallowed
  const moving = useRef(false);
  const [dragId, setDragId] = useState<number | null>(null);
  // a class, not `:root:has([data-drag])`: with :has, every element added anywhere restyles the whole page
  useEffect(() => { document.documentElement.classList.toggle('f-dragging', dragId !== null); }, [dragId]);
  const [gap, setGap] = useState<number | null>(null); // the gap the line sits in: before row `gap`, or after the last
  const reorder = (id: number) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.doc-x, .files-x')) return;
    const box = e.currentTarget.parentElement!, x0 = e.clientX, y0 = e.clientY;
    let y = y0, at: number | null = null, raf = 0;
    const rows = () => ([...box.children] as HTMLElement[]).filter((r) => r.dataset.id); // docs only: the SpeechDrop row stays last
    // the gap nearest the pointer; the two beside the file itself change nothing
    const aim = () => {
      const rs = rows(), from = rs.findIndex((r) => r.dataset.id === String(id));
      let g = rs.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
      if (g < 0) g = rs.length;
      at = g === from || g === from + 1 ? null : g;
      setGap(at);
    };
    // near the top or bottom of a scrolling list, it scrolls on
    const tick = () => {
      const r = box.getBoundingClientRect();
      const dy = y < r.top + 24 ? y - (r.top + 24) : y > r.bottom - 24 ? y - (r.bottom - 24) : 0;
      if (dy) { box.scrollTop += Math.max(-12, Math.min(12, dy / 2)); aim(); }
      raf = requestAnimationFrame(tick);
    };
    const move = (m: PointerEvent) => {
      y = m.clientY;
      if (!moving.current) {
        if (Math.hypot(m.clientX - x0, y - y0) < 5) return;
        moving.current = true;
        setDragId(id);
        raf = requestAnimationFrame(tick);
      }
      m.preventDefault();
      aim();
    };
    const end = (ok: boolean) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      removeEventListener('blur', cancel);
      removeEventListener('keydown', key, true);
      cancelAnimationFrame(raf);
      if (!moving.current) return;
      setDragId(null);
      setGap(null);
      if (ok && at !== null) {
        const from = rows().findIndex((r) => r.dataset.id === String(id));
        props.onMove(id, at > from ? at - 1 : at);
      }
      // the click that ends a drag isn't a switch; clear the flag after it would have fired
      addEventListener('click', swallow, true);
      setTimeout(() => {
        removeEventListener('click', swallow, true);
        moving.current = false;
        // dropped outside both lists: the leave that would have shut the panel was skipped mid-drag
        if (!strip.current?.matches(':hover') && !list.current?.parentElement?.matches(':hover')) hide();
      }, 0);
    };
    const up = () => end(true), cancel = () => end(false);
    const key = (k: KeyboardEvent) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); end(false); } };
    const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
    addEventListener('blur', cancel);
    addEventListener('keydown', key, true);
  };
  // both lists scroll together, so each row stays level with its icon
  useLayoutEffect(() => { if (open && list.current && strip.current) list.current.scrollTop = strip.current.scrollTop; }, [open, props.docs.length]);

  // the right edge drags the rail wider; wide enough, the names show in the rail and the hover panel stays shut
  // off (Settings > Appearance > Resizable rail), it stays icons only; the dragged width is kept for when it's back on
  const resizable = pref(P.railResize);
  const [dragged, setWidth] = useState(loadRail);
  const width = resizable ? dragged : RAIL_MIN;
  const wide = width >= RAIL_NAMES;
  useLayoutEffect(() => { document.documentElement.style.setProperty('--rail-w', `${width}px`); }, [width]);
  useEffect(() => { if (wide) setOpen(false); }, [wide]);
  const resize = (w: number) => { setWidth(w); saveRail(w); };
  const grab = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = e.clientX - width, root = document.documentElement;
    let w = width, raf = 0;
    root.dataset.railDrag = '';
    const move = (m: PointerEvent) => { w = railWidth(m.clientX - from, railMax()); cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setWidth(w)); };
    const up = () => {
      cancelAnimationFrame(raf);
      delete root.dataset.railDrag;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      resize(w);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  };
  const step = (e: React.KeyboardEvent) => {
    const to = { ArrowLeft: width - 16 < RAIL_NAMES ? RAIL_MIN : width - 16, ArrowRight: wide ? width + 16 : RAIL_NAMES, Home: RAIL_MIN, End: RAIL_MAX }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    resize(railWidth(to, railMax()));
  };

  // Shift-click picks files without opening them; right-click a picked one to Join them side by side
  const [sel, setSel] = useState<number[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setSel((s) => (s.every((id) => props.docs.some((d) => d.id === id)) ? s : s.filter((id) => props.docs.some((d) => d.id === id)))); }, [props.docs]);
  const pick = (id: number) => (e: React.MouseEvent) => {
    if (!e.shiftKey) { setSel([]); props.onSwitch(id); return; }
    e.preventDefault();
    if (sel.includes(id)) { setSel(sel.filter((x) => x !== id)); return; }
    const max = pref(P.joinMax);
    if (sel.length >= max) { props.flash(`You can join up to ${max} files. Change it in Settings > Appearance.`); return; }
    setSel([...sel, id]);
  };
  // right-clicking a file while others are picked counts it in, so pick two and right-click either
  // and the open file counts in too when that alone would leave one, so pick one and right-click it or the open one
  const joining = menu ? (sel.length ? [...new Set([...sel, menu.id])] : []) : [];
  if (joining.length === 1 && props.docs.some((d) => d.id === props.active) && !props.home && !props.sd.some((s) => s.on) && !joining.includes(props.active)) joining.push(props.active);
  const member = !!menu && !!props.group?.includes(menu.id);
  const openMenu = (id: number) => (e: React.MouseEvent) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, id }); };
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !menu) return;
    el.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - el.offsetHeight - 8))}px`;
    requestAnimationFrame(() => el.classList.add('in'));
  }, [menu]);
  useEffect(() => {
    if (!menu && !sel.length) return;
    const down = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    // Esc shuts the menu, then lets go of the picked files
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; if (menu) setMenu(null); else setSel([]); };
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', down, true);
    addEventListener('keydown', key);
    addEventListener('resize', close);
    addEventListener('blur', close);
    return () => { document.removeEventListener('pointerdown', down, true); removeEventListener('keydown', key); removeEventListener('resize', close); removeEventListener('blur', close); };
  }, [menu, sel.length]);
  // joined files read as one capsule in both lists, where they sit together
  const joinAt = (i: number) => {
    const g = props.group, d = props.docs;
    if (!g?.includes(d[i].id)) return undefined;
    const up = i > 0 && g.includes(d[i - 1].id), down = i < d.length - 1 && g.includes(d[i + 1].id);
    return up && down ? 'mid' : up ? 'last' : down ? 'first' : 'solo';
  };

  const isOn = (d: DocRow) => d.id === props.active && !props.home && !props.sd.some((s) => s.on);
  const sdLabel = (sd: SdRow) => `SpeechDrop${sd.name !== 'SpeechDrop' ? `: ${sd.name}` : ''}${sd.fresh ? ` (${sd.fresh} new)` : ''}`;
  const sdTip = titled('SpeechDrop', 'speechdrop', 'the room\'s files, live. Middle-click to close');
  return (
    <nav className="fstrip" aria-label="Open documents" data-wide={wide || undefined}>
      <button ref={logo} className="sb-logo" title={titled('Home', 'home', 'recent files and new documents')} aria-label="Home" data-on={props.home || undefined} onClick={props.onHome}><SvgIcon name="logo" /><span className="lbl">Falcon</span></button>
      <div ref={strip} className="fs-docs" role="tablist" aria-label="Open documents" onPointerEnter={wide ? undefined : show} onPointerLeave={wide ? undefined : hide}
        onScroll={(e) => { if (list.current) list.current.scrollTop = e.currentTarget.scrollTop; }}>
        {props.docs.map((d, i) => (
          <div key={d.id} className="doc-row" data-id={d.id} data-on={isOn(d) || undefined} data-drag={dragId === d.id || undefined} data-drop={gap === i ? 'before' : gap === props.docs.length && i === props.docs.length - 1 ? 'after' : undefined} data-sel={sel.includes(d.id) || undefined} data-join={joinAt(i)}
            onPointerDown={reorder(d.id)} onContextMenu={openMenu(d.id)}>
            <button className="fs-b doc-nm" role="tab" aria-selected={isOn(d)} aria-label={d.speech ? `${d.name} (speech doc)` : d.name} data-on={isOn(d) || undefined}
              onClick={pick(d.id)} onAuxClick={(e) => { if (e.button === 1) props.onClose(d.id); }}>
              <SvgIcon name="doc" />{wide && <span className="lbl">{tidy(d.name)}</span>}{d.dirty && <i className="dot" aria-label="unsaved" />}{d.speech && <i className="spk" aria-hidden="true">S</i>}
            </button>
            {wide && <button tabIndex={-1} className="doc-x" title={titled('Close', 'close', 'close this file')} onClick={() => props.onClose(d.id)}><SvgIcon name="x" /></button>}
          </div>
        ))}
        {props.sd.map((sd) => (
          <div key={`sd${sd.key}`} className="doc-row sd-tab" data-on={sd.on || undefined}>
            <button className="fs-b doc-nm" role="tab" aria-selected={sd.on} aria-label={sdLabel(sd)} title={sdTip} data-on={sd.on || undefined}
              onClick={() => props.onSd(sd.key)} onAuxClick={(e) => { if (e.button === 1) props.onSdClose(sd.key); }}>
              <SvgIcon name="inbox" />{wide && <span className="lbl">{sd.name}</span>}{sd.fresh > 0 && <i className="dot new" aria-hidden="true" />}
            </button>
            {wide && <button tabIndex={-1} className="doc-x" title="Close SpeechDrop" onClick={() => props.onSdClose(sd.key)}><SvgIcon name="x" /></button>}
          </div>
        ))}
      </div>
      {/* mouse-only: the tabs in the rail are what the keyboard and screen readers use; inert while
          closed so its rows can't take clicks */}
      <aside className="files" data-open={open || undefined} inert={!open} aria-hidden="true" onPointerEnter={show} onPointerLeave={hide}>
        <div className="files-h" style={{ top: at.head }}><b>Falcon</b><span>{props.docs.length} open</span></div>
        <div ref={list} className="files-l" style={{ top: at.list }}
          onScroll={(e) => { if (strip.current) strip.current.scrollTop = e.currentTarget.scrollTop; }}>
          {props.docs.map((d, i) => (
            <div key={d.id} className="files-r" data-id={d.id} data-on={isOn(d) || undefined} data-drag={dragId === d.id || undefined} data-drop={gap === i ? 'before' : gap === props.docs.length && i === props.docs.length - 1 ? 'after' : undefined} data-sel={sel.includes(d.id) || undefined} data-join={joinAt(i)}
              onPointerDown={reorder(d.id)} onContextMenu={openMenu(d.id)}>
              <button tabIndex={-1} className="files-b" onClick={pick(d.id)} onAuxClick={(e) => { if (e.button === 1) props.onClose(d.id); }}>
                <SvgIcon name="doc" /><span className="nm">{tidy(d.name)}</span>{d.speech && <i className="spk" aria-hidden="true">S</i>}{d.dirty && <i className="dot" />}
              </button>
              <button tabIndex={-1} className="files-x" title={titled('Close', 'close', 'close this file')} onClick={() => props.onClose(d.id)}><SvgIcon name="x" /></button>
            </div>
          ))}
          {props.sd.map((sd) => (
            <div key={`sd${sd.key}`} className="files-r" data-on={sd.on || undefined}>
              <button tabIndex={-1} className="files-b" onClick={() => props.onSd(sd.key)} onAuxClick={(e) => { if (e.button === 1) props.onSdClose(sd.key); }}>
                <SvgIcon name="inbox" /><span className="nm">{sd.name}</span>{sd.fresh > 0 && <i className="dot new" />}
              </button>
              <button tabIndex={-1} className="files-x" title="Close SpeechDrop" onClick={() => props.onSdClose(sd.key)}><SvgIcon name="x" /></button>
            </div>
          ))}
        </div>
      </aside>
      {menu && (joining.length >= 2 || member) && (
        <div ref={menuRef} className="pop menu rail-menu" role="menu" aria-label="File">
          {joining.length >= 2 && <>
            <div className="mn-h">{joining.length} files selected</div>
            <button className="mn-i" role="menuitem" onClick={() => { setMenu(null); setSel([]); props.onJoin(joining); }}><span>Join</span></button>
          </>}
          {member && <button className="mn-i" role="menuitem" onClick={() => { setMenu(null); props.onUnjoin(); }}><span>Unjoin</span></button>}
        </div>
      )}
      <div className="grow" />
      {props.update ? <UpdateButton u={props.update} onInstall={props.onUpdate} />
        : props.onCheck && <button className="fs-b chk" title={props.checking ? 'Checking for updates' : 'Check for updates'} aria-label="Check for updates"
            aria-busy={props.checking || undefined} data-busy={props.checking || undefined} onClick={() => { if (!props.checking) props.onCheck!(); }}>
            <SvgIcon name="refresh" /><span className="lbl">{props.checking ? 'Checking' : 'Check for updates'}</span></button>}
      <button className="fs-b gear-b" title={titled('Settings', 'settings', 'highlight color, speech time, keys and more')} aria-label="Settings" data-on={props.settings || undefined} onClick={props.onSettings}><SvgIcon name="gear" /><span className="lbl">Settings</span></button>
      {resizable && <div className="rail-grip" role="separator" aria-orientation="vertical" aria-label="Rail width" tabIndex={0}
        aria-valuemin={RAIL_MIN} aria-valuemax={RAIL_MAX} aria-valuenow={width}
        title="Rail width: drag to show file names, double-click to reset"
        onPointerDown={grab} onDoubleClick={() => resize(RAIL_MIN)} onKeyDown={step} />}
    </nav>
  );
}

// the update button: a ring while the update downloads, lit once it's ready; hovering it shows what's new
function UpdateButton({ u, onInstall }: { u: UpdateInfo; onInstall: () => void }) {
  const [open, setOpen] = useState(false);
  const [bottom, setBottom] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = () => { clearTimeout(timer.current); setBottom(innerHeight - btn.current!.getBoundingClientRect().bottom); setOpen(true); };
  const hide = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), 180); };
  const { items, more } = useMemo(() => releaseNotes(u.notes), [u.notes]);
  const downloading = u.state === 'downloading';
  const busy = downloading || u.state === 'installing';
  const title = downloading ? 'Downloading the update' : busy ? 'Installing the update' : u.state === 'error' ? "The update didn't install" : 'Update ready to install';
  const mb = (n = 0) => Math.round(n / 1e6);
  const action = downloading ? `${mb(u.done)} of ${mb(u.total)} MB. You can keep working.`
    : busy ? 'Falcon restarts when it\'s done.'
    : u.state === 'error' ? `${u.error ?? 'Something went wrong'}. Click to try again.`
    : u.manual ? 'Click to open the installer, then drag Falcon onto Applications.' : 'Click to restart and update.';
  return (
    <>
      <button ref={btn} className="fs-b upd" aria-label={`${title}: Falcon ${u.version}`} aria-disabled={busy || undefined} data-state={u.state}
        style={downloading ? { '--p': `${u.total ? (u.done ?? 0) / u.total * 100 : 0}%` } as React.CSSProperties : undefined}
        onClick={() => { if (!busy) onInstall(); }} onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}>
        <SvgIcon name="download" /><i className="upd-dot" />
      </button>
      <div className="upd-card" data-open={open || undefined} role="tooltip" style={{ bottom }} onPointerEnter={show} onPointerLeave={hide}>
        <b>{title}</b>
        <span className="upd-v">{u.version}{u.date && ` · ${ago(u.date)}`}</span>
        {items.length > 0 && <ul>{items.map((n, i) => <li key={i}>{n.lead && <strong>{n.lead} </strong>}{n.rest}</li>)}</ul>}
        {more > 0 && <p className="upd-more">Plus {more} more {more === 1 ? 'change' : 'changes'}.</p>}
        <p className="upd-act">{action}</p>
        {u.url && <a href={u.url} target="_blank" rel="noreferrer">Full release notes</a>}
      </div>
    </>
  );
}

// ---------- the tools: file and view buttons in a row above the outline ----------

function Tools(props: { outline: boolean; reading: boolean; speech: boolean; onNew: (speech: boolean) => void; onOpen: () => void; onSave: (as: boolean) => void; onFind: () => void; onOutline: () => void; onRead: () => void; onSpeech: () => void }) {
  const b = (icon: string, title: string, onClick: (e: React.MouseEvent) => void, on = false) => (
    <button className="fs-b" title={title} aria-label={parseTip(title).label} data-on={on || undefined} aria-pressed={on || undefined} onClick={onClick}><SvgIcon name={icon} /></button>
  );
  return (
    <div className="tools" role="toolbar" aria-label="File and view">
      {b('plus', titled('New document', 'new', 'choose a blank file or a speech doc. Shift-click goes straight to a speech doc'), (e) => props.onNew(e.shiftKey))}
      {b('open', titled('Open…', 'open', 'open a .docx file'), props.onOpen)}
      {b('save', titled('Save', 'save', 'save this file. Shift-click for Save As'), (e) => props.onSave(e.shiftKey))}
      {b('saveAs', titled('Save As…', 'saveAs', 'save a copy, as-is or as a send, read or marked doc'), () => props.onSave(true))}
      <span className="sep" />
      {b('search', titled('Find', 'find', 'search this file'), props.onFind)}
      {b('list', titled('Outline', 'outline', 'show or hide the list of pockets, hats, blocks and tags'), props.onOutline, props.outline)}
      {b('eye', titled('Read mode', 'read', 'show only what\'s read aloud. Typing is locked and Space drops a marker'), props.onRead, props.reading)}
      {b('mic', `Speech doc: make this file the speech doc, where ${keyOf('sendToSpeech') ? keyText(keyOf('sendToSpeech')) : 'Send'} sends the selection. Click again to unmark it`, props.onSpeech, props.speech)}
    </div>
  );
}

// ---------- the top bar: the Classic layout, a two-row grid where each button previews its style ----------

type SelState = ReturnType<typeof selectionState>;
type PopKind = 'highlight' | 'shading' | 'font' | 'size' | 'doc' | 'card';
const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48];

function Toolbar(props: { sel: SelState | null; run: (c: Command) => void; brush: string | null; onColor: (k: 'highlight' | 'shading') => void; onPick: (k: 'highlight' | 'shading', c: string | null) => void; flash: (m: string) => void; onSend: () => void; speechSeconds: number }) {
  const { sel, run } = props;
  const SPEECH_SECONDS = props.speechSeconds;
  const [pop, setPop] = useState<{ kind: PopKind; x: number; y: number; origin: number } | null>(null);
  const [fontColor, setFontColor] = useState<string | null>(() => localStorage.getItem('falcon.fontColor'));
  useEffect(() => onPrefs(() => setFontColor(localStorage.getItem('falcon.fontColor'))), []); // Import settings
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

  // the round's clocks: the speech timer opens the timer window (speech, our prep, their prep); right-click resets it.
  // The prep button, when Settings shows it, is our prep: click to start or pause, right-click to reset
  const showPrep = pref(P.showPrep);
  const lowSec = pref(P.lowTime);
  const rc = useRoundClocks(pref(P.round), SPEECH_SECONDS / 60, pref(P.prepMin), (id) => {
    props.flash(id === 'speech' ? 'Time is up' : id === 'our' ? 'Prep is up' : 'Their prep is up');
    if (pref(P.beep)) beep();
  });
  const [timerReq, setTimerReq] = useState(0); // each click asks the window to open, or come forward
  const [timerOpen, setTimerOpen] = useState(false);
  // the command center starts, pauses and resets the clocks the same way a click does, and opens the window
  const rcRef = useRef(rc);
  rcRef.current = rc;
  useEffect(() => {
    const on = (e: Event) => {
      const { which, op } = (e as CustomEvent<TimerRequest>).detail;
      if (op === 'open') { setTimerReq((n) => n + 1); return; }
      const id = which === 'prep' ? 'our' : which;
      if (op === 'reset') rcRef.current.reset(id); else rcRef.current.toggle(id);
    };
    addEventListener(TIMER_EVENT, on);
    return () => removeEventListener(TIMER_EVENT, on);
  }, []);
  const { clocks } = rc;
  const low = (id: 'speech' | 'our') => (clocks.on === id && lowSec > 0 && clocks[id] <= lowSec ? ' low' : '');

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
          <button className="b sm" title={titled('Shrink', 'shrink', pref(P.smartShrink) ? 'Smart Shrink: unread paragraphs to 5 pt, unread words between read ones to 8 pt' : 'make the text you don\'t read smaller. Press again to shrink more')} onMouseDown={(e) => { e.preventDefault(); run(commandOf('shrink')); }}>Shrink</button>
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
          <button className={`b timer clock${low('speech')}`} data-on={clocks.on === 'speech' || undefined} aria-haspopup="dialog" aria-expanded={timerOpen}
            title={`Timer: ${rc.speeches[clocks.idx].name}. Click to open the timer window, with both sides' prep. Right-click to reset`}
            onMouseDown={(e) => { e.preventDefault(); if (e.button === 0) setTimerReq((n) => n + 1); }}
            onContextMenu={(e) => { e.preventDefault(); rc.reset('speech'); }}>
            <Stopwatch left={clocks.speech / rc.speeches[clocks.idx].sec} />{clock(clocks.speech)}
          </button>
          <TimerWindow req={timerReq} onOpen={setTimerOpen} rc={rc} low={lowSec} />
          {pref(P.showSend) && (
            <button className="b" title={titled('Send to speech', 'sendToSpeech', 'copy the selection, or the card or section at the caret, into the speech doc. The file isn\'t changed. Change the key in Settings > Keybindings')} onMouseDown={(e) => { e.preventDefault(); props.onSend(); }}>Send</button>
          )}
          {showPrep && (
            <button className={`b timer prep${low('our')}`} data-on={clocks.on === 'our' || undefined} title="Our prep: click to start or pause. Right-click to reset"
              onMouseDown={(e) => { e.preventDefault(); if (e.button === 0) rc.toggle('our'); }}
              onContextMenu={(e) => { e.preventDefault(); rc.reset('our'); }}>
              Prep {clock(clocks.our)}
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
              {(pop.kind === 'highlight' ? Object.entries(HIGHLIGHTS).map(([n, css]) => [n, css, HIGHLIGHT_NAMES[n]]) : SHADES.map(([c, name]) => [c, c, name])).map(([n, css, name]) => (
                <button key={n} className="sw" role="menuitem" aria-label={name} title={name} aria-current={activeColors[pop.kind as 'highlight'] === n || undefined} style={{ background: css }}
                  onMouseDown={(e) => { e.preventDefault(); props.onPick(pop.kind as 'highlight', n); setPop(null); }} />
              ))}
            </>}
        </div>
      )}
    </header>
  );
}
