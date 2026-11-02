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

type FalconBridge = {
  readClipboardText?: () => Promise<string>;
  openFile?: () => Promise<{ name: string; path: string; data: Uint8Array } | null>;
  openPath?: (path: string) => Promise<{ name: string; path: string; data: Uint8Array }>;
  saveFile?: (opts: { path?: string; name: string; data: Uint8Array }) => Promise<{ path: string; name: string } | null>;
  /** Mac File menu clicks ('new', 'open', 'save', 'saveAs', 'close', 'settings'). Returns an unsubscribe. */
  onMenu?: (f: (cmd: string) => void) => () => void;
  /** The keys the Mac menu shows beside its items, by command ('save': 'Mod-s'; '' shows none). */
  setMenuKeys?: (keys: Record<string, string>) => void;
  /** Closing the window (quit = quitting the app) with unsaved docs: the page asks. Returns an unsubscribe. */
  onConfirmClose?: (f: (quit: boolean) => void) => () => void;
  /** The user said close anyway: close the window (or quit) past the unsaved-docs guard. */
  forceClose?: (quit: boolean) => void;
  platform?: string;
};
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
