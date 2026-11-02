import { afterEach, describe, expect, it } from 'vitest';
import { commandOf, falconKeys, liveKeys } from '../src/editor/keymap';
import { BINDINGS, keyOf, keyText, pressed, pressedId, recordKey, refusal, resetKey, setKey } from '../src/editor/keybinds';
import { resetPrefs } from '../src/editor/prefs';

afterEach(() => resetPrefs());

// jsdom isn't a Mac: Mod is Ctrl
const ev = (key: string, keyCode: number, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  new KeyboardEvent('keydown', { key, keyCode, ...mods } as KeyboardEventInit);

describe('keybindings', () => {
  it('ship with the keys Falcon always had', () => {
    expect(keyOf('tag')).toBe('F7');
    expect(keyOf('save')).toBe('Mod-s');
    expect(falconKeys.F7).toBe(commandOf('tag'));
    expect(falconKeys['Alt-F3']).toBe(commandOf('condenseMerge'));
    // menu-only tools have no key until one is set
    expect(keyOf('lockHighlighting')).toBe('');
    expect(new Set(BINDINGS.map((b) => b.id)).size).toBe(BINDINGS.length);
  });

  it('records a keydown as its key, the way the keymap falls back to it', () => {
    expect(recordKey(ev('*', 56, { ctrlKey: true, shiftKey: true }))).toBe('Mod-Shift-8');
    expect(recordKey(ev('T', 84, { ctrlKey: true, shiftKey: true }))).toBe('Mod-Shift-t');
    expect(recordKey(ev('F7', 118))).toBe('F7');
    expect(recordKey(ev('Shift', 16, { shiftKey: true }))).toBe(null);
  });

  it('matches events by key name and by key code', () => {
    expect(pressed(ev('*', 56, { ctrlKey: true, shiftKey: true }), 'Mod-Shift-8')).toBe(true);
    expect(pressed(ev('s', 83, { ctrlKey: true }), 'Mod-s')).toBe(true);
    // Ctrl-Shift-S is Save As; Ctrl-Shift-T isn't Home (Home is Ctrl-T)
    expect(pressedId(ev('S', 83, { ctrlKey: true, shiftKey: true }), ['save', 'saveAs'])).toBe('saveAs');
    expect(pressedId(ev('T', 84, { ctrlKey: true, shiftKey: true }), ['home'])).toBe(undefined);
    expect(pressed(ev('S', 83, { ctrlKey: true, shiftKey: true }), 'Mod-Shift-s')).toBe(true);
    expect(pressed(ev('-', 189, { ctrlKey: true }), 'Mod--')).toBe(true);
  });

  it('lets Send to speech be one symbol key, and nothing else', () => {
    expect(keyOf('sendToSpeech')).toBe('`');
    expect(refusal('sendToSpeech', '`')).toBe(null);
    expect(refusal('sendToSpeech', 'Shift-`')).toBe(null); // ~
    expect(refusal('sendToSpeech', '/')).toBe(null);
    expect(refusal('sendToSpeech', 'a')).toMatch(/Add Ctrl or Alt/);
    expect(refusal('sendToSpeech', '5')).toMatch(/Add Ctrl or Alt/);
    expect(refusal('tag', '`')).toMatch(/Add Ctrl or Alt/);
    expect(refusal('tag', 'Mod-`')).toBe(null);
  });

  it('refuses keys that need a modifier, are taken, or are kept', () => {
    expect(refusal('tag', 't')).toMatch(/Add Ctrl or Alt/);
    expect(refusal('tag', 'Shift-t')).toMatch(/Add Ctrl or Alt/);
    expect(refusal('tag', 'F9')).toBe('F9 is already Underline');
    expect(refusal('tag', 'Mod-z')).toBe('Ctrl+Z is kept for Undo');
    expect(refusal('tag', 'Mod-c')).toBe('Ctrl+C is kept for Copy');
    expect(refusal('tag', 'Meta-t')).toMatch(/Windows key/);
    expect(refusal('tag', 'F7')).toBe(null); // its own key
    expect(refusal('tag', 'Mod-Shift-t')).toBe(null);
    expect(refusal('nextHeading', 'End')).toBe(null);
    expect(refusal('tag', 'Alt-Dead')).toMatch(/accent/);
    expect(refusal('find', 'Mod-Alt-k')).toMatch(/AltGr/); // jsdom isn't a Mac
    expect(refusal('tag', 'Mod-Alt-k')).toBe(null); // the editor's keymap still takes Ctrl+Alt
  });

  it('a new key replaces the old one in the live keymap, and reset puts it back', () => {
    setKey('tag', 'Mod-Shift-t');
    let m = liveKeys();
    expect(m['Mod-Shift-t']).toBe(commandOf('tag'));
    expect(m.F7).toBeUndefined();
    expect(refusal('pocket', 'Mod-Shift-t')).toBe('Ctrl+Shift+T is already Tag');
    expect(refusal('pocket', 'F7')).toBe(null); // F7 is free now
    resetKey('tag');
    m = liveKeys();
    expect(m.F7).toBe(commandOf('tag'));
    expect(m['Mod-Shift-t']).toBeUndefined();
  });

  it('can remove a shortcut, and Restore defaults brings every key back', () => {
    setKey('find', '');
    setKey('lockHighlighting', 'Mod-Alt-l');
    expect(keyOf('find')).toBe('');
    expect(liveKeys()['Mod-Alt-l']).toBe(commandOf('lockHighlighting'));
    resetPrefs();
    expect(keyOf('find')).toBe('Mod-f');
    expect(keyOf('lockHighlighting')).toBe('');
  });

  it('shows keys as text', () => {
    expect(keyText('Mod-Shift-s')).toBe('Ctrl+Shift+S');
    expect(keyText('Mod--')).toBe('Ctrl+−');
    expect(keyText('Alt-PageDown')).toBe('Alt+Page Down');
    expect(keyText('')).toBe('');
  });
});
