import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { cardAround } from '../commands';
import { isReading } from '../read';
import { levelOf, moveSections, sectionAt, type Section } from './sections';

/**
 * Drag a card or heading section on the page. Hovering a card shows a grip in the margin beside its
 * heading; dragging the grip shows a line where it would land, only at places the structure allows
 * (a card among cards, a block among blocks). Alt-drag on macOS, Ctrl-drag elsewhere, copies.
 */
const key = new PluginKey<Section | null>('page-drag');
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const copyModifier = (e: { altKey: boolean; ctrlKey: boolean }) => (IS_MAC ? e.altKey : e.ctrlKey);

const GRIP = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></g></svg>';

function dragView(view: EditorView) {
  const host = view.dom.parentElement!;
  host.style.position = 'relative';
  const grip = document.createElement('div');
  grip.className = 'f-grip';
  grip.title = `Drag to move this card or section. ${IS_MAC ? 'Option' : 'Ctrl'}-drag copies it`;
  grip.innerHTML = GRIP;
  const line = document.createElement('div');
  line.className = 'f-drop-line';
  host.append(grip, line);
  let head = -1; // the heading the grip belongs to

  const hideGrip = () => { grip.style.display = 'none'; head = -1; };
  hideGrip();
  line.style.display = 'none';

  // the grip sits beside the heading of whatever card or section the pointer is over
  const onMove = (e: MouseEvent) => {
    if (dragging || isReading(view.state) || !view.editable) return;
    let el = e.target as HTMLElement | null;
    while (el && el.parentElement !== view.dom) el = el.parentElement;
    if (!el) return;
    const doc = view.state.doc;
    let pos: number;
    try { pos = view.posAtDOM(el, 0); } catch { return; }
    const $p = doc.resolve(Math.min(pos, doc.content.size));
    if ($p.depth < 1) return;
    const c = cardAround(doc, pos);
    if (!c) { hideGrip(); return; }
    let h = $p.before(1);
    for (let i = $p.index(0) - 1; i >= c.head; i--) h -= doc.child(i).nodeSize;
    if (h === head) return;
    const dom = view.nodeDOM(h) as HTMLElement | null;
    if (!dom) return;
    head = h;
    grip.style.display = '';
    const lh = Math.min(dom.offsetHeight, parseFloat(getComputedStyle(dom).lineHeight) || 20);
    grip.style.top = `${dom.offsetTop + lh / 2 - 9}px`;
  };
  view.dom.addEventListener('mousemove', onMove);

  // ---- dragging ----
  let dragging: { sec: Section; gaps: number[]; target: number | null; y: number; raf: number } | null = null;
  const zoom = () => host.getBoundingClientRect().height / (host.offsetHeight || 1) || 1;
  const gapY = (pos: number) => {
    const doc = view.state.doc;
    if (pos >= doc.content.size) { const last = view.dom.lastElementChild as HTMLElement; return last.getBoundingClientRect().bottom; }
    return (view.nodeDOM(pos) as HTMLElement).getBoundingClientRect().top;
  };
  const aim = () => {
    if (!dragging) return;
    const { gaps, sec, y } = dragging;
    // DOM order is document order: binary search the first allowed gap below the pointer
    let lo = 0, hi = gaps.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (gapY(gaps[mid]) < y) lo = mid + 1; else hi = mid; }
    const near = [gaps[lo - 1], gaps[lo]].filter((g) => g !== undefined);
    let best: number | null = null;
    for (const g of near) if (best === null || Math.abs(gapY(g) - y) < Math.abs(gapY(best) - y)) best = g;
    const noop = best === sec.from || best === sec.to;
    dragging.target = best;
    if (best === null || noop) { line.style.display = 'none'; return; }
    line.style.display = '';
    line.style.top = `${(gapY(best) - host.getBoundingClientRect().top) / zoom() - 1}px`;
  };
  const scroller = () => view.dom.closest('.f-scroll') as HTMLElement | null;
  const tick = () => {
    if (!dragging) return;
    const sc = scroller();
    if (sc) {
      const r = sc.getBoundingClientRect(), y = dragging.y;
      const d = y < r.top + 48 ? -(r.top + 48 - y) : y > r.bottom - 48 ? y - (r.bottom - 48) : 0;
      if (d) { sc.scrollTop += Math.max(-24, Math.min(24, d / 2)); aim(); }
    }
    dragging.raf = requestAnimationFrame(tick);
  };
  const finish = (drop: boolean, copy = false) => {
    if (!dragging) return;
    const { sec, target, raf } = dragging;
    cancelAnimationFrame(raf);
    dragging = null;
    line.style.display = 'none';
    document.body.classList.remove('f-grabbing');
    window.removeEventListener('keydown', onKey, true);
    view.dispatch(view.state.tr.setMeta(key, null));
    const tr = drop && target !== null ? moveSections(view.state, [sec.from], target, copy) : null;
    if (tr) view.dispatch(tr);
    hideGrip();
    view.focus();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || head < 0) return;
    e.preventDefault();
    const doc = view.state.doc;
    const sec = sectionAt(doc, head);
    if (!sec) return;
    const gaps: number[] = [];
    doc.forEach((n, p) => { const l = levelOf(n); if (l > 0 && l <= sec.level && !(p > sec.from && p < sec.to)) gaps.push(p); });
    gaps.push(doc.content.size);
    grip.setPointerCapture(e.pointerId);
    dragging = { sec, gaps, target: null, y: e.clientY, raf: 0 };
    document.body.classList.add('f-grabbing');
    window.addEventListener('keydown', onKey, true);
    view.dispatch(view.state.tr.setMeta(key, sec));
    dragging.raf = requestAnimationFrame(tick);
  });
  grip.addEventListener('pointermove', (e) => { if (dragging) { dragging.y = e.clientY; aim(); } });
  grip.addEventListener('pointerup', (e) => finish(true, copyModifier(e)));
  grip.addEventListener('pointercancel', () => finish(false));

  return {
    // the doc changed under the grip: it comes back on the next mouse move
    update(_v: EditorView, prev: { doc: unknown }) { if (!dragging && head >= 0 && prev.doc !== view.state.doc) hideGrip(); },
    destroy() { view.dom.removeEventListener('mousemove', onMove); grip.remove(); line.remove(); },
  };
}

export const pageDragPlugin = new Plugin<Section | null>({
  key,
  state: {
    init: () => null,
    apply: (tr, v) => (tr.getMeta(key) !== undefined ? tr.getMeta(key) : v && tr.docChanged ? null : v),
  },
  view: dragView,
  props: {
    // the section being dragged fades while it's carried
    decorations(state) {
      const s = key.getState(state);
      if (!s) return null;
      const decos: Decoration[] = [];
      state.doc.nodesBetween(s.from, s.to, (n, p) => { decos.push(Decoration.node(p, p + n.nodeSize, { class: 'f-dragging' })); return false; });
      return DecorationSet.create(state.doc, decos);
    },
  },
});
