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
  /** Anonymous usage count (electron/telemetry.cjs drops unknown events and any non-word value). */
  track?: (event: string, props?: Record<string, string | number | boolean>) => void;
  platform?: string;
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
