import type { Mark, MarkType, Node as PMNode } from 'prosemirror-model';
import { Plugin, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { AddMarkStep, RemoveMarkStep } from 'prosemirror-transform';
import { isHistoryTransaction } from 'prosemirror-history';
import { schema } from '../schema';
import { wordAt } from '../commands';
import { spansOf, type Span } from '../multi';
import { isReading } from '../read';
import { readSetting, type SettingSpec } from '../tools';

const M = schema.marks;

/** Transaction meta: a bulk recolor or cleanup that the automatic bridging must leave as it is. */
export const NO_BRIDGE = 'falcon-no-bridge';

export const autoBridgeSetting: SettingSpec = {
  section: 'Formatting gaps', key: 'falcon.autoBridge', kind: 'toggle', default: true,
  label: 'Bridge formatting across gaps automatically',
  hint: 'Formatting a word next to a formatted word also formats the space between them. Fix Formatting Gaps in the Doc menu works either way.',
};
export const gapClassSetting: SettingSpec = {
  section: 'Formatting gaps', key: 'falcon.bridgeGaps', kind: 'choice', default: 'both',
  options: [['both', 'Spaces and punctuation'], ['space', 'Spaces only']],
  label: 'Bridge formatting across',
  hint: 'Which gaps between two formatted words get filled, by the automatic bridging and by Fix Formatting Gaps.',
};

// Bookends are word characters (quotes count, so a quoted word still bridges). Dashes are never gap
// characters: they join words, so a seam at a dash is one the user chose.
const WORD = "\\p{L}\\p{N}'\"‘’“”";
const isWordChar = (c: string) => new RegExp(`[${WORD}]`, 'u').test(c);
const gapChars = () => (readSetting(gapClassSetting) === 'space' ? ' ' : '.,;:?()! ');
const charAt = (doc: PMNode, pos: number) => doc.textBetween(pos, pos + 1, '\n', '\n');
const isPunct = (doc: PMNode, pos: number) => { const c = charAt(doc, pos); return !!c && !isWordChar(c) && !/\s/.test(c); };

type Gap = { from: number; to: number; left: PMNode; right: PMNode };

/** Every word-to-word gap whose bookends both lie in [from, to], in body paragraphs only (headings, tags, analytics and undertags never bridge). */
function eachGap(doc: PMNode, from: number, to: number, fn: (g: Gap) => void) {
  const re = new RegExp(`([${WORD}])([${gapChars()}]+)(?=[${WORD}])`, 'gu');
  doc.nodesBetween(from, to, (para, pos) => {
    if (!para.isTextblock) return true;
    if (para.attrs.style !== 'normal') return false;
    const start = pos + 1, a = Math.max(from, start), b = Math.min(to, start + para.content.size);
    // a line break is one position and one '\n', so string offsets stay document offsets
    const text = para.textBetween(a - start, b - start, undefined, '\n');
    for (const m of text.matchAll(re)) {
      const gf = a + m.index! + m[1].length, gt = gf + m[2].length;
      fn({ from: gf, to: gt, left: para.childAfter(gf - 1 - start).node!, right: para.childAfter(gt - start).node! });
    }
    return false;
  });
}

const ptOf = (n: PMNode) => M.size.isInSet(n.marks)?.attrs.pt ?? (M.cite.isInSet(n.marks) ? 13 : 11);
const fullyHas = (doc: PMNode, from: number, to: number, type: MarkType) => {
  let all = to > from;
  doc.nodesBetween(from, to, (n) => { if (n.isText && !type.isInSet(n.marks)) all = false; return all; });
  return all;
};

/**
 * Bring a gap's marks in line with its two bookends: a mark both carry spans the gap (the left one's color
 * wins), a mark they disagree on comes off it. `named` covers underline, emphasis and cite; the automatic
 * bridge after a highlight leaves those alone, since whatever the gap carries there was set on purpose.
 * Marks are added over `mod` and stripped over `strip` (both default to the whole gap).
 */
function fixGap(tr: Transaction, g: Gap, o: { auto: boolean; named: boolean; mod?: Span; strip?: Span }) {
  const mod = o.mod ?? g, strip = o.strip ?? mod;
  if (mod.from >= mod.to) return;
  const L = g.left.marks, R = g.right.marks;
  const add: Mark[] = [], off: MarkType[] = [];
  const both = (t: MarkType) => (t.isInSet(L) && t.isInSet(R) ? t.isInSet(L)! : null);
  if (o.named) {
    const lu = !!(M.underline.isInSet(L) || M.emphasis.isInSet(L)), ru = !!(M.underline.isInSet(R) || M.emphasis.isInSet(R));
    const ee = !!both(M.emphasis);
    // Emphasis on both sides keeps a continuous emphasized phrase whole. Otherwise two read words are joined
    // with underline: always when typing a format (the read-aloud join), and for mixed underline/emphasis by hand.
    if (ee && (!o.auto || fullyHas(tr.doc, mod.from, mod.to, M.emphasis))) add.push(M.emphasis.create());
    else if (lu && ru) add.push(M.underline.create());
    else off.push(M.underline, M.emphasis);
    const cite = both(M.cite);
    cite ? add.push(cite) : off.push(M.cite);
  }
  for (const t of [M.highlight, M.shading]) { const m = both(t); m ? add.push(m) : off.push(t); }
  if (!o.auto) {
    // size: the smaller bookend's explicit size, so the gap never looks bigger than either word
    const lp = ptOf(g.left), rp = ptOf(g.right), ls = M.size.isInSet(L), rs = M.size.isInSet(R);
    const size = lp < rp ? ls : rp < lp ? rs : ls && rs ? ls : undefined;
    size ? add.push(size) : off.push(M.size);
  }
  if (strip.from < strip.to) for (const t of off) tr.removeMark(strip.from, strip.to, t);
  for (const m of add) tr.addMark(mod.from, mod.to, m);
}

/** The selection's stretches, or the whole document when nothing is selected. */
export const scopeOf = (state: EditorState): Span[] => {
  const spans = spansOf(state.selection);
  return spans.length ? spans : [{ from: 0, to: state.doc.content.size }];
};

/** Doc menu: Fix Formatting Gaps, Verbatim's macro widened to every formatting family, over the selection or the whole document. */
export const fixFormattingGaps: Command = (state, dispatch) => {
  if (isReading(state)) return false;
  const tr = state.tr;
  for (const r of scopeOf(state)) eachGap(state.doc, r.from, r.to, (g) => fixGap(tr, g, { auto: false, named: true }));
  if (!tr.docChanged) return false;
  dispatch?.(tr.setMeta(NO_BRIDGE, true));
  return true;
};

/** What a formatting command just acted on: the selection (minus edge spaces, as the commands trim them), else the word at the cursor. */
function operatingRanges(old: EditorState, tr: Transaction): Span[] {
  const doc = old.doc;
  const out = spansOf(old.selection).map(({ from, to }) => {
    while (from < to && /\s/.test(charAt(doc, from) || 'x')) from++;
    while (to > from && /\s/.test(charAt(doc, to - 1) || 'x')) to--;
    return { from, to };
  }).filter((r) => r.to > r.from);
  if (out.length) return out;
  const w = old.selection.empty && wordAt(old, old.selection.from);
  if (w) return [w];
  const steps = tr.steps as (AddMarkStep | RemoveMarkStep)[];
  return [{ from: Math.min(...steps.map((s) => s.from)), to: Math.max(...steps.map((s) => s.to)) }];
}

/** Widen r by the gap on each side and the word character past it, inside the paragraph. */
function withNeighbors(doc: PMNode, r: Span): Span {
  const gap = gapChars(), isGap = (p: number) => gap.includes(charAt(doc, p) || 'x');
  const lo = doc.resolve(r.from).start(), hi = doc.resolve(r.to).end();
  let from = r.from, to = r.to;
  while (from > lo && isGap(from - 1)) from--;
  if (from > lo) from--;
  while (to < hi && isGap(to)) to++;
  if (to < hi) to++;
  return { from, to };
}

/**
 * Punctuation the user selected with the word keeps what the command gave it ("plan." with its period).
 * A selection that starts with punctuation and runs on into the next word keeps the space after it too.
 */
function writable(doc: PMNode, g: Gap, r: Span): Span {
  const inSel = (p: number) => p >= r.from && p < r.to;
  let from = g.from, to = g.to;
  while (from < to && inSel(from) && isPunct(doc, from)) from++;
  if (from > g.from && from < g.to && g.to <= r.to) from = g.to;
  while (to > from && inSel(to - 1) && isPunct(doc, to - 1)) to--;
  return { from, to };
}

/** Punctuation stuck to the word outside the selection belongs to that word: a mark the bookends disagree on stays on it. */
function strippable(doc: PMNode, g: Gap, mod: Span, r: Span): Span {
  let { from, to } = mod;
  if (g.from - 1 < r.from) { let p = g.from; while (p < g.to && isPunct(doc, p)) p++; from = Math.max(from, p); }
  if (g.to >= r.to) { let p = g.to; while (p > g.from && isPunct(doc, p - 1)) p--; to = Math.min(to, p); }
  return from < to ? { from, to } : { from: mod.from, to: mod.from };
}

const BRIDGED = new Set<MarkType>([M.underline, M.emphasis, M.cite, M.highlight, M.shading]);

/**
 * Automatic gap bridging: after underline, emphasis, cite, highlight or background color lands on a word,
 * the gaps at the edges of what changed are brought in line with their bookends, so formatting a word next
 * to a formatted word reads as one stretch. Rides along in the same undo step. Gaps inside the selection
 * are left exactly as the command set them.
 */
let clearing = false;
export const autoBridgePlugin = new Plugin({
  props: {
    handleDOMEvents: {
      // F12 (clear formatting) never bridges, as in CardMirror. DOM handlers run before the keymap, and the
      // keymap dispatches synchronously, so the flag is up exactly while F12's transaction is applied.
      keydown: (_view, ev) => {
        if (ev.key === 'F12') { clearing = true; setTimeout(() => { clearing = false; }); }
        return false;
      },
    },
  },
  appendTransaction(trs, old, state) {
    const tr = trs[0];
    if (trs.length !== 1 || clearing || !tr.docChanged || tr.getMeta(NO_BRIDGE) || isHistoryTransaction(tr) || !readSetting(autoBridgeSetting)) return null;
    let named = false;
    for (const s of tr.steps) {
      if (!(s instanceof AddMarkStep || s instanceof RemoveMarkStep) || !BRIDGED.has(s.mark.type)) return null;
      if (s.mark.type !== M.highlight && s.mark.type !== M.shading) named = true;
    }
    const out = state.tr, doc = state.doc;
    for (const r of operatingRanges(old, tr)) {
      // only spaces or punctuation were picked: that was deliberate, leave it
      if (!new RegExp(`[${WORD}]`, 'u').test(doc.textBetween(r.from, r.to, ' ', ' '))) continue;
      const near = withNeighbors(doc, r);
      eachGap(doc, near.from, near.to, (g) => {
        if (g.from - 1 >= r.from && g.to < r.to) return;
        const mod = writable(doc, g, r);
        fixGap(out, g, { auto: true, named, mod, strip: strippable(doc, g, mod, r) });
      });
    }
    return out.docChanged ? out.setMeta(NO_BRIDGE, true) : null;
  },
});
