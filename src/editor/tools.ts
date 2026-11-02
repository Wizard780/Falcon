import type { Command } from 'prosemirror-state';

/** One entry in the toolbar's Doc or Card menu. `key` (a keymap name like "Alt-Shift-F8") is shown beside it. */
export type ToolItem = { label: string; run: Command; key?: string; hint?: string };
export type ToolSection = { title: string; items: ToolItem[] };
