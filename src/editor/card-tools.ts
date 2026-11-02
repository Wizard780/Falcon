import type { Command } from 'prosemirror-state';
import type { ToolSection } from './tools';

/** The toolbar's Card menu: operations on the card at the cursor. */
export const CARD_TOOLS: ToolSection[] = [];
/** Keys for Card tools, merged into the editor keymap. */
export const cardToolKeys: Record<string, Command> = {};
/** [key, what it does] rows for Settings > Keybindings. */
export const cardToolShortcuts: [string, string][] = [];
