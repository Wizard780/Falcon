import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { DOMParser as PMDOMParser, type Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { cardAround, paintColorMark } from './commands';
import { activeColors, disarmPlainPaste, plainPasteArmed } from './host';
import { falconKeymap } from './keymap';
import { wordSelection } from './mouse';
import { schema } from './schema';
import { cleanPastedHTML } from './paste';
import { findPlugin } from './find';
import { multiSelectionPlugin } from './multi';
import { readPlugin } from './read';

/** Paintbrush: while armed, every mouse selection gets painted with the active color. */
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
        if (!kind) return false;
        // let the selection settle, then paint it
        setTimeout(() => {
          const { from, to, empty } = view.state.selection;
          if (empty) return;
          const strip = (ev as MouseEvent).altKey || (navigator.platform.startsWith('Mac') && (ev as MouseEvent).ctrlKey);
          const color = strip ? null : activeColors[kind];
          paintColorMark(schema.marks[kind], color, from, to)(view.state, view.dispatch);
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
 * - f-live on the paragraphs holding the cursor, which always lay out normally (the off-screen
 *   layout skip in styles.css would otherwise misplace the caret in a just-created paragraph);
 * - f-cur-card on the card (tag/analytic and its body) that holds the cursor, for the left bar.
 */
const selectionClasses = new Plugin({
  props: {
    decorations(state) {
      const doc = state.doc;
      const decos: Decoration[] = [];
      const live = new Set<number>();
      for (const $p of [state.selection.$anchor, state.selection.$head]) if ($p.depth >= 1) live.add($p.before(1));
      for (const pos of live) decos.push(Decoration.node(pos, pos + doc.nodeAt(pos)!.nodeSize, { class: 'f-live' }));
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
      return DecorationSet.create(doc, decos);
    },
  },
});

/** Mod-V after a refused F2 pastes plain; Word/web HTML is cleaned of source styling. */
const pastePlugin = new Plugin({
  props: {
    transformPastedHTML: (html) => cleanPastedHTML(html),
    handlePaste: (view, ev) => {
      if (!plainPasteArmed) return false;
      disarmPlainPaste();
      const text = ev.clipboardData?.getData('text/plain');
      if (!text) return false;
      view.dispatch(view.state.tr.insertText(text));
      return true;
    },
  },
});

export function emptyDoc(): PMNode {
  return schema.node('doc', null, [schema.node('paragraph')]);
}

export function createState(doc: PMNode = emptyDoc()) {
  return EditorState.create({
    doc,
    plugins: [
      readPlugin, // first, so its keyboard lock runs before the formatting keys
      multiSelectionPlugin,
      falconKeymap(),
      keymap(baseKeymap),
      history({ newGroupDelay: 500 }),
      dropCursor({ color: '#3b82f6', width: 2 }),
      brush,
      pastePlugin,
      wordSelection(),
      selectionClasses,
      findPlugin,
    ],
  });
}

export function docFromHTML(html: string): PMNode {
  // an inert document: nothing in the HTML runs or loads
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  return PMDOMParser.fromSchema(schema).parse(body);
}

export function createView(mount: HTMLElement, onChange: (view: EditorView) => void, doc?: PMNode) {
  const view: EditorView = new EditorView(mount, {
    state: createState(doc),
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      onChange(view);
    },
    attributes: { spellcheck: 'false', class: 'f-page-text' },
  });
  const w = window as unknown as Record<string, unknown>;
  w.__falconView = view;
  w.__falconMarkMap = () => markMap(view.state.doc);
  return view;
}

/** Normalized text+marks listing, the same shape the probe builds for CardMirror. */
export function markMap(doc: PMNode): string {
  const out: string[] = [];
  doc.forEach((para) => {
    const runs: [string, string][] = [];
    para.forEach((n) => {
      const text = n.isText ? n.text! : '';
      const mk = n.marks
        .map((m) => (m.type.name === 'highlight' ? `highlight:${m.attrs.color}` : m.type.name === 'size' ? `size:${m.attrs.pt}pt` : m.type.name))
        .sort()
        .join('+');
      const last = runs[runs.length - 1];
      if (last && last[1] === mk) last[0] += text;
      else runs.push([text, mk]);
    });
    out.push(`${para.attrs.style}: ` + runs.map(([t, m]) => (m ? `[${t}]{${m}}` : t)).join(''));
  });
  return out.join('\n');
}
