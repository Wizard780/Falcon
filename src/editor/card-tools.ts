import type { Command } from 'prosemirror-state';
import { condense, uncondense } from './commands';
import type { SettingSpec, ToolSection } from './tools';
import { editing } from './card-tools/scope';
import {
  backgroundToHighlight, condenseWithWarning, extractCard, extractUndertag, highlightToBackground, lockHighlighting, undertagQuotes,
} from './card-tools/edit';
import { createReference, refHeading, refHighlights, refShrink } from './card-tools/reference';

/** The toolbar's Card menu: operations on the card at the cursor. */
export const CARD_TOOLS: ToolSection[] = [
  { title: 'Condense', items: [
    { label: 'Condense', run: editing(condense('integrity')), key: 'F3', hint: 'Collapse extra spaces, keeping the paragraphs' },
    { label: 'Condense without paragraph integrity', run: editing(condense('merge')), key: 'Alt-F3', hint: 'Merge the paragraphs into one' },
    { label: 'Condense with pilcrows', run: editing(condense('pilcrows')), key: 'Mod-Alt-F3', hint: 'Merge the paragraphs, marking each old break with ¶' },
    { label: 'Condense With Warning', run: condenseWithWarning(false), hint: 'Merge the selected paragraphs between [PARAGRAPH INTEGRITY PAUSES] and RESUMES lines' },
    { label: 'Condense With Warning and Shrink', run: condenseWithWarning(true), hint: 'Condense With Warning, then shrink the unread text' },
    { label: 'Uncondense', run: editing(uncondense), key: 'Mod-Alt-Shift-F3', hint: 'Split the paragraphs back apart at the ¶ marks' },
  ] },
  { title: 'Excerpt', items: [
    { label: 'Create Reference', run: createReference, hint: 'Copy the selected text as a <<CITE FOR REFERENCE>> excerpt' },
    { label: 'Extract Undertag', run: extractUndertag, hint: 'Copy the selected text into a new undertag under the tag' },
    { label: 'Extract Card', run: extractCard, key: 'Alt-Shift-F8', hint: 'Copy the selected text into a new card below, with this tag and cite' },
  ] },
  { title: 'Highlighting', items: [
    { label: 'Lock Highlighting', run: lockHighlighting, hint: 'Turn highlights into a light gray background, in the selection or the whole card' },
    { label: 'Highlight to Background', run: highlightToBackground, hint: 'Turn the selection\'s highlights into a background of the same color' },
    { label: 'Background to Highlight', run: backgroundToHighlight, hint: 'Turn the selection\'s backgrounds into the nearest highlight color' },
  ] },
];
/** Keys for Card tools, merged into the editor keymap. */
export const cardToolKeys: Record<string, Command> = { 'Alt-Shift-F8': extractCard };
/** [key, what it does] rows for Settings > Keybindings. */
export const cardToolShortcuts: [string, string][] = [
  ['Alt-F3', 'Condense without paragraph integrity'], ['Mod-Alt-F3', 'Condense with pilcrows'], ['Mod-Alt-Shift-F3', 'Uncondense'],
  ['Alt-Shift-F8', 'Extract card'],
];
/** This feature's rows in Settings > Editor. */
export const cardToolSettings: SettingSpec[] = [refHeading, refShrink, refHighlights, undertagQuotes];
