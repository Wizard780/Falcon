import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { wordAt } from './commands';

type Unit = 'char' | 'word' | 'para';

/**
 * Word-style mouse selection:
 * - click-drag selects by character inside the first word, then snaps both ends to whole words;
 * - double-click and triple-click keep the browser's word/paragraph drag;
 * - Shift-click extends by the unit of the last selection (char, word, or paragraph).
 */
export function wordSelection() {
  let lastUnit: Unit = 'char';
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, ev) => {
          const e = ev as MouseEvent;
          if (e.button !== 0) return false;
          if (e.detail === 2) { lastUnit = 'word'; return false; }
          if (e.detail >= 3) { lastUnit = 'para'; return false; }
          if (e.metaKey || e.ctrlKey || e.altKey) return false;
          const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (!hit) return false;
          const { state } = view;
          if (e.shiftKey) {
            e.preventDefault();
            const head = snap(view, hit.pos, lastUnit, hit.pos >= state.selection.anchor);
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, state.selection.anchor, head)));
            view.focus();
            return true;
          }
          // a press inside an existing selection may start a drag-and-drop: leave it to the browser
          const sel = state.selection;
          if (!sel.empty && hit.pos > sel.from && hit.pos < sel.to) return false;
          e.preventDefault();
          view.focus();
          lastUnit = 'char';
          startDrag(view, hit.pos, (u) => (lastUnit = u));
          return true;
        },
      },
    },
  });
}

function snap(view: EditorView, pos: number, unit: Unit, forward: boolean): number {
  if (unit === 'word') {
    const w = wordAt(view.state, pos);
    return w ? (forward ? w.to : w.from) : pos;
  }
  if (unit === 'para') {
    const $p = view.state.doc.resolve(pos);
    return forward ? $p.end() : $p.start();
  }
  return pos;
}

function startDrag(view: EditorView, anchor: number, setUnit: (u: Unit) => void) {
  const doc0 = view.state.doc;
  const tr = view.state.tr.setSelection(TextSelection.create(doc0, anchor));
  view.dispatch(tr.setMeta('pointer', true));
  const anchorWord = wordAt(view.state, anchor);
  const scroller = (view.dom.closest('.f-scroll') as HTMLElement) ?? document.scrollingElement!;
  let lastX = 0, lastY = 0, raf = 0, moved = false;

  const update = () => {
    const hit = view.posAtCoords({ left: lastX, top: Math.max(scrollerTop() + 1, Math.min(lastY, scrollerBottom() - 1)) });
    if (!hit) return;
    const head = hit.pos;
    const doc = view.state.doc;
    let a = anchor, h = head;
    const insideAnchorWord = anchorWord && head >= anchorWord.from && head <= anchorWord.to;
    if (!insideAnchorWord && head !== anchor) {
      const forward = head > anchor;
      if (anchorWord) a = forward ? anchorWord.from : anchorWord.to;
      const hw = wordAt(view.state, head);
      if (hw) h = forward ? hw.to : hw.from;
      setUnit('word');
    } else setUnit('char');
    const cur = view.state.selection;
    if (cur.anchor === a && cur.head === h) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, a, h)).setMeta('pointer', true));
  };
  const scrollerTop = () => (scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top);
  const scrollerBottom = () => (scroller === document.scrollingElement ? innerHeight : scroller.getBoundingClientRect().bottom);
  const tick = () => {
    raf = 0;
    const top = scrollerTop(), bottom = scrollerBottom();
    let dy = 0;
    if (lastY < top + 20) dy = -Math.min(40, top + 20 - lastY);
    else if (lastY > bottom - 20) dy = Math.min(40, lastY - bottom + 20);
    if (dy) { scroller.scrollTop += dy; update(); raf = requestAnimationFrame(tick); }
  };
  const move = (e: MouseEvent) => {
    lastX = e.clientX; lastY = e.clientY;
    if (!moved && Math.abs(e.movementX) + Math.abs(e.movementY) === 0) return;
    moved = true;
    update();
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    if (raf) cancelAnimationFrame(raf);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}
