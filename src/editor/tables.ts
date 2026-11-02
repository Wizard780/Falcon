import './media.css';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import {
  CellSelection, TableMap, addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, columnResizing, deleteColumn, deleteRow,
  deleteTable, findTable, goToNextCell, isInTable, mergeCells, selectedRect, setCellAttr, splitCell, tableEditing, toggleHeaderRow,
} from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import { schema } from './schema';

const T = schema.nodes;
const PAGE_PX = 624; // 6.5in of text width

/** A rows × cols table of empty cells, as wide as the page, put after the paragraph at the cursor. */
export function insertTable(rows = 3, cols = 3): Command {
  return (state, dispatch) => {
    if (isInTable(state)) return false;
    const w = Math.floor(PAGE_PX / cols);
    const cell = () => T.table_cell.create({ colwidth: [w] }, T.paragraph.create());
    const table = T.table.create(null, Array.from({ length: rows }, () => T.table_row.create(null, Array.from({ length: cols }, cell))));
    if (!dispatch) return true;
    const $f = state.selection.$from;
    const empty = $f.depth === 1 && $f.parent.content.size === 0;
    // an empty line becomes the table; otherwise it goes below the paragraph
    const at = empty ? $f.before(1) : $f.after(1);
    const tr = empty ? state.tr.replaceWith(at, $f.after(1), table) : state.tr.insert(at, table);
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 3)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Tab in the last cell adds a row, like Word. */
const nextCellOrRow: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  return addRowAfter(state, dispatch && ((tr) => {
    // one undo step: the new row, and the cursor in its first cell
    goToNextCell(1)(state.apply(tr), (move) => { tr.setSelection(TextSelection.create(tr.doc, move.selection.from, move.selection.to)); });
    dispatch(tr.scrollIntoView());
  }));
};

/** Every column the same width, filling the page. */
export const evenColumns: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const t = findTable(state.selection.$from);
  if (!t) return false;
  const map = TableMap.get(t.node);
  const w = Math.floor(PAGE_PX / map.width);
  if (!dispatch) return true;
  const tr = state.tr;
  const seen = new Set<number>();
  for (const rel of map.map) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const cell = t.node.nodeAt(rel)!;
    tr.setNodeMarkup(t.start + rel, null, { ...cell.attrs, colwidth: Array(cell.attrs.colspan).fill(w) });
  }
  dispatch(tr);
  return true;
};

const SHADES = [null, '#D9D9D9', '#FFF2CC', '#DEEAF6', '#E2EFD9'];
/** Cycle the selected cells' background: none, gray, yellow, blue, green. */
const cycleShade: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  const first = rect.table.nodeAt(rect.map.map[rect.top * rect.map.width + rect.left]);
  const next = SHADES[(SHADES.indexOf(first?.attrs.background ?? null) + 1) % SHADES.length];
  return setCellAttr('background', next)(state, dispatch);
};

type Tool = { label: string; title: string; run: Command };
const TOOLS: Tool[][] = [
  [
    { label: 'Row ↑', title: 'Insert a row above', run: addRowBefore },
    { label: 'Row ↓', title: 'Insert a row below (Tab in the last cell does this too)', run: addRowAfter },
    { label: 'Col ←', title: 'Insert a column to the left', run: addColumnBefore },
    { label: 'Col →', title: 'Insert a column to the right', run: addColumnAfter },
  ],
  [
    { label: 'Merge', title: 'Merge the selected cells (drag across cells to select them)', run: mergeCells },
    { label: 'Split', title: 'Split a merged cell back apart', run: splitCell },
    { label: 'Header', title: 'Make the first row a header row (repeats on each page in Word)', run: toggleHeaderRow },
    { label: 'Shade', title: 'Cycle the cell background: none, gray, yellow, blue, green', run: cycleShade },
    { label: 'Even', title: 'Make every column the same width', run: evenColumns },
  ],
  [
    { label: 'Del row', title: 'Delete the row', run: deleteRow },
    { label: 'Del col', title: 'Delete the column', run: deleteColumn },
    { label: 'Del table', title: 'Delete the whole table', run: deleteTable },
  ],
];

/** The table bar: a small pill above the table the cursor is in. */
class TableBar {
  dom = document.createElement('div');
  private buttons: { el: HTMLButtonElement; run: Command }[] = [];
  private frame = 0;
  constructor(private view: EditorView) {
    this.dom.className = 'f-tbar';
    this.dom.setAttribute('role', 'toolbar');
    this.dom.setAttribute('aria-label', 'Table');
    for (const group of TOOLS) {
      const g = document.createElement('span');
      g.className = 'f-tbar-g';
      for (const t of group) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = t.label;
        b.title = t.title;
        b.setAttribute('aria-label', t.title.split(' (')[0]);
        // keep the editor's selection: the bar never takes focus
        b.addEventListener('mousedown', (e) => { e.preventDefault(); t.run(this.view.state, this.view.dispatch, this.view); this.view.focus(); });
        g.append(b);
        this.buttons.push({ el: b, run: t.run });
      }
      this.dom.append(g);
    }
    document.body.append(this.dom);
    this.onScroll = this.onScroll.bind(this);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.onScroll);
    this.update();
  }
  private onScroll() { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.place(); }); }
  private tableDom(): HTMLElement | null {
    const t = isInTable(this.view.state) ? findTable(this.view.state.selection.$from) : null;
    if (!t) return null;
    const dom = this.view.nodeDOM(t.pos) as HTMLElement | null;
    return dom?.querySelector?.('table') ?? (dom?.tagName === 'TABLE' ? dom : null);
  }
  private place() {
    const table = this.view.editable ? this.tableDom() : null;
    if (!table) { this.dom.hidden = true; return; }
    const r = table.getBoundingClientRect();
    const h = this.dom.offsetHeight || 30;
    this.dom.hidden = false;
    // above the table; once its top scrolls away, pinned to the top of the page area while the table is in view
    const scroller = this.view.dom.closest('.f-scroll')?.getBoundingClientRect();
    const minTop = (scroller?.top ?? 0) + 6;
    const top = Math.min(Math.max(r.top - h - 6, minTop), r.bottom - h);
    this.dom.style.top = `${Math.round(top)}px`;
    this.dom.style.left = `${Math.round(r.left)}px`;
    this.dom.style.visibility = r.bottom < minTop + h ? 'hidden' : '';
  }
  update() {
    const { state } = this.view;
    if (isInTable(state)) for (const b of this.buttons) b.el.disabled = !b.run(state, undefined, this.view);
    this.place();
  }
  destroy() {
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onScroll);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.dom.remove();
  }
}

/** In a cell, the next and previous cell; outside tables Tab still indents. */
const tableKeys = keymap({
  Tab: nextCellOrRow,
  'Shift-Tab': (state, dispatch) => isInTable(state) && (goToNextCell(-1)(state, dispatch) || true),
});

/**
 * Tables: drag a column's edge to resize it, drag across cells to select several (then Merge, or format
 * them all at once), Tab between cells, and the table bar for rows, columns and the rest.
 */
export const tablePlugins: Plugin[] = [
  columnResizing({ cellMinWidth: 32, lastColumnResizable: true }),
  tableEditing(),
  tableKeys,
  new Plugin({ view: (view) => new TableBar(view) }),
];

/** Whether two positions are in different cells (a drag between them selects cells, not text). */
export function acrossCells(doc: PMNode, a: number, b: number): boolean {
  const cellOf = (p: number) => {
    const $p = doc.resolve(Math.max(0, Math.min(p, doc.content.size)));
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.spec.tableRole === 'cell' || $p.node(d).type.spec.tableRole === 'header_cell') return $p.before(d);
    return -1;
  };
  const ca = cellOf(a), cb = cellOf(b);
  return ca >= 0 && cb >= 0 && ca !== cb;
}
export { CellSelection };
