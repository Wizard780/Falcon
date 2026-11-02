import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { fixTables } from 'prosemirror-tables';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { DOMParser as PMDOMParser, Slice, type Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { cardAround, paintColorMark, pastedText } from './commands';
import { activeColors, disarmPlainPaste, plainPasteArmed } from './host';
import { falconKeymap } from './keymap';
import { navPlugins } from './nav-keys';
import { wordSelection } from './mouse';
import { footnoteText, schema } from './schema';
import { PREFS_META, onPrefs } from './prefs';
import { cleanPastedHTML } from './paste';
import { findPlugin } from './find';
import { multiSelectionPlugin } from './multi';
import { readPlugin } from './read';
import { docToolPlugins } from './doc-tools';
import { tablePlugins } from './tables';
import { imagePlugin } from './images';
import { footnotePlugin } from './footnotes';

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
    // a pasted tag or heading keeps its style instead of melting into the line it lands on
    transformPasted: (slice) => {
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
      multiSelectionPlugin,
      ...navPlugins, // card numbers, dragging cards on the page
      ...tablePlugins, // before the keymap (Tab moves between cells) and mouse selection (column edges, cell drags)
      falconKeymap(),
      keymap(baseKeymap),
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

export function createView(mount: HTMLElement, onChange: (view: EditorView) => void, doc?: PMNode) {
  const view: EditorView = new EditorView(mount, {
    state: createState(doc),
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      onChange(view);
    },
    attributes: { spellcheck: 'false', class: 'f-page-text' },
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
  w.__falconMarkMap = () => markMap(view.state.doc);
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
