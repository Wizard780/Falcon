import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { levelOf, schema } from './schema';
import { P, pref } from './prefs';
import { scrollToTop } from './nav/sections';
import './card-links.css';

/**
 * Card links: a card's cite name typed anywhere in the file ("extend Clare 23") links to that card.
 * Hover shows a preview, a click goes to the card, and Back (Mod-[) returns. Nothing is stored in the
 * document: the names are matched as you hover, and drawn with the CSS Custom Highlight API, so
 * ProseMirror's DOM and decorations never change for them and typing pays nothing.
 *
 * Settings > Editor > Card links: Quiet (an underline only under the pointer, a dark preview),
 * Page slice (every linked name on screen dotted, the preview a piece of the page), or Off.
 */
export type CardRef = { pos: number; end: number; name: string };
type Index = { cards: Map<string, CardRef[]>; re: RegExp | null };

const YEAR = /^(\d{4}|\d{2})$/;
/** "Clare 23", "Clare '23", "Clare, 2023", "Smith and Jones 22" → name and two-digit year. */
export function parseCite(text: string): { name: string; year: string } | null {
  const m = /^\s*(\p{L}[\p{L}'’.\- &]*?)[\s,]+['’]?(\d{4}|\d{2})(?!\p{N})/u.exec(text);
  if (!m) return null;
  const name = m[1].trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40) return null;
  return { name, year: m[2].slice(-2) };
}
const keyOf = (name: string, year: string) => `${name.toLowerCase().replace(/[’]/g, "'")} ${year}`;

const cite = schema.marks.cite;
/** The first run of cite-marked text in a paragraph. */
function citeRun(n: PMNode): string {
  let s = '', open = true;
  n.forEach((t) => {
    if (!open) return;
    if (t.isText && cite.isInSet(t.marks)) s += t.text;
    else if (s) open = false;
  });
  return s;
}
const hasCite = (n: PMNode) => { let y = false; n.forEach((t) => { if (cite.isInSet(t.marks)) y = true; }); return y; };

const built = new WeakMap<PMNode, Index>();
let lastAlt = '', lastRe: RegExp | null = null; // typing rarely changes the names: keep the compiled pattern
/** Every card's cite name → the cards with it, in file order. A card's cite line is the first non-empty,
 *  non-undertag paragraph after its tag (after an analytic only when it has cite-marked text). */
export function cardIndex(doc: PMNode): Index {
  const known = built.get(doc);
  if (known) return known;
  const cards = new Map<string, CardRef[]>();
  const names = new Set<string>();
  let head: { node: PMNode; pos: number; done: boolean } | null = null;
  let last: CardRef | null = null;
  doc.forEach((n, pos) => {
    const level = levelOf(n);
    if (level) {
      if (last) last.end = pos;
      last = null;
      head = level === 4 ? { node: n, pos, done: false } : null;
      return;
    }
    if (!head || head.done || n.attrs.style === 'undertag' || n.content.size === 0) return;
    head.done = true;
    if (head.node.attrs.style !== 'tag' && !hasCite(n)) return;
    const c = parseCite(citeRun(n));
    if (!c) return;
    const k = keyOf(c.name, c.year);
    last = { pos: head.pos, end: doc.content.size, name: `${c.name} ${c.year}` };
    cards.set(k, [...(cards.get(k) ?? []), last]);
    names.add(c.name);
  });
  const alt = [...names].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+').replace(/'/g, "['’]")).join('|');
  if (alt !== lastAlt) { lastAlt = alt; lastRe = alt ? new RegExp(`(?<![\\p{L}\\p{N}])(${alt})[\\s,]+['’]?(\\d{4}|\\d{2})(?![\\p{L}\\p{N}])`, 'giu') : null; }
  const idx: Index = { cards, re: lastRe };
  built.set(doc, idx);
  return idx;
}

export type Ref = { from: number; to: number; cards: CardRef[] };
/** The linked names in one textblock starting at `start` (its content's first position). Cite-marked text is a cite, not a reference. */
export function refsIn(doc: PMNode, para: PMNode, start: number, idx = cardIndex(doc)): Ref[] {
  if (!idx.re || !para.isTextblock) return [];
  const text = para.textBetween(0, para.content.size, undefined, '\uFFFC');
  const out: Ref[] = [];
  for (const m of text.matchAll(idx.re)) {
    if (!YEAR.test(m[2]) || (m[2].length === 4 && !/^(19|20)/.test(m[2]))) continue;
    const cards = idx.cards.get(keyOf(m[1].replace(/\s+/g, ' '), m[2].slice(-2)));
    if (!cards) continue;
    const from = start + m.index!, to = from + m[0].length;
    if (doc.rangeHasMark(from, to, cite)) continue;
    out.push({ from, to, cards });
  }
  return out;
}
/** The linked name at a document position, if any. */
export function refAt(doc: PMNode, pos: number): Ref | null {
  const $p = doc.resolve(pos);
  if (!$p.parent.isTextblock) return null;
  return refsIn(doc, $p.parent, $p.start()).find((r) => pos >= r.from && pos <= r.to) ?? null;
}

// ---------------------------------------------------------------- state: Back, and the card that just got jumped to

type St = { back: number[]; flash: [number, number] | null };
export const cardLinksKey = new PluginKey<St>('cardLinks');
type Meta = { push?: number; pop?: true; flash?: [number, number] | null };

export const canGoBack = (state: EditorState) => !!cardLinksKey.getState(state)?.back.length;
const tops = new WeakMap<EditorView, number[]>(); // scroll offsets beside the back stack
const scroller = (view: EditorView) => view.dom.closest('.f-scroll') as HTMLElement | null;

/** Go to a card: the cursor to its tag, the page scrolled to it (the app's smooth scroll when it listens), and a short flash. */
export function goToCard(view: EditorView, card: CardRef) {
  const { state } = view;
  const t = tops.get(view) ?? [];
  t.push(scroller(view)?.scrollTop ?? 0);
  tops.set(view, t.slice(-20));
  const tr = state.tr.setSelection(TextSelection.create(state.doc, card.pos + 1))
    .setMeta(cardLinksKey, { push: state.selection.head, flash: [card.pos, card.end] } satisfies Meta);
  view.dispatch(tr);
  view.focus();
  const ev = new CustomEvent('falcon-scroll-to', { detail: { view, pos: card.pos }, cancelable: true });
  if (dispatchEvent(ev)) scrollToTop(view, card.pos);
  setTimeout(() => {
    if (!view.isDestroyed && cardLinksKey.getState(view.state)?.flash) view.dispatch(view.state.tr.setMeta(cardLinksKey, { flash: null }).setMeta('addToHistory', false));
  }, 1200);
}

/** Back to where the last card link was clicked. */
export const linkBack: Command = (state, dispatch, view) => {
  const st = cardLinksKey.getState(state);
  if (!st?.back.length) return false;
  if (dispatch) {
    const pos = Math.min(st.back[st.back.length - 1], state.doc.content.size);
    dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))).setMeta(cardLinksKey, { pop: true, flash: null } satisfies Meta));
    if (view) {
      const t = tops.get(view) ?? [];
      const top = t.pop();
      const sc = scroller(view);
      if (sc && top != null) sc.scrollTop = top;
      view.focus();
    }
  }
  return true;
};

// ---------------------------------------------------------------- the view: hover, preview, click

type Mode = 'quiet' | 'page' | 'off';
const mode = (): Mode => pref(P.cardLinks);
const HL = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
/** Page slice's dots per view: one highlight for the page, so files side by side (Join) each keep theirs. */
const dots = new Map<EditorView, Range[]>();
function setDots(view: EditorView, ranges: Range[] | null) {
  if (ranges?.length) dots.set(view, ranges); else dots.delete(view);
  if (!dots.size) CSS.highlights.delete('falcon-ref');
  else CSS.highlights.set('falcon-ref', new Highlight(...[...dots.values()].flat()));
}

function domRange(view: EditorView, from: number, to: number): Range | null {
  try {
    const a = view.domAtPos(from), b = view.domAtPos(to);
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  } catch { return null; }
}
const inside = (r: Range, x: number, y: number) => [...r.getClientRects()].some((c) => x >= c.left - 1 && x <= c.right + 1 && y >= c.top - 1 && y <= c.bottom + 1);

/** The linked name under the pointer: the position's name, and the point really on its text (not past the line's end). */
function hit(view: EditorView, x: number, y: number): { ref: Ref; range: Range } | null {
  const p = view.posAtCoords({ left: x, top: y });
  if (!p) return null;
  const ref = refAt(view.state.doc, p.pos);
  if (!ref) return null;
  const range = domRange(view, ref.from, ref.to);
  return range && inside(range, x, y) ? { ref, range } : null;
}

const serializer = DOMSerializer.fromSchema(schema);
/** The nearest pocket, hat or block above `pos`: where the card sits, for the preview's corner. */
function section(doc: PMNode, pos: number): string {
  let s = '';
  doc.forEach((n, p) => { if (p < pos && levelOf(n) && levelOf(n) < 4) s = n.textContent.trim(); });
  return s;
}

function previewOne(doc: PMNode, card: CardRef, m: Mode): HTMLElement {
  const box = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'cl-h';
  head.innerHTML = '<span></span><span>Click to open</span>';
  (head.firstChild as HTMLElement).textContent = section(doc, card.pos);
  const page = document.createElement('div');
  page.className = 'cl-card';
  let n = 0;
  doc.nodesBetween(card.pos, card.end, (node, pos) => {
    if (pos < card.pos || n >= 6) return false;
    page.appendChild(serializer.serializeNode(node));
    n++;
    return false;
  });
  if (m === 'page') box.append(page, head); else box.append(head, page);
  return box;
}

function previewMany(view: EditorView, cards: CardRef[], pick: (c: CardRef) => void): HTMLElement {
  const box = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'cl-h';
  head.innerHTML = `<span>${cards.length} cards named </span><span>Pick one</span>`;
  head.firstChild!.textContent += cards[0].name;
  box.appendChild(head);
  const doc = view.state.doc;
  for (const c of cards) {
    const it = document.createElement('button');
    it.className = 'cl-it';
    const tag = document.createElement('b');
    tag.textContent = doc.nodeAt(c.pos)?.textContent ?? '';
    const sub = document.createElement('span');
    let citeLine = '';
    doc.nodesBetween(c.pos, c.end, (node, pos) => { if (pos > c.pos && !citeLine && node.attrs.style !== 'undertag' && node.content.size) citeLine = node.textContent; return false; });
    sub.textContent = citeLine.length > 140 ? citeLine.slice(0, 140) + '…' : citeLine;
    it.append(tag, sub);
    it.addEventListener('mousedown', (e) => e.preventDefault());
    it.addEventListener('click', () => pick(c));
    box.appendChild(it);
  }
  return box;
}

class LinkView {
  pv: HTMLElement;
  hot: Ref | null = null;
  shown: Ref | null = null;
  timer = 0;
  hideTimer = 0;
  raf = 0;
  sc: HTMLElement | null;
  constructor(readonly view: EditorView) {
    this.pv = document.createElement('div');
    this.pv.className = 'cl-pv';
    this.pv.addEventListener('mouseenter', () => clearTimeout(this.hideTimer));
    this.pv.addEventListener('mouseleave', () => this.hideSoon());
    this.pv.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's focus
    this.pv.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.cl-it')) return;
      if (this.shown?.cards.length === 1) this.go(this.shown.cards[0]);
    });
    document.body.appendChild(this.pv);
    document.addEventListener('mouseup', this.up);
    this.sc = scroller(view);
    this.sc?.addEventListener('scroll', this.onScroll, { passive: true });
    this.paintSoon();
  }
  press: { x: number; y: number; ref: Ref } | null = null;
  down(e: MouseEvent) {
    this.press = null;
    if (mode() === 'off' || e.button !== 0 || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.detail > 1) return;
    const h = hit(this.view, e.clientX, e.clientY);
    if (h) this.press = { x: e.clientX, y: e.clientY, ref: h.ref };
  }
  up = (e: MouseEvent) => {
    const p = this.press;
    this.press = null;
    if (!p || e.button !== 0 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4 || !this.view.state.selection.empty) return;
    const h = hit(this.view, e.clientX, e.clientY);
    if (!h || h.ref.from !== p.ref.from) return;
    if (h.ref.cards.length > 1) { this.setHot(h.ref, h.range); this.show(h.ref, h.range); }
    else this.go(h.ref.cards[0]);
  };
  onScroll = () => { this.hide(); this.setHot(null); this.paintSoon(); };
  go(card: CardRef) { this.hide(); this.setHot(null); goToCard(this.view, card); }

  move(e: MouseEvent) {
    if (mode() === 'off' || e.buttons) { this.setHot(null); return; }
    const h = hit(this.view, e.clientX, e.clientY);
    if (!h) { if (this.hot) { this.setHot(null); clearTimeout(this.timer); this.hideSoon(); } return; }
    clearTimeout(this.hideTimer);
    if (this.hot && this.hot.from === h.ref.from && this.hot.to === h.ref.to) return;
    this.setHot(h.ref, h.range);
    clearTimeout(this.timer);
    if (this.shown) this.show(h.ref, h.range);
    else this.timer = window.setTimeout(() => { if (this.hot === h.ref) this.show(h.ref, h.range); }, 450);
  }
  setHot(ref: Ref | null, range?: Range) {
    this.hot = ref;
    this.view.dom.classList.toggle('cl-pointer', !!ref);
    if (!HL) return;
    if (ref && range) CSS.highlights.set('falcon-ref-hot', new Highlight(range));
    else CSS.highlights.delete('falcon-ref-hot');
  }
  show(ref: Ref, range: Range) {
    const m = mode();
    this.shown = ref;
    this.pv.className = `cl-pv ${m === 'page' ? 'cl-page' : 'cl-quiet'}${ref.cards.length > 1 ? ' cl-many' : ''}`;
    this.pv.replaceChildren(ref.cards.length > 1 ? previewMany(this.view, ref.cards, (c) => this.go(c)) : previewOne(this.view.state.doc, ref.cards[0], m));
    const rects = [...range.getClientRects()];
    const r = rects[rects.length - 1] ?? range.getBoundingClientRect();
    const w = this.pv.offsetWidth, h = this.pv.offsetHeight;
    const x = Math.max(12, Math.min(r.left, innerWidth - w - 12));
    let y = r.bottom + 8;
    if (y + h > innerHeight - 12) y = Math.max(12, (rects[0] ?? r).top - h - 8);
    this.pv.style.left = `${x}px`;
    this.pv.style.top = `${y}px`;
    this.pv.classList.add('cl-on');
  }
  hideSoon() { clearTimeout(this.hideTimer); this.hideTimer = window.setTimeout(() => this.hide(), 200); }
  hide() { clearTimeout(this.timer); this.shown = null; this.pv.classList.remove('cl-on'); }

  /** Page slice: dot every linked name in the paragraphs on screen. */
  paintSoon() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); }); }
  paint() {
    if (!HL) return;
    const view = this.view;
    if (mode() !== 'page' || !this.sc || !view.dom.isConnected) { if (dots.has(view)) setDots(view, null); return; }
    const box = this.sc.getBoundingClientRect(), left = view.dom.getBoundingClientRect().left + 4;
    const a = view.posAtCoords({ left, top: box.top + 2 })?.pos ?? 0;
    const b = view.posAtCoords({ left, top: box.bottom - 2 })?.pos ?? view.state.doc.content.size;
    const doc = view.state.doc, idx = cardIndex(doc), ranges: Range[] = [];
    if (idx.re) doc.nodesBetween(Math.max(0, a - 2000), Math.min(doc.content.size, b + 2000), (n, pos) => {
      if (!n.isTextblock) return true;
      for (const r of refsIn(doc, n, pos + 1, idx)) { const d = domRange(view, r.from, r.to); if (d) ranges.push(d); }
      return false;
    });
    setDots(view, ranges);
  }
  update(view: EditorView, prev: EditorState) {
    if (view.state.doc !== prev.doc) { this.hide(); this.setHot(null); }
    this.paintSoon();
  }
  destroy() {
    clearTimeout(this.timer); clearTimeout(this.hideTimer); cancelAnimationFrame(this.raf);
    this.sc?.removeEventListener('scroll', this.onScroll);
    this.pv.remove();
    document.removeEventListener('mouseup', this.up);
    if (HL) { setDots(this.view, null); if (this.hot) CSS.highlights.delete('falcon-ref-hot'); }
  }
}

const views = new WeakMap<EditorView, LinkView>();

export const cardLinksPlugin = new Plugin<St>({
  key: cardLinksKey,
  state: {
    init: () => ({ back: [], flash: null }),
    apply(tr, prev) {
      const m = tr.getMeta(cardLinksKey) as Meta | undefined;
      let back = tr.docChanged ? prev.back.map((p) => tr.mapping.map(p)) : prev.back;
      let flash = prev.flash && tr.docChanged ? [tr.mapping.map(prev.flash[0]), tr.mapping.map(prev.flash[1])] as [number, number] : prev.flash;
      if (!m) return back === prev.back && flash === prev.flash ? prev : { back, flash };
      if (m.push != null) back = [...back, m.push].slice(-20);
      if (m.pop) back = back.slice(0, -1);
      if (m.flash !== undefined) flash = m.flash;
      return { back, flash };
    },
  },
  view(view) { const v = new LinkView(view); views.set(view, v); return v; },
  props: {
    attributes: () => ({ 'data-card-links': mode() }),
    decorations(state) {
      const f = cardLinksKey.getState(state)?.flash;
      if (!f) return null;
      const decos: Decoration[] = [];
      state.doc.forEach((n, pos) => { if (pos >= f[0] && pos < f[1]) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'cl-flash' })); });
      return DecorationSet.create(state.doc, decos);
    },
    handleDOMEvents: {
      // a click is caught here and on mouseup, not by handleClick: mouse.ts takes mousedown over for word selection,
      // so ProseMirror's own click handling never runs
      mousedown: (view, e) => { views.get(view)?.down(e); return false; },
      mousemove: (view, e) => { views.get(view)?.move(e); return false; },
      mouseleave: (view) => { const v = views.get(view); if (v) { v.setHot(null); v.hideSoon(); } return false; },
      keydown: (view) => { const v = views.get(view); if (v?.shown) v.hide(); return false; },
    },
  },
});
