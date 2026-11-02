import type { Command } from 'prosemirror-state';
import type { SettingSpec } from './tools';

/** Navigation and structure keys, merged into the editor keymap. */
export const navKeys: Record<string, Command> = {};
/** [key, what it does] rows for Settings > Keybindings. */
export const navShortcuts: [string, string][] = [];
/** This feature's rows in Settings > Editor. */
export const navSettings: SettingSpec[] = [];
