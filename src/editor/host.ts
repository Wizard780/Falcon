import type { EditorView } from 'prosemirror-view';
import { insertPlainText } from './commands';

/** The active pens for the highlight and background-color buttons (null = the "no color" pen). */
export const activeColors: { highlight: string | null; shading: string | null } = {
  highlight: localStorage.getItem('falcon.highlight') ?? 'yellow',
  shading: localStorage.getItem('falcon.shading') ?? '#D9D9D9',
};
export function setActiveColor(kind: 'highlight' | 'shading', color: string | null) {
  activeColors[kind] = color;
  if (color === null) localStorage.removeItem(`falcon.${kind}`);
  else localStorage.setItem(`falcon.${kind}`, color);
}

export type IndexFolder = { path: string; count: number | null; missing: boolean };
export type IndexedFile = { path: string; root: string; mtime: number };
/** One card from Search cards: the file it's in and which tag or analytic it is there (0-based). */
export type CardHit = { path: string; ordinal: number; file: string; tag: string; cite: string; headings: string[]; copies: number };
export type CardIndexStatus = { files: number; cards: number; scanning: boolean; done: number; total: number };
type FalconBridge = {
  readClipboardText?: () => Promise<string>;
  openFile?: () => Promise<{ name: string; path: string; data: Uint8Array } | null>;
  openPath?: (path: string) => Promise<{ name: string; path: string; data: Uint8Array }>;
  saveFile?: (opts: { path?: string; name: string; data: Uint8Array }) => Promise<{ path: string; name: string } | null>;
  /** File search (Cmd-K): the folders allowed in Settings, with file counts (null while the first scan runs). */
  indexFolders?: () => Promise<IndexFolder[]>;
  /** Pick folders in the native dialog and allow them. Returns the new list. */
  addIndexFolder?: () => Promise<IndexFolder[]>;
  removeIndexFolder?: (path: string) => Promise<IndexFolder[]>;
  /** Every .docx in the allowed folders (openPath opens any of them). */
  indexedFiles?: () => Promise<IndexedFile[]>;
  /** Search cards: the cards in those folders whose tag, cite, headings or file name hold every word. */
  searchCards?: (query: string) => Promise<{ hits: CardHit[]; status: CardIndexStatus }>;
  /** Words added with right-click > Add to Dictionary, sorted. */
  dictionaryWords?: () => Promise<string[]>;
  /** Take a word back out of the dictionary. Returns the new list. */
  removeDictionaryWord?: (word: string) => Promise<string[]>;
  /** Mac File menu clicks ('new', 'newSpeech', 'open', 'save', 'saveAs', 'close', 'settings'). Returns an unsubscribe. */
  onMenu?: (f: (cmd: string) => void) => () => void;
  /** Files the OS asked Falcon to open (double-click, Open With). Subscribing says the page is ready. Returns an unsubscribe. */
  onOpenPaths?: (f: (paths: string[]) => void) => () => void;
  /** The keys the Mac menu shows beside its items, by command ('save': 'Mod-s'; '' shows none). */
  setMenuKeys?: (keys: Record<string, string>) => void;
  /** Closing the window (quit = quitting the app) with unsaved docs: the page asks. Returns an unsubscribe. */
  onConfirmClose?: (f: (quit: boolean) => void) => () => void;
  /** The user said close anyway: close the window (or quit) past the unsaved-docs guard. */
  forceClose?: (quit: boolean) => void;
  /** The theme changed: the window's own background (shown before the page paints) and native menus follow it.
   *  system: the theme is System, so native stays on the OS setting (forcing it would freeze prefers-color-scheme). */
  setTheme?: (bg: string, dark: boolean, system: boolean) => void;
  /** A newer Falcon, downloaded and ready to install (null: none). Fires with the current state on subscribe. Returns an unsubscribe. */
  onUpdate?: (f: (u: UpdateInfo | null) => void) => () => void;
  /** Install the downloaded update and restart (or open its disk image when Falcon can't replace itself). */
  installUpdate?: () => Promise<void>;
  /** Check for a newer Falcon now: 'ready' once one is downloaded (onUpdate fires too), 'none' when this is the latest, 'failed' offline. */
  checkUpdate?: () => Promise<'ready' | 'none' | 'failed'>;
  /** Anonymous usage count (electron/telemetry.cjs drops unknown events and any non-word value). */
  track?: (event: string, props?: Record<string, string | number | boolean>) => void;
  /** The open docs, for open-docs.json in userData (electron/docsync.cjs); their files are watched while open. */
  setOpenDocs?: (docs: { path?: string; name: string; unsaved: boolean; active: boolean }[]) => void;
  /** The user's edits to the file at `path` since its checkpoint (edit-log.ts), for edits/<hash>.json in userData. */
  writeEdits?: (path: string, edits: { cards: unknown[]; unsaved: boolean }) => void;
  /** The checkpoint the edits count from: `data` is the file to count from when it isn't the doc as opened (an earlier
   *  session's, or a restored doc's file); null when it is. Null for a file Falcon may not open. */
  editCheckpoint?: (path: string) => Promise<{ continued: boolean; data: Uint8Array | null } | null>;
  /** An open doc's file changed on disk (another program wrote it). Returns an unsubscribe. */
  onDocChanged?: (f: (path: string) => void) => () => void;
  /** SpeechDrop (electron/speechdrop.cjs): rooms, live file lists, uploads and downloads. */
  speechdrop?: SpeechDropBridge;
  platform?: string;
};
/** A SpeechDrop answer: the value, or SpeechDrop's error code ('no_room', 'too_large', 'unreachable'…). */
export type SdResult<T> = { ok: true; value: T } | { ok: false; error: string };
/** One file in a room. `index` is SpeechDrop's slot for it (part of its URL); `ctime` is when it came, in ms. */
export type SdFile = { index: number; name: string; ctime: number };
export type SpeechDropBridge = {
  room: (room: string) => Promise<SdResult<{ room: string; name: string; files: SdFile[] }>>;
  make: (name: string) => Promise<SdResult<string>>;
  upload: (room: string, name: string, data: Uint8Array) => Promise<SdResult<{ files: SdFile[]; index: number | null }>>;
  remove: (room: string, index: number) => Promise<SdResult<SdFile[]>>;
  /** The native picker: each picked file's bytes (none for one over SpeechDrop's 10 MB). */
  pick: () => Promise<SdResult<{ name: string; size: number; data?: Uint8Array }[]>>;
  /** Download to ~/Downloads/SpeechDrop/<room>; a .docx comes back for Falcon to open, anything else opens in its app. */
  open: (room: string, index: number, name: string) => Promise<SdResult<{ path: string; docx: boolean }>>;
  download: (room: string, index: number, name: string) => Promise<SdResult<string>>;
  archive: (room: string, title: string) => Promise<SdResult<{ path: string; count: number; skipped: number }>>;
  /** The room's list, pushed on every change. Returns an unsubscribe (which stops watching). */
  watch: (room: string, files: SdFile[] | null, f: (u: { room: string; files: SdFile[]; live: boolean }) => void) => () => void;
};
export type UpdateInfo = { version: string; date: string; notes: string; url: string; state: 'ready' | 'installing' | 'error'; manual: boolean; error?: string };
export const bridge: FalconBridge = (globalThis as unknown as { falcon?: FalconBridge }).falcon ?? {};

/** F2: paste the clipboard as plain text. */
export async function pastePlainFromClipboard(view: EditorView) {
  let text = '';
  try {
    text = bridge.readClipboardText ? await bridge.readClipboardText() : await navigator.clipboard.readText();
  } catch {
    plainPasteArmed = true; // browser refused: the next Mod-V pastes plain
    return;
  }
  if (text) insertPlainText(text)(view.state, view.dispatch);
  view.focus();
}
export let plainPasteArmed = false;
export function disarmPlainPaste() { plainPasteArmed = false; }
