import type { MarkType, Node as PMNode } from 'prosemirror-model';
import type { Command, Plugin } from 'prosemirror-state';
import { NO_BRIDGE, cardAround, selectedParas } from './commands';
import { activeColors } from './host';
import { MultiSelection, spansOf, type Span } from './multi';
import { isReading } from './read';
import { HIGHLIGHTS, HIGHLIGHT_NAMES, SHADES, schema } from './schema';
import { readSetting, type SettingSpec, type ToolSection } from './tools';
import { autoBridgePlugin, autoBridgeSetting, fixFormattingGaps, gapClassSetting, scopeOf } from './doc-tools/gaps';
import { linkClickPlugin, linkUrls, removeHyperlinks } from './doc-tools/links';
import { insertTable } from './tables';
import { insertPicture } from './images';
import { insertFootnote } from './footnotes';

const M = schema.marks;

const SHADE_EXCEPTIONS: [string, string][] = [['#FFFF00', 'Yellow'], ['#00FF00', 'Bright green'], ['#00FFFF', 'Cyan'], ...SHADES];
const highlightException: SettingSpec = {
  section: 'Standardize', key: 'falcon.standardizeHighlightException', kind: 'choice', default: 'yellow',
  // every color the highlighter has
  options: Object.keys(HIGHLIGHTS).map((k): [string, string] => [k, HIGHLIGHT_NAMES[k]]), colors: HIGHLIGHTS,
  label: 'Highlighting exception',
  hint: 'The highlight color Standardize Highlighting (except) leaves alone.',
};
const shadingException: SettingSpec = {
  section: 'Standardize', key: 'falcon.standardizeShadingException', kind: 'choice', default: '#FFFF00',
  // the background pen's colors, plus the bright ones pasted or CardMirror files tend to have
  options: SHADE_EXCEPTIONS, colors: Object.fromEntries(SHADE_EXCEPTIONS.map(([c]) => [c, c])),
  label: 'Background color exception',
  hint: 'The background color Standardize Background Color (except) leaves alone.',
};
const choiceLabel = (spec: SettingSpec) => spec.kind === 'choice' ? spec.options.find(([v]) => v === readSetting(spec))![1] : '';

/**
 * Standardize: every highlight (or background color) in the selection, or the whole document, becomes the
 * active pen's color; with the "no color" pen, it comes off. `except` names one color that stays as it is.
 */
export function standardize(type: MarkType, pen: () => string | null, except?: () => string): Command {
  return (state, dispatch) => {
    if (isReading(state)) return false;
    const norm = (c: string) => c.toUpperCase();
    const color = pen(), skip = except?.();
    const tr = state.tr;
    for (const r of scopeOf(state)) {
      state.doc.nodesBetween(r.from, r.to, (node, pos) => {
        const m = node.isText && type.isInSet(node.marks);
        if (!m || (skip !== undefined && norm(m.attrs.color) === norm(skip)) || (color !== null && norm(m.attrs.color) === norm(color))) return true;
        const a = Math.max(r.from, pos), b = Math.min(r.to, pos + node.nodeSize);
        color === null ? tr.removeMark(a, b, type) : tr.addMark(a, b, type.create({ color }));
        return true;
      });
    }
    if (!tr.docChanged) return false;
    dispatch?.(tr.setMeta(NO_BRIDGE, true));
    return true;
  };
}

/** Whether the card under the analytic at index i has a cite in its body. */
function hasCite(doc: PMNode, i: number): boolean {
  let pos = 0;
  for (let j = 0; j <= i; j++) pos += doc.child(j).nodeSize;
  const end = cardAround(doc, pos - 1)!.end;
  for (let j = i + 1; j < end; j++) {
    let found = false;
    doc.child(j).forEach((n) => { if (M.cite.isInSet(n.marks)) found = true; });
    if (found) return true;
  }
  return false;
}

/** Analytics become tags: those touched by the selection (or whose card it touches), else every one in the document. */
export function analyticsToTags(onlyCited: boolean): Command {
  return (state, dispatch) => {
    if (isReading(state)) return false;
    const doc = state.doc, picked = new Set<number>();
    if (state.selection.empty) doc.forEach((n, _p, i) => { if (n.attrs.style === 'analytic') picked.add(i); });
    else for (const [n, pos] of selectedParas(state)) {
      const i = doc.resolve(pos).index(0);
      if (n.attrs.style === 'analytic') picked.add(i);
      else { const c = cardAround(doc, pos + 1); if (c && doc.child(c.head).attrs.style === 'analytic') picked.add(c.head); }
    }
    const tr = state.tr;
    doc.forEach((n, pos, i) => {
      if (picked.has(i) && (!onlyCited || hasCite(doc, i))) tr.setNodeMarkup(pos, undefined, { ...n.attrs, style: 'tag' });
    });
    if (!tr.docChanged) return false;
    dispatch?.(tr);
    return true;
  };
}

/**
 * Select Similar Formatting: every run with the same paragraph style and the same marks as the one at the
 * cursor (the run before it, as typing would continue), in the whole document. With a selection, the first
 * selected run is the sample and only the selection is searched. The matches become one multi-selection.
 */
export const selectSimilar: Command = (state, dispatch) => {
  const sel = state.selection, $p = sel.$from;
  const before = $p.nodeBefore?.isText ? $p.nodeBefore : null, after = $p.nodeAfter?.isText ? $p.nodeAfter : null;
  const sample = sel.empty ? before ?? after : after ?? before;
  if (!sample || $p.depth < 1) return false;
  const style = $p.parent.attrs.style;
  const spans: Span[] = [];
  for (const r of sel.empty ? [{ from: 0, to: state.doc.content.size }] : spansOf(sel)) {
    state.doc.nodesBetween(r.from, r.to, (node, pos, parent) => {
      if (node.isText && parent?.attrs.style === style && sample.sameMarkup(node)) {
        spans.push({ from: Math.max(r.from, pos), to: Math.min(r.to, pos + node.nodeSize) });
      }
      return true;
    });
  }
  if (!spans.length) return false;
  dispatch?.(state.tr.setSelection(MultiSelection.create(state.doc, spans)));
  return true;
};

const shading = () => activeColors.shading?.toUpperCase() ?? null;

/** The toolbar's Doc menu: whole-document cleanup. Each tool acts on the selection when there is one. */
export const DOC_TOOLS: ToolSection[] = [
  { title: 'Insert', items: [
    { id: 'insertTable', label: 'Insert Table', run: insertTable(3, 3), hint: 'A 3 × 3 table below the cursor. Drag column edges to resize; the bar above it adds rows and columns' },
    { id: 'insertPicture', label: 'Insert Picture…', run: insertPicture, hint: 'Pick picture files. You can also paste or drop pictures straight into the page' },
    { id: 'insertFootnote', label: 'Insert Footnote', run: insertFootnote, key: 'Mod-Alt-f', hint: 'A numbered footnote at the cursor; click any footnote number to edit it' },
  ] },
  { title: 'Cleanup', items: [
    { id: 'analyticsToTags', label: 'Convert Analytics to Tags', run: analyticsToTags(false), hint: 'Turn analytics into tags: the selected ones, or every one in the document' },
    { id: 'citedAnalyticsToTags', label: 'Convert Cited Analytics to Tags', run: analyticsToTags(true), hint: 'Turn analytics into tags, only those with a cite under them' },
    { id: 'fixFormattingGaps', label: 'Fix Formatting Gaps', run: fixFormattingGaps, hint: 'Give the space between two formatted words the formatting both share, and take off what they don\'t' },
    { id: 'removeHyperlinks', label: 'Remove Hyperlinks', run: removeHyperlinks, hint: 'Drop the links, keeping the text' },
    { id: 'linkUrls', label: 'Link URLs', run: linkUrls, hint: 'Turn written web addresses into links' },
  ] },
  { title: 'Highlighting', items: [
    { id: 'standardizeHighlighting', label: 'Standardize Highlighting', run: standardize(M.highlight, () => activeColors.highlight), hint: 'Every highlight becomes your highlighter\'s color' },
    { id: 'standardizeShading', label: 'Standardize Background Color', run: standardize(M.shading, shading), hint: 'Every background color becomes your background pen\'s color' },
    // getters, so the menu shows the exception chosen in Settings each time it opens
    { id: 'standardizeHighlightingExcept', get label() { return `Standardize Highlighting (except ${choiceLabel(highlightException)})`; },
      run: standardize(M.highlight, () => activeColors.highlight, () => readSetting(highlightException) as string), hint: 'Like Standardize Highlighting, leaving one color alone (pick it in Settings)' },
    { id: 'standardizeShadingExcept', get label() { return `Standardize Background Color (except ${choiceLabel(shadingException)})`; },
      run: standardize(M.shading, shading, () => readSetting(shadingException) as string), hint: 'Like Standardize Background Color, leaving one color alone (pick it in Settings)' },
  ] },
  { title: 'Select', items: [
    { id: 'selectSimilar', label: 'Select Similar Formatting', run: selectSimilar, hint: 'Select every stretch formatted like the text at the cursor' },
  ] },
];
/** This feature's rows in Settings > Editor. */
export const docToolSettings: SettingSpec[] = [autoBridgeSetting, gapClassSetting, highlightException, shadingException];
/** Editor plugins: Cmd/Ctrl-click on links (ahead of mouse selection) and automatic gap bridging. */
export const docToolPlugins: Plugin[] = [linkClickPlugin, autoBridgePlugin];
