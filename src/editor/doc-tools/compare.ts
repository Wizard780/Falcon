/**
 * Compare Text: two texts side by side with their differences marked, as in the debate-uploader plugin.
 * Words are diffed first; in Characters mode each changed stretch is then diffed letter by letter, so
 * anything left unmarked is identical, byte for byte, unless an Ignore option is on.
 */
import type { Command, EditorState } from 'prosemirror-state';
import { spansOf } from '../multi';

export type CompareOpts = { mode?: 'words' | 'chars'; ignoreCase?: boolean; ignoreSpace?: boolean };
/** kind 0 = the same, 1 = in a change but the same letters (Characters mode), 2 = changed, 3 = where the other side has text. g: the difference it belongs to. */
export type Piece = { text: string; kind: 0 | 1 | 2 | 3; g: number };
export type CompareResult = { diffs: number; removed: number; added: number; unit: 'word' | 'character'; left: Piece[]; right: Piece[]; timedOut: boolean };

// ---------- the diff ----------
// Myers' diff in linear space (the middle-snake bisect, after diff-match-patch, Apache 2.0), over integer ids.
const TIMED_OUT = 'timed out';
const COMPARE_MS = 2500; // past this, what's left is shown as one big change

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

/** With Ignore spacing, whitespace rides along with the unit before it and never counts. */
function units(text: string, words: boolean, ignoreSpace: boolean): string[] {
  const raw = words ? text.match(WORD_RE) ?? [] : Array.from(text);
  if (!ignoreSpace) return raw;
  const out: string[] = [];
  let lead = '';
  for (const u of raw) {
    if (!/^\s+$/.test(u)) { out.push(lead + u); lead = ''; } else if (out.length) out[out.length - 1] += u; else lead += u;
  }
  if (lead) out.push(lead);
  return out;
}

function encode(listA: string[], listB: string[], opts: CompareOpts): [Int32Array, Int32Array] {
  const ids = new Map<string, number>();
  const key = (u: string) => {
    let k = opts.ignoreSpace ? u.replace(/\s+/g, '') : u;
    if (opts.ignoreCase) k = k.toLowerCase();
    if (!ids.has(k)) ids.set(k, ids.size);
    return ids.get(k)!;
  };
  return [Int32Array.from(listA, key), Int32Array.from(listB, key)];
}

const textLen = (list: string[], i: number, j: number) => { let n = 0; for (let k = i; k < j; k++) n += list[k].length; return n; };
const isWord = (u: string) => /[\p{L}\p{N}]/u.test(u);

export function compareTexts(left: string, right: string, opts: CompareOpts = {}): CompareResult {
  const deadline = Date.now() + COMPARE_MS;
  const words = opts.mode !== 'chars', space = !!opts.ignoreSpace;
  const ta = units(left, true, space), tb = units(right, true, space);
  const [a, b] = encode(ta, tb, opts);
  const { ops, timedOut: slow } = diffSeq(a, b, deadline);
  let timedOut = slow;

  // equal runs and changes, by unit index
  type Seg = { eq: boolean; a0: number; a1: number; b0: number; b1: number };
  const segs: Seg[] = [];
  let i = 0, j = 0, removedWords = 0, addedWords = 0;
  for (const [t, n] of ops) {
    if (t === '-') removedWords += ta.slice(i, i + n).filter(isWord).length;
    if (t === '+') addedWords += tb.slice(j, j + n).filter(isWord).length;
    if (t === '=') { segs.push({ eq: true, a0: i, a1: i + n, b0: j, b1: j + n }); i += n; j += n; continue; }
    let last = segs[segs.length - 1];
    if (!last || last.eq) segs.push((last = { eq: false, a0: i, a1: i, b0: j, b1: j }));
    if (t === '-') last.a1 = i += n; else last.b1 = j += n;
  }
  // A short equal run between two bigger changes ("the", a space) joins them, so a rewritten phrase
  // reads as one change instead of confetti.
  for (let again = true; again;) {
    again = false;
    for (let k = 1; k < segs.length - 1; k++) {
      const p = segs[k - 1], e = segs[k], q = segs[k + 1];
      if (!e.eq || p.eq || q.eq) continue;
      const n = textLen(ta, e.a0, e.a1);
      if (n <= Math.max(textLen(ta, p.a0, p.a1), textLen(tb, p.b0, p.b1)) && n <= Math.max(textLen(ta, q.a0, q.a1), textLen(tb, q.b0, q.b1))) {
        segs.splice(k - 1, 3, { eq: false, a0: p.a0, a1: q.a1, b0: p.b0, b1: q.b1 });
        again = true;
      }
    }
  }

  const sides: [Piece[], Piece[]] = [[], []];
  const push = (side: Piece[], text: string, kind: Piece['kind'], g: number) => {
    if (!text && kind !== 3) return;
    const last = side[side.length - 1];
    if (last && last.kind === kind && last.g === g && kind !== 3) last.text += text; else side.push({ text, kind, g });
  };
  let g = 0, removed = words ? removedWords : 0, added = words ? addedWords : 0;
  for (const s of segs) {
    const at = ta.slice(s.a0, s.a1).join(''), bt = tb.slice(s.b0, s.b1).join('');
    if (s.eq) { push(sides[0], at, 0, -1); push(sides[1], bt, 0, -1); continue; }
    if (!at || !bt) {
      push(sides[0], at, at ? 2 : 3, g);
      push(sides[1], bt, bt ? 2 : 3, g);
    }
    // Characters mode marks the exact letters only when the two sides mostly share them
    // ("colour"/"color"); a swapped word ("nearly"/"almost") stays whole.
    let sub: ReturnType<typeof diffSeq> | null = null, ca: string[] = [], cb: string[] = [];
    if (!words && at && bt) {
      ca = units(at, false, space);
      cb = units(bt, false, space);
      const [x, y] = encode(ca, cb, opts);
      sub = diffSeq(x, y, deadline);
      timedOut ||= sub.timedOut;
      const same = sub.ops.reduce((n, [t, c]) => (t === '=' ? n + c : n), 0);
      if (same * 2 < Math.min(ca.length, cb.length)) sub = null;
    }
    if (at && bt && !sub) {
      push(sides[0], at, 2, g);
      push(sides[1], bt, 2, g);
    }
    if (words) {
      // counted above, from the edit script (a merged "the" is in both texts)
    } else if (!sub) {
      removed += units(at, false, space).length;
      added += units(bt, false, space).length;
    } else {
      let ci = 0, cj = 0;
      for (const [t, n] of sub.ops) {
        if (t !== '+') { const part = ca.slice(ci, ci + n).join(''); ci += n; push(sides[0], part, t === '=' ? 1 : 2, g); if (t === '-') removed += n; }
        if (t !== '-') { const part = cb.slice(cj, cj + n).join(''); cj += n; push(sides[1], part, t === '=' ? 1 : 2, g); if (t === '+') added += n; }
      }
    }
    g++;
  }
  return { diffs: g, removed, added, unit: words ? 'word' : 'character', left: sides[0], right: sides[1], timedOut };
}

/** The selection's text, paragraphs on their own lines. */
export function selectionText(state: EditorState): string {
  const parts: string[] = [];
  for (const r of spansOf(state.selection)) parts.push(state.doc.textBetween(r.from, r.to, '\n', '\n'));
  return parts.join('\n');
}

/** The app opens the Compare Text panel on this event; detail is the selection's text. */
export const COMPARE_EVENT = 'falcon-compare';

/** Compare Text: the panel, with the selection (if any) as Text 1. */
export const compareText: Command = (state, _dispatch, view) => {
  if (view) dispatchEvent(new CustomEvent(COMPARE_EVENT, { detail: selectionText(state) }));
  return true;
};
