/**
 * Shortcuts you can change in Settings > Keybindings. Each binding is a command with a default key,
 * saved as its own pref (`falcon.key.<id>`, '' = no shortcut), so Restore defaults and other windows
 * cover it like any setting. Key names are prosemirror-keymap's ("Mod-Shift-8", "Alt-a", "F7"), and
 * an event matches a key the same way prosemirror-keymap matches it, so what Settings records is
 * what the editor and the app answer to.
 */
import { base, keyName } from 'w3c-keyname';
import type { Command } from 'prosemirror-state';
import { clearPref, pref, registerPrefs, setPref, type Pref } from './prefs';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** `run` is set for editor commands; app commands (Save, Find…) are run by the app, which looks them up by id. */
export type Binding = { id: string; label: string; group: string; key: string; run?: Command; pref: Pref<string> };
export const BINDINGS: Binding[] = [];
const byId = new Map<string, Binding>();

export function bind(group: string, list: { id: string; label: string; key?: string; run?: Command }[]) {
  for (const b of list) {
    if (byId.has(b.id)) continue; // a menu item that shares a keymap command's id shows that command's key
    const full: Binding = {
      id: b.id, group, key: b.key ?? '', run: b.run, pref: { key: `falcon.key.${b.id}`, default: b.key ?? '' },
      get label() { return b.label; }, // Doc tools name their Settings choice in the label
    };
    BINDINGS.push(full);
    byId.set(b.id, full);
    registerPrefs([full.pref]);
  }
}

/** Keys Falcon or the system keeps for itself: [key, what it does]. Refused when recording. */
const RESERVED = new Map<string, string>();
export function reserve(list: [key: string, label: string][]) {
  for (const [k, what] of list) RESERVED.set(norm(k), what);
}
reserve([
  ['Mod-c', 'Copy'], ['Mod-x', 'Cut'], ['Mod-v', 'Paste'], ['Mod-q', 'Quit'], ['Escape', 'Close'],
  ...(IS_MAC ? [['Mod-h', 'Hide Falcon'], ['Mod-Alt-h', 'Hide others'], ['Mod-m', 'Minimize']] as [string, string][] : []),
]);

export const keyOf = (id: string): string => { const b = byId.get(id); return b ? pref(b.pref) : ''; };
export const bindingOf = (id: string) => byId.get(id);
export const setKey = (id: string, key: string) => { const b = byId.get(id); if (b) setPref(b.pref, key); };
export const resetKey = (id: string) => { const b = byId.get(id); if (b) clearPref(b.pref); };

// ---------- names and matching ----------

/** A key name in prosemirror-keymap's normal form (Shift-Meta-Ctrl-Alt-key), with Mod resolved for this platform. */
export function norm(name: string): string {
  const parts = name.split(/-(?!$)/);
  let key = parts.pop()!;
  if (key === 'Space') key = ' ';
  let alt = false, ctrl = false, shift = false, meta = false;
  for (const m of parts) {
    if (/^(cmd|meta|m)$/i.test(m)) meta = true;
    else if (/^a(lt)?$/i.test(m)) alt = true;
    else if (/^(c|ctrl|control)$/i.test(m)) ctrl = true;
    else if (/^s(hift)?$/i.test(m)) shift = true;
    else if (/^mod$/i.test(m)) { if (IS_MAC) meta = true; else ctrl = true; }
  }
  return `${shift ? 'Shift-' : ''}${meta ? 'Meta-' : ''}${ctrl ? 'Ctrl-' : ''}${alt ? 'Alt-' : ''}${key}`;
}

const withMods = (name: string, e: KeyboardEvent, shift = true) =>
  `${shift && e.shiftKey ? 'Shift-' : ''}${e.metaKey ? 'Meta-' : ''}${e.ctrlKey ? 'Ctrl-' : ''}${e.altKey ? 'Alt-' : ''}${name}`;

/** The names a keydown answers to, tried in prosemirror-keymap's order (the key as typed, without its Shift, then by key code). */
export function eventNames(e: KeyboardEvent): string[] {
  const name = keyName(e);
  const out = [withMods(name, e)];
  if (name.length === 1 && name !== ' ') {
    if (e.shiftKey) out.push(withMods(name, e, false));
    const b = base[e.keyCode];
    if ((e.altKey || e.metaKey || e.ctrlKey) && !(!IS_MAC && e.ctrlKey && e.altKey) && b && b !== name) out.push(withMods(b, e));
  }
  return out;
}
/** Does this keydown press `key`? */
export const pressed = (e: KeyboardEvent, key: string) => !!key && eventNames(e).includes(norm(key));
/** Which of these commands the keydown runs. Like the keymap, an exact name wins over a fallback (Ctrl-Shift-S is Save As, not Save). */
export function pressedId(e: KeyboardEvent, ids: string[]): string | undefined {
  const keys = ids.map((id) => [id, keyOf(id) && norm(keyOf(id))]);
  for (const name of eventNames(e)) {
    const hit = keys.find(([, k]) => k === name);
    if (hit) return hit[0];
  }
  return undefined;
}

const MODIFIER = /^(Shift|Control|Alt|Meta|AltGraph|CapsLock|OS|Fn)$/;
/** What Settings saves for a keydown: "Mod-Shift-8", "Alt-a", "F7"; null while only modifiers are down. */
export function recordKey(e: KeyboardEvent): string | null {
  const name = keyName(e);
  if (MODIFIER.test(name)) return null;
  // a typed character is saved as its key (Shift-8, not *; Alt-a, not å), the way the keymap falls back to it
  let key = name.length === 1 ? (base[e.keyCode] ?? name).toLowerCase() : name;
  if (key === ' ') key = 'Space';
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  return [mod && 'Mod', IS_MAC && e.ctrlKey && 'Ctrl', !IS_MAC && e.metaKey && 'Meta', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('-');
}

/** The modifiers held down, in key order, for the recorder to show as they go down. */
export function heldMods(e: KeyboardEvent): string[] {
  return [(IS_MAC ? e.metaKey : e.ctrlKey) && 'Mod', IS_MAC && e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[];
}

const APP_GROUPS = ['App', 'Files', 'Speech'];
const ALONE = /^(F\d{1,2}|PageUp|PageDown|Home|End|Insert)$/;
/** Why `key` can't be `id`'s shortcut, or null when it can. */
export function refusal(id: string, key: string): string | null {
  const parts = key.split(/-(?!$)/);
  const k = parts[parts.length - 1];
  const mods = parts.slice(0, -1).filter((m) => m !== 'Shift' && m !== 'Meta');
  if (!IS_MAC && parts.includes('Meta')) return 'The Windows key belongs to the system';
  // Option+E, U, I, N and ` on a Mac start an accent (key "Dead"); an IME is composing: no key the keymap can match
  if (/^(Dead|Process|Unidentified|Compose)$/.test(k)) return 'That key types an accent or character here. Try another letter';
  // Ctrl+Alt is AltGr on Windows keyboards, which the app leaves to typing
  if (!IS_MAC && APP_GROUPS.includes(byId.get(id)?.group ?? '') && parts.includes('Mod') && parts.includes('Alt')) return 'Ctrl+Alt is AltGr on many keyboards. Try Ctrl+Shift';
  // Send to speech can be one symbol key on its own (` by default, or ~); letters and digits stay for typing
  const symbol = byId.get(id)?.group === 'Speech' && /^[^\p{L}\p{N}]$/u.test(k);
  if (!mods.length && !symbol && !ALONE.test(k)) return IS_MAC ? 'Add ⌘, ⌥ or ⌃ (a function key can stand alone)' : 'Add Ctrl or Alt (a function key can stand alone)';
  const n = norm(key);
  const kept = RESERVED.get(n);
  if (kept) return `${keyText(key)} is kept for ${kept}`;
  const other = BINDINGS.find((b) => b.id !== id && keyOf(b.id) && norm(keyOf(b.id)) === n);
  if (other) return `${keyText(key)} is already ${other.label}`;
  return null;
}

// ---------- showing keys ----------

const NAMES: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'Page Up', PageDown: 'Page Down', Backspace: IS_MAC ? '⌫' : 'Backspace', ' ': 'Space' };
/** "Mod-Shift-8" as its keys: ⌘ ⇧ 8 on macOS, Ctrl Shift 8 elsewhere. */
export function keyParts(k: string): string[] {
  if (!k) return [];
  return k.split(/-(?!$)/).map((p) => ({
    Mod: IS_MAC ? '⌘' : 'Ctrl', Ctrl: IS_MAC ? '⌃' : 'Ctrl', Alt: IS_MAC ? '⌥' : 'Alt', Shift: IS_MAC ? '⇧' : 'Shift',
    '-': '−', ...NAMES,
  }[p] ?? (p.length === 1 ? p.toUpperCase() : p)));
}
/** One string: ⌘⇧S on macOS, Ctrl+Shift+S elsewhere. */
export const keyText = (k: string) => {
  const ps = keyParts(k);
  return IS_MAC ? ps.map((p, i) => (i && p.length > 1 && ps[i - 1].length > 1 ? ` ${p}` : p)).join('') : ps.join('+');
};
/** `Label (key): desc` for a button's title (the shape Tips reads), leaving out the key when there is none. */
export const titled = (label: string, id: string, desc: string) => {
  const k = keyOf(id);
  return `${label}${k ? ` (${keyText(k)})` : ''}: ${desc}`;
};

// ---------- recording ----------

let recording = false;
/** While Settings listens for a new shortcut, no shortcut runs, so the keys reach the recorder. */
export const isRecording = () => recording;
export const setRecording = (on: boolean) => { recording = on; };

// ---------- the app's own commands (run by App.tsx, which looks them up by id) ----------

bind('App', [
  { id: 'home', label: 'Home', key: 'Mod-t' }, { id: 'search', label: 'Search files', key: 'Mod-k' }, { id: 'settings', label: 'Settings', key: 'Mod-,' },
  { id: 'commands', label: 'Search everything (command center)', key: 'Mod-Shift-Space' },
  { id: 'searchCards', label: 'Search cards', key: 'Mod-Shift-k' },
  { id: 'outline', label: 'Show or hide the outline', key: 'Mod-\\' }, { id: 'find', label: 'Find', key: 'Mod-f' },
  { id: 'zoomIn', label: 'Zoom in', key: 'Mod-=' }, { id: 'zoomOut', label: 'Zoom out', key: 'Mod--' }, { id: 'zoomReset', label: 'Actual size', key: 'Mod-0' },
]);
bind('Files', [
  { id: 'new', label: 'New document', key: 'Mod-n' }, { id: 'newSpeech', label: 'New speech doc', key: 'Mod-Shift-n' }, { id: 'open', label: 'Open', key: 'Mod-o' },
  { id: 'save', label: 'Save', key: 'Mod-s' }, { id: 'saveAs', label: 'Save As', key: 'Mod-Shift-s' }, { id: 'close', label: 'Close document', key: 'Mod-w' },
  { id: 'nextDoc', label: 'Next open document', key: 'Ctrl-Tab' }, { id: 'prevDoc', label: 'Previous open document', key: 'Ctrl-Shift-Tab' },
]);
// a plain key on purpose: the page can't type it while it's bound (text boxes still can)
bind('Speech', [{ id: 'sendToSpeech', label: 'Send to speech', key: '`' }]);
// second keys that always work: Mod-Shift-] / [ also switch documents
reserve([['Mod-Shift-]', 'Next open document'], ['Mod-Shift-[', 'Previous open document']]);
