import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { Decoration, DecorationSet, type EditorView, type NodeView, type NodeViewConstructor } from 'prosemirror-view';
import { isReading } from './read';

/**
 * The paragraphs near the screen, drawn; the rest skipped (styles.css: `content-visibility: hidden`
 * unless `.f-near`). The browser's own `content-visibility: auto` does the same, but it watches every
 * paragraph with an intersection observer and re-checks all of them after each layout: ~18 ms a key
 * and a scroll frame on a 15k-paragraph file. Here one scroll handler picks the range.
 *
 * The range is top-level child indices [from, to), snapped to STEP so small scrolls don't redraw.
 *
 * A skipped plain paragraph isn't built at all: it is an empty element of its own tag and style (a node
 * view with no content), sized to the height it last drew at, or to an estimate from its text. Building
 * every paragraph's spans was most of the cost of a big file: 428k DOM nodes for 15k paragraphs, and
 * every style recalc, GC and tab switch walked them. Paragraphs holding pictures or footnotes, and
 * tables, are built as before and skipped by content-visibility alone.
 */
type Win = { from: number; to: number; decos: DecorationSet };
export const windowKey = new PluginKey<Win>('window');
const FIRST = 80; // drawn before the first measure: the top of a just-opened file
const STEP = 24;
const MARGIN = 1; // screens drawn above and below the visible one

/** Spec of the decorations that make a paragraph drawn for real: f-near here, f-live (the selection's paragraphs) in editor.ts. */
export const NEAR = { near: true };
const isNear = (decos: readonly Decoration[]) => decos.some((d) => d.spec.near);

/** Heights (unzoomed CSS px, border box) of paragraphs drawn before, and the page width then. Keyed by
 *  node: an unchanged paragraph keeps its node across edits and tab switches, so a file switched back to
 *  comes back at the same heights and its scroll position lands on the same text. Estimates are kept
 *  too, for the same reason. */
const heights = new WeakMap<PMNode, { h: number; w: number }>();
/** Each view's page width at its last measure (read there: reading layout while building would force it per paragraph). */
const widths = new WeakMap<EditorView, number>();
/** Per paragraph style: one line's height (px), and height × page width per character. Fitted to five real
 *  files (31k paragraphs) at the default font: the estimated page comes out within 4% of the real one. */
const EST: Record<string, { h1: number; r: number }> = {
  normal: { h1: 19, r: 130 }, undertag: { h1: 19, r: 130 }, tag: { h1: 19.9, r: 169 }, analytic: { h1: 22.5, r: 211 },
  block: { h1: 23.5, r: 260 }, hat: { h1: 32.2, r: 400 }, pocket: { h1: 56.9, r: 700 },
};

/** Characters, each scaled by its font size (a card's shrunk text fits more on a line). */
function chars(node: PMNode): number {
  let c = 0;
  node.forEach((t) => {
    const size = t.marks.find((m) => m.type.name === 'size');
    c += (t.text?.length ?? 0) * (size ? size.attrs.pt / 11 : 1);
  });
  return c;
}

function heightOf(node: PMNode, view: EditorView): number {
  const w = widths.get(view) ?? 0, known = heights.get(node);
  if (known && (!w || known.w === w)) return known.h;
  const s = EST[node.attrs.style] ?? EST.normal, width = w || 1000;
  const h = Math.max(s.h1, (s.r * chars(node)) / width);
  heights.set(node, { h, w: width });
  return h;
}

/** Remember the drawn heights of paragraphs [from, to) that are about to be skipped. */
function remember(view: EditorView, from: number, to: number, keep: { from: number; to: number }) {
  if (isReading(view.state)) return; // read mode hides most text and runs paragraphs together: its heights aren't the page's
  const doc = view.state.doc, kids = view.dom.children, w = widths.get(view)!;
  // the page's CSS zoom, exactly: rect / offsetHeight is off by up to half a pixel in the whole page's height, and that
  // error in 24 stored heights moves everything below a fraction of a pixel, which redraws every tile on screen
  const z = (view.dom as { currentCSSZoom?: number }).currentCSSZoom ?? (view.dom.getBoundingClientRect().height / (view.dom.offsetHeight || 1) || 1);
  for (let i = from; i < Math.min(to, doc.childCount); i++) {
    if (i >= keep.from && i < keep.to) continue;
    const el = kids[i] as HTMLElement, n = doc.child(i);
    if (n.type.name !== 'paragraph' || el.classList.contains('f-far')) continue;
    heights.set(n, { h: el.getBoundingClientRect().height / z, w });
  }
}

/** Top-level children's start positions, per doc: a paragraph view has to know it isn't in a table cell. */
const starts = new WeakMap<PMNode, Uint32Array>();
function startsOf(doc: PMNode): Uint32Array {
  let s = starts.get(doc);
  if (!s) {
    s = new Uint32Array(doc.childCount);
    let p = 0;
    for (let i = 0; i < s.length; i++) { s[i] = p; p += doc.child(i).nodeSize; }
    starts.set(doc, s);
  }
  return s;
}
function topLevel(doc: PMNode, pos: number, node: PMNode): boolean {
  const s = startsOf(doc);
  let lo = 0, hi = s.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid] < pos) lo = mid + 1; else if (s[mid] > pos) hi = mid - 1; else return doc.child(mid) === node;
  }
  return false;
}

const plain = (node: PMNode) => { let ok = true; node.forEach((c) => { if (!c.isText) ok = false; }); return ok; };

/** A top-level paragraph: drawn (its own DOM, with content) while near, an empty placeholder of the same
 *  tag and classes while far. Either one gives way to the other when the near mark comes or goes. */
const paragraphView: NodeViewConstructor = (node, view, getPos, decos) => {
  const pos = getPos();
  // cell paragraphs draw the default way: null falls back to toDOM
  if (pos === undefined || !topLevel(view.state.doc, pos, node)) return null as unknown as NodeView;
  const { dom, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
  if (isNear(decos)) {
    let cur = node;
    return { dom, contentDOM, update: (n, d) => isNear(d) && n.sameMarkup(cur) && ((cur = n), true) };
  }
  const el = dom as HTMLElement;
  el.style.height = `${heightOf(node, view)}px`;
  // one holding pictures, footnotes or breaks is built as before and skipped by content-visibility alone, at the
  // height it drew at: it's a new element, which the browser has no remembered size for (it would be 1.3em)
  if (!plain(node)) { el.style.boxSizing = 'border-box'; return { dom, contentDOM, update: (n, d) => n === node && !isNear(d) }; }
  el.classList.add('f-far');
  return { dom, update: (n, d) => n === node && !isNear(d) };
};

/** A set of node decorations on top-level paragraphs only. On every redraw ProseMirror asks each set, for each top-level
 *  child, for the decorations inside it, and a DecorationSet answers by scanning all of its own: 15k children times
 *  ~70 near marks a key. A node decoration is never inside its node, so here the answer is always none. */
class TopSet extends (DecorationSet as unknown as new (local: Decoration[], children: never[]) => DecorationSet) {
  forChild() { return DecorationSet.empty; }
}
/** `decos`: node decorations, each exactly on one top-level child (as DecorationSet.create would check). */
export const topSet = (decos: Decoration[]): DecorationSet =>
  decos.length ? new TopSet(decos.sort((x, y) => x.from - y.from || x.to - y.to), []) : DecorationSet.empty;

function decorate(doc: PMNode, from: number, to: number): DecorationSet {
  const decos: Decoration[] = [];
  const end = Math.min(to, doc.childCount);
  let pos = 0;
  for (let i = 0; i < end; i++) {
    const n = doc.child(i);
    if (i >= from) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'f-near' }, NEAR));
    pos += n.nodeSize;
  }
  return topSet(decos);
}

/** Typing maps the marks along (the next measure squares the range up), then re-marks the paragraphs
 *  the edit touched: mapping drops the mark from a paragraph Enter splits or Backspace joins (its edge
 *  moves), and the next measure finds the range unchanged, so it stayed skipped (blank) once the caret
 *  left it. Not decorate(): it marks by index, so paragraphs added above the screen would move the marks off it. */
function remark(tr: Transaction, v: Win): DecorationSet {
  const doc = tr.doc;
  let decos = v.decos.map(tr.mapping, doc);
  let lo = Infinity, hi = -Infinity;
  tr.mapping.maps.forEach((m, i) => m.forEach((_a, _b, start, end) => {
    const rest = tr.mapping.slice(i + 1);
    lo = Math.min(lo, rest.map(start, -1));
    hi = Math.max(hi, rest.map(end, 1));
  }));
  if (lo > hi || !doc.childCount) return topSet(decos.find());
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
    if (i >= v.from && i < v.to) add.push(Decoration.node(pos, pos + n.nodeSize, { class: 'f-near' }, NEAR));
    pos += n.nodeSize;
  }
  return topSet((add.length ? decos.add(doc, add) : decos).find());
}

/** The top-level child range near the screen, or null when it can't be measured (not laid out): [a, b) unsnapped,
 *  [from, to) snapped. `top` is the first child starting on screen, the one kept in place when the range changes. */
function nearRange(view: EditorView, sc: HTMLElement): { a: number; b: number; from: number; to: number; top: number } | null {
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
  const a = search(top, 'bottom'), b = Math.min(n, search(bottom, 'top') + 1);
  return { a, b, from: Math.max(0, Math.floor(a / STEP) * STEP), to: Math.min(n, Math.ceil(b / STEP) * STEP), top: Math.min(search(box.top, 'top'), n - 1) };
}

/** Start of the top-level child at height `y` (client px): the first one whose bottom is below it, as the browser's own
 *  hit test picks in the gap between two (where text would land, the outline wants only the paragraph). The end of the
 *  doc below the last one. A few rects, not posAtCoords's hit test. Null when children can't be indexed by DOM, or in
 *  read mode, which hides paragraphs (no box: the rects stop being in order) and runs others inline. */
export function topChildAt(view: EditorView, y: number): number | null {
  const doc = view.state.doc, n = doc.childCount, kids = view.dom.children;
  if (kids.length < n || isReading(view.state)) return null;
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (kids[mid].getBoundingClientRect().bottom <= y) lo = mid + 1; else hi = mid;
  }
  return lo >= n ? doc.content.size : startsOf(doc)[lo];
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
  props: { decorations: (state) => windowKey.getState(state)!.decos, nodeViews: { paragraph: paragraphView } },
  view(view) {
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      const sc = view.dom.closest('.f-scroll') as HTMLElement | null;
      if (!sc || !view.dom.isConnected) return;
      widths.set(view, view.dom.clientWidth);
      // real paragraphs drawn over estimates move the page, so the range is measured again until it holds, here
      // rather than on the next frame: a screen that came up short of drawn paragraphs fills in before it's shown blank
      for (let k = 0; k < 3; k++) {
        const r = nearRange(view, sc);
        const cur = windowKey.getState(view.state)!;
        // The range stays while it covers what's near and isn't two steps too wide at either end; each end moves on its
        // own, one redraw (every redraw walks all 15k paragraphs) when it runs out or gets too wide. Not both ends in one
        // frame: on a 15k-paragraph file that rasters ~40% more tiles, as if what the frame redraws became one box from
        // the text dropped above the screen to the text added below it, the screen included
        const keep = (slack: number) => slack >= 0 && slack < 2 * STEP;
        if (!r || (keep(r.a - cur.from) && keep(cur.to - r.b))) return;
        const next = { from: keep(r.a - cur.from) ? cur.from : r.from, to: keep(cur.to - r.b) ? cur.to : r.to };
        remember(view, cur.from, cur.to, next);
        const y = view.dom.children[r.top].getBoundingClientRect().top;
        view.dispatch(view.state.tr.setMeta(windowKey, next).setMeta(WINDOW_META, true).setMeta('addToHistory', false));
        // paragraphs above the screen just changed from estimates to real heights: keep the text on screen where it was.
        // By index, since the anchor itself may have been a placeholder that got replaced (a scrollbar drag)
        const now = view.dom.children[r.top];
        const d = now ? now.getBoundingClientRect().top - y : 0;
        if (Math.abs(d) >= 1) sc.scrollTop += d;
      }
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
