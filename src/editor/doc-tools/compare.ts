/**
 * Compare Text: how the selection differs from the text on the clipboard, marked in place. Text only
 * on the page is struck through in red; text only on the clipboard shows in green where it would go.
 * Nothing in the document changes; the marks go away on the next edit, on Esc, or on the next compare.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { bridge } from '../host';
import { readSetting, type SettingSpec } from '../tools';
import { spansOf } from '../multi';

export const compareIgnoreCase: SettingSpec = {
  section: 'Compare Text', key: 'falcon.compareIgnoreCase', kind: 'toggle', default: false,
  label: 'Ignore case', hint: 'Compare Text treats "The" and "the" as the same.',
};
export const compareIgnoreSpacing: SettingSpec = {
  section: 'Compare Text', key: 'falcon.compareIgnoreSpacing', kind: 'toggle', default: true,
  label: 'Ignore spacing', hint: 'Compare Text skips extra spaces and line breaks, so text copied from a PDF or web page lines up.',
};

export type CompareOpts = { ignoreCase?: boolean; ignoreSpace?: boolean };
/** A[aFrom, aTo) became `b` (offsets into the two texts). An empty range is an insertion, an empty b a removal. */
export type Edit = { aFrom: number; aTo: number; bFrom: number; bTo: number };
export type CompareResult = {
  edits: Edit[];
  /** the clipboard has text before / after everything the selection matches (left unmarked) */
  moreBefore: boolean; moreAfter: boolean;
  timedOut: boolean;
};

// ---------- the diff ----------
// Myers' diff in linear space (the middle-snake bisect, after diff-match-patch, Apache 2.0), as in the
// debate-uploader plugin's Compare text. It runs over integer ids, one per distinct unit.
const TIMED_OUT = 'timed out';
const COMPARE_MS = 2000; // past this, what's left is one big change

function bisect(a: Int32Array, b: Int32Array, deadline: number): [number, number] | typeof TIMED_OUT | null {
  const n = a.length, m = b.length, maxD = Math.ceil((n + m) / 2), off = maxD, len = 2 * maxD;
  const v1 = new Int32Array(len).fill(-1), v2 = new Int32Array(len).fill(-1);
  v1[off + 1] = 0;
  v2[off + 1] = 0;
  const delta = n - m, front = delta % 2 !== 0;
  let k1s = 0, k1e = 0, k2s = 0, k2e = 0;
  for (let d = 0; d < maxD; d++) {
    if (Date.now() > deadline) return TIMED_OUT;
    for (let k1 = -d + k1s; k1 <= d - k1e; k1 += 2) {
      const k1o = off + k1;
      let x1 = k1 === -d || (k1 !== d && v1[k1o - 1] < v1[k1o + 1]) ? v1[k1o + 1] : v1[k1o - 1] + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[x1] === b[y1]) { x1++; y1++; }
      v1[k1o] = x1;
      if (x1 > n) k1e += 2;
      else if (y1 > m) k1s += 2;
      else if (front) {
        const k2o = off + delta - k1;
        if (k2o >= 0 && k2o < len && v2[k2o] !== -1 && x1 >= n - v2[k2o]) return [x1, y1];
      }
    }
    for (let k2 = -d + k2s; k2 <= d - k2e; k2 += 2) {
      const k2o = off + k2;
      let x2 = k2 === -d || (k2 !== d && v2[k2o - 1] < v2[k2o + 1]) ? v2[k2o + 1] : v2[k2o - 1] + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[n - x2 - 1] === b[m - y2 - 1]) { x2++; y2++; }
      v2[k2o] = x2;
      if (x2 > n) k2e += 2;
      else if (y2 > m) k2s += 2;
      else if (!front) {
        const k1o = off + delta - k2;
        if (k1o >= 0 && k1o < len && v1[k1o] !== -1) {
          const x1 = v1[k1o];
          if (x1 >= n - x2) return [x1, off + x1 - k1o];
        }
      }
    }
  }
  return null;
}

type Op = ['=' | '-' | '+', number];
function diffSeq(a: Int32Array, b: Int32Array, deadline: number): { ops: Op[]; timedOut: boolean } {
  const ops: Op[] = [];
  let timedOut = false;
  const emit = (t: Op[0], n: number) => {
    if (!n) return;
    const last = ops[ops.length - 1];
    if (last && last[0] === t) last[1] += n; else ops.push([t, n]);
  };
  const rec = (a: Int32Array, b: Int32Array) => {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    emit('=', p);
    const ma = a.subarray(p, a.length - s), mb = b.subarray(p, b.length - s);
    const at = ma.length && mb.length ? bisect(ma, mb, deadline) : null;
    if (at === TIMED_OUT) timedOut = true;
    if (at && at !== TIMED_OUT) {
      rec(ma.subarray(0, at[0]), mb.subarray(0, at[1]));
      rec(ma.subarray(at[0]), mb.subarray(at[1]));
    } else {
      emit('-', ma.length);
      emit('+', mb.length);
    }
    emit('=', s);
  };
  rec(a, b);
  return { ops, timedOut };
}

// ---------- units ----------
/** A word (with inner apostrophes), a run of spaces, or any other single character. */
const WORD_RE = /\s+|[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*|[^]/gu;
type Unit = { from: number; to: number };

function unitsOf(text: string, from: number, to: number, words: boolean, ignoreSpace: boolean): Unit[] {
  const out: Unit[] = [];
  const s = text.slice(from, to);
  if (words) for (const m of s.matchAll(WORD_RE)) out.push({ from: from + m.index!, to: from + m.index! + m[0].length });
  else for (let i = 0; i < s.length;) { const n = s.codePointAt(i)! > 0xffff ? 2 : 1; out.push({ from: from + i, to: from + i + n }); i += n; }
  // with Ignore spacing, spaces aren't compared at all
  return ignoreSpace ? out.filter((u) => !/^\s+$/.test(s.slice(u.from - from, u.to - from))) : out;
}

function ids(a: string, ua: Unit[], b: string, ub: Unit[], opts: CompareOpts): [Int32Array, Int32Array] {
  const map = new Map<string, number>();
  const id = (text: string) => (u: Unit) => {
    let k = text.slice(u.from, u.to);
    if (opts.ignoreCase) k = k.toLowerCase();
    if (!map.has(k)) map.set(k, map.size);
    return map.get(k)!;
  };
  return [Int32Array.from(ua, id(a)), Int32Array.from(ub, id(b))];
}

/** A run of changed units, by index: a[a0, a1) became b[b0, b1). */
type Run = { a0: number; a1: number; b0: number; b1: number };
function runsOf(ops: Op[]): Run[] {
  const out: Run[] = [];
  let i = 0, j = 0;
  for (const [t, n] of ops) {
    if (t === '=') { i += n; j += n; continue; }
    let last = out[out.length - 1];
    if (!last || last.a1 !== i || last.b1 !== j) out.push((last = { a0: i, a1: i, b0: j, b1: j }));
    if (t === '-') last.a1 = i += n; else last.b1 = j += n;
  }
  return out;
}

const size = (u: Unit[], i: number, j: number) => (j > i ? u[j - 1].to - u[i].from : 0);
/** Text offsets of units [i0, i1); an empty run sits right after the unit before it. */
const at = (u: Unit[], i0: number, i1: number): [number, number] => {
  const p = i1 > i0 ? u[i0].from : i0 > 0 ? u[i0 - 1].to : u.length ? u[0].from : 0;
  return [p, i1 > i0 ? u[i1 - 1].to : p];
};

export function compareTexts(a: string, b: string, opts: CompareOpts = {}): CompareResult {
  const deadline = Date.now() + COMPARE_MS;
  const space = !!opts.ignoreSpace;
  const ua = unitsOf(a, 0, a.length, true, space), ub = unitsOf(b, 0, b.length, true, space);
  const [x, y] = ids(a, ua, b, ub, opts);
  const { ops, timedOut: slow } = diffSeq(x, y, deadline);
  let timedOut = slow;
  let runs = runsOf(ops);

  // The selection is usually part of what was copied (a card from its article): clipboard-only text
  // before the first and after the last match isn't a difference.
  // A match the diff could put in either place goes in the one that leaves that text at the edge.
  // Clipboard-only text slides toward the ends ("The [plan failed. The] economy" is "[The plan failed.] The
  // economy"), joining the run it reaches.
  const touch = (p: Run, q: Run) => p.a1 === q.a0 && p.b1 === q.b0;
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k], p = runs[k - 1];
    if (r.a0 !== r.a1) continue;
    while (r.a0 > (p?.a1 ?? 0) && r.b0 > (p?.b1 ?? 0) && x[r.a0 - 1] === y[r.b1 - 1]) { r.a0--; r.a1--; r.b0--; r.b1--; }
    if (p && touch(p, r)) { p.b1 = r.b1; runs.splice(k--, 1); }
  }
  for (let k = runs.length - 1; k >= 0; k--) {
    const r = runs[k], q = runs[k + 1];
    if (r.a0 !== r.a1) continue;
    while (r.a0 < (q?.a0 ?? ua.length) && r.b1 < (q?.b0 ?? ub.length) && x[r.a0] === y[r.b0]) { r.a0++; r.a1++; r.b0++; r.b1++; }
    if (q && touch(r, q)) { q.a0 = r.a0; q.b0 = r.b0; runs.splice(k, 1); }
  }
  let moreBefore = false, moreAfter = false;
  if (ua.length && runs.length && runs[0].a0 === 0 && runs[0].b0 === 0 && runs[0].a1 === 0) { moreBefore = true; runs.shift(); }
  const last = runs[runs.length - 1];
  if (ua.length && last && last.a0 === ua.length && last.b1 === ub.length) { moreAfter = true; runs.pop(); }

  // A short match between two bigger changes ("the") joins them, so a rewritten phrase reads as one change.
  for (let again = true; again;) {
    again = false;
    for (let k = 0; k + 1 < runs.length; k++) {
      const p = runs[k], q = runs[k + 1];
      const gap = size(ua, p.a1, q.a0);
      const big = (r: Run) => Math.max(size(ua, r.a0, r.a1), size(ub, r.b0, r.b1));
      if (gap <= big(p) && gap <= big(q)) { runs.splice(k, 2, { a0: p.a0, a1: q.a1, b0: p.b0, b1: q.b1 }); again = true; }
    }
  }

  const edits: Edit[] = [];
  for (const r of runs) {
    // where in each text the change sits; an empty side sits right after the unit before it
    const [aFrom, aTo] = at(ua, r.a0, r.a1), [bFrom, bTo] = at(ub, r.b0, r.b1);
    // Inside a changed stretch, mark just the letters when only a few differ ("colour"/"color",
    // a curly apostrophe); a swapped word ("nearly"/"almost", "rates"/"prices") stays whole.
    if (aTo > aFrom && bTo > bFrom) {
      const ca = unitsOf(a, aFrom, aTo, false, space), cb = unitsOf(b, bFrom, bTo, false, space);
      const [cx, cy] = ids(a, ca, b, cb, opts);
      const sub = diffSeq(cx, cy, deadline);
      timedOut ||= sub.timedOut;
      const same = sub.ops.reduce((n, [t, c]) => (t === '=' ? n + c : n), 0);
      if ((ca.length - same) + (cb.length - same) <= Math.max(ca.length, cb.length) / 2) {
        for (const s of runsOf(sub.ops)) {
          const [f, t] = at(ca, s.a0, s.a1), [g, h] = at(cb, s.b0, s.b1);
          edits.push({ aFrom: f, aTo: t, bFrom: g, bTo: h });
        }
        continue;
      }
    }
    edits.push({ aFrom, aTo, bFrom, bTo });
  }
  return { edits, moreBefore, moreAfter, timedOut };
}

// ---------- the page ----------
/** The selection's text, with each character's document position (paragraph breaks are '\n' with no position). */
export function selectionText(state: EditorState): { text: string; pos: number[] } {
  let text = '';
  const pos: number[] = [];
  let first = true;
  for (const r of spansOf(state.selection)) {
    state.doc.nodesBetween(r.from, r.to, (node: PMNode, at: number) => {
      if (node.isTextblock) {
        if (!first) { text += '\n'; pos.push(-1); }
        first = false;
        return true;
      }
      if (node.isText) {
        const from = Math.max(r.from, at), to = Math.min(r.to, at + node.nodeSize);
        text += node.text!.slice(from - at, to - at);
        for (let p = from; p < to; p++) pos.push(p);
      } else if (node.isInline) {
        const from = Math.max(r.from, at);
        if (from < Math.min(r.to, at + node.nodeSize)) { text += node.type.name === 'hard_break' ? '\n' : '￼'; pos.push(from); }
      }
      return true;
    });
  }
  return { text, pos };
}

type CmpState = { decos: DecorationSet } | null;
export const compareKey = new PluginKey<CmpState>('compare');

function mark(cls: string, text: string, title: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  el.title = title;
  return el;
}
function clipWidget(text: string): HTMLElement {
  return mark('f-cmp-ins', /^\s+$/.test(text) ? text.replace(/\n/g, '↵').replace(/[^↵]/g, '␣') : text.replace(/\n/g, ' ↵ '), 'Only on the clipboard');
}

/** Marks for `edits` over the selection text whose characters sit at `pos`. */
export function compareDecorations(doc: PMNode, pos: number[], b: string, edits: Edit[], end: number): DecorationSet {
  const decos: Decoration[] = [];
  // where text inserted before character i goes: that character, or right after the one before it
  const placeAt = (i: number) => {
    for (let k = i; k < pos.length; k++) if (pos[k] >= 0) return pos[k];
    for (let k = i - 1; k >= 0; k--) if (pos[k] >= 0) return pos[k] + 1;
    return end;
  };
  for (const e of edits) {
    // removed: one inline mark per stretch of consecutive positions
    for (let i = e.aFrom; i < e.aTo;) {
      if (pos[i] < 0) { // a paragraph break only in the selection
        decos.push(Decoration.widget(placeAt(i), () => mark('f-cmp-del', '↵', 'Only in the selection'), { side: -1, key: `cmp-br-${i}`, ignoreSelection: true }));
        i++;
        continue;
      }
      let j = i + 1;
      while (j < e.aTo && pos[j] === pos[j - 1] + 1) j++;
      decos.push(Decoration.inline(pos[i], pos[j - 1] + 1, { class: 'f-cmp-del', title: 'Only in the selection' }));
      i = j;
    }
    if (e.bTo > e.bFrom) {
      const text = b.slice(e.bFrom, e.bTo);
      // after the removed text, so a replacement reads old then new
      const i = e.aTo > e.aFrom ? e.aTo : e.aFrom;
      const at = i > 0 && pos[i - 1] >= 0 ? pos[i - 1] + 1 : placeAt(i);
      decos.push(Decoration.widget(at, () => clipWidget(text), { side: 1, key: `cmp-${e.bFrom}-${text}`, ignoreSelection: true }));
    }
  }
  return DecorationSet.create(doc, decos);
}

export const comparePlugin = new Plugin<CmpState>({
  key: compareKey,
  state: {
    init: () => null,
    apply(tr, prev) {
      const meta = tr.getMeta(compareKey) as CmpState | undefined;
      if (meta !== undefined) return meta;
      return tr.docChanged ? null : prev; // any edit clears the marks
    },
  },
  props: {
    decorations: (state) => compareKey.getState(state)?.decos ?? null,
    handleKeyDown(view, ev) {
      if (ev.key !== 'Escape' || !compareKey.getState(view.state)) return false;
      view.dispatch(view.state.tr.setMeta(compareKey, null));
      return true;
    },
  },
});

/** The app shows these as a toast. */
export const TOAST_EVENT = 'falcon-toast';
const toast = (msg: string) => dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: msg }));

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function summary(a: string, b: string, r: CompareResult, opts: CompareOpts): string {
  const more = [r.moreBefore && 'before', r.moreAfter && 'after'].filter(Boolean).join(' and ');
  const tail = (more ? `. The clipboard also has text ${more} it` : '') + (r.timedOut ? '. Too long to compare closely: big changes are marked whole' : '');
  if (r.edits.length) return `${plural(r.edits.length, 'difference')}: red is only in the selection, green only on the clipboard${tail}`;
  if (a === b) return 'Identical to the clipboard';
  const ignoring = [opts.ignoreCase && 'case', opts.ignoreSpace && 'spacing'].filter(Boolean).join(' and ');
  return `Matches the clipboard${ignoring ? ` (ignoring ${ignoring})` : ''}${tail}`;
}

/** Compare the selection with the clipboard and mark the differences. */
export async function runCompare(view: EditorView): Promise<void> {
  let b = '';
  try {
    b = bridge.readClipboardText ? await bridge.readClipboardText() : await navigator.clipboard.readText();
  } catch {
    toast("Couldn't read the clipboard");
    return;
  }
  if (!b.trim()) { toast('Copy the text to compare with first: the clipboard is empty'); return; }
  const state = view.state;
  const { text, pos } = selectionText(state);
  const opts = { ignoreCase: readSetting(compareIgnoreCase) as boolean, ignoreSpace: readSetting(compareIgnoreSpacing) as boolean };
  const r = compareTexts(text, b, opts);
  const decos = compareDecorations(state.doc, pos, b, r.edits, state.selection.to);
  view.dispatch(view.state.tr.setMeta(compareKey, r.edits.length ? { decos } : null));
  toast(summary(text, b, r, opts));
}

export const compareText: Command = (state, _dispatch, view) => {
  if (!view) return !state.selection.empty;
  if (state.selection.empty) { toast('Select the text to compare first, with the other version on the clipboard'); return true; }
  void runCompare(view);
  return true;
};

export const compareSettings: SettingSpec[] = [compareIgnoreSpacing, compareIgnoreCase];
