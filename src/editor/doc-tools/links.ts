import { Plugin, type Command } from 'prosemirror-state';
import { schema } from '../schema';
import { isReading } from '../read';
import { scopeOf } from './gaps';
import './links.css';

const link = schema.marks.link;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Web addresses in text: http(s):// or www. up to the next space, angle bracket or quote. Sentence punctuation
 * at the end stays outside, and so does a closing bracket with no partner inside ("(see https://x.org/a)").
 */
export function findUrls(text: string): { start: number; end: number; href: string }[] {
  const out = [];
  for (const m of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'“”‘’]+/gi)) {
    let s = m[0];
    for (;;) {
      const last = s[s.length - 1], open = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[last];
      if (/[.,;:!?]/.test(last)) s = s.slice(0, -1);
      else if (open && s.split(last).length > s.split(open).length) s = s.slice(0, -1);
      else break;
    }
    const host = s.replace(/^(https?:\/\/)?(www\.)?/i, '').split(/[/?#]/)[0];
    const www = /^www\./i.test(s);
    if (!host || (!www && !/[.:]/.test(host) && !/^localhost$/i.test(host))) continue;
    out.push({ start: m.index!, end: m.index! + s.length, href: www ? `https://${s}` : s });
  }
  return out;
}

/** Doc menu: link every unlinked web address in the selection (an address partly selected is linked whole), or the whole document. */
export const linkUrls: Command = (state, dispatch) => {
  if (isReading(state)) return false;
  const tr = state.tr;
  for (const r of scopeOf(state)) {
    state.doc.nodesBetween(r.from, r.to, (para, pos) => {
      if (!para.isTextblock) return true;
      const start = pos + 1;
      for (const u of findUrls(para.textBetween(0, para.content.size, undefined, '\n'))) {
        const a = start + u.start, b = start + u.end;
        if (b > r.from && a < r.to && !tr.doc.rangeHasMark(a, b, link)) tr.addMark(a, b, link.create({ href: u.href }));
      }
      return false;
    });
  }
  if (!tr.docChanged) return false;
  dispatch?.(tr);
  return true;
};

/** Doc menu: drop the links in the selection, or the whole document. The text and its formatting stay. */
export const removeHyperlinks: Command = (state, dispatch) => {
  if (isReading(state)) return false;
  const tr = state.tr;
  for (const r of scopeOf(state)) if (state.doc.rangeHasMark(r.from, r.to, link)) tr.removeMark(r.from, r.to, link);
  if (!tr.docChanged) return false;
  dispatch?.(tr);
  return true;
};

/**
 * A plain click on a link only places the cursor; Cmd-click (Ctrl-click elsewhere) opens it in the browser.
 * Only web addresses open: the desktop app hands window.open to the system browser and refuses the rest.
 * Must run before the mouse-selection plugin, which otherwise takes Cmd/Ctrl-click to add a stretch.
 */
export const linkClickPlugin = new Plugin({
  props: {
    handleDOMEvents: {
      mousedown: (_view, ev) => {
        const e = ev as MouseEvent;
        if (e.button !== 0 || e.shiftKey || e.altKey || !(isMac ? e.metaKey : e.ctrlKey)) return false;
        const href = (e.target as HTMLElement).closest?.('a.f-link')?.getAttribute('data-href');
        if (!href || !/^https?:\/\//i.test(href)) return false;
        e.preventDefault();
        window.open(href, '_blank', 'noopener');
        return true;
      },
    },
  },
});
