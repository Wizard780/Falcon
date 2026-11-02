import type { Command } from 'prosemirror-state';

/** Navigation and structure keys, merged into the editor keymap. */
export const navKeys: Record<string, Command> = {};
/** [key, what it does] rows for Settings > Keybindings. */
export const navShortcuts: [string, string][] = [];
