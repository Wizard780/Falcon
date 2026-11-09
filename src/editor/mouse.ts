import { Plugin, TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { wordAt } from './commands';
import { MultiSelection, spansOf, type Span as MSpan } from './multi';
import { CellSelection, acrossCells } from './tables';
import { IS_MAC } from './keybinds';

type Unit = 'char' | 'word' | 'para';

/** A text selection whose ends are inside paragraphs, even when the click landed below the last line. */
function textSel(state: EditorState, anchor: number, head: number) {
  const doc = state.doc;
  const clamp = (p: number) => Math.max(0, Math.min(p, doc.content.size));
  return TextSelection.between(doc.resolve(clamp(anchor)), doc.resolve(clamp(head)));
}
type Span = { from: number; to: number };

/**
 * Word-style mouse selection:
 * - click-drag selects by character inside the first word, then snaps to whole words;
 * - a press on a word's edge that drags away from the word leaves that word out;
 * - double-click selects a word (with its trailing space) and dragging extends by words;
 * - triple-click selects the paragraph and dragging extends by paragraphs;
 * - Shift-click extends by the unit of the last selection.
 */
export function wordSelection() {
  let lastUnit: Unit = 'char';
  return new Plugin({
    // a press in the page's margin beside a line (where the card grip shows) goes to the line's near edge, the way
    // Word and CardMirror put the caret at the start of the line; a drag from there selects as usual
    view(view) {
      const page = view.dom.parentElement?.parentElement; // .page > mount > .ProseMirror
      if (!page) return {};
      const onDown = (e: MouseEvent) => {
        if (e.button !== 0 || !e.isTrusted) return;
        const t = e.target as HTMLElement;
        if (view.dom.contains(t) || t.closest?.('.f-grip')) return;
        const r = view.dom.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom) return;
        const x = Math.max(r.left + 2, Math.min(r.right - 2, e.clientX));
        const el = document.elementFromPoint(x, e.clientY);
        if (!el || !view.dom.contains(el)) return;
        e.preventDefault();
        e.stopPropagation();
        el.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, clientX: x, clientY: e.clientY, detail: e.detail, button: 0, buttons: e.buttons,
          shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
        }));
      };
      page.addEventListener('mousedown', onDown);
      return { destroy: () => page.removeEventListener('mousedown', onDown) };
    },
    props: {
      handleDOMEvents: {
        mousedown: (view, ev) => {
          const e = ev as MouseEvent;
          if (e.button !== 0 || e.altKey) return false;
          // a picture or footnote reference is selected whole by a click (ProseMirror's own node selection)
          if ((e.target as HTMLElement).closest?.('.f-img, .f-footnote, .f-notes')) return false;
          const addKey = IS_MAC ? e.metaKey : e.ctrlKey;
          if ((e.metaKey || e.ctrlKey) && !addKey) return false;
          const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (!hit) return false;
          const { state } = view;
          if (addKey && !e.shiftKey) {
            // Ctrl/Cmd-click: add a stretch to the selection, or drop the stretch you clicked
            e.preventDefault();
            view.focus();
            const spans = spansOf(state.selection);
            if (e.detail <= 1) {
              const hitSpan = spans.find((s) => hit.pos >= s.from && hit.pos <= s.to);
              if (hitSpan) {
                const rest = spans.filter((s) => s !== hitSpan);
                view.dispatch(state.tr.setSelection(rest.length ? MultiSelection.create(state.doc, rest) : textSel(state, hit.pos, hit.pos)));
                return true;
              }
              lastUnit = 'char';
              startDrag(view, hit.pos, 'char', (u) => (lastUnit = u), spans);
            } else {
              // double/triple: the click before already added a word; widen that stretch to this unit
              const base = spans.filter((s) => !(hit.pos >= s.from && hit.pos <= s.to));
              lastUnit = e.detail >= 3 ? 'para' : 'word';
              startDrag(view, hit.pos, lastUnit, (u) => (lastUnit = u), base);
            }
            return true;
          }
          if (e.shiftKey) {
            // shift-click from one cell to another extends a cell selection (the table plugin does that)
            if (state.selection instanceof CellSelection || acrossCells(state.doc, state.selection.anchor, hit.pos)) return false;
            e.preventDefault();
            const anchor = state.selection.anchor;
            const forward = hit.pos >= anchor;
            let a = anchor, head = hit.pos;
            if (lastUnit !== 'char') head = edge(view, hit.pos, lastUnit, forward);
            else {
              const aw = wordUnit(view, anchor);
              const away = awayFromEdge(view, anchor, hit.pos);
              if (away !== null) head = away;
              else if (aw && !(head >= aw.from && head <= aw.to)) {
                a = forward ? aw.from : aw.to;
                head = edge(view, hit.pos, 'word', forward);
              }
            }
            view.dispatch(state.tr.setSelection(textSel(state, a, head)));
            view.focus();
            return true;
          }
          // every plain press is ours (like CardMirror, selected text isn't dragged; cards move from the outline)
          e.preventDefault();
          view.focus();
          lastUnit = e.detail >= 3 ? 'para' : e.detail === 2 ? 'word' : 'char';
          startDrag(view, hit.pos, lastUnit, (u) => (lastUnit = u));
          return true;
        },
      },
    },
  });
}

/** A word plus the spaces after it (what a double-click selects). */
function wordUnit(view: EditorView, pos: number): Span | null {
  const w = wordAt(view.state, pos);
  if (!w) return null;
  const $p = view.state.doc.resolve(w.to);
  const text = $p.parent.textBetween($p.parentOffset, $p.parent.content.size, '￼', '￼');
  const spaces = text.match(/^ +/)?.[0].length ?? 0;
  return { from: w.from, to: w.to + spaces };
}

function paraUnit(view: EditorView, pos: number): Span {
  const $p = view.state.doc.resolve(pos);
  return { from: $p.start(), to: $p.end() };
}

/** Where the moving end of a word/paragraph selection lands. */
function edge(view: EditorView, pos: number, unit: Unit, forward: boolean): number {
  if (unit === 'para') { const p = paraUnit(view, pos); return forward ? p.to : p.from; }
  const w = wordAt(view.state, pos);
  return w ? (forward ? w.to : w.from) : pos;
}

/**
 * Where the moving end lands when the fixed end sits on a word's edge and the move goes away from that word,
 * which stays out of the selection. Null when that isn't the case. The moving end snaps only from inside a word.
 */
function awayFromEdge(view: EditorView, pos: number, head: number): number | null {
  const forward = head > pos;
  const w = wordAt(view.state, pos);
  if (!w || pos !== (forward ? w.to : w.from)) return null;
  const h = wordAt(view.state, head);
  return h && head > h.from && head < h.to ? (forward ? h.to : h.from) : head;
}

function startDrag(view: EditorView, pos: number, unit: Unit, setUnit: (u: Unit) => void, base?: MSpan[]) {
  const first: Span | null = unit === 'para' ? paraUnit(view, pos) : unit === 'word' ? wordUnit(view, pos) : null;
  const anchorWord = unit === 'char' ? wordUnit(view, pos) : null;
  const select = (a: number, h: number) => {
    if (base) {
      // adding to a multi-selection: the new stretch joins the ones already selected
      const sel = MultiSelection.create(view.state.doc, [...base, { from: Math.min(a, h), to: Math.max(a, h) }]);
      if (!sel.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(sel).setMeta('pointer', true));
      return;
    }
    const cur = view.state.selection;
    if (cur.anchor === a && cur.head === h) return;
    // from one table cell into another, the drag selects cells (the table plugin does that)
    if (acrossCells(view.state.doc, a, h)) return;
    view.dispatch(view.state.tr.setSelection(textSel(view.state, a, h)).setMeta('pointer', true));
  };
  // a Ctrl/Cmd-click adds the word under it (without its trailing space); a Ctrl/Cmd-drag adds exactly what you drag
  const added = base && !first ? wordAt(view.state, pos) : null;
  if (added) select(added.from, added.to);
  else select(first ? first.from : pos, first ? first.to : pos);

  const scroller = (view.dom.closest('.f-scroll') as HTMLElement) ?? document.scrollingElement!;
  const bounds = () => (scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect());
  let lastX = 0, lastY = 0, raf = 0;

  const update = () => {
    const { top, bottom } = bounds();
    const hit = view.posAtCoords({ left: lastX, top: Math.max(top + 1, Math.min(lastY, bottom - 1)) });
    if (!hit) return;
    const head = hit.pos;
    if (first) {
      // double/triple-click drag: the first unit always stays selected
      if (head >= first.from && head <= first.to) return select(first.from, first.to);
      const forward = head > first.to;
      return select(forward ? first.from : first.to, edge(view, head, unit, forward));
    }
    if (base) { if (head !== pos) select(pos, head); return; }
    const inFirstWord = anchorWord && head >= anchorWord.from && head <= anchorWord.to;
    if (inFirstWord || head === pos || !anchorWord) { setUnit('char'); return select(pos, head); }
    // past the first word: snap both ends to whole words
    setUnit('word');
    const away = awayFromEdge(view, pos, head);
    if (away !== null) return select(pos, away);
    const forward = head > pos;
    select(forward ? anchorWord.from : anchorWord.to, edge(view, head, 'word', forward));
  };
  const tick = () => {
    raf = 0;
    const { top, bottom } = bounds();
    const dy = lastY < top + 20 ? -Math.min(40, top + 20 - lastY) : lastY > bottom - 20 ? Math.min(40, lastY - bottom + 20) : 0;
    if (dy) { scroller.scrollTop += dy; update(); raf = requestAnimationFrame(tick); }
  };
  const move = (e: MouseEvent) => {
    lastX = e.clientX; lastY = e.clientY;
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
