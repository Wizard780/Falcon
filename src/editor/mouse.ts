import { Plugin, TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { wordAt } from './commands';
import { MultiSelection, spansOf, type Span as MSpan } from './multi';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

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
 * - double-click selects a word (with its trailing space) and dragging extends by words;
 * - triple-click selects the paragraph and dragging extends by paragraphs;
 * - Shift-click extends by the unit of the last selection.
 */
export function wordSelection() {
  let lastUnit: Unit = 'char';
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, ev) => {
          const e = ev as MouseEvent;
          if (e.button !== 0 || e.altKey) return false;
          const addKey = isMac ? e.metaKey : e.ctrlKey;
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
            e.preventDefault();
            const anchor = state.selection.anchor;
            const forward = hit.pos >= anchor;
            let a = anchor, head = hit.pos;
            if (lastUnit !== 'char') head = edge(view, hit.pos, lastUnit, forward);
            else {
              const aw = wordUnit(view, anchor);
              if (aw && !(head >= aw.from && head <= aw.to)) {
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
