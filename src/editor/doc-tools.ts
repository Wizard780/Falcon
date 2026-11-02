import type { Command } from 'prosemirror-state';
import type { SettingSpec, ToolSection } from './tools';

/** The toolbar's Doc menu: whole-document cleanup. */
export const DOC_TOOLS: ToolSection[] = [];
/** Keys for Doc tools, merged into the editor keymap. */
export const docToolKeys: Record<string, Command> = {};
/** [key, what it does] rows for Settings > Keybindings. */
export const docToolShortcuts: [string, string][] = [];
/** This feature's rows in Settings > Editor. */
export const docToolSettings: SettingSpec[] = [];
