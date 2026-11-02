import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { OutlineItem } from '../editor/outline';
import { SvgIcon } from './icons';
import { tidy } from './recents';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- the outline: attached to the document, docked on the page's left edge ----------

export function OutlinePane(props: { active: number; shown: boolean; items: OutlineItem[]; depth: number; cur: number; onDepth: (n: number) => void; onJump: (item: OutlineItem, index: number) => void }) {
  const { shown, items, cur } = props;
  const [query, setQuery] = useState<string | null>(null);
  const lvRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLSpanElement>(null);
  // the 1-4 highlight slides to the chosen level
  useLayoutEffect(() => {
    const b = lvRef.current?.querySelector<HTMLElement>(`[data-lv="${props.depth}"]`);
    if (b && hlRef.current) hlRef.current.style.transform = `translateX(${b.offsetLeft - 2}px)`;
  }, [props.depth, shown]);
  // hidden means gone: no strip on the page's edge, nothing to hover
  return (
    <aside className={`olp${shown ? ' shown' : ''}`} aria-hidden={!shown}>
      <div className="sb-scroll">
        <div className="ol-head">
          <span className="sb-label">Outline</span>
          <div ref={lvRef} className="lv" role="group" aria-label="Outline depth">
            <span ref={hlRef} className="lv-hl" />
            {[1, 2, 3, 4].map((l) => { const t = `Show ${['pockets', 'down to hats', 'down to blocks', 'down to tags'][l - 1]}`; return <button key={l} data-lv={l} data-on={props.depth === l || undefined} aria-label={t} title={t} onClick={() => props.onDepth(l)}>{l}</button>; })}
          </div>
          <button className="sb-ico" title="Filter the outline by name" onClick={() => setQuery((q) => (q === null ? '' : null))}><SvgIcon name="search" /></button>
        </div>
        {query !== null && <input className="ol-q" autoFocus placeholder="Filter this outline" aria-label="Filter outline" spellCheck={false} value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null); } }} />}
        <OutlineRows key={props.active} items={items} depth={props.depth} cur={cur} query={(query ?? '').trim().toLowerCase()} onJump={props.onJump} visible={shown} />
      </div>
    </aside>
  );
}

const OutlineRows = memo(function OutlineRows({ items, depth, cur, query, onJump, visible }: { items: OutlineItem[]; depth: number; cur: number; query: string; onJump: (item: OutlineItem, index: number) => void; visible: boolean }) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const actRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  // folds follow the heading (level + text), so typing above it doesn't move them to another heading
  const keyOf = (item: OutlineItem) => `${item.level}:${item.text}`;
  useEffect(() => { setFolded(new Set()); setOpened(new Set()); }, [depth]);

  // filtering keeps a heading when it or anything under it matches, and opens everything
  const keep = useMemo(() => {
    if (!query) return null;
    const k = items.map((it) => it.text.toLowerCase().includes(query));
    const stack: number[] = [];
    items.forEach((it, i) => {
      while (stack.length && items[stack[stack.length - 1]].level >= it.level) stack.pop();
      if (k[i]) stack.forEach((s) => (k[s] = true));
      stack.push(i);
    });
    return k;
  }, [items, query]);

  const rows: { item: OutlineItem; i: number; open: boolean }[] = [];
  let hideBelow = Infinity;
  const parents: { level: number; byHand: boolean }[] = [];
  items.forEach((item, i) => {
    if (keep) { if (keep[i]) rows.push({ item, i, open: item.hasKids }); return; }
    if (item.level > hideBelow) return;
    hideBelow = Infinity;
    while (parents.length && parents[parents.length - 1].level >= item.level) parents.pop();
    // past the depth, a heading shows only under one you opened by hand
    if (item.level > depth && !parents[parents.length - 1]?.byHand) { hideBelow = item.level; return; }
    const byHand = opened.has(keyOf(item));
    const open = item.hasKids && (folded.has(keyOf(item)) ? false : item.level < depth || byHand);
    rows.push({ item, i, open });
    parents.push({ level: item.level, byHand: open && item.level >= depth });
    if (!open) hideBelow = item.level;
  });
  const toggle = (item: OutlineItem, open: boolean) => {
    const k = keyOf(item);
    if (open) { setFolded((s) => new Set(s).add(k)); setOpened((s) => { const n = new Set(s); n.delete(k); return n; }); }
    else { setOpened((s) => new Set(s).add(k)); setFolded((s) => { const n = new Set(s); n.delete(k); return n; }); }
  };

  // the row to light: the current heading, or the nearest shown heading above it when it's folded away
  let lit = -1;
  if (cur >= 0) {
    const shownIdx = new Set(rows.map((r) => r.i));
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
    const row = list.querySelector<HTMLElement>(`[data-i="${lit}"]`);
    if (!row) { act.style.opacity = '0'; return; }
    act.style.height = `${row.offsetHeight}px`;
    act.style.transform = `translateY(${row.offsetTop}px)`;
    act.style.opacity = '1';
    if (!visible) return;
    const s = list.closest('.sb-scroll') as HTMLElement | null;
    if (!s) return;
    const rt = row.getBoundingClientRect(), st = s.getBoundingClientRect();
    if (rt.top < st.top + 40 || rt.bottom > st.bottom - 40) s.scrollTo({ top: s.scrollTop + rt.top - st.top - st.height / 3, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
  // the pill only animates after the first placement
  useEffect(() => { const r = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true))); return () => cancelAnimationFrame(r); }, []);

  if (!rows.length) return <div className="ol-none">{query ? 'Nothing in this file matches.' : 'Pockets, hats, blocks and tags show up here.'}</div>;
  return (
    <div ref={listRef} className="sb-list" data-ready={ready || undefined}>
      <span ref={actRef} className="sb-act" />
      {rows.map(({ item, i, open }) => (
        <button key={item.pos} data-i={i} className={`sb-row ol l${item.level}`} data-on={i === lit || undefined} aria-expanded={item.hasKids ? open : undefined}
          style={{ paddingLeft: 6 + (item.level - 1) * 14 }}
          onMouseDown={(e) => { e.preventDefault(); if ((e.target as HTMLElement).closest('[data-tw]') && item.hasKids && !keep) toggle(item, open); else onJump(item, i); }}
          onDoubleClick={() => item.hasKids && !keep && toggle(item, open)}>
          {item.hasKids ? <span className="ic tw" data-tw><SvgIcon name="chev" /></span> : <span className="ic sp" />}
          <span className={`nm${item.text ? '' : ' empty'}`}>{tidy(item.text) || 'Untitled'}</span>
          {item.level < 4 && item.cards > 0 && <span className="ct">{item.cards}</span>}
        </button>
      ))}
    </div>
  );
});
