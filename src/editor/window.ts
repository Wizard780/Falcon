import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

/**
 * The paragraphs near the screen, drawn; the rest skipped (styles.css: `content-visibility: hidden`
 * unless `.f-near`). The browser's own `content-visibility: auto` does the same, but it watches every
 * paragraph with an intersection observer and re-checks all of them after each layout: ~18 ms a key
 * and a scroll frame on a 15k-paragraph file. Here one scroll handler picks the range.
 *
 * The range is top-level child indices [from, to), snapped to STEP so small scrolls don't redraw.
 * Skipped paragraphs keep the height they last drew at (contain-intrinsic-size: auto).
 */
type Win = { from: number; to: number; decos: DecorationSet };
export const windowKey = new PluginKey<Win>('window');
const FIRST = 80; // drawn before the first measure: the top of a just-opened file
const STEP = 24;
const MARGIN = 1; // screens drawn above and below the visible one

function decorate(doc: PMNode, from: number, to: number): DecorationSet {
  const decos: Decoration[] = [];
  const end = Math.min(to, doc.childCount);
  let pos = 0;
  for (let i = 0; i < end; i++) {
    const n = doc.child(i);
    if (i >= from) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'f-near' }));
    pos += n.nodeSize;
  }
  return DecorationSet.create(doc, decos);
}

/** Typing maps the marks along (the next measure squares the range up), then re-marks the paragraphs
 *  the edit touched: mapping drops the mark from a paragraph Enter splits or Backspace joins (its edge
 *  moves), and the next measure finds the range unchanged, so it stayed skipped (blank) once the caret
 *  left it. Not decorate(): DecorationSet.create costs ~4 ms a key on a 15k-paragraph file. */
function remark(tr: Transaction, v: Win): DecorationSet {
  const doc = tr.doc;
  let decos = v.decos.map(tr.mapping, doc);
  let lo = Infinity, hi = -Infinity;
  tr.mapping.maps.forEach((m, i) => m.forEach((_a, _b, start, end) => {
    const rest = tr.mapping.slice(i + 1);
    lo = Math.min(lo, rest.map(start, -1));
    hi = Math.max(hi, rest.map(end, 1));
  }));
  if (lo > hi || !doc.childCount) return decos;
  const a = doc.resolve(Math.min(lo, doc.content.size)).index(0);
  const b = Math.min(doc.resolve(Math.min(hi, doc.content.size)).index(0), doc.childCount - 1);
  // a wide edit (replace all, a long paste): each find/remove below scans every mark, so rebuild once
  if (b - a > 64) return decorate(doc, v.from, v.to);
  let pos = doc.resolve(Math.min(lo, doc.content.size)).posAtIndex(a, 0);
  const add: Decoration[] = [];
  for (let i = a; i <= b; i++) {
    const n = doc.child(i);
    // find() also returns the neighbours' marks that only touch this paragraph's edges
    decos = decos.remove(decos.find(pos, pos + n.nodeSize).filter((d) => d.from < pos + n.nodeSize && d.to > pos));
    if (i >= v.from && i < v.to) add.push(Decoration.node(pos, pos + n.nodeSize, { class: 'f-near' }));
    pos += n.nodeSize;
  }
  return add.length ? decos.add(doc, add) : decos;
}

/** The top-level child range near the screen, or null when it can't be measured (not laid out). */
function nearRange(view: EditorView, sc: HTMLElement): { from: number; to: number } | null {
  const doc = view.state.doc, n = doc.childCount;
  const kids = view.dom.children;
  // the footnote list is a widget after the last paragraph; anything else extra and we can't index by DOM
  if (kids.length < n) return null;
  const box = sc.getBoundingClientRect();
  if (!box.height) return null;
  const top = box.top - box.height * MARGIN, bottom = box.bottom + box.height * MARGIN;
  // first child whose bottom is below `top`, first child whose top is below `bottom`
  const search = (y: number, edge: 'top' | 'bottom') => {
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const r = (kids[mid] as HTMLElement).getBoundingClientRect();
      if ((edge === 'bottom' ? r.bottom : r.top) < y) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const a = search(top, 'bottom'), b = search(bottom, 'top');
  return { from: Math.max(0, Math.floor(a / STEP) * STEP), to: Math.min(n, Math.ceil((b + 1) / STEP) * STEP) };
}

export const WINDOW_META = 'falcon-window';

export const windowPlugin = new Plugin<Win>({
  key: windowKey,
  state: {
    init: (_, state) => ({ from: 0, to: FIRST, decos: decorate(state.doc, 0, FIRST) }),
    apply(tr, v) {
      const w = tr.getMeta(windowKey) as { from: number; to: number } | undefined;
      if (w) return { ...w, decos: decorate(tr.doc, w.from, w.to) };
      return tr.docChanged ? { ...v, decos: remark(tr, v) } : v;
    },
  },
  props: { decorations: (state) => windowKey.getState(state)!.decos },
  view(view) {
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      const sc = view.dom.closest('.f-scroll') as HTMLElement | null;
      if (!sc || !view.dom.isConnected) return;
      const r = nearRange(view, sc);
      const cur = windowKey.getState(view.state)!;
      if (r && (r.from !== cur.from || r.to !== cur.to)) view.dispatch(view.state.tr.setMeta(windowKey, r).setMeta(WINDOW_META, true).setMeta('addToHistory', false));
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(measure); };
    // scroll events come before the frame is drawn: measuring here draws the new paragraphs in that same frame
    const onScroll = (e: Event) => { if (e.target instanceof Node && e.target.contains(view.dom)) measure(); };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    // the page changed height (typing, zoom, a new window width, another doc swapped in)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon);
    ro?.observe(view.dom);
    soon();
    return {
      update(v, prev) { if (v.state.doc !== prev.doc) soon(); },
      destroy() { cancelAnimationFrame(raf); ro?.disconnect(); document.removeEventListener('scroll', onScroll, { capture: true }); },
    };
  },
});
