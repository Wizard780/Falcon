import type { Command, Plugin } from 'prosemirror-state';
import type { SettingSpec } from './tools';
import { deleteSections, gotoStyle, headAtCursor, sectionsSlice, selectSections } from './nav/sections';
import { copySlice } from './nav/clipboard';
import { numberingPlugin, toggleRestart, toggleRole } from './nav/numbering';
import { pageDragPlugin } from './nav/page-drag';
import { requestFind } from './find';
import { IS_MAC } from './keybinds';

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

/** Navigation and structure commands, bound in the editor keymap (Settings > Keybindings can change their keys). */
export const navBinds: { id: string; label: string; key: string; run: Command }[] = [
  { id: 'nextTag', label: 'Next tag', key: 'Alt-PageDown', run: gotoStyle('tag', 1) },
  { id: 'prevTag', label: 'Previous tag', key: 'Alt-PageUp', run: gotoStyle('tag', -1) },
  { id: 'nextBlock', label: 'Next block', key: 'Mod-PageDown', run: gotoStyle('block', 1) },
  { id: 'prevBlock', label: 'Previous block', key: 'Mod-PageUp', run: gotoStyle('block', -1) },
  { id: 'nextHat', label: 'Next hat', key: 'Mod-Alt-PageDown', run: gotoStyle('hat', 1) },
  { id: 'prevHat', label: 'Previous hat', key: 'Mod-Alt-PageUp', run: gotoStyle('hat', -1) },
  { id: 'nextPocket', label: 'Next pocket', key: 'Mod-Alt-Shift-PageDown', run: gotoStyle('pocket', 1) },
  { id: 'prevPocket', label: 'Previous pocket', key: 'Mod-Alt-Shift-PageUp', run: gotoStyle('pocket', -1) },
  { id: 'selectSection', label: 'Select the card or heading at the cursor, with everything under it', key: 'Alt-a', run: selectCurrentHeading },
  { id: 'copySection', label: 'Copy the card or heading at the cursor, with everything under it', key: 'Alt-c', run: copyCurrentHeading },
  { id: 'deleteSection', label: 'Delete the card or heading at the cursor, with everything under it', key: 'Mod-Alt-Backspace', run: deleteCurrentHeading },
  { id: 'number', label: 'Number the card (or the cards selected, here or in the outline)', key: 'Mod-Alt-1', run: toggleRole('number') },
  { id: 'sub', label: 'Substructure: letter the card under the number above', key: 'Mod-Alt-2', run: toggleRole('sub') },
  { id: 'restart', label: 'Restart numbering at this card, or let a block continue from the one above', key: 'Mod-Alt-3', run: toggleRestart },
  // Cmd-H hides the app on a Mac, so Find and Replace is Cmd-Shift-H there (Word for Mac's key)
  { id: 'replace', label: 'Find and replace', key: IS_MAC ? 'Mod-Shift-h' : 'Mod-h', run: openFind({ replace: true }) },
  { id: 'findInOrder', label: 'Find in order from the cursor, not grouped by type', key: 'Alt-f', run: openFind({ byPosition: true }) },
];
/** Off the Mac, Ctrl-Shift-H also opens Find and Replace. */
export const navFixed: [string, string, Command][] = IS_MAC ? [] : [['Mod-Shift-h', 'Find and replace', openFind({ replace: true })]];

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
