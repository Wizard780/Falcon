import { aiCitePlugin } from './ai-cite';
import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { fixTables } from 'prosemirror-tables';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { DOMParser as PMDOMParser, Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, EditorView } from 'prosemirror-view';
import { cardAround, pastedText, toggleColorMark } from './commands';
import { activeColors, disarmPlainPaste, plainPasteArmed } from './host';
import { falconKeymap } from './keymap';
import { IS_MAC } from './keybinds';
import { navPlugins } from './nav-keys';
import { wordSelection } from './mouse';
import { footnoteText, schema } from './schema';
import { P, PREFS_META, onPrefs, pref } from './prefs';
import { cleanPastedHTML } from './paste';
import { clipboardSerializer } from './clipboard-styles';
import { findPlugin } from './find';
import { multiSelectionPlugin } from './multi';
import { isReading, readPlugin } from './read';
import { docToolPlugins } from './doc-tools';
import { tablePlugins } from './tables';
import { imagePlugin } from './images';
import { footnotePlugin } from './footnotes';
import { NEAR, WINDOW_META, topSet, windowPlugin } from './window';
import { smartQuotesPlugin } from './quotes';

/** Paintbrush: while armed, every mouse selection gets the active color, or loses it if it's already all that color. */
export const brushKey = new PluginKey<{ kind: 'highlight' | 'shading' | null }>('brush');
const brush = new Plugin<{ kind: 'highlight' | 'shading' | null }>({
  key: brushKey,
  state: {
    init: () => ({ kind: null }),
    apply: (tr, v) => (tr.getMeta(brushKey) !== undefined ? { kind: tr.getMeta(brushKey) } : v),
  },
  props: {
    attributes: (state): Record<string, string> => {
      const k = brushKey.getState(state)?.kind;
      return k ? { class: `f-brush f-brush-${k}` } : {};
    },
    handleDOMEvents: {
      mouseup: (view, ev) => {
        const kind = brushKey.getState(view.state)?.kind;
        if (!kind || isReading(view.state)) return false;
        // let the selection settle, then paint it
        setTimeout(() => {
          const { to, empty } = view.state.selection;
          if (empty) return;
          const strip = (ev as MouseEvent).altKey || (IS_MAC && (ev as MouseEvent).ctrlKey);
          const color = strip ? null : activeColors[kind];
          toggleColorMark(schema.marks[kind], color)(view.state, view.dispatch);
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, to)));
        }, 0);
        return false;
      },
    },
    handleKeyDown: (view, ev) => {
      if (ev.key === 'Escape' && brushKey.getState(view.state)?.kind) {
        view.dispatch(view.state.tr.setMeta(brushKey, null));
        return true;
      }
      return false;
    },
  },
});

/**
 * Two paragraph classes driven by the selection:
 * - f-live on the paragraphs holding the cursor, the ones either side and the doc's first and last,
 *   which are always built and laid out: window.ts leaves an off-screen paragraph an empty placeholder,
 *   and the browser's own caret moves (arrows, Mod-Up/Down to the doc's ends) skip those, so they would
 *   land paragraphs or a whole screen away;
 * - f-cur-card on the card (tag/analytic and its body) that holds the cursor, for the left bar.
 */
const selectionClasses = new Plugin({
  props: {
    decorations(state) {
      const doc = state.doc;
      const decos: Decoration[] = [];
      const live = new Set<number>([0, doc.content.size - doc.lastChild!.nodeSize]);
      for (const $p of [state.selection.$anchor, state.selection.$head]) {
        if ($p.depth < 1) continue;
        const i = $p.index(0), at = $p.before(1);
        live.add(at);
        if (i > 0) live.add(at - doc.child(i - 1).nodeSize);
        if (i + 1 < doc.childCount) live.add($p.after(1));
      }
      for (const pos of live) decos.push(Decoration.node(pos, pos + doc.nodeAt(pos)!.nodeSize, { class: 'f-live' }, NEAR));
      const c = cardAround(doc, state.selection.head);
      const head = c && doc.child(c.head);
      if (c && head && (head.attrs.style === 'tag' || head.attrs.style === 'analytic')) {
        let pos = 0;
        for (let i = 0; i < c.end; i++) {
          const n = doc.child(i);
          if (i >= c.head) decos.push(Decoration.node(pos, pos + n.nodeSize, { class: 'f-cur-card' }));
          pos += n.nodeSize;
        }
      }
      return topSet(decos); // all on top-level paragraphs
    },
  },
});

/** One analytic or undertag line, as its own open slice. Null for anything else. A triple click also copies the empty start of the next line. */
function inlineLine(slice: Slice): Slice | null {
  const { firstChild: first, lastChild: last, childCount } = slice.content;
  if (!first?.isTextblock || (first.attrs.style !== 'analytic' && first.attrs.style !== 'undertag')) return null;
  if (childCount === 1) return new Slice(slice.content, 1, 1);
  return childCount === 2 && !last!.content.size ? new Slice(Fragment.from(first), 1, 1) : null;
}

/** Does a paste here replace all of a line (or land on an empty one)? */
function fillsLine({ $from, $to }: EditorState['selection']) {
  return $from.sameParent($to) && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;
}

/** Mod-V after a refused F2 pastes plain; Word/web HTML is cleaned of source styling. Copies carry inline styles for Gmail, Docs and Word. */
const pastePlugin = new Plugin({
  props: {
    clipboardSerializer,
    transformPastedHTML: (html) => cleanPastedHTML(html),
    // a pasted tag or heading keeps its style instead of melting into the line it lands on.
    // analytics and undertags are just text, so on a line with words they sit right next to them
    transformPasted: (slice, view) => {
      const line = fillsLine(view.state.selection) ? null : inlineLine(slice);
      if (line) return line;
      const first = slice.content.firstChild;
      if (slice.openStart > 0 && first?.isTextblock && first.attrs.style !== 'normal') return new Slice(slice.content, 0, slice.openEnd);
      return slice;
    },
    handlePaste: (view, ev) => {
      if (!plainPasteArmed) return false;
      disarmPlainPaste();
      const text = ev.clipboardData?.getData('text/plain');
      if (!text) return false;
      view.dispatch(view.state.tr.insertText(pastedText(text)));
      return true;
    },
  },
});

/** A setting changed: an empty transaction tells the plugins that draw from settings (read mode) to redraw. */
const prefsWatch = new Plugin({
  view: (view) => ({ destroy: onPrefs(() => view.dispatch(view.state.tr.setMeta(PREFS_META, true).setMeta('addToHistory', false))) }),
});

export function emptyDoc(): PMNode {
  return schema.node('doc', null, [schema.node('paragraph')]);
}

export function createState(doc: PMNode = emptyDoc()) {
  const state = EditorState.create({
    doc,
    plugins: [
      readPlugin, // first, so its keyboard lock runs before the formatting keys
      aiCitePlugin,
      multiSelectionPlugin,
      ...navPlugins, // card numbers, dragging cards on the page
      ...tablePlugins, // before the keymap (Tab moves between cells) and mouse selection (column edges, cell drags)
      falconKeymap(),
      keymap(baseKeymap),
      smartQuotesPlugin,
      history({ newGroupDelay: 500 }),
      dropCursor({ color: '#3b82f6', width: 2 }),
      brush,
      pastePlugin,
      ...docToolPlugins, // before wordSelection: Cmd/Ctrl-click on a link opens it
      imagePlugin,
      footnotePlugin,
      wordSelection(),
      gapCursor(),
      selectionClasses,
      windowPlugin,
      findPlugin,
      prefsWatch,
    ],
  });
  // tables from other programs can have short rows or overlapping spans: square them up once, on open
  const fix = fixTables(state);
  return fix ? state.apply(fix.setMeta('addToHistory', false)) : state;
}

export function docFromHTML(html: string): PMNode {
  // an inert document: nothing in the HTML runs or loads
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  return PMDOMParser.fromSchema(schema).parse(body);
}

/** An editor in `mount`, on a new state for `doc`, or on `state` as it is (a split pane keeps its undo history). */
export function createView(mount: HTMLElement, onChange: (view: EditorView) => void, doc?: PMNode | EditorState) {
  const view: EditorView = new EditorView(mount, {
    state: doc instanceof EditorState ? doc : createState(doc),
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      // the drawn range moved on a scroll: nothing the app shows changed
      if (!tr.getMeta(WINDOW_META)) onChange(view);
    },
    // read again on every update, so the Check spelling setting applies at once; read mode is never
    // checked (no underlines while reading, and no guesses to click that would edit the locked doc)
    attributes: (state) => ({ spellcheck: pref(P.spellcheck) && !isReading(state) ? 'true' : 'false', class: 'f-page-text' }),
    // Read the page's selection before any key runs. The editor learns about a new selection from
    // the selectionchange event, and a busy page handles a key press before that event, so a format
    // key right after selecting (Shift-arrows, a drag) would format the old selection. ProseMirror's
    // own keydown flush only covers pending DOM edits, not a pending selection change.
    handleKeyDown(v) {
      (v as unknown as { domObserver: { flush(): void } }).domObserver.flush();
      return false;
    },
  });
  const w = window as unknown as Record<string, unknown>;
  w.__falconView = view;
  w.__falconMarkMap = () => markMap((w.__falconView as EditorView).state.doc); // the focused editor, once files are joined
  return view;
}

/**
 * Normalized text+marks listing, the same shape the probe builds for CardMirror. Pictures show as
 * [image WxH], footnotes as [^note text], and a table as one `table` line with a line per cell paragraph
 * (`cell r0c1 2x1 normal: ...`, span shown only when it isn't 1x1).
 */
export function markMap(doc: PMNode): string {
  const out: string[] = [];
  const para = (p: PMNode, prefix = '') => {
    const runs: [string, string][] = [];
    p.forEach((n) => {
      const text = n.isText ? n.text!
        : n.type.name === 'image' ? `[image ${n.attrs.width ?? '?'}x${n.attrs.height ?? '?'}${n.attrs.crop ? ` crop ${['l', 't', 'r', 'b'].map((k) => Math.round(n.attrs.crop[k] * 1000)).join(',')}` : ''}]`
        : n.type.name === 'footnote' ? `[^${footnoteText(n.attrs.content)}]` : '';
      const mk = n.marks
        .map((m) => (m.type.name === 'highlight' ? `highlight:${m.attrs.color}` : m.type.name === 'size' ? `size:${m.attrs.pt}pt` : m.type.name))
        .sort()
        .join('+');
      const last = runs[runs.length - 1];
      if (last && last[1] === mk) last[0] += text;
      else runs.push([text, mk]);
    });
    out.push(`${prefix}${p.attrs.style}: ` + runs.map(([t, m]) => (m ? `[${t}]{${m}}` : t)).join(''));
  };
  doc.forEach((node) => {
    if (node.isTextblock) return para(node);
    out.push(`table ${node.childCount} rows${node.attrs.borders ? '' : ' no borders'}`);
    node.forEach((row, _o, r) => row.forEach((cell, _p, c) => {
      const { colspan, rowspan, background } = cell.attrs;
      const tag = `cell r${r}c${c}${colspan > 1 || rowspan > 1 ? ` ${colspan}x${rowspan}` : ''}${background ? ` bg${background}` : ''}${cell.type.name === 'table_header' ? ' head' : ''} `;
      cell.forEach((p) => para(p, tag));
    }));
  });
  return out.join('\n');
}
