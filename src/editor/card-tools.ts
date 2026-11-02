import { condense, condenseBySettings, uncondense } from './commands';
import type { SettingSpec, ToolSection } from './tools';
import { editing } from './card-tools/scope';
import {
  backgroundToHighlight, condenseWithWarning, extractCard, extractUndertag, highlightToBackground, lockHighlighting, undertagQuotes,
} from './card-tools/edit';
import { createReference, refHeading, refHighlights, refShrink } from './card-tools/reference';

/** The toolbar's Card menu: operations on the card at the cursor. */
export const CARD_TOOLS: ToolSection[] = [
  { title: 'Condense', items: [
    { id: 'condense', label: 'Condense', run: editing(condenseBySettings), key: 'F3', hint: 'Collapse extra spaces, keeping or merging the paragraphs as Settings picks' },
    { id: 'condenseMerge', label: 'Condense without paragraph integrity', run: editing(condense('merge')), key: 'Alt-F3', hint: 'Merge the paragraphs into one' },
    { id: 'condensePilcrows', label: 'Condense with pilcrows', run: editing(condense('pilcrows')), key: 'Mod-Alt-F3', hint: 'Merge the paragraphs, marking each old break with ¶' },
    { id: 'condenseWarning', label: 'Condense With Warning', run: condenseWithWarning(false), hint: 'Merge the selected paragraphs between [PARAGRAPH INTEGRITY PAUSES] and RESUMES lines' },
    { id: 'condenseWarningShrink', label: 'Condense With Warning and Shrink', run: condenseWithWarning(true), hint: 'Condense With Warning, then shrink the unread text' },
    { id: 'uncondense', label: 'Uncondense', run: editing(uncondense), key: 'Mod-Alt-Shift-F3', hint: 'Split the paragraphs back apart at the ¶ marks' },
  ] },
  { title: 'Excerpt', items: [
    { id: 'createReference', label: 'Create Reference', run: createReference, hint: 'Copy the selected text as a <<CITE FOR REFERENCE>> excerpt' },
    { id: 'extractUndertag', label: 'Extract Undertag', run: extractUndertag, hint: 'Copy the selected text into a new undertag under the tag' },
    { id: 'extractCard', label: 'Extract Card', run: extractCard, key: 'Alt-Shift-F8', hint: 'Copy the selected text into a new card below, with this tag and cite' },
  ] },
  { title: 'Highlighting', items: [
    { id: 'lockHighlighting', label: 'Lock Highlighting', run: lockHighlighting, hint: 'Turn highlights into a light gray background, in the selection or the whole card' },
    { id: 'highlightToBackground', label: 'Highlight to Background', run: highlightToBackground, hint: 'Turn the selection\'s highlights into a background of the same color' },
    { id: 'backgroundToHighlight', label: 'Background to Highlight', run: backgroundToHighlight, hint: 'Turn the selection\'s backgrounds into the nearest highlight color' },
  ] },
];
/** This feature's rows in Settings > Editor. */
export const cardToolSettings: SettingSpec[] = [refHeading, refShrink, refHighlights, undertagQuotes];
