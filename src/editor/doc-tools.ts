import type { Command } from 'prosemirror-state';
import type { ToolSection } from './tools';

/** The toolbar's Doc menu: whole-document cleanup. */
export const DOC_TOOLS: ToolSection[] = [];
/** Keys for Doc tools, merged into the editor keymap. */
export const docToolKeys: Record<string, Command> = {};
/** [key, what it does] rows for Settings > Keybindings. */
export const docToolShortcuts: [string, string][] = [];
