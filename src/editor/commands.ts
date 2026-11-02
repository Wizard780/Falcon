import type { Mark, MarkType, Node as PMNode } from 'prosemirror-model';
import { EditorState, Selection, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { LEVEL, schema, type ParaStyle } from './schema';
import { P, pref, type CondenseMode } from './prefs';

const M = schema.marks;
export const isHeading = (n: PMNode) => LEVEL[n.attrs.style as ParaStyle] > 0;
const isCardHead = (n: PMNode) => n.attrs.style === 'tag' || n.attrs.style === 'analytic';

type Range = { from: number; to: number };

const WORD = /[\p{L}\p{N}_'’]/u;

/** The word around a collapsed cursor, or null when the cursor isn't touching a word. */
export function wordAt(state: EditorState, pos: number): Range | null {
  const $pos = state.doc.resolve(pos);
  const para = $pos.parent;
  if (!para.isTextblock) return null;
  const text = para.textBetween(0, para.content.size, '￼', '￼');
  const off = $pos.parentOffset;
  let a = off, b = off;
  while (a > 0 && WORD.test(text[a - 1])) a--;
  while (b < text.length && WORD.test(text[b])) b++;
  if (a === b) return null;
  const start = $pos.start();
  return { from: start + a, to: start + b };
}

/** The ranges a formatting command acts on: the selection, else (optionally) the word at the cursor. */
function targetRanges(state: EditorState, fallback: 'word' | 'none'): Range[] {
  const { selection } = state;
  if (!selection.empty) return selection.ranges.map((r) => ({ from: r.$from.pos, to: r.$to.pos }));
  if (fallback === 'word') {
    const w = wordAt(state, selection.from);
    return w ? [w] : [];
  }
  return [];
}

/** Calls fn for each text node slice inside the ranges, with its paragraph. */
function eachText(doc: PMNode, ranges: Range[], fn: (node: PMNode, from: number, to: number, para: PMNode) => void) {
  for (const { from, to } of ranges) {
    doc.nodesBetween(from, to, (node, pos, parent) => {
      if (node.isText && parent) fn(node, Math.max(from, pos), Math.min(to, pos + node.nodeSize), parent);
      return true;
    });
  }
}

/** Splits ranges so heading paragraphs are dropped (used by Cite when a selection mixes headings and body). */
function withoutHeadings(doc: PMNode, ranges: Range[]): Range[] {
  const out: Range[] = [];
  let hasBody = false;
  for (const { from, to } of ranges) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (!isHeading(node)) {
        hasBody = true;
        const a = Math.max(from, pos + 1), b = Math.min(to, pos + 1 + node.content.size);
        if (a < b) out.push({ from: a, to: b });
      }
      return false;
    });
  }
  return hasBody ? out : ranges;
}

const isWS = (c: string) => /\s/.test(c);

/** Drop whitespace at the edges of each range: F8/F9/F10 never mark the spaces around a selection. */
function trimRanges(doc: PMNode, ranges: Range[]): Range[] {
  return ranges
    .map(({ from, to }) => {
      while (from < to && isWS(doc.textBetween(from, from + 1, '\n', '\n') || 'x')) from++;
      while (to > from && isWS(doc.textBetween(to - 1, to, '\n', '\n') || 'x')) to--;
      return { from, to };
    })
    .filter((r) => r.from < r.to);
}

/** Underline cut into the middle of emphasis also takes the emphasized spaces next to it, so no box ends on a space. */
function growOverEmphasizedSpace(doc: PMNode, r: Range): Range {
  let { from, to } = r;
  const emphSpace = (pos: number) => {
    if (pos < 0 || pos >= doc.content.size) return false;
    const $p = doc.resolve(pos + 1);
    if ($p.parent !== doc.resolve(pos).parent) return false;
    const ch = doc.textBetween(pos, pos + 1, '\n', '\n');
    return isWS(ch || 'x') && !!M.emphasis.isInSet(doc.resolve(pos + 1).marks());
  };
  while (emphSpace(from - 1)) from--;
  while (emphSpace(to)) to++;
  return { from, to };
}

function allHave(doc: PMNode, ranges: Range[], test: (marks: readonly Mark[]) => boolean): boolean {
  let any = false, all = true;
  eachText(doc, ranges, (node) => {
    any = true;
    if (!test(node.marks)) all = false;
  });
  return any && all;
}

function finish(state: EditorState, tr: Transaction, dispatch?: (tr: Transaction) => void) {
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Verbatim-style toggle: if every character in scope already carries the mark, remove it;
 * otherwise apply it to all of it. With nothing selected, acts on the word at the cursor.
 */
export function toggleCharMark(type: MarkType, opts: { fallback?: 'word' | 'none'; skipHeadings?: boolean } = {}): Command {
  return (state, dispatch) => {
    let ranges = trimRanges(state.doc, targetRanges(state, opts.fallback ?? 'word'));
    if (!ranges.length) return false;
    if (opts.skipHeadings) ranges = withoutHeadings(state.doc, ranges);
    const has = allHave(state.doc, ranges, (ms) => !!type.isInSet(ms));
    const tr = state.tr;
    for (let r of ranges) {
      if (has) { tr.removeMark(r.from, r.to, type); continue; }
      if (type === M.underline) r = growOverEmphasizedSpace(state.doc, r);
      tr.addMark(r.from, r.to, type.create());
    }
    return finish(state, tr, dispatch);
  };
}

/** Mod-U / Mod-B / Mod-I: with a selection toggle like F9; with none, toggle the mark for the text you type next. */
export function toggleTypingMark(type: MarkType): Command {
  return (state, dispatch) => {
    if (!state.selection.empty) return toggleCharMark(type, { fallback: 'none' })(state, dispatch);
    const stored = state.storedMarks ?? state.selection.$from.marks();
    if (dispatch) dispatch(state.tr.setStoredMarks(type.isInSet(stored) ? type.removeFromSet(stored) : type.create().addToSet(stored)));
    return true;
  };
}

/** F10: apply-only. Emphasis replaces underline (schema `excludes`) and removes background color. */
export const applyEmphasis: Command = (state, dispatch) => {
  const ranges = trimRanges(state.doc, targetRanges(state, 'word'));
  if (!ranges.length) return false;
  const tr = state.tr;
  for (const r of ranges) {
    tr.removeMark(r.from, r.to, M.shading);
    tr.addMark(r.from, r.to, M.emphasis.create());
  }
  return finish(state, tr, dispatch);
};

/**
 * With "Highlight underlined text only" on, the parts of the ranges a highlight or background color
 * lands on: underlined, emphasized or cited body text, and headings whole. Otherwise the ranges.
 */
function paintable(doc: PMNode, ranges: Range[], type: MarkType): Range[] {
  if ((type !== M.highlight && type !== M.shading) || !pref(P.hlUnderlined)) return ranges;
  const out: Range[] = [];
  eachText(doc, ranges, (node, from, to, para) => {
    if (isHeading(para) || node.marks.some((m) => m.type === M.underline || m.type === M.emphasis || m.type === M.cite)) out.push({ from, to });
  });
  return out;
}

/** F11 / Mod-F11: toggle a color mark. `null` color is the "no color" pen, which strips the mark. */
export function toggleColorMark(type: MarkType, color: string | null): Command {
  return (state, dispatch) => {
    const ranges = trimRanges(state.doc, targetRanges(state, 'none'));
    if (!ranges.length) return false;
    const tr = state.tr;
    const paint = color === null ? [] : paintable(state.doc, ranges, type);
    // nothing paintable (or the no-color pen): clear the whole selection, so removal is never blocked
    if (!paint.length) {
      for (const r of ranges) tr.removeMark(r.from, r.to, type);
    } else {
      const has = allHave(state.doc, paint, (ms) => ms.some((m) => m.type === type && m.attrs.color === color));
      if (has) for (const r of ranges) tr.removeMark(r.from, r.to, type);
      else for (const r of paint) tr.addMark(r.from, r.to, type.create({ color }));
    }
    return finish(state, tr, dispatch);
  };
}

/** Paint (never toggle) a color: used by the paintbrush. */
export function paintColorMark(type: MarkType, color: string | null, from: number, to: number): Command {
  return (state, dispatch) => {
    const [r] = trimRanges(state.doc, [{ from, to }]);
    if (!r) return false;
    const tr = state.tr;
    if (color === null) tr.removeMark(r.from, r.to, type);
    else for (const p of paintable(state.doc, [r], type)) tr.addMark(p.from, p.to, type.create({ color }));
    return finish(state, tr, dispatch);
  };
}

const CLEAR_KEEPS = new Set(['highlight', 'shading']);

/** F12: strip direct formatting, keep highlighting. With nothing selected, clears the current paragraph. */
export const clearFormatting: Command = (state, dispatch) => {
  let ranges = targetRanges(state, 'none');
  if (!ranges.length) {
    const $f = state.selection.$from;
    ranges = [{ from: $f.start(), to: $f.end() }];
  }
  const tr = state.tr;
  for (const r of ranges) {
    for (const name of Object.keys(schema.marks)) if (!CLEAR_KEEPS.has(name)) tr.removeMark(r.from, r.to, schema.marks[name]);
  }
  if (state.selection.empty) tr.setStoredMarks([]);
  return finish(state, tr, dispatch);
};

/** Paragraphs touched by the selection, as [node, pos] pairs. */
export function selectedParas(state: EditorState): [PMNode, number][] {
  const out: [PMNode, number][] = [];
  const seen = new Set<number>();
  // every stretch of a multi-selection, not just the last one
  for (const r of state.selection.ranges) {
    state.doc.nodesBetween(r.$from.pos, r.$to.pos, (node, pos) => {
      if (node.isTextblock) { if (!seen.has(pos)) { seen.add(pos); out.push([node, pos]); } return false; }
      return true;
    });
  }
  return out.sort((a, b) => a[1] - b[1]);
}

/** F4–F7, Mod-F7, Mod-F8: set the paragraph style. Re-applying a style resets indent and font-size overrides. */
export function setParaStyle(style: ParaStyle): Command {
  return (state, dispatch) => {
    const paras = selectedParas(state);
    if (!paras.length) return false;
    const tr = state.tr;
    for (const [node, pos] of paras) {
      if (node.attrs.style === style) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: 0 });
        if (style !== 'undertag') tr.removeMark(pos + 1, pos + 1 + node.content.size, M.size);
      } else {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, style });
      }
    }
    return finish(state, tr, dispatch);
  };
}

/** The card (or heading section) around a position: index range of paragraphs in the doc. */
export function cardAround(doc: PMNode, pos: number): { head: number; start: number; end: number } | null {
  // a position at the very end of the doc (e.g. select-all) resolves past the last paragraph
  const idx = Math.min(doc.resolve(Math.min(pos, doc.content.size)).index(0), doc.childCount - 1);
  let head = idx;
  while (head >= 0 && !isHeading(doc.child(head))) head--;
  if (head < 0) return null;
  const level = LEVEL[doc.child(head).attrs.style as ParaStyle];
  let end = head + 1;
  while (end < doc.childCount) {
    const n = doc.child(end);
    const l = LEVEL[n.attrs.style as ParaStyle];
    if (l > 0 && (level === 4 || l <= level)) break;
    end++;
  }
  return { head, start: head + 1, end };
}

function posOfIndex(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** Body range of the card at the cursor (paragraphs after the tag), or the selection when there is one. */
function cardBodyRange(state: EditorState): Range | null {
  if (!state.selection.empty) return { from: state.selection.from, to: state.selection.to };
  const c = cardAround(state.doc, state.selection.from);
  if (!c || c.start >= c.end) return null;
  return { from: posOfIndex(state.doc, c.start), to: posOfIndex(state.doc, c.end) };
}

/** The sizes Mod-8 steps through, down to the smallest one set in Settings. */
const shrinkSteps = () => [8, 7, 6, 5, 4].filter((pt) => pt >= pref(P.shrinkMin));
const OMISSION = /[[<][^\]>]*omitted[^\]>]*[\]>]/gi;

/** Mod-8: cycle the unread (not underlined/emphasized/cited) text in the card through smaller sizes. */
export const shrink: Command = (state, dispatch) => {
  const r = cardBodyRange(state);
  if (!r) return false;
  const pieces: Range[] = [];
  const protect = pref(P.shrinkProtect);
  let current: number | null | undefined;
  state.doc.nodesBetween(r.from, r.to, (node, pos, parent) => {
    if (node.isTextblock) return !isHeading(node);
    if (!node.isText || !parent) return false;
    if (node.marks.some((m) => m.type === M.underline || m.type === M.emphasis || m.type === M.cite)) return false;
    const from = Math.max(r.from, pos), to = Math.min(r.to, pos + node.nodeSize);
    if (current === undefined) current = M.size.isInSet(node.marks)?.attrs.pt ?? null;
    // keep omission notes like [Table Omitted] at full size
    const text = node.text!.slice(from - pos, to - pos);
    let last = 0;
    if (protect) for (const m of text.matchAll(OMISSION)) {
      if (m.index! > last) pieces.push({ from: from + last, to: from + m.index! });
      last = m.index! + m[0].length;
    }
    if (last < text.length) pieces.push({ from: from + last, to });
    return false;
  });
  if (!pieces.length) return false;
  const steps = shrinkSteps();
  const i = current == null ? -1 : steps.indexOf(current);
  const next = i + 1 < steps.length ? steps[i + 1] : null;
  const tr = state.tr;
  for (const p of pieces) next === null ? tr.removeMark(p.from, p.to, M.size) : tr.addMark(p.from, p.to, M.size.create({ pt: next }));
  return finish(state, tr, dispatch);
};

/** Mod-Shift-8: regrow the card's shrunk text to normal size. */
export const regrow: Command = (state, dispatch) => {
  const r = cardBodyRange(state);
  if (!r) return false;
  return finish(state, state.tr.removeMark(r.from, r.to, M.size), dispatch);
};

/** Shift-F3: lowercase → UPPERCASE → Title Case → lowercase. */
export const toggleCase: Command = (state, dispatch) => {
  const ranges = targetRanges(state, 'word');
  if (!ranges.length) return false;
  const text = ranges.map((r) => state.doc.textBetween(r.from, r.to, ' ')).join(' ');
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters) return false;
  const isUpper = letters === letters.toUpperCase();
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const isTitle = !isUpper && words.every((w) => w[0] === w[0].toUpperCase());
  // per character, so marks on each text node stay put
  const conv = (c: string, wordStart: boolean) => {
    const out = isUpper ? (wordStart ? c.toUpperCase() : c.toLowerCase()) : isTitle ? c.toLowerCase() : c.toUpperCase();
    return out.length === 1 ? out : c;
  };
  const tr = state.tr;
  for (const r of ranges) {
    let prev = r.from > 0 ? state.doc.textBetween(r.from - 1, r.from, ' ', ' ') : ' ';
    eachText(state.doc, [r], (node, from, to) => {
      const piece = state.doc.textBetween(from, to);
      let out = '';
      for (const c of piece) { out += conv(c, prev === '' || /[\s\-–—"“(]/.test(prev)); prev = c; }
      if (out !== piece) tr.replaceWith(from, to, schema.text(out, node.marks));
    });
  }
  return finish(state, tr, dispatch);
};

/**
 * F3 family. `integrity` keeps paragraph breaks and only collapses whitespace;
 * `merge` joins the paragraphs; `pilcrows` joins them and marks each old break with ¶.
 */
export function condense(mode: CondenseMode): Command {
  return (state, dispatch) => {
    let range: Range | null;
    let skipCite = false;
    if (state.selection.empty) {
      const c = cardAround(state.doc, state.selection.from);
      if (!c || c.start >= c.end) return false;
      range = { from: posOfIndex(state.doc, c.start), to: posOfIndex(state.doc, c.end) };
      skipCite = isCardHead(state.doc.child(c.head)) && c.end - c.start > 1;
    } else range = { from: state.selection.from, to: state.selection.to };

    const paras: [PMNode, number][] = [];
    state.doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (node.isTextblock) { if (!isHeading(node)) paras.push([node, pos]); return false; }
      return true;
    });
    if (skipCite && paras.length) paras.shift();
    if (!paras.length) return false;

    const tr = state.tr;
    // collapse whitespace inside each paragraph; paragraphs last to first, and edits within one last to first,
    // so every offset still points at the original text (line breaks count as one placeholder char)
    for (const [node, pos] of [...paras].reverse()) {
      const text = node.textBetween(0, node.content.size, undefined, '\uFFFC');
      const edits: [number, number, string][] = [];
      for (const m of text.matchAll(/[ \t\u00a0]{2,}|\t|\u00a0/g)) edits.push([m.index!, m.index! + m[0].length, ' ']);
      const lead = text.match(/^[ \t\u00a0]+/), trail = text.match(/[ \t\u00a0]+$/);
      if (lead) { const e = edits.find((x) => x[0] === 0); if (e) e[2] = ''; else edits.push([0, lead[0].length, '']); }
      if (trail && trail.index! > 0) {
        const e = edits.find((x) => x[1] === text.length);
        if (e) e[2] = ''; else edits.push([trail.index!, text.length, '']);
      }
      edits.sort((x, y) => y[0] - x[0]);
      for (const [a, b, rep] of edits) {
        const from = pos + 1 + a, to = pos + 1 + b;
        rep ? tr.insertText(rep, from, to) : tr.delete(from, to);
      }
    }
    if (mode !== 'integrity') {
      // join consecutive paragraphs, last to first; never across a heading that sits between them
      const mapped = paras.map(([, pos]) => tr.mapping.map(pos));
      for (let i = mapped.length - 1; i > 0; i--) {
        const prevNode = tr.doc.nodeAt(mapped[i - 1]);
        const curNode = tr.doc.nodeAt(mapped[i]);
        if (!prevNode || !curNode || mapped[i - 1] + prevNode.nodeSize !== mapped[i]) continue;
        if (curNode.content.size === 0) { tr.delete(mapped[i], mapped[i] + curNode.nodeSize); continue; }
        tr.join(mapped[i]);
        const sep = mode === 'pilcrows' ? ' ¶ ' : ' ';
        if (prevNode.content.size > 0) {
          tr.insertText(sep, mapped[i] - 1);
          if (mode === 'pilcrows' && pref(P.smallPilcrows)) tr.addMark(mapped[i] - 1, mapped[i] - 1 + sep.length, M.size.create({ pt: 6 }));
        }
      }
    }
    return finish(state, tr, dispatch);
  };
}

/** Mod-Alt-Shift-F3: split paragraphs at ¶ marks. */
export const uncondense: Command = (state, dispatch) => {
  const r = cardBodyRange(state);
  if (!r) return false;
  const hits: number[] = [];
  state.doc.nodesBetween(r.from, r.to, (node, pos) => {
    if (node.isText) for (const m of node.text!.matchAll(/ ?¶ ?/g)) {
      const at = pos + m.index!;
      if (at >= r.from && at + m[0].length <= r.to) hits.push(at, m[0].length);
    }
    return true;
  });
  if (!hits.length) return false;
  const tr = state.tr;
  for (let i = hits.length - 2; i >= 0; i -= 2) {
    tr.delete(hits[i], hits[i] + hits[i + 1]);
    tr.split(hits[i]);
  }
  return finish(state, tr, dispatch);
};

const hasCite = (n: PMNode) => { let yes = false; n.forEach((c) => { if (M.cite.isInSet(c.marks)) yes = true; }); return yes; };

/** Alt-F8: copy the previous card's cite paragraph to the cursor. */
export const copyPreviousCite: Command = (state, dispatch) => {
  const doc = state.doc;
  if (state.selection.$from.depth < 1 || state.selection.$to.depth < 1) return false;
  const here = doc.resolve(state.selection.from).index(0);
  let tags = 0;
  for (let i = here; i >= 0; i--) {
    const n = doc.child(i);
    if (!isCardHead(n)) continue;
    tags++;
    if (tags < 2 && i <= here && cardAround(doc, state.selection.from)?.head === i) continue;
    for (let j = i + 1; j < doc.childCount && !isHeading(doc.child(j)); j++) {
      const cite = doc.child(j);
      if (cite.content.size === 0) continue;
      // "nearest cite only" off: also the cite-marked lines right after it (a cite split over lines)
      const more: PMNode[] = [];
      if (!pref(P.citeNearest)) {
        for (let k = j + 1; k < doc.childCount; k++) {
          const n = doc.child(k);
          if (isHeading(n) || !n.content.size || !hasCite(n)) break;
          more.push(schema.nodes.paragraph.create(null, n.content));
        }
      }
      const $f = state.selection.$from;
      const tr = state.tr;
      if ($f.parent.content.size === 0 && !isHeading($f.parent)) {
        tr.replaceWith($f.start(), $f.end(), cite.content);
        if (more.length) tr.insert(tr.mapping.map($f.after(1)), more);
      } else tr.insert(state.selection.$to.after(1), [schema.nodes.paragraph.create(null, cite.content), ...more]);
      return finish(state, tr, dispatch);
    }
    return false;
  }
  return false;
};

/** Condense pasted plain text the way F3 condenses a card: collapse whitespace, and merge the lines unless `integrity`. */
export function condenseText(text: string, mode: CondenseMode): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim());
  if (mode === 'integrity') return lines.join('\n');
  return lines.filter(Boolean).join(mode === 'pilcrows' ? ' ¶ ' : ' ');
}

/** Text from F2 (or a plain paste), condensed first when "Condense after Paste Text" is on. */
export const pastedText = (text: string) => (pref(P.pasteCondense) ? condenseText(text, pref(P.condense)) : text);

/** Insert plain text (F2 paste), keeping paragraph breaks and dropping all source styling. */
export function insertPlainText(text: string): Command {
  return (state, dispatch) => {
    const lines = pastedText(text).replace(/\r\n?/g, '\n').split('\n');
    const marks = state.selection.$from.marks().filter((m) => m.type === M.highlight || m.type === M.size);
    const tr = state.tr;
    if (lines.length === 1) {
      tr.replaceSelectionWith(schema.text(lines[0], marks), false);
    } else {
      // works for any selection, including select-all (whose ends sit outside every paragraph)
      tr.deleteSelection();
      let pos = tr.selection.$from.depth ? tr.selection.from : Selection.atStart(tr.doc).from;
      lines.forEach((line, i) => {
        if (i > 0) { tr.split(pos); pos += 2; tr.setNodeMarkup(pos - 1, undefined, { style: 'normal', indent: 0 }); }
        if (line) { tr.insertText(line, pos); pos += line.length; }
      });
      tr.setSelection(TextSelection.create(tr.doc, pos));
    }
    return finish(state, tr, dispatch);
  };
}

/** Tab / Shift-Tab: indent or outdent the selected paragraphs. */
export function indent(delta: number): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    for (const [node, pos] of selectedParas(state)) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: Math.max(0, Math.min(8, node.attrs.indent + delta)) });
    }
    return finish(state, tr, dispatch);
  };
}

/** Mod-B inside a heading/tag/cite un-bolds (they are bold by default). */
export const toggleBold: Command = (state, dispatch) => {
  const $f = state.selection.$from;
  const boldByDefault = isHeading($f.parent) || state.selection.$from.marks().some((m) => m.type === M.cite);
  return toggleTypingMark(boldByDefault ? M.unbold : M.bold)(state, dispatch);
};
