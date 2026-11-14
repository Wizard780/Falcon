import type { EditorView } from 'prosemirror-view';
import { cardPreview, slideIn } from '../editor/card-links';
import { P, pref } from '../editor/prefs';
import { levelOf } from '../editor/schema';
import { reducedMotion } from './motion';

/**
 * The outline's card preview. Rest on a tag row and its card shows beside the pane, level with the pointer; move down
 * the tags and the one box follows, the next card sliding in. It never takes a click: the row under it still does.
 * Settings > Editor > Card preview in the outline turns it off. Its look is Card links' (Quiet or Page slice).
 *
 * Plain DOM on the list's own events: the rows are memoised (~800 of them), so nothing here renders React.
 * `posOf` is the tag's document position for a row, or null when the row isn't a card's tag.
 */
export function outlinePreview(list: HTMLElement, getView: () => EditorView | null, posOf: (row: HTMLElement) => number | null): () => void {
  const REST = 350;
  const pv = document.createElement('div');
  pv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(pv);
  let shown = false, pos: number | null = null, doc: unknown = null, rest = 0, raf = 0, y = 0, to = 0, h = 0, at = { pos: 0, y: 0 }, used: number | null = null;

  const place = (v: number) => { y = v; pv.style.transform = `translateY(${v.toFixed(1)}px)`; };
  const step = () => { // ease toward the pointer: a fifth of the gap each frame, and stop once there
    raf = 0;
    if (Math.abs(to - y) < .5) return place(to);
    place(y + (to - y) * .2);
    raf = requestAnimationFrame(step);
  };
  const aim = (clientY: number) => {
    to = Math.max(12, Math.min(innerHeight - h - 12, clientY - h / 2));
    if (!shown || reducedMotion()) place(to); else if (!raf) raf = requestAnimationFrame(step);
  };
  const hide = () => {
    clearTimeout(rest); rest = 0;
    cancelAnimationFrame(raf); raf = 0;
    if (shown) { shown = false; pos = null; pv.classList.remove('cl-on'); }
  };
  const draw = (p: number, view: EditorView) => {
    // the outline is a beat behind an edit (it refreshes 150 ms later): a row past the doc's new end, or one that isn't
    // a tag's start any more, shows nothing (nodeAt throws past the end, it doesn't answer null)
    const n = p >= 0 && p < view.state.doc.content.size ? view.state.doc.nodeAt(p) : null;
    if (!n || n.type.name !== 'paragraph' || levelOf(n) !== 4) return hide();
    const { box, page } = cardPreview(view.state.doc, p);
    pv.className = `cl-pv ol-pv ${page ? 'cl-page' : 'cl-quiet'}${shown ? ' cl-on' : ''}`;
    pv.style.left = `${(list.closest('.olp') ?? list).getBoundingClientRect().right + 8}px`;
    pv.replaceChildren(box);
    h = pv.offsetHeight; // as tall as its card, up to card-links.css's limit
    if (shown && pos !== null) slideIn(box, p > pos ? 1 : -1);
    pos = p; doc = view.state.doc;
  };
  const move = (e: MouseEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.sb-row.ol'), p = row && posOf(row), view = getView();
    if (p !== used) used = null;
    if (p == null || p === used || !view || e.buttons || !pref(P.outlinePreview) || 'dragging' in list.dataset || document.querySelector('.ol-menu')) return hide();
    at = { pos: p, y: e.clientY };
    if (shown) {
      if (p !== pos || view.state.doc !== doc) draw(p, view);
      return aim(e.clientY);
    }
    // not yet: only once the pointer rests on a row, so running down the outline to click doesn't flash it
    clearTimeout(rest);
    rest = window.setTimeout(() => {
      rest = 0;
      const v = getView();
      if (!v) return;
      draw(at.pos, v);
      if (pos === null) return;
      aim(at.y);
      shown = true;
      pv.classList.add('cl-on');
    }, REST);
  };
  // a row that was just clicked stays quiet till the pointer goes to another: the page went to that card, so don't cover it
  const press = (e: MouseEvent) => { const row = (e.target as HTMLElement).closest<HTMLElement>('.sb-row.ol'); used = row && posOf(row); hide(); };
  const scroller = list.closest('.sb-scroll');
  list.addEventListener('mousemove', move);
  list.addEventListener('mouseleave', hide);
  list.addEventListener('mousedown', press, true);
  list.addEventListener('contextmenu', hide, true);
  scroller?.addEventListener('scroll', hide, { passive: true });
  return () => {
    hide();
    list.removeEventListener('mousemove', move);
    list.removeEventListener('mouseleave', hide);
    list.removeEventListener('mousedown', press, true);
    list.removeEventListener('contextmenu', hide, true);
    scroller?.removeEventListener('scroll', hide);
    pv.remove();
  };
}
