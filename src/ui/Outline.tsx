import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorView } from 'prosemirror-view';
import type { Command, Transaction } from 'prosemirror-state';
import { searchOutline, type OutlineItem } from '../editor/outline';
import { alphabetize, canDrop, deleteSections, moveSections, sectionsSlice, selectSections, topSections } from '../editor/nav/sections';
import { copySlice } from '../editor/nav/clipboard';
import { numberMarks, setNavScope, toggleRestart, toggleRole } from '../editor/nav/numbering';
import { copyModifier } from '../editor/nav/page-drag';
import { readSetting, type SettingSpec } from '../editor/tools';
import { onPrefs } from '../editor/prefs';

import { outlineContentSetting, outlineHideSetting, outlineLevelSetting } from '../editor/nav-keys';
import { SvgIcon } from './icons';
import { tidyHeading } from './recents';
import { safeSet } from './storage';
import { reducedMotion } from './motion';
import { outlinePreview } from './outline-preview';
import { OL_DEFAULT, OL_MAX, OL_MIN, loadOutlineWidth, outlineMax, outlineWidth, saveOutlineWidth } from './outline-width';
import { IS_MAC } from '../editor/keybinds';
import './outline.css';

/** autoFocus for a box shown after load (Preact only sets the attribute, which browsers ignore then): a stable ref, so it runs once. */
const focusOnMount = (el: HTMLInputElement | null) => el?.focus();

const modKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (IS_MAC ? e.metaKey : e.ctrlKey);
const save = (spec: SettingSpec, v: string | boolean) => safeSet(spec.key, typeof v === 'boolean' ? (v ? 'on' : 'off') : v);

type Props = {
  active: number; shown: boolean; items: OutlineItem[]; depth: number; cur: number;
  /** labels from card numbering, one per row ('' for none) */
  numbers: string[];
  getView: () => EditorView | null;
  onDepth: (n: number) => void;
  onJump: (item: OutlineItem, index: number) => void;
  /** scroll the page to a row without moving the cursor or focus */
  onPeek: (item: OutlineItem) => void;
  flash: (msg: string) => void;
};

// ---------- the outline: attached to the document, docked on the page's left edge ----------

export function OutlinePane(props: Props) {
  const { shown, items, cur } = props;
  const [query, setQuery] = useState<string | null>(null);
  const [level, setLevel] = useState(() => readSetting(outlineLevelSetting) as string);
  const [hide, setHide] = useState(() => readSetting(outlineHideSetting) as boolean);
  const [content, setContent] = useState(() => readSetting(outlineContentSetting) as boolean);
  const [step, setStep] = useState(-1); // which match Up/Down is on
  // Import settings or Restore defaults changed them underneath
  useEffect(() => onPrefs(() => {
    setLevel(readSetting(outlineLevelSetting) as string); setHide(readSetting(outlineHideSetting) as boolean); setContent(readSetting(outlineContentSetting) as boolean);
  }), []);
  const lvRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLSpanElement>(null);
  // the 1-4 highlight slides to the chosen level
  useLayoutEffect(() => {
    const b = lvRef.current?.querySelector<HTMLElement>(`[data-lv="${props.depth}"]`);
    if (b && hlRef.current) hlRef.current.style.transform = `translateX(${b.offsetLeft - 2}px)`;
  }, [props.depth, shown]);

  // searching card text walks the whole doc: let typing in the box stay ahead of it
  const q = useDeferredValue((query ?? '').trim());
  const hits = useMemo(() => {
    const doc = props.getView()?.state.doc;
    return q && doc ? searchOutline(items, doc, q, level === 'all' ? 0 : Number(level), content) : null;
  }, [items, q, level, content, props.getView]);
  useEffect(() => setStep(-1), [hits]);

  const close = () => { setQuery(null); setStep(-1); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!hits?.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = hits.length, next = step < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (step + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      setStep(next);
      props.onPeek(items[hits[next]]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const i = hits[Math.max(step, 0)];
      props.onJump(items[i], i);
    }
  };
  const opt = (label: string, on: boolean, set: (v: boolean) => void, spec: SettingSpec, title: string) => (
    <button className="ol-tg" aria-pressed={on} title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => { set(!on); save(spec, !on); }}>{label}</button>
  );

  // hidden means gone: no strip on the page's edge, nothing to hover
  return (
    <aside className={`olp${shown ? ' shown' : ''}`} aria-hidden={!shown}>
      <OutlineGrip />
      <div className="sb-scroll">
        <div className="ol-head">
          <span className="sb-label">Outline</span>
          <div ref={lvRef} className="lv" role="group" aria-label="Outline depth">
            <span ref={hlRef} className="lv-hl" />
            {[1, 2, 3, 4].map((l) => { const t = `Show ${['pockets', 'down to hats', 'down to blocks', 'down to tags'][l - 1]}`; return <button key={l} data-lv={l} data-on={props.depth === l || undefined} aria-label={t} title={t} onClick={() => props.onDepth(l)}>{l}</button>; })}
          </div>
          <button className="sb-ico" title="Search the outline" aria-label="Search the outline" onClick={() => (query === null ? setQuery('') : close())}><SvgIcon name="search" /></button>
        </div>
        {query !== null && <>
          <input className="ol-q" ref={focusOnMount} placeholder="Search this outline" aria-label="Search outline" spellCheck={false} value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} />
          <div className="ol-opts">
            <div className="ol-lv" role="radiogroup" aria-label="Search level">
              {outlineLevelSetting.kind === 'choice' && outlineLevelSetting.options.map(([v, name]) => (
                <button key={v} role="radio" aria-checked={level === v} title={v === 'all' ? 'Search every heading' : `Search ${name.toLowerCase()} only`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => { setLevel(v); save(outlineLevelSetting, v); }}>{v === 'all' ? 'All' : name[0]}</button>
              ))}
            </div>
            <span className="ol-br" />
            {opt('Hide others', hide, setHide, outlineHideSetting, 'Show only the matches and the headings above them')}
            {opt('Card text', content, setContent, outlineContentSetting, 'A heading also matches when the text under it does')}
          </div>
          {hits && <div className="ol-count">{hits.length ? `${step >= 0 ? `${step + 1} of ` : ''}${hits.length} ${hits.length === 1 ? 'match' : 'matches'} · ↑↓ to step, Enter to go` : 'No matches'}</div>}
        </>}
        <OutlineRows key={props.active} items={items} depth={props.depth} cur={cur} hits={hits} hide={hide} step={hits && step >= 0 ? hits[step] : -1}
          numbers={props.numbers} getView={props.getView} onJump={props.onJump} flash={props.flash} visible={shown} />
      </div>
    </aside>
  );
}

type RowsProps = {
  items: OutlineItem[]; depth: number; cur: number; hits: number[] | null; hide: boolean; step: number; numbers: string[];
  getView: () => EditorView | null; onJump: (item: OutlineItem, index: number) => void; flash: (msg: string) => void; visible: boolean;
};
type Drag = { heads: number[]; x: number; y: number; on: boolean; gap: number | null; raf: number; end?: (ok: boolean) => void };

const OutlineRows = memo(function OutlineRows({ items, depth, cur, hits, hide, step, numbers, getView, onJump, flash, visible }: RowsProps) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [drop, setDrop] = useState<{ top: number } | null>(null);
  const anchor = useRef(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const actRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // folds follow the heading's key (its text under its parents), so typing above it doesn't move them
  const keyOf = (item: OutlineItem) => item.key;
  useEffect(() => { setFolded(new Set()); setOpened(new Set()); }, [depth]);
  // the doc changed: row numbers point elsewhere now
  useEffect(() => { setSel(new Set()); setMenu(null); }, [items]);

  // the numbering keys act on a multi-selection here
  const selRef = useRef(sel);
  selRef.current = sel;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const outlineScope = useRef(() => (selRef.current.size > 1 ? [...selRef.current].map((i) => itemsRef.current[i]?.pos).filter((p) => p !== undefined) : [])).current;
  useEffect(() => { setNavScope(outlineScope); return () => setNavScope(() => []); }, [outlineScope]);
  // clicking in the page lets go of the outline's selection
  useEffect(() => {
    const down = (e: MouseEvent) => { if ((e.target as HTMLElement).closest?.('.ProseMirror')) setSel((s) => (s.size ? new Set() : s)); };
    document.addEventListener('mousedown', down, true);
    return () => document.removeEventListener('mousedown', down, true);
  }, []);

  // searching: matches plus the headings above them (Hide others), or the usual outline with them shown
  const keep = useMemo(() => {
    if (!hits) return null;
    const k = items.map(() => false);
    for (const i of hits) k[i] = true;
    const stack: number[] = [];
    items.forEach((it, i) => {
      while (stack.length && items[stack[stack.length - 1]].level >= it.level) stack.pop();
      if (k[i]) stack.forEach((s) => (k[s] = true));
      stack.push(i);
    });
    return k;
  }, [items, hits]);
  const hitSet = useMemo(() => new Set(hits ?? []), [hits]);

  const rows = useMemo(() => {
  const rows: { item: OutlineItem; i: number; open: boolean }[] = [];
  let hideBelow = Infinity;
  const parents: { level: number; byHand: boolean }[] = [];
  items.forEach((item, i) => {
    if (keep && hide) { if (keep[i]) rows.push({ item, i, open: item.hasKids }); return; }
    const forced = !!keep?.[i];
    if (item.level > hideBelow && !forced) return;
    if (item.level <= hideBelow) hideBelow = Infinity;
    while (parents.length && parents[parents.length - 1].level >= item.level) parents.pop();
    // past the depth, a heading shows only under one you opened by hand (or when it's a search match)
    if (!forced && item.level > depth && !parents[parents.length - 1]?.byHand) { hideBelow = item.level; return; }
    const byHand = opened.has(keyOf(item));
    const open = item.hasKids && (folded.has(keyOf(item)) ? false : item.level < depth || byHand);
    rows.push({ item, i, open });
    parents.push({ level: item.level, byHand: open && item.level >= depth });
    if (!open && hideBelow === Infinity) hideBelow = item.level;
  });
  return rows;
  }, [items, depth, folded, opened, keep, hide]);
  const toggle = (item: OutlineItem, open: boolean) => {
    const k = keyOf(item);
    if (open) { setFolded((s) => new Set(s).add(k)); setOpened((s) => { const n = new Set(s); n.delete(k); return n; }); }
    else { setOpened((s) => new Set(s).add(k)); setFolded((s) => { const n = new Set(s); n.delete(k); return n; }); }
  };

  // the row to light: the match Up/Down is on, else the current heading (or the nearest shown one above it)
  let lit = -1;
  const shownIdx = new Set(rows.map((r) => r.i));
  if (step >= 0 && shownIdx.has(step)) lit = step;
  else if (cur >= 0) {
    let level = Infinity;
    for (let i = cur; i >= 0; i--) {
      if (items[i].level < level || i === cur) {
        if (shownIdx.has(i)) { lit = i; break; }
        level = Math.min(level, items[i].level);
      }
    }
  }

  // one lit pill slides to the active row; the list scrolls to keep it in view
  useLayoutEffect(() => {
    const list = listRef.current, act = actRef.current;
    if (!list || !act) return;
    const row = list.querySelector<HTMLElement>(`[data-i="${lit}"]`), was = list.querySelector('.sb-row.ol[data-on]');
    if (was !== row) { was?.removeAttribute('data-on'); row?.setAttribute('data-on', ''); } // not rendered: see `list`
    if (!row) { act.style.opacity = '0'; return; }
    act.style.height = `${row.offsetHeight}px`;
    act.style.transform = `translateY(${row.offsetTop}px)`;
    act.style.opacity = '1';
    if (!visible || dragRef.current?.on) return;
    const s = list.closest('.sb-scroll') as HTMLElement | null;
    if (!s) return;
    const rt = row.getBoundingClientRect(), st = s.getBoundingClientRect();
    if (rt.top < st.top + 40 || rt.bottom > st.bottom - 40) s.scrollTo({ top: s.scrollTop + rt.top - st.top - st.height / 3, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
  // the pill only animates after the first placement
  useEffect(() => { const r = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true))); return () => cancelAnimationFrame(r); }, []);
  // a tag's card beside the pane (the list isn't there while the outline is empty)
  const some = rows.length > 0;
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    return outlinePreview(list, getView, (row) => { const it = itemsRef.current[Number(row.dataset.i)]; return it?.level === 4 ? it.pos : null; });
  }, [some, getView]);

  // ---- acting on headings ----
  /** The rows an action covers: the selection when the row is part of it, else the row alone. */
  const targets = (i: number) => (sel.has(i) && sel.size > 1 ? [...sel].sort((a, b) => a - b) : [i]);
  /** Heading positions for rows, checked against the doc (the outline can trail typing by a moment). */
  const headsOf = (rowsIdx: number[]) => {
    const v = getView();
    if (!v) return null;
    const heads = rowsIdx.map((i) => items[i]?.pos);
    const fresh = heads.every((p, k) => p !== undefined && p < v.state.doc.content.size && v.state.doc.nodeAt(p)?.textContent.trim() === items[rowsIdx[k]].text);
    return fresh ? { v, heads: heads as number[] } : null;
  };
  const apply = (v: EditorView, tr: Transaction | null) => { if (tr) v.dispatch(tr); v.focus(); };
  const runOn = (rowsIdx: number[], cmd: Command) => {
    const h = headsOf(rowsIdx);
    if (!h) return;
    // the numbering commands act on the outline's scope: point it at these rows for the call
    setNavScope(() => h.heads);
    try { cmd(h.v.state, h.v.dispatch, h.v); } finally { setNavScope(outlineScope); }
    h.v.focus();
  };
  const act = async (what: string, rowsIdx: number[]) => {
    setMenu(null);
    const h = headsOf(rowsIdx);
    if (!h) return;
    const { v, heads } = h;
    if (what === 'select') apply(v, selectSections(v.state, heads));
    else if (what === 'delete') apply(v, deleteSections(v.state, heads));
    else if (what === 'alpha') apply(v, alphabetize(v.state, heads));
    else if (what === 'copy' || what === 'cut') {
      const doc = v.state.doc;
      const ok = await copySlice(sectionsSlice(doc, heads));
      if (!ok) { flash("Couldn't copy to the clipboard"); return; }
      // cut removes the headings only once the copy has landed, and only if nothing changed meanwhile
      if (what === 'cut' && v.state.doc === doc) apply(v, deleteSections(v.state, heads));
      else v.focus();
      const n = topSections(doc, heads).length;
      flash(`${what === 'cut' ? 'Cut' : 'Copied'} ${n === 1 ? 'the heading and everything under it' : `${n} headings and everything under them`}`);
    }
  };

  // ---- clicks, Mod-click, Shift-click ----
  const click = (e: React.MouseEvent, item: OutlineItem, i: number, open: boolean) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if ((e.target as HTMLElement).closest('[data-tw]') && item.hasKids && !(keep && hide)) { toggle(item, open); return; }
    if (modKey(e)) {
      setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
      anchor.current = i;
      return;
    }
    if (e.shiftKey) {
      const from = anchor.current >= 0 ? anchor.current : lit >= 0 ? lit : i;
      const a = rows.findIndex((r) => r.i === from), b = rows.findIndex((r) => r.i === i);
      if (a >= 0 && b >= 0) setSel(new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.i)));
      return;
    }
    anchor.current = i;
    const inMulti = sel.size > 1 && sel.has(i);
    if (!inMulti) setSel(new Set());
    onJump(item, i);
    startDrag(e, inMulti ? targets(i) : [i]);
  };

  // ---- dragging rows to reorder (Alt on macOS, Ctrl elsewhere, copies) ----
  const dragRef = useRef<Drag | null>(null);
  const startDrag = (e: React.MouseEvent, rowsIdx: number[]) => {
    if (hits) return; // results are for finding; clear the search to rearrange
    const h = headsOf(rowsIdx);
    if (!h) return;
    const d: Drag = { heads: h.heads, x: e.clientX, y: e.clientY, on: false, gap: null, raf: 0 };
    dragRef.current = d;
    const list = listRef.current!;
    const scroller = list.closest('.sb-scroll') as HTMLElement;
    const aim = () => {
      const v = getView();
      if (!v) return;
      const doc = v.state.doc, secs = topSections(doc, d.heads);
      // a gap before each shown row, and one after the last
      const els = [...list.querySelectorAll<HTMLElement>('.sb-row[data-i]')];
      const lr = list.getBoundingClientRect();
      let best: { gap: number; top: number } | null = null;
      const consider = (gap: number, top: number) => {
        if (!canDrop(doc, secs, gap)) return;
        if (!best || Math.abs(top + lr.top - d.y) < Math.abs(best.top + lr.top - d.y)) best = { gap, top };
      };
      for (const el of els) { const it = items[Number(el.dataset.i)]; if (it) consider(it.pos, el.offsetTop); }
      const last = els[els.length - 1];
      if (last) consider(doc.content.size, last.offsetTop + last.offsetHeight);
      const b = best as { gap: number; top: number } | null;
      const noop = !b || (secs.length === 1 && (b.gap === secs[0].from || b.gap === secs[0].to));
      d.gap = noop ? null : b!.gap;
      setDrop(noop ? null : { top: b!.top });
    };
    const tick = () => {
      const r = scroller.getBoundingClientRect();
      const dy = d.y < r.top + 40 ? -(r.top + 40 - d.y) : d.y > r.bottom - 40 ? d.y - (r.bottom - 40) : 0;
      if (dy) { scroller.scrollTop += Math.max(-20, Math.min(20, dy / 2)); aim(); }
      d.raf = requestAnimationFrame(tick);
    };
    const move = (ev: MouseEvent) => {
      if (!ev.buttons) { end(false); return; } // the button came up somewhere we didn't hear about
      d.x = ev.clientX; d.y = ev.clientY;
      if (!d.on && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
      if (!d.on) { d.on = true; document.body.classList.add('f-grabbing'); list.dataset.dragging = ''; d.raf = requestAnimationFrame(tick); }
      document.body.classList.toggle('f-copying', copyModifier(ev));
      aim();
    };
    const end = (ok: boolean, ev?: MouseEvent) => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', up, true);
      document.removeEventListener('keydown', key, true);
      cancelAnimationFrame(d.raf);
      document.body.classList.remove('f-grabbing', 'f-copying');
      delete list.dataset.dragging;
      setDrop(null);
      dragRef.current = null;
      const v = getView();
      if (!d.on && rowsIdx.length > 1) setSel(new Set()); // a plain click on a selected row selects just it
      if (!ok || !d.on || d.gap === null || !v) return;
      const tr = moveSections(v.state, d.heads, d.gap, !!ev && copyModifier(ev));
      if (tr) { v.dispatch(tr); setSel(new Set()); }
      v.focus();
    };
    d.end = end;
    const up = (ev: MouseEvent) => end(true, ev);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(false); } };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
    document.addEventListener('keydown', key, true);
  };
  // unmounted mid-drag (the doc was switched): drop the drag, so its mouseup can't move the new doc's sections
  useEffect(() => () => { dragRef.current?.end?.(false); }, []);

  // ---- the right-click menu ----
  const [menuRows, setMenuRows] = useState<number[]>([]);
  const openMenu = (e: React.MouseEvent, i: number) => {
    e.preventDefault();
    const t = targets(i);
    if (!(sel.has(i) && sel.size > 1)) setSel(new Set());
    setMenuRows(t);
    setMenu({ x: e.clientX, y: e.clientY });
  };
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !menu) return;
    el.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - el.offsetHeight - 8))}px`;
    requestAnimationFrame(() => el.classList.add('in'));
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); } };
    const close = () => setMenu(null);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); removeEventListener('resize', close); };
  }, [menu]);

  const menuEl = menu && (() => {
    const n = menuRows.length;
    const what = n > 1 ? `${n} headings` : 'heading';
    const searching = !!hits;
    const v = getView();
    const marks = v ? numberMarks(v.state) : new Map();
    const its = menuRows.map((i) => items[i]).filter(Boolean);
    const cards = its.filter((it) => it.level === 4), blocks = its.filter((it) => it.level === 3);
    const item = (label: string, run: () => void, hint?: string) => (
      <button key={label} className="mn-i" role="menuitem" title={hint} onMouseDown={(e) => e.preventDefault()} onClick={run}><span>{label}</span></button>
    );
    const numberItems = [
      cards.length > 0 && item(cards.every((c) => marks.get(c.pos)?.role === 'number') ? 'Remove number' : 'Number', () => { setMenu(null); runOn(menuRows.filter((i) => items[i]?.level === 4), toggleRole('number')); }, 'Number these cards (display only: the text and the saved file are untouched)'),
      cards.length > 0 && item(cards.every((c) => marks.get(c.pos)?.role === 'sub') ? 'Remove substructure' : 'Substructure', () => { setMenu(null); runOn(menuRows.filter((i) => items[i]?.level === 4), toggleRole('sub')); }, 'Letter these cards under the number above: 1, a, b, 2'),
      blocks.length > 0 && item(blocks.every((b) => marks.get(b.pos)?.flip) ? 'Restart numbering here' : 'Continue numbering from above', () => { setMenu(null); runOn(menuRows.filter((i) => items[i]?.level === 3), toggleRestart); }),
      !blocks.length && cards.length > 0 && item(cards.every((c) => marks.get(c.pos)?.flip) ? 'Don\'t restart numbering' : 'Restart numbering here', () => { setMenu(null); runOn(menuRows.filter((i) => items[i]?.level === 4), toggleRestart); }),
    ].filter(Boolean);
    return createPortal(
      <div ref={menuRef} className="pop menu ol-menu" role="menu" aria-label="Outline">
        <div className="mn-sec" role="group" aria-label={n > 1 ? `${n} headings` : 'Heading'}>
          <div className="mn-h">{n > 1 ? `${n} headings, with everything under them` : 'Heading, with everything under it'}</div>
          {item('Select', () => void act('select', menuRows), `Select the ${what} and everything under ${n > 1 ? 'them' : 'it'}`)}
          {!searching && item('Cut', () => void act('cut', menuRows))}
          {item('Copy', () => void act('copy', menuRows))}
          {!searching && item('Delete', () => void act('delete', menuRows))}
          {!searching && n > 1 && item(`Alphabetize ${n} headings`, () => void act('alpha', menuRows), 'Sort by heading text; each lands in one of the places the selection held')}
        </div>
        {!searching && numberItems.length > 0 && <div className="mn-sec" role="group" aria-label="Numbering"><div className="mn-h">Numbering</div>{numberItems}</div>}
      </div>, document.body);
  })();

  // The rows, rendered again only when they change, not when the lit row moves: that happens at every heading the page
  // scrolls past, and diffing ~800 rows for it took ~30 ms a time. The lit row's data-on is set in the effect above, and
  // the rows call the handlers of the latest render
  const on = useRef({ click, openMenu, toggle });
  on.current = { click, openMenu, toggle };
  const list = useMemo(() => rows.map(({ item, i, open }) => (
    <button key={item.pos} data-i={i} className={`sb-row ol l${item.level}`} aria-expanded={item.hasKids ? open : undefined}
      aria-selected={sel.size > 1 ? sel.has(i) : undefined} data-hit={hitSet.has(i) || undefined}
      style={{ paddingLeft: 6 + (item.level - 1) * 14 }}
      onMouseDown={(e) => on.current.click(e, item, i, open)}
      onContextMenu={(e) => on.current.openMenu(e, i)}
      onDoubleClick={(e) => item.hasKids && !(keep && hide) && !(e.target as HTMLElement).closest('[data-tw]') && on.current.toggle(item, open)}>
      {item.hasKids ? <span className="ic tw" data-tw><SvgIcon name="chev" /></span> : <span className="ic sp" />}
      {numbers[i] && <span className="num">{numbers[i]}</span>}
      <span className={`nm${item.text ? '' : ' empty'}`}>{tidyHeading(item.text) || 'Untitled'}</span>
      {item.cite && <span className="cite">{item.cite}</span>}
      {item.level < 4 && item.cards > 0 && <span className="ct">{item.cards}</span>}
    </button>
  )), [rows, sel, hitSet, numbers, keep, hide]);

  if (!rows.length) return <div className="ol-none">{hits ? 'Nothing in this file matches.' : 'Pockets, hats, blocks and tags show up here.'}</div>;
  return (
    <div ref={listRef} className="sb-list" data-ready={ready || undefined}>
      <span ref={actRef} className="sb-act" />
      {drop && <span className="ol-drop" style={{ transform: `translateY(${drop.top - 1}px)` }} />}
      {list}
      {menuEl}
    </div>
  );
});

/** The outline's right edge: drag it wider or narrower, double-click for the default, arrows step it. */
function OutlineGrip() {
  const [width, setWidth] = useState(loadOutlineWidth);
  useLayoutEffect(() => { document.documentElement.style.setProperty('--ol-w', `${width}px`); }, [width]);
  // a narrower window shrinks it to fit; the saved width stays for when the window grows again
  useEffect(() => { const fit = () => setWidth(loadOutlineWidth()); addEventListener('resize', fit); return () => removeEventListener('resize', fit); }, []);
  const resize = (w: number) => { setWidth(w); saveOutlineWidth(w); };
  const grab = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = e.clientX - width, root = document.documentElement;
    let w = width, raf = 0;
    root.dataset.olDrag = '';
    const move = (m: PointerEvent) => { w = outlineWidth(m.clientX - from, outlineMax()); cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setWidth(w)); };
    const up = () => {
      cancelAnimationFrame(raf);
      delete root.dataset.olDrag;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      resize(w);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  };
  const step = (e: React.KeyboardEvent) => {
    const to = { ArrowLeft: width - 16, ArrowRight: width + 16, Home: OL_MIN, End: OL_MAX }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    resize(outlineWidth(to, outlineMax()));
  };
  return <div className="ol-grip" role="separator" aria-orientation="vertical" aria-label="Outline width" tabIndex={0}
    aria-valuemin={OL_MIN} aria-valuemax={OL_MAX} aria-valuenow={width}
    title="Outline width: drag to resize, double-click to reset"
    // a mouse drag leaves focus where it was, so the edge doesn't stay lit after letting go
    onPointerDown={grab} onMouseDown={(e) => e.preventDefault()} onDoubleClick={() => resize(OL_DEFAULT)} onKeyDown={step} />;
}
