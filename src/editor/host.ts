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
/** An app that asked to send cards in over the bridge. */
export type LinkedApp = { id: string; name: string; allowed: boolean };
export type CardIndexStatus = { files: number; cards: number; scanning: boolean; done: number; total: number };
/** A place in a file, to jump to once it's open. */
export type CardSpot = { tag: string; ordinal: number; file: string };
export type WindowOpen = { path?: string; card?: CardSpot; alone?: boolean; backup?: string; speech?: string; inactive?: boolean; caretEnd?: boolean };
export type WindowStart = { slot: string; alone?: boolean; path?: string; card?: CardSpot; backup?: string; caretEnd?: boolean };
export type SpeechAnswer = { ok: boolean; error?: string; docTitle?: string; undo?: string; note?: string };
type FalconBridge = {
  readClipboardText?: () => Promise<string>;
  openFile?: () => Promise<{ name: string; path: string; data: Uint8Array } | null>;
  openPath?: (path: string) => Promise<{ name: string; path: string; data: Uint8Array }>;
  /** Pick .docx files in the native dialog for a template, which lets openPath read them from then on. Returns their paths. */
  pickTemplateFiles?: () => Promise<string[]>;
  saveFile?: (opts: { path?: string; name: string; data: Uint8Array }) => Promise<{ path: string; name: string } | null>;
  /** File search (Cmd-K): the folders allowed in Settings, with file counts (null while the first scan runs). */
  indexFolders?: () => Promise<IndexFolder[]>;
  /** Pick folders in the native dialog and allow them. Returns the new list. */
  addIndexFolder?: () => Promise<IndexFolder[]>;
  removeIndexFolder?: (path: string) => Promise<IndexFolder[]>;
  /** A settings import's folders: the real ones are allowed, no dialog. Returns the new list. */
  importIndexFolders?: (paths: string[]) => Promise<IndexFolder[]>;
  /** Every .docx in the allowed folders (openPath opens any of them). */
  indexedFiles?: () => Promise<IndexedFile[]>;
  /** Search cards: the cards in those folders whose tag, cite, headings or file name hold every word. */
  searchCards?: (query: string, hidden?: string[]) => Promise<{ hits: CardHit[]; status: CardIndexStatus }>;
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
  /** Crash recovery for docs too big for localStorage: the desktop app keeps them in a file. `write('')` clears it. */
  recovery?: { read: () => string; write: (text: string) => void; orphans?: () => string[] };
  /** This window's place among the app's windows, and what it opens with (read once, before the first render). */
  windowStart?: () => WindowStart;
  /** Show `path` in the window that has it, or with `alone` open a new window. False: this page opens it itself. */
  openWindow?: (req: WindowOpen) => boolean;
  /** This window's last doc closed: true when the window closes too (it isn't the only one). */
  leaveWindow?: () => boolean;
  cycleWindow?: (dir: 1 | -1) => void;
  reportWindow?: (state: { paths: string[]; speech: string | null; unsaved?: string[] }) => void;
  /** The names of unsaved docs in the app's other windows. */
  unsavedElsewhere?: () => string[];
  /** Every window's open files, and the name of the speech doc when another window holds it. */
  onWindows?: (f: (w: { session: string[]; speech: string | null }) => void) => () => void;
  speechAsk?: (kind: string, payload: Record<string, unknown>) => Promise<SpeechAnswer>;
  /** A newer Falcon, downloading or ready to install (null: none). Fires with the current state on subscribe. Returns an unsubscribe. */
  onUpdate?: (f: (u: UpdateInfo | null) => void) => () => void;
  /** Install this downloaded version and restart (or open its disk image when Falcon can't replace itself). Does nothing if a later one has replaced it. */
  installUpdate?: (version: string) => Promise<void>;
  /** Check for a newer Falcon now, without waiting on a download: 'ready' when there is one (onUpdate says how far along it is), 'none' when this is the latest, 'failed' offline. */
  checkUpdate?: () => Promise<'ready' | 'none' | 'failed'>;
  /** Anonymous usage count (electron/telemetry.cjs drops unknown events and any non-word value). */
  track?: (event: string, props?: Record<string, string | number | boolean>) => void;
  /** SpeechDrop (electron/speechdrop.cjs): rooms, live file lists, uploads and downloads. */
  speechdrop?: SpeechDropBridge;
  /** Other debate apps (electron/editor-bridge.cjs): kind is ping, docs, insert, jump or consent. Returns an unsubscribe. */
  onBridge?: (f: (kind: string, payload: Record<string, unknown>) => Promise<unknown>) => () => void;
  onBridgeExpired?: (f: () => void) => () => void;
  /** The apps that asked to send cards in, and whether they're allowed. */
  linkedApps?: () => Promise<LinkedApp[]>;
  /** Allow or block an app (null forgets it, so it asks again). Returns the new list. */
  allowLinkedApp?: (id: string, on: boolean | null) => Promise<LinkedApp[]>;
  /** Secrets (API keys) by name, like 'anthropic'. The page learns which are saved, never a value:
   *  secretPrompt opens a window the main process owns to type one in, and resolves true if it saved. */
  secretList?: () => Promise<string[]>;
  secretPrompt?: (id: string, look: Record<string, string>) => Promise<boolean>;
  secretRemove?: (id: string) => Promise<string[]>;
  /** Puts the user's relay on their Cloudflare account (electron/relay-setup.cjs). The token is typed into a window the
   *  main process owns and never reaches the page. `onStep` hears 'account', 'upload' and 'address' as each starts. */
  relaySetup?: (look: Record<string, string>, onStep: (step: string) => void) => Promise<RelaySetupResult>;
  /** One model request. `stop` means retrying won't help (a bad key, no credit). */
  aiAsk?: (req: { provider: string; system: string; text: string; model: string; maxTokens: number }) => Promise<{ text?: string; error?: string; stop?: boolean }>;
  platform?: string;
};
/** The relay is up at `url` (`created`: on a workers.dev subdomain made just now), or why not: an error code, and what Cloudflare said. */
export type RelaySetupResult = { ok: true; url: string; created: boolean } | { ok: false; error: string; said?: string };
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
export type UpdateInfo = { version: string; date: string; notes: string; url: string; state: 'downloading' | 'ready' | 'installing' | 'error'; manual: boolean; error?: string; done?: number; total?: number };
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
