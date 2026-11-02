import type { Command, Plugin } from 'prosemirror-state';
import type { SettingSpec } from './tools';
import { deleteSections, gotoStyle, headAtCursor, sectionsSlice, selectSections } from './nav/sections';
import { copySlice } from './nav/clipboard';
import { numberingPlugin, toggleRestart, toggleRole } from './nav/numbering';
import { pageDragPlugin } from './nav/page-drag';
import { requestFind } from './find';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Select / copy / delete the card or heading section at the cursor (the heading and everything under it). */
const selectCurrentHeading: Command = (state, dispatch) => {
  const h = headAtCursor(state);
  const tr = h === null ? null : selectSections(state, [h]);
  if (!tr) return false;
  dispatch?.(tr.scrollIntoView());
  return true;
};
const copyCurrentHeading: Command = (state, dispatch) => {
  const h = headAtCursor(state);
  if (h === null) return false;
  if (dispatch) void copySlice(sectionsSlice(state.doc, [h]));
  return true;
};
const deleteCurrentHeading: Command = (state, dispatch) => {
  const h = headAtCursor(state);
  const tr = h === null ? null : deleteSections(state, [h]);
  if (!tr) return false;
  dispatch?.(tr);
  return true;
};
const openFind = (req: { replace?: boolean; byPosition?: boolean }): Command => (_s, dispatch) => { if (dispatch) requestFind(req); return true; };

/** Navigation and structure keys, merged into the editor keymap. */
export const navKeys: Record<string, Command> = {
  'Alt-PageDown': gotoStyle('tag', 1),
  'Alt-PageUp': gotoStyle('tag', -1),
  'Mod-PageDown': gotoStyle('block', 1),
  'Mod-PageUp': gotoStyle('block', -1),
  'Mod-Alt-PageDown': gotoStyle('hat', 1),
  'Mod-Alt-PageUp': gotoStyle('hat', -1),
  'Mod-Alt-Shift-PageDown': gotoStyle('pocket', 1),
  'Mod-Alt-Shift-PageUp': gotoStyle('pocket', -1),
  'Alt-a': selectCurrentHeading,
  'Alt-c': copyCurrentHeading,
  'Mod-Alt-Backspace': deleteCurrentHeading,
  'Mod-Alt-1': toggleRole('number'),
  'Mod-Alt-2': toggleRole('sub'),
  'Mod-Alt-3': toggleRestart,
  // Cmd-H hides the app on a Mac, so Find and Replace is Cmd-Shift-H there (Word for Mac's key)
  'Mod-Shift-h': openFind({ replace: true }),
  ...(IS_MAC ? {} : { 'Mod-h': openFind({ replace: true }) }),
  'Alt-f': openFind({ byPosition: true }),
};

/** [key, what it does] rows for Settings > Keybindings. */
export const navShortcuts: [string, string][] = [
  ['Alt-PageDown', 'Next tag'], ['Alt-PageUp', 'Previous tag'],
  ['Mod-PageDown', 'Next block'], ['Mod-PageUp', 'Previous block'],
  ['Mod-Alt-PageDown', 'Next hat'], ['Mod-Alt-PageUp', 'Previous hat'],
  ['Mod-Alt-Shift-PageDown', 'Next pocket'], ['Mod-Alt-Shift-PageUp', 'Previous pocket'],
  ['Alt-A', 'Select the card or heading at the cursor, with everything under it'],
  ['Alt-C', 'Copy the card or heading at the cursor, with everything under it'],
  ['Mod-Alt-Backspace', 'Delete the card or heading at the cursor, with everything under it'],
  ['Mod-Alt-1', 'Number the card (or the cards selected, here or in the outline)'],
  ['Mod-Alt-2', 'Substructure: letter the card under the number above'],
  ['Mod-Alt-3', 'Restart numbering at this card, or let a block continue from the one above'],
  [IS_MAC ? 'Mod-Shift-H' : 'Mod-H', 'Find and replace'],
  ['Alt-F', 'Find in order from the cursor, not grouped by type'],
];

/** This feature's rows in Settings > Editor. */
export const findOrderSetting: SettingSpec = {
  section: 'Find', label: 'Find order', key: 'falcon.find.order', kind: 'choice', default: 'grouped',
  options: [['grouped', 'By type'], ['position', 'By position']],
  hint: 'By type: headings first, then tags, analytics, undertags, cites, then card text.',
};
export const outlineHideSetting: SettingSpec = {
  section: 'Outline search', label: 'Outline search hides non-matches', key: 'falcon.outline.hideNonMatches', kind: 'toggle', default: true,
  hint: 'Off: the full outline stays and matches are lit.',
};
export const outlineContentSetting: SettingSpec = {
  section: 'Outline search', label: 'Outline search looks in card text', key: 'falcon.outline.searchContent', kind: 'toggle', default: false,
  hint: 'A heading matches when the text under it does.',
};
export const outlineLevelSetting: SettingSpec = {
  section: 'Outline search', label: 'Outline search level', key: 'falcon.outline.searchLevel', kind: 'choice', default: 'all',
  options: [['all', 'All'], ['1', 'Pockets'], ['2', 'Hats'], ['3', 'Blocks'], ['4', 'Tags']],
};
export const navSettings: SettingSpec[] = [findOrderSetting, outlineHideSetting, outlineContentSetting, outlineLevelSetting];

/** Editor plugins for this feature: card numbers and dragging cards on the page. */
export const navPlugins: Plugin[] = [numberingPlugin, pageDragPlugin];
