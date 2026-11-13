// Random formatting and typing through the real keymap and every editor plugin, checking after each step that
// nothing in the selection was skipped, nothing outside it changed, and undo puts it all back.
import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { createView } from '../src/editor/editor';
import { schema, PARA_STYLES, type ParaStyle } from '../src/editor/schema';
import { resetPrefs } from '../src/editor/prefs';
import { IS_MAC } from '../src/editor/keybinds';

const M = schema.marks;
let seed = 1;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
const WORDS = ['war', 'is', 'bad', 'Smith', '24', 'x', 'nuclear', 'escalation', 'the', 'a', 'growth', '—', 'it\'s', '"quote"', 'end.', '(aside)'];
const STYLES: ParaStyle[] = ['normal', 'normal', 'normal', 'normal', 'tag', 'analytic', 'undertag', 'block'];
const MARKS = [() => M.underline.create(), () => M.emphasis.create(), () => M.cite.create(), () => M.highlight.create({ color: 'yellow' }), () => M.bold.create(), () => M.size.create({ pt: 8 })];

function randomDoc(): PMNode {
  const paras: PMNode[] = [];
  const n = 2 + Math.floor(rand() * 6);
  for (let i = 0; i < n; i++) {
    const len = pick([0, 1, 1, 2, 3, 6, 12]);
    const runs: PMNode[] = [];
    for (let w = 0; w < len; w++) {
      const text = (w ? ' ' : '') + pick(WORDS);
      const marks = rand() < 0.35 ? [pick(MARKS)()] : [];
      runs.push(schema.text(text, marks));
    }
    paras.push(schema.node('paragraph', { style: pick(STYLES) }, runs));
  }
  return schema.node('doc', null, paras);
}

let views: EditorView[] = [];
afterEach(() => { views.forEach((v) => { v.destroy(); v.dom.parentElement?.remove(); }); views = []; resetPrefs(); });
const key = (v: EditorView, k: string, mod = false) =>
  v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: k, ...(mod ? (IS_MAC ? { metaKey: true } : { ctrlKey: true }) : {}) })));

/** Every word character position in the trimmed selection, by paragraph. */
function wordChars(doc: PMNode, from: number, to: number) {
  const out: { pos: number; para: PMNode }[] = [];
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isText || !parent) return true;
    for (let i = 0; i < node.text!.length; i++) {
      const p = pos + i;
      if (p >= from && p < to && /[\p{L}\p{N}]/u.test(node.text![i])) out.push({ pos: p, para: parent });
    }
    return false;
  });
  return out;
}
const charMarks = (doc: PMNode, pos: number) => { const n = doc.nodeAt(pos); return n?.isText ? n.marks.map((m) => m.type.name).sort().join(',') : ''; };

describe('editing stress', () => {
  it('F8-F12 never skip a line, never touch what is outside the selection, and undo cleanly', () => {
    const problems: string[] = [];
    for (let round = 0; round < 1500 && problems.length < 12; round++) {
      seed = round + 7;
      views.forEach((x) => { x.destroy(); x.dom.parentElement?.remove(); }); views = []; // one editor at a time keeps it quick
      const mount = document.createElement('div');
      document.body.appendChild(mount);
      const v = createView(mount, () => {}, randomDoc());
      views.push(v);
      const size = v.state.doc.content.size;
      // a selection: anywhere to anywhere, often from a line start or to the start of a later line
      const a = Math.max(1, Math.floor(rand() * size)), b = Math.max(1, Math.floor(rand() * size));
      const sel = TextSelection.between(v.state.doc.resolve(Math.min(a, b)), v.state.doc.resolve(Math.max(a, b)));
      v.dispatch(v.state.tr.setSelection(sel));
      const before = v.state.doc;
      const { from, to, empty } = v.state.selection;
      if (empty) {
        const k = pick(['F9', 'F10']);
        const $c = v.state.selection.$from;
        const text = $c.parent.isTextblock ? $c.parent.textContent : '';
        const off = $c.parentOffset;
        const touching = /\S/.test(text[off - 1] ?? '') || /\S/.test(text[off] ?? '');
        const hasWord = /[\p{L}\p{N}]/u.test(text.slice(0, off).split(/\s/).pop()! + text.slice(off).split(/\s/)[0]);
        // (F10 on a word that's already emphasized changes nothing, which is fine: it only has to act)
        if (touching && hasWord && !key(v, k)) problems.push(`round ${round} ${k} at "${text.slice(0, off)}|${text.slice(off)}": did nothing`);
        continue;
      }
      const k = pick(['F8', 'F9', 'F10', 'F11', 'F12']);
      const label = `round ${round} ${k} on "${before.textBetween(from, to, '|')}" in ${before.childCount} lines`;
      try {
        key(v, k);
        v.state.doc.check();
      } catch (e) { problems.push(`${label}: threw ${(e as Error).message}`); continue; }
      const after = v.state.doc;
      const sameShape = after.content.size === before.content.size;
      if (!sameShape && k !== 'F12') { problems.push(`${label}: text changed size`); continue; }
      // nothing outside the selection changed, other than the spaces and punctuation gap bridging fills
      if (sameShape) {
        for (const { pos } of wordChars(before, 0, size)) {
          if (pos >= from && pos < to) continue;
          if (charMarks(before, pos) !== charMarks(after, pos)) { problems.push(`${label}: changed "${before.textBetween(pos, pos + 1)}" outside the selection (${charMarks(before, pos)} -> ${charMarks(after, pos)})`); break; }
        }
      }
      const inside = wordChars(after, from, to);
      const want = { F8: 'cite', F9: 'underline', F10: 'emphasis', F11: 'highlight' }[k as 'F8'];
      if (want && sameShape) {
        const all = inside.every(({ pos }) => charMarks(after, pos).split(',').includes(want));
        const none = inside.every(({ pos }) => !charMarks(after, pos).split(',').includes(want));
        // F8 skips headings when the selection has body text, so look only at body lines for it
        const body = inside.filter(({ para }) => k !== 'F8' || para.attrs.style === 'normal' || para.attrs.style === 'undertag');
        const bodyAll = body.every(({ pos }) => charMarks(after, pos).split(',').includes(want));
        if (k === 'F10' ? !all : !(k === 'F8' ? bodyAll || none : all || none)) {
          const missed = inside.filter(({ pos }) => !charMarks(after, pos).split(',').includes(want)).map(({ pos }) => after.textBetween(pos, pos + 1)).join('');
          problems.push(`${label}: ${want} skipped "${missed}"`);
        }
      }
      // undo puts back exactly what was there
      key(v, 'z', true);
      if (!v.state.doc.eq(before)) problems.push(`${label}: undo didn't restore the doc`);
      // F12: nothing but highlight and background color is left, and lines it covered whole are normal
      if (k === 'F12' && !after.eq(before)) {
        const left = inside.map(({ pos }) => charMarks(after, pos)).filter((m) => m && !/^(highlight|shading)(,(highlight|shading))?$/.test(m));
        if (left.length) problems.push(`${label}: F12 left ${left[0]}`);
        after.nodesBetween(from, to, (n, pos) => {
          if (n.isTextblock && from <= pos + 1 && to >= pos + 1 + n.content.size && n.attrs.style !== 'normal') problems.push(`${label}: F12 left a whole ${n.attrs.style} line`);
          return !n.isTextblock;
        });
      }
    }
    expect(problems).toEqual([]);
  }, 60000);

  it('random typing, Enter, Backspace, Delete, Tab and formatting never break the doc, and undo goes all the way back', () => {
    const problems: string[] = [];
    const KEYS = ['Backspace', 'Delete', 'Enter', 'Tab', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F4', 'F6', 'ArrowLeft'];
    for (let round = 0; round < 400 && problems.length < 12; round++) {
      seed = round * 31 + 3;
      views.forEach((x) => { x.destroy(); x.dom.parentElement?.remove(); }); views = [];
      const mount = document.createElement('div');
      document.body.appendChild(mount);
      const v = createView(mount, () => {}, randomDoc());
      views.push(v);
      const start = v.state.doc;
      const log: string[] = [];
      try {
        for (let step = 0; step < 25; step++) {
          const size = v.state.doc.content.size;
          const a = Math.floor(rand() * (size + 1)), b = rand() < 0.5 ? a : Math.floor(rand() * (size + 1));
          v.dispatch(v.state.tr.setSelection(TextSelection.between(v.state.doc.resolve(Math.min(a, b)), v.state.doc.resolve(Math.max(a, b)))));
          if (rand() < 0.3) {
            const text = pick(['x', ' ', 'word ', '.', 'Smith 24']);
            const { from, to } = v.state.selection;
            if (!v.someProp('handleTextInput', (f) => f(v, from, to, text, () => v.state.tr.insertText(text, from, to)))) v.dispatch(v.state.tr.insertText(text, from, to));
            log.push(`type "${text}" at ${from}-${to}`);
          } else {
            const k = pick(KEYS);
            key(v, k);
            log.push(`${k} at ${Math.min(a, b)}-${Math.max(a, b)}`);
          }
          v.state.doc.check();
        }
      } catch (e) { problems.push(`round ${round} threw ${(e as Error).message} after ${log.slice(-3).join(', ')}`); continue; }
      // undo everything (Tab can be a fixed key with no undo of its own, so give it plenty of tries)
      for (let i = 0; i < 80 && !v.state.doc.eq(start); i++) key(v, 'z', true);
      if (!v.state.doc.eq(start)) problems.push(`round ${round}: undo didn't get back to the start (${log.join(', ')})`);
    }
    expect(problems).toEqual([]);
  }, 60000);
});
