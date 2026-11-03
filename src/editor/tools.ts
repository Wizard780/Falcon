import type { Command } from 'prosemirror-state';

/**
 * One entry in the toolbar's Doc or Card menu. Each is a command Settings > Keybindings can bind, under `id`;
 * `key` (a keymap name like "Alt-Shift-F8") is its default, and the menu shows the key it has now.
 */
export type ToolItem = { id: string; label: string; run: Command; key?: string; hint?: string };
export type ToolSection = { title: string; items: ToolItem[] };

/**
 * A setting a feature declares in its own file; Settings draws the row. Values live in localStorage
 * under `key` (toggles as 'on'/'off'), read with `readSetting`, so a feature needs no Settings plumbing.
 */
export type SettingSpec = { section: string; label: string; hint?: string; key: string } & (
  | { kind: 'toggle'; default: boolean }
  | { kind: 'choice'; options: [value: string, label: string][]; default: string; colors?: Record<string, string> } // colors: shown as swatches
);
export function readSetting(spec: SettingSpec): string | boolean {
  const v = localStorage.getItem(spec.key);
  if (spec.kind === 'toggle') return v === null ? spec.default : v === 'on';
  return v !== null && spec.options.some(([o]) => o === v) ? v : spec.default;
}
